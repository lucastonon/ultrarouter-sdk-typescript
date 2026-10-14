# Testing your app

Unit tests should never call a real gateway or a real model provider. The client takes a `fetch`
function, so you can replace the network with a function that records what your code sends and
returns whatever response the test needs: a completion, a stream, or an error envelope.

## The pattern

1. Construct the client with `fetch: fakeFetch`, a fake `apiKey`, any `baseURL`, and
   `maxRetries: 0` (so error tests fail fast and deterministically).
2. Have `fakeFetch` record the URL, method, headers and body, and return a `Response`.
3. Assert on the recorded request and on what your code did with the response.

```ts
import assert from 'node:assert/strict';
import UltraRouter, { type ChatCompletion, type FetchLike } from '@ultrarouter/sdk';

function completion(content: string): ChatCompletion {
  return {
    id: 'chatcmpl_test',
    object: 'chat.completion',
    created: 0,
    model: 'openai/gpt-5.2-mini',
    choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    ur: {
      request_id: 'req_test',
      call_type: null,
      model_served: 'openai/gpt-5.2-mini',
      provider: 'openai',
      routing: { mode: 'off', fallback_used: false },
      compression: { applied: 'off' },
      cost_usd: 0,
      byok: false,
    },
  };
}

const requests: { url: string; method: string; body: Record<string, unknown> }[] = [];
const fakeFetch: FetchLike = async (url, init) => {
  requests.push({
    url: String(url),
    method: init?.method ?? 'GET',
    body: JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>,
  });
  return Response.json(completion('Bonjour'));
};

const ur = new UltraRouter({
  apiKey: 'ur_sk_test_fake',
  baseURL: 'https://gateway.test',
  fetch: fakeFetch,
  maxRetries: 0,
});

// Code under test.
async function translate(text: string): Promise<string> {
  const res = await ur.chat.completions.create({
    model: 'openai/gpt-5.2-mini',
    call_type: 'translate',
    messages: [{ role: 'user', content: `Translate to French: ${text}` }],
  });
  return res.choices[0]?.message.content ?? '';
}

assert.equal(await translate('Hello'), 'Bonjour');
assert.equal(requests[0]?.url, 'https://gateway.test/v1/chat/completions');
assert.equal(requests[0]?.method, 'POST');
assert.equal(requests[0]?.body.call_type, 'translate');
console.log('ok');
```

The same works in Vitest, Jest or `node:test`; only the assertion library changes.

## Simulating errors

Return the gateway's error envelope with the status you want to test. The SDK turns it into an
`UltraRouterError` exactly as it would in production:

```ts
import assert from 'node:assert/strict';
import UltraRouter, { ModelUnpricedError, UltraRouterError } from '@ultrarouter/sdk';

function failingClient(status: number, code: string, retryable = false): UltraRouter {
  return new UltraRouter({
    apiKey: 'ur_sk_test_fake',
    baseURL: 'https://gateway.test',
    maxRetries: 0,
    fetch: async () =>
      Response.json(
        { error: { code, message: code, request_id: 'req_test', retryable } },
        { status },
      ),
  });
}

const messages = [{ role: 'user' as const, content: 'hi' }];

await assert.rejects(
  failingClient(403, 'model_unpriced').chat.completions.create({ model: 'x/y', messages }),
  ModelUnpricedError,
);
await assert.rejects(
  failingClient(429, 'rate_limited', true).chat.completions.create({ model: 'x/y', messages }),
  (err: unknown) => err instanceof UltraRouterError && err.code === 'rate_limited' && err.retryable,
);
console.log('error paths ok');
```

To test your own retry handling, return a different response per call (a counter in the fake), and
leave `maxRetries` at a small number.

## Simulating a stream

A stream is a `text/event-stream` body of `data:` frames ending in `data: [DONE]`. The last chunk
should carry `usage` and `ur`:

```ts
import assert from 'node:assert/strict';
import UltraRouter from '@ultrarouter/sdk';

function sse(frames: unknown[]): Response {
  const body = frames.map((f) => `data: ${JSON.stringify(f)}\n\n`).join('') + 'data: [DONE]\n\n';
  return new Response(body, { headers: { 'content-type': 'text/event-stream' } });
}

const base = {
  id: 'c1',
  object: 'chat.completion.chunk',
  created: 0,
  model: 'openai/gpt-5.2-mini',
};
const ur = new UltraRouter({
  apiKey: 'ur_sk_test_fake',
  baseURL: 'https://gateway.test',
  maxRetries: 0,
  fetch: async () =>
    sse([
      { ...base, choices: [{ index: 0, delta: { role: 'assistant', content: 'Hel' } }] },
      { ...base, choices: [{ index: 0, delta: { content: 'lo' }, finish_reason: 'stop' }] },
    ]),
});

let text = '';
const stream = await ur.chat.completions.create({
  model: 'openai/gpt-5.2-mini',
  stream: true,
  messages: [{ role: 'user', content: 'hi' }],
});
for await (const chunk of stream) text += chunk.choices[0]?.delta.content ?? '';
assert.equal(text, 'Hello');
console.log('stream ok');
```

To simulate a mid-stream failure, add a frame `event: error\ndata: {"error":{...}}\n\n`; the loop
throws an `UltraRouterError` with that code.

## Outcomes and the durable queue in tests

`ur.ur.outcomes.record()` persists to the client's `outcomeStore` before sending. In tests use the
default in-memory store (it is per client) and call `ur.ur.outcomes.flush()` to assert delivery.
`ur.ur.outcomes.record()` does not throw for a delivery failure; check the receipt's `status`
(`delivered`, `queued` or `rejected`).

## Integration tests against a real gateway

Keep a separate, opt-in suite for a real gateway and skip it unless credentials are present, so CI
and contributors without a key are never blocked:

```ts
import UltraRouter from '@ultrarouter/sdk';

const key = process.env.ULTRAROUTER_API_KEY;
if (key === undefined || key === '') {
  console.log('skipping: ULTRAROUTER_API_KEY is not set');
} else {
  const ur = new UltraRouter({ apiKey: key });
  const models = await ur.models.list();
  console.log(`gateway reachable, ${String(models.data.length)} models`);
}
```

Use a test key (`ur_sk_test_…`) and a dedicated workspace for integration tests.

## Typed raw requests

For an operation without a dedicated method, `ur.request(method, path, init)` is typed from the
OpenAPI document, and the same fake `fetch` approach applies. See
[typed requests](./typed-requests.md).

## Related

- [Errors](./errors.md) · [Streaming](./streaming.md) · [Outcomes](./outcomes.md)
- Runnable example: [`examples/testing-with-fake-fetch.ts`](../examples/testing-with-fake-fetch.ts)
