# OpenAI compatibility

The gateway speaks the OpenAI HTTP API under `/v1`, and this SDK mirrors the `openai` client's
shape. You can adopt ultrarouter in three ways, from least to most change:

1. Keep the official `openai` client and point it at the gateway (`asOpenAI`).
2. Keep the `openai` client and set `baseURL` / `apiKey` yourself.
3. Switch to `UltraRouter`, whose `chat.completions.create`, `embeddings.create` and `models.list`
   have the same shape, plus typed access to the `ur` response block and the ultrarouter
   resources.

`openai` is not a dependency of this SDK; install it yourself if you use it.

## `asOpenAI(OpenAI)`: a ready `openai` client

Pass the `OpenAI` constructor and get an instance configured with the gateway URL (with `/v1`), your
API key and the client's default headers:

```ts
import OpenAI from 'openai';
import UltraRouter from '@ultrarouter/sdk';

const openai = new UltraRouter().asOpenAI(OpenAI);

const res = await openai.chat.completions.create({
  model: 'openai/gpt-5.2-mini',
  messages: [{ role: 'user', content: 'Hello through the openai client' }],
});
console.log(res.choices[0]?.message.content);
```

## `asOpenAI()`: just the configuration

Without an argument, `asOpenAI()` returns `{ baseURL, apiKey, defaultHeaders? }` so you can add your
own options:

```ts
import OpenAI from 'openai';
import UltraRouter from '@ultrarouter/sdk';

const config = new UltraRouter().asOpenAI();
const openai = new OpenAI({ ...config, timeout: 20_000, maxRetries: 1 });

const stream = await openai.chat.completions.create({
  model: 'openai/gpt-5.2-mini',
  stream: true,
  messages: [{ role: 'user', content: 'Stream through openai' }],
});
for await (const chunk of stream) process.stdout.write(chunk.choices[0]?.delta.content ?? '');
process.stdout.write('\n');
```

`ur.ur.asOpenAI` is the same method.

## Configuring `openai` directly

No SDK needed: use the gateway URL with `/v1` and your ultrarouter key.

```ts
import OpenAI from 'openai';

const openai = new OpenAI({
  baseURL: `${process.env.ULTRAROUTER_BASE_URL}/v1`, // your gateway, e.g. http://localhost:8080
  apiKey: process.env.ULTRAROUTER_API_KEY,
});
const models = await openai.models.list();
console.log(models.data.map((m) => m.id));
```

## What carries over

| From the `UltraRouter` client           | Carried by `asOpenAI()`?                                                                                  |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `baseURL`, `apiKey`                     | Yes (`/v1` is appended).                                                                                  |
| `defaultHeaders`                        | Yes.                                                                                                      |
| The `bench` capture tag                 | Yes — its `X-UR-Bench-*` headers are part of the default headers (a per-request `trace` function is not). |
| `defaultModel`, `defaults`, `autopilot` | No — they are applied by `UltraRouter` when it builds a request. Set them per call in `openai`.           |
| Retries, timeout                        | No — the `openai` client has its own `maxRetries` and `timeout`.                                          |

The ultrarouter request fields (`call_type`, `router`, `compression`, `provider`, `models`, `ur`)
are extra body fields; with the `openai` client you can still send them (the `openai` client
passes unknown body fields through in JavaScript, and TypeScript users can cast), and the response
still carries the `ur` block at runtime.

## Surface mapping

| `openai`                                    | `UltraRouter`                               | Notes                                             |
| ------------------------------------------- | ------------------------------------------- | ------------------------------------------------- |
| `chat.completions.create(params)`           | `chat.completions.create(params, options?)` | Same params; adds `ur` and extensions.            |
| `chat.completions.create({ stream: true })` | same                                        | Async iterable of chunks.                         |
| `embeddings.create(params)`                 | `embeddings.create(params, options?)`       | Same params.                                      |
| `models.list()`                             | `models.list(query?, options?)`             | Adds `provider` / `capability` filters.           |
| `models.retrieve(id)`                       | `models.retrieve(id, options?)`             | Returns the model with its provider offers.       |
| `new OpenAI({ baseURL, apiKey })`           | `new UltraRouter({ baseURL, apiKey })`      | `baseURL` here has no `/v1`.                      |
| `OpenAI.APIError`                           | `UltraRouterError`                          | Stable `code` strings; see [errors](./errors.md). |

Differences to keep in mind:

- `UltraRouter`'s `baseURL` is the gateway origin **without** `/v1`; `openai`'s includes it.
  `asOpenAI()` adds it for you.
- Errors are `UltraRouterError` with a gateway `code` rather than OpenAI's error classes.
- Model ids are provider-prefixed (`openai/gpt-5.2-mini`, `anthropic/claude-sonnet-4.6`).
- The Assistants, Files, Images and Audio APIs are not part of this SDK. The OpenAI Responses API
  (and the Anthropic Messages API) are reachable as [native passthrough](./passthrough.md) — point
  the official `openai` / `@anthropic-ai/sdk` clients at the gateway.

## Related

- [Chat completions](./chat-completions.md) · [Streaming](./streaming.md)
- [Configuration](./configuration.md)
- Runnable example: [`examples/openai-drop-in.ts`](../examples/openai-drop-in.ts)
