# Native passthrough: the official OpenAI and Anthropic SDKs through your gateway

The gateway speaks two more vendor APIs natively: the OpenAI Responses API at `POST /v1/responses`
and the Anthropic Messages API at `POST /v1/messages`. Point the official `openai` and
`@anthropic-ai/sdk` clients at your gateway, change only the base URL and the key, and each request
body is forwarded to the provider unchanged, metered, and returned untouched.

Unlike `chat.completions.create` and `embeddings.create`, these two surfaces are **opaque
passthrough**: the gateway does no routing, no compression, no model remapping and no field
injection. The body you send is the body the provider receives; the body the provider returns is the
body you get back (`stream: true` forwards the upstream SSE bytes verbatim). The gateway only meters,
caps and captures the call.

The intended client for these surfaces is the official vendor SDK pointed at the gateway, not a typed
method in this SDK. This SDK's own `ur.request()` reaches them too, for raw REST access.

## Two environment variables and the key

| Surface            | Base URL (env)                                 | Key (env)                              |
| ------------------ | ---------------------------------------------- | -------------------------------------- |
| OpenAI Responses   | `OPENAI_BASE_URL=<your gateway>/v1`            | `OPENAI_API_KEY=<your ur_sk_… key>`    |
| Anthropic Messages | `ANTHROPIC_BASE_URL=<your gateway>` (no `/v1`) | `ANTHROPIC_API_KEY=<your ur_sk_… key>` |

Use your ultrarouter key (`ur_sk_test_…` or `ur_sk_live_…`), not a provider key — the platform or
BYOK provider key is injected server-side and your key is never forwarded upstream. The OpenAI client
sends the key as an `Authorization: Bearer` token; the Anthropic client sends it as `x-api-key`. The
gateway accepts the ultrarouter key either way on `/v1/messages`.

<!-- doctest: skip — installs the official SDKs from the npm registry and only sets environment variables -->

```bash
npm install openai @anthropic-ai/sdk

# Point each official client at your gateway (use https://gateway.example.com for a remote one).
export OPENAI_BASE_URL="http://localhost:8080/v1"
export ANTHROPIC_BASE_URL="http://localhost:8080"
export OPENAI_API_KEY="ur_sk_test_your_key"
export ANTHROPIC_API_KEY="ur_sk_test_your_key"
```

## The ultrarouter extension headers

The ultrarouter extensions ride **request headers**, so the provider body stays untouched:

| Request header    | Meaning                                                                                  |
| ----------------- | ---------------------------------------------------------------------------------------- |
| `X-UR-Call-Type`  | The stage/call-type slug this call belongs to.                                           |
| `X-UR-Trace`      | A JSON object `{"run","case","stage","attempt"}` that ties the call to a run and a case. |
| `X-UR-Timeout-Ms` | The total timeout, clamped to 1 s–600 s (default 300 s).                                 |

Every (non-streaming) response carries two **response headers**:

| Response header       | Meaning                                               |
| --------------------- | ----------------------------------------------------- |
| `X-UR-Request-Id`     | The ultrarouter request id (`req_…`) for this call.   |
| `X-UR-Cost-Micro-USD` | The booked cost of the call, an integer in micro-USD. |

## The OpenAI Responses API through your gateway

With `OPENAI_BASE_URL` and `OPENAI_API_KEY` set as above, the official client needs no other change.
Pass the ultrarouter headers per request, and read the two response headers with the client's
`.withResponse()`:

```ts
import OpenAI from 'openai';

// Reads OPENAI_BASE_URL (your gateway + /v1) and OPENAI_API_KEY (your ur_sk_… key).
const openai = new OpenAI();

const { data, response } = await openai.responses
  .create(
    { model: 'openai/gpt-5.2-mini', input: 'Give me one word for "fast".' },
    {
      headers: {
        'X-UR-Call-Type': 'drafting',
        'X-UR-Trace': JSON.stringify({ run: 'run_1', case: 'case_1', stage: 'draft', attempt: 1 }),
        'X-UR-Timeout-Ms': '30000',
      },
    },
  )
  .withResponse();

console.log(data.output_text);
console.log('request id:', response.headers.get('X-UR-Request-Id'));
console.log('cost (micro-USD):', response.headers.get('X-UR-Cost-Micro-USD'));
```

## The Anthropic Messages API through your gateway

`@anthropic-ai/sdk` is not a dependency of this SDK; install it in your app. With `ANTHROPIC_BASE_URL`
and `ANTHROPIC_API_KEY` set, the official client is unchanged — the ultrarouter key goes in
`x-api-key` (the Anthropic default) and the same ultrarouter headers tag the call:

<!-- doctest: skip — the official @anthropic-ai/sdk is not a dependency of this SDK; install it in your app -->

```ts
import Anthropic from '@anthropic-ai/sdk';

// Reads ANTHROPIC_BASE_URL (your gateway, no /v1) and ANTHROPIC_API_KEY (your ur_sk_… key).
const anthropic = new Anthropic();

const { data, response } = await anthropic.messages
  .create(
    {
      model: 'anthropic/claude-sonnet-4.6',
      max_tokens: 64,
      messages: [{ role: 'user', content: 'Give me one word for "fast".' }],
    },
    {
      headers: {
        'X-UR-Call-Type': 'drafting',
        'X-UR-Trace': JSON.stringify({ run: 'run_1', case: 'case_1', stage: 'draft', attempt: 1 }),
        'X-UR-Timeout-Ms': '30000',
      },
    },
  )
  .withResponse();

const block = data.content[0];
console.log(block?.type === 'text' ? block.text : '');
console.log('request id:', response.headers.get('X-UR-Request-Id'));
console.log('cost (micro-USD):', response.headers.get('X-UR-Cost-Micro-USD'));
```

## Reaching the passthrough from this SDK with `ur.request()`

You can also call both operations from this SDK with [`ur.request()`](./typed-requests.md). The body
is an opaque passthrough object, so it is typed as `{ model: string }` and extra provider fields are
passed with a cast; the result is the provider's response body. `ur.request()` resolves the body
only — read the `X-UR-Request-Id` / `X-UR-Cost-Micro-USD` response headers with the official clients'
`.withResponse()` (above) or a custom `fetch`.

```ts
import UltraRouter from '@ultrarouter/sdk';

const ur = new UltraRouter();

// POST /v1/responses — the OpenAI Responses body is forwarded to OpenAI unchanged.
const res = (await ur.request('post', '/v1/responses', {
  body: { model: 'openai/gpt-5.2-mini', input: 'Give me one word for "fast".' } as never,
  headers: { 'X-UR-Call-Type': 'drafting' },
})) as unknown as { object: string; model: string; status: string };
console.log(res.object, res.status, res.model);

// POST /v1/messages — the Anthropic Messages body is forwarded to Anthropic unchanged.
const msg = (await ur.request('post', '/v1/messages', {
  body: {
    model: 'anthropic/claude-sonnet-4.6',
    max_tokens: 64,
    messages: [{ role: 'user', content: 'Give me one word for "fast".' }],
  } as never,
  headers: { 'X-UR-Call-Type': 'drafting' },
})) as unknown as { type: string; model: string; stop_reason: string };
console.log(msg.type, msg.model, msg.stop_reason);
```

## Related

- [OpenAI compatibility](./openai-compatibility.md) — `asOpenAI()` and the OpenAI-shaped
  `chat.completions` / `embeddings` surfaces this SDK mirrors.
- [Typed requests](./typed-requests.md) — `ur.request()` for any operation in the OpenAPI document.
- [API coverage](./api-coverage.md) — every gateway operation and how this SDK reaches it.
