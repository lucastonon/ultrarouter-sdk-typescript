# Streaming

Pass `stream: true` to `ur.chat.completions.create()` and you get an async iterable of
`chat.completion.chunk` objects instead of a completion. Iterate it with `for await`. The final
chunk carries `usage` and the ultrarouter `ur` block (request id, model served, cost).

The parser uses only `fetch`, `ReadableStream` and `TextDecoder`, so streaming works on Node.js,
Bun, Deno and edge runtimes.

## Print a reply as it arrives

```ts
import UltraRouter from '@ultrarouter/sdk';

const ur = new UltraRouter();

const stream = await ur.chat.completions.create({
  model: 'openai/gpt-5.2-mini',
  stream: true,
  messages: [{ role: 'user', content: 'Count from one to five.' }],
});

let text = '';
for await (const chunk of stream) {
  const delta = chunk.choices[0]?.delta.content ?? '';
  text += delta;
  process.stdout.write(delta);
  if (chunk.ur !== undefined) {
    // The final chunk: usage and the `ur` block.
    console.log(`\n${String(chunk.usage?.total_tokens)} tokens, $${String(chunk.ur.cost_usd)}`);
  }
}
console.log(text.length > 0);
```

## What the chunks contain

| Field                         | Meaning                                                         |
| ----------------------------- | --------------------------------------------------------------- |
| `choices[0].delta.role`       | On the first chunk: `assistant`.                                |
| `choices[0].delta.content`    | The next piece of text (may be empty).                          |
| `choices[0].delta.tool_calls` | Tool-call fragments when the model calls tools.                 |
| `choices[0].finish_reason`    | Set on the last content chunk (`stop`, `length`, `tool_calls`). |
| `usage`                       | Token usage, on the final chunk.                                |
| `ur`                          | The ultrarouter response block, on the final chunk.             |

Heartbeat comment lines and the terminating `data: [DONE]` frame are handled by the SDK; you never
see them.

## Collect the whole reply

```ts
import UltraRouter, { type ChatCompletionStream } from '@ultrarouter/sdk';

async function collect(
  stream: ChatCompletionStream,
): Promise<{ text: string; requestId?: string }> {
  let text = '';
  let requestId: string | undefined;
  for await (const chunk of stream) {
    text += chunk.choices[0]?.delta.content ?? '';
    if (chunk.ur !== undefined) requestId = chunk.ur.request_id;
  }
  return requestId === undefined ? { text } : { text, requestId };
}

const ur = new UltraRouter({ defaultModel: 'openai/gpt-5.2-mini' });
const result = await collect(
  await ur.chat.completions.create({ stream: true, messages: [{ role: 'user', content: 'Hi' }] }),
);
console.log(result);
```

## Stop early

Breaking out of the `for await` loop releases the stream and cancels the underlying request. To
cancel from elsewhere (a user pressing "stop"), pass an `AbortSignal`:

```ts
import UltraRouter, { isUltraRouterError } from '@ultrarouter/sdk';

const ur = new UltraRouter();
const controller = new AbortController();

const stream = await ur.chat.completions.create(
  {
    model: 'openai/gpt-5.2-mini',
    stream: true,
    messages: [{ role: 'user', content: 'Tell me a long story.' }],
  },
  { signal: controller.signal },
);

let received = 0;
try {
  for await (const chunk of stream) {
    received += (chunk.choices[0]?.delta.content ?? '').length;
    break; // stop after the first chunk
  }
} catch (err) {
  if (!isUltraRouterError(err)) throw err;
}
console.log(`stopped after ${String(received)} characters`);
```

## Errors

- A request that fails **before** the stream opens (bad key, unknown model, `model_unpriced`)
  rejects the `create()` call with an `UltraRouterError`, just like a non-streaming call.
- A failure **after** the stream opened arrives as an `event: error` frame; the `for await` loop
  throws an `UltraRouterError` with that frame's `code` (its `status` is `0`, because the HTTP
  status was already 200). The SDK never silently truncates a stream.
- A malformed frame throws an `UltraRouterError` with code `internal`.
- A stream that ends before the gateway's `data: [DONE]` throws an `UltraRouterError` with code
  `connection`: the response is incomplete, so it is never reported as a clean finish.
- The total `timeout` and your `AbortSignal` keep applying while chunks arrive: a stream that stalls
  or outlives the deadline throws `timeout`, an abort throws `aborted`. See
  [timeouts](./retries-timeouts-idempotency.md#timeouts-and-cancellation).
- The parser follows the Server-Sent Events standard: lines may end in LF, CRLF or CR (also split
  across network chunks), `:` lines are comments, and unknown fields are ignored, so a proxy that
  rewrites line endings does not break a stream.
- A stream carries no idempotency key. It is retried only when the gateway answers with a
  retryable error **before** the stream opens (nothing was generated); never after a network
  failure, and never once chunks have started. If a stream fails partway, decide in your
  application whether to start a new request.

```ts
import UltraRouter, { ModelUnpricedError } from '@ultrarouter/sdk';

const ur = new UltraRouter();
try {
  const stream = await ur.chat.completions.create({
    model: 'example/unpriced-model',
    stream: true,
    messages: [{ role: 'user', content: 'hi' }],
  });
  for await (const chunk of stream) process.stdout.write(chunk.choices[0]?.delta.content ?? '');
} catch (err) {
  if (err instanceof ModelUnpricedError) console.log('refused before the stream opened:', err.code);
  else throw err;
}
```

## With the OpenAI client

`ur.asOpenAI(OpenAI)` returns an `openai` client pointed at the gateway; its streaming works the
same way. See [OpenAI compatibility](./openai-compatibility.md).

## Related

- [Chat completions](./chat-completions.md)
- [Retries, timeouts and idempotency](./retries-timeouts-idempotency.md)
- [Errors](./errors.md)
