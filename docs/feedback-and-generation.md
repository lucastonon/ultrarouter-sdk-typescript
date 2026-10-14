# Feedback, generation stats and key info

Three small reads and writes that work on any request the gateway served:

- **Feedback** (`ur.ur.requests.feedback`) attaches a thumbs up or down, tags and a comment to a
  request. It is the quickest human signal you can send, and evals consume it.
- **Generation stats** (`ur.ur.generation.get`) describe one served request after the fact: tokens,
  cost, latency, the routing decision and any outcomes bound to it (compatible with the OpenRouter
  `/generation` route).
- **Key info** (`ur.ur.key.get`) describes the API key the client is using: its scopes, caps and
  usage this period.

All three use the request id from the `ur` block of a response (`res.ur.request_id`, a `req_…`
string). Feedback and generation need the `gateway:invoke` scope, which every gateway key has.

## Rate a request

```ts
import UltraRouter from '@ultrarouter/sdk';

const ur = new UltraRouter({ defaultModel: 'openai/gpt-5.2-mini' });

const res = await ur.chat.completions.create({
  messages: [{ role: 'user', content: 'Summarise our refund policy in one sentence.' }],
});

// Thumbs down with tags and a comment. `rating` is 1 (good) or -1 (bad).
const feedback = await ur.ur.requests.feedback(res.ur.request_id, {
  rating: -1,
  tags: ['too_long', 'missed_exception'],
  comment: 'Did not mention the 30-day window.',
});
console.log(feedback.id, feedback.rating, feedback.tags);
```

| Field     | Type       | Notes                              |
| --------- | ---------- | ---------------------------------- |
| `rating`  | `1 \| -1`  | Required.                          |
| `tags`    | `string[]` | Optional, up to 32 free-form tags. |
| `comment` | `string`   | Optional, up to 4,000 characters.  |

The route wraps the stored row in `{ feedback: … }`; the SDK unwraps it and resolves a bare
`Feedback` (`id`, `request_id`, `rating`, `tags`, `comment`, `created_at`). The wire type
`FeedbackEnvelope` is exported for raw-REST callers.

Feedback is a per-request signal. To record what actually happened to the thing your application
produced (accepted, edited, resolved), use [outcomes](./outcomes.md) instead.

## Read generation stats

```ts
import UltraRouter from '@ultrarouter/sdk';

const ur = new UltraRouter({ defaultModel: 'openai/gpt-5.2-mini' });
const res = await ur.chat.completions.create({ messages: [{ role: 'user', content: 'hi' }] });

const stats = await ur.ur.generation.get(res.ur.request_id);
console.log(stats.status, stats.model_requested, '→', stats.model_served);
console.log('tokens', stats.tokens.input, stats.tokens.output, 'cached', stats.tokens.cached);
console.log('cost', stats.cost.total_usd, 'USD /', stats.cost.total_micro_usd, 'micro-USD');
console.log(
  'latency',
  stats.timing.latency_ms,
  'ms; time to first byte',
  stats.timing.ttfb_ms,
  'ms',
);
```

| Field                                           | Meaning                                                                                     |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `status`                                        | `ok`, `error` or `cancelled`.                                                               |
| `model_requested` / `model_served` / `provider` | What you asked for and what actually served it.                                             |
| `error_class`                                   | The error class of a failed request, or `null`.                                             |
| `tokens`                                        | `{ input, output, cached, total }`.                                                         |
| `cost`                                          | `{ total_micro_usd, total_usd }`. Money is an integer number of micro-USD in the API.       |
| `timing`                                        | `{ ttfb_ms, latency_ms }` (either may be `null`).                                           |
| `routing_decision`                              | The routing trail (open object).                                                            |
| `compression`                                   | What compression did (open object).                                                         |
| `contract_digest`                               | A digest of the declared contract (schema, tools, tool choice, response format), or `null`. |
| `outcomes`                                      | Outcome events bound to this request (channel, kind, observed time, value — never a body).  |
| `exposure`                                      | The experiment arm and epoch stamped before dispatch (`null` fields when none).             |
| `lever`                                         | What learned context was served (ids and numbers only) or why none was.                     |
| `byok`                                          | Whether your own provider key served it.                                                    |

An unknown or foreign request id is a `not_found` error.

## Inspect the API key

```ts
import UltraRouter from '@ultrarouter/sdk';

const ur = new UltraRouter();
const key = await ur.ur.key.get();
console.log(key.name, key.mode, key.workspace_id);
console.log('scopes:', key.scopes.join(', '));
console.log('spent this period (micro-USD):', key.usage.key_spent_micro_usd);
console.log('caps:', key.limits.rps_limit, key.limits.spend_cap_micro_usd);
```

`mode` is `live` or `test` (`ur_sk_live_…` / `ur_sk_test_…`). `scopes` tells you which routes the key
may call: for example `gateway:invoke` (chat, embeddings, models, preflight, feedback),
`config:read` / `config:write` (call types, Bench freeze), `outcomes:write` (artifacts, outcomes,
imports, reviewer events) and `bench:run` (Bench runs). A call outside the key's scopes fails with a
`permission` error. When the workspace has learning usage, `flywheel` reports the usage quantities
and caps for the current period.

`key.get()` is a cheap way to check that a key and base URL work at startup.

## Related

- [Errors](./errors.md) — `not_found`, `permission` and the rest of the taxonomy
- [Outcomes and artifacts](./outcomes.md) — richer signals than a thumbs up
- [Configuration](./configuration.md) — API keys and base URLs
- API reference: [`UrNamespace`](./api/sdk.md#urnamespace), [`GenerationStats`](./api/sdk.md#generationstats),
  [`KeyInfo`](./api/sdk.md#keyinfo)
