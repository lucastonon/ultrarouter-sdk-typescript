# Chat completions

`ur.chat.completions.create(params, options?)` sends a chat request through the gateway
(`POST /v1/chat/completions`). The request and response follow the OpenAI chat-completions shape,
with a few ultrarouter fields added: request-level routing and compression controls, a stable call
type, and the `ur` block on every response (the request id, the model that served, the cost).

Model ids are provider-prefixed (`openai/gpt-5.2-mini`). The ids in these docs are illustrative:
which models you can use depends on your gateway, and `ur.models.list()` tells you.

## A minimal call

```ts
import UltraRouter from '@ultrarouter/sdk';

const ur = new UltraRouter();

const res = await ur.chat.completions.create({
  model: 'openai/gpt-5.2-mini',
  messages: [
    { role: 'system', content: 'Answer in one short sentence.' },
    { role: 'user', content: 'What is the capital of France?' },
  ],
  temperature: 0.2,
  max_completion_tokens: 100,
});

console.log(res.choices[0]?.message.content);
console.log(res.usage.total_tokens, res.ur.cost_usd, res.ur.model_served);
```

Set `defaultModel` on the client to omit `model` from each call (a per-call `model` still wins):

```ts
import UltraRouter from '@ultrarouter/sdk';

const ur = new UltraRouter({ defaultModel: 'openai/gpt-5.2-mini' });
const res = await ur.chat.completions.create({ messages: [{ role: 'user', content: 'Hi!' }] });
console.log(res.model);
```

## OpenAI parameters

| Parameter                               | Notes                                                                                            |
| --------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `model`                                 | Provider-prefixed id. Optional when the client has `defaultModel`.                               |
| `messages`                              | `system`, `developer`, `user`, `assistant` and `tool` messages.                                  |
| `temperature`, `top_p`, `seed`          | Sampling controls.                                                                               |
| `max_completion_tokens`, `max_tokens`   | Output cap (`max_tokens` is the legacy name).                                                    |
| `stop`, `n`                             | Stop sequences; number of choices.                                                               |
| `frequency_penalty`, `presence_penalty` | Repetition penalties.                                                                            |
| `logprobs`, `top_logprobs`              | Log probabilities.                                                                               |
| `tools`, `tool_choice`                  | Function calling. See [tools](./tools.md).                                                       |
| `response_format`                       | `json_object` or `json_schema`. See [structured outputs](./structured-outputs.md).               |
| `stream`, `stream_options`              | Server-sent events. See [streaming](./streaming.md).                                             |
| `reasoning_effort`                      | `none` \| `minimal` \| `low` \| `medium` \| `high`.                                              |
| `reasoning`                             | OpenRouter-style `{ effort?, max_tokens?, exclude? }`; takes precedence over `reasoning_effort`. |
| `user`, `metadata`                      | An end-user id; free-form metadata.                                                              |

### Reasoning

`reasoning_effort` is forwarded to providers that support it and mapped to a thinking-token budget
for providers that use budgets. A model with no reasoning control is refused with
`capability_unsupported` rather than silently ignoring the setting.

```ts
import UltraRouter from '@ultrarouter/sdk';

const ur = new UltraRouter();
const res = await ur.chat.completions.create({
  model: 'openai/gpt-5.2',
  reasoning_effort: 'low',
  messages: [{ role: 'user', content: 'Is 221 prime? Answer yes or no.' }],
});
console.log(res.choices[0]?.message.content);
```

### Multi-part content and cache breakpoints

`content` may be an array of parts. A part can carry `cache_control: { type: 'ephemeral' }` to mark
a prompt-cache breakpoint; providers with explicit cache breakpoints honour it, others ignore it.

```ts
import UltraRouter from '@ultrarouter/sdk';

const ur = new UltraRouter();
const policy = 'Refunds are accepted within 30 days of delivery with a receipt.';

const res = await ur.chat.completions.create({
  model: 'anthropic/claude-sonnet-4.6',
  messages: [
    {
      role: 'system',
      content: [{ type: 'text', text: policy, cache_control: { type: 'ephemeral', ttl: '5m' } }],
    },
    { role: 'user', content: 'Can I return a jacket I bought last week?' },
  ],
});
console.log(res.usage.prompt_tokens_details?.cached_tokens ?? 0, 'cached input tokens');
```

## ultrarouter parameters

| Parameter     | Type                                                            | Notes                                                                                                                                       |
| ------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `call_type`   | `string`                                                        | A stable slug naming this kind of request (`support-reply`). Groups requests for evaluation and routing. See [call types](./call-types.md). |
| `models`      | `string[]`                                                      | Ordered fallback models, tried when the primary fails.                                                                                      |
| `router`      | `'off' \| 'auto' \| 'candidates'`                               | Routing mode for this call. `off` serves the requested model.                                                                               |
| `compression` | mode string or `{ mode, no_compress_fields, max_quality_risk }` | Prompt compression control. `off` is the default.                                                                                           |
| `provider`    | `ProviderPreferences`                                           | OpenRouter-style provider preferences: `order`, `allow_fallbacks`, `ignore`, `sort`, …                                                      |
| `ur`          | `UrRequestOptions`                                              | Per-request controls; see below.                                                                                                            |
| `bench`       | `string \| { suite, run?, trace? }`                             | Tag this call for a Bench suite. See [Bench](./bench.md).                                                                                   |

Compression modes are `off`, `semantic_safe` and `adaptive`.
The legacy values `lossless` and `auto` are deprecated aliases that still parse (the legacy `lossless` alias is not a guarantee that the model sees identical text).

### The `ur` request options

| Field             | Type                                      | Notes                                                                                       |
| ----------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------- |
| `max_cost_usd`    | `number`                                  | Refuse the call before dispatch (`max_cost_exceeded`) when its estimated cost exceeds this. |
| `trace_id`        | `string`                                  | Your trace id, grouping related requests.                                                   |
| `tags`            | `Record<string, string>`                  | Free-form tags recorded with the request.                                                   |
| `timeout_ms`      | `number`                                  | An upstream timeout for this request.                                                       |
| `segments`        | `{ index, kind }[]`                       | Label messages (`reference_context`, `history`, …) to guide compression segmentation.       |
| `artifact`        | `string`                                  | The artifact key this request contributes to. See [outcomes](./outcomes.md).                |
| `situation`       | `Record<string, unknown>`                 | Declared situation facets (labels and values only).                                         |
| `manifest`        | `UrManifest`                              | A declared context manifest from `toWire()`. See [context runtime](./context-runtime.md).   |
| `context_modules` | `{ module_id, module_version }[]`         | Learned-context modules pinned to exact versions (at most 8).                               |
| `prompt_vars`     | `Record<string, string\|number\|boolean>` | Values for the active hosted prompt's `{{variables}}`. See [call types](./call-types.md).   |
| `bench`           | Bench tag                                 | Same as the top-level `bench` (the top-level one is folded in here).                        |

```ts
import UltraRouter from '@ultrarouter/sdk';

const ur = new UltraRouter();

const res = await ur.chat.completions.create({
  model: 'openai/gpt-5.2-mini',
  models: ['anthropic/claude-sonnet-4.6'], // fallback
  call_type: 'support-reply',
  router: 'off',
  compression: { mode: 'off' },
  provider: { sort: 'price', allow_fallbacks: true },
  ur: {
    max_cost_usd: 0.05,
    trace_id: 'ticket-4821',
    tags: { team: 'support' },
  },
  messages: [{ role: 'user', content: 'Where is my order?' }],
});

console.log(res.ur.call_type, res.ur.routing.fallback_used);
```

## The response

The response is an OpenAI `chat.completion` object plus `ur`:

| Field                              | Meaning                                                                                       |
| ---------------------------------- | --------------------------------------------------------------------------------------------- |
| `id`, `object`, `created`, `model` | The completion identity.                                                                      |
| `choices[].message`                | `role`, `content`, and `tool_calls` when the model calls tools.                               |
| `choices[].finish_reason`          | `stop`, `length`, `tool_calls`, …                                                             |
| `usage`                            | `prompt_tokens`, `completion_tokens`, `total_tokens`, `prompt_tokens_details.cached_tokens`.  |
| `ur.request_id`                    | The gateway request id. Use it with `ur.ur.generation.get()` and `ur.ur.requests.feedback()`. |
| `ur.call_type`                     | The call type the request was attributed to, or `null`.                                       |
| `ur.model_served`, `ur.provider`   | Which model and provider actually served the request.                                         |
| `ur.routing`                       | `{ mode, fallback_used, engine? }`.                                                           |
| `ur.compression`                   | What compression did (`applied`, and estimates labelled by `savings_basis`).                  |
| `ur.cost_usd`                      | The request cost in USD.                                                                      |
| `ur.byok`                          | Whether your own provider key served the request.                                             |
| `ur.artifact_id`                   | Present when the request declared an artifact.                                                |
| `ur.bench`                         | Present on a Bench-tagged request (the capture is `queued`).                                  |
| `ur.verified_memory`               | Present only when the answer came from the workspace's verified memory instead of a provider. |

```ts
import UltraRouter from '@ultrarouter/sdk';

const ur = new UltraRouter();
const res = await ur.chat.completions.create({
  model: 'openai/gpt-5.2-mini',
  messages: [{ role: 'user', content: 'Hello' }],
});

// Look the request up later, and rate it.
const stats = await ur.ur.generation.get(res.ur.request_id);
console.log(stats.tokens.total, stats.cost.total_usd, stats.timing.latency_ms);
await ur.ur.requests.feedback(res.ur.request_id, { rating: 1, tags: ['helpful'] });
```

## Pitfalls

- A request without `model` and without a client `defaultModel` is rejected by the gateway with
  `invalid_request`.
- `ur.max_cost_usd` is a pre-dispatch estimate check, not a billing guarantee.
- The `ur` request field is the per-request extension object; `ur.ur.*` on the client is the
  resource namespace. They are unrelated.
- Model capabilities differ: a model without tools or `json_schema` support is refused with
  `capability_unsupported`.

## Related

- [Streaming](./streaming.md) · [Tools](./tools.md) · [Structured outputs](./structured-outputs.md)
- [Configuration](./configuration.md) · [Errors](./errors.md)
- [Feedback and generation stats](./feedback-and-generation.md)
