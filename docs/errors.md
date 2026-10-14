# Errors

Every method of the client rejects with an `UltraRouterError` (or its subclass `ModelUnpricedError`)
when something goes wrong. The error carries a stable string `code`, the HTTP `status`, the
gateway `requestId` and a `retryable` flag, so your code branches on a string instead of guessing
from a status or parsing a message.

## The error object

| Field          | Type                  | Meaning                                                                                            |
| -------------- | --------------------- | -------------------------------------------------------------------------------------------------- |
| `code`         | `string`              | A stable code: one of the gateway codes below, or a client-side code (`connection`, `timeout`, …). |
| `status`       | `number`              | The HTTP status of the failed response; `0` when no response arrived (network error, timeout).     |
| `requestId`    | `string \| undefined` | The gateway correlation id (`req_…`). Quote it when you report a problem.                          |
| `retryable`    | `boolean`             | Whether the same request may be retried as-is. The SDK only auto-retries retryable errors.         |
| `providerCode` | `string \| undefined` | The raw upstream provider error code, when a provider produced the failure.                        |
| `message`      | `string`              | A human-readable explanation. Do not branch on it; branch on `code`.                               |

```ts
import UltraRouter, { UltraRouterError } from '@ultrarouter/sdk';

const ur = new UltraRouter();

try {
  await ur.chat.completions.create({
    model: 'example/unpriced-model',
    messages: [{ role: 'user', content: 'hi' }],
  });
} catch (err) {
  if (err instanceof UltraRouterError) {
    console.log(err.code); // 'model_unpriced'
    console.log(err.status); // 403
    console.log(err.retryable); // false
    console.log(err.requestId); // 'req_…'
  } else {
    throw err;
  }
}
```

## Narrowing helpers

- `err instanceof UltraRouterError` — any SDK error.
- `err instanceof ModelUnpricedError` — the typed `model_unpriced` refusal.
- `isUltraRouterError(err, code?)` — a type guard, optionally narrowed to one code.
- `isGatewayErrorCode(code)` — whether a string is one of the stable gateway codes.
- `GATEWAY_ERROR_CODES` — every gateway code; `GATEWAY_ERROR_TAXONOMY[code]` — its canonical
  `status` and `retryable` flag.

```ts
import UltraRouter, { GATEWAY_ERROR_TAXONOMY, isUltraRouterError } from '@ultrarouter/sdk';

const ur = new UltraRouter();

async function ask(question: string): Promise<string> {
  try {
    const res = await ur.chat.completions.create({
      model: 'openai/gpt-5.2-mini',
      messages: [{ role: 'user', content: question }],
    });
    return res.choices[0]?.message.content ?? '';
  } catch (err) {
    if (isUltraRouterError(err, 'context_length')) return 'That question is too long.';
    if (isUltraRouterError(err, 'rate_limited')) return 'Busy, try again shortly.';
    throw err;
  }
}

console.log(await ask('What is 2 + 2?'));
console.log(GATEWAY_ERROR_TAXONOMY.rate_limited); // { status: 429, retryable: true }
```

## `model_unpriced`

The gateway refuses a call to a model it has no price for, because a call it cannot cost would be
invisible to spend caps and budgets. The refusal happens before dispatch: nothing reaches a
provider and nothing is billed.

- HTTP status `403`, code `model_unpriced`.
- Surfaces as `ModelUnpricedError` (a subclass of `UltraRouterError`); `retryable` is always `false`.
- **Never retried**, whatever the status or the envelope says.
- Fix it by choosing a priced model (`ur.models.list()` shows pricing), or by declaring pricing on
  the custom provider that serves the model.

```ts
import UltraRouter, { ModelUnpricedError } from '@ultrarouter/sdk';

const ur = new UltraRouter();

try {
  await ur.chat.completions.create({
    model: 'example/unpriced-model',
    messages: [{ role: 'user', content: 'hi' }],
  });
} catch (err) {
  if (!(err instanceof ModelUnpricedError)) throw err;
  const priced = await ur.models.list();
  console.log(`unpriced model refused; ${String(priced.data.length)} priced models available`);
}
```

## Gateway error codes

These are the codes the gateway returns (`GATEWAY_ERROR_CODES`). "Retried" means the SDK retries
the request automatically (up to `maxRetries`, see
[retries, timeouts and idempotency](./retries-timeouts-idempotency.md)).

| Code                             | HTTP | Retried | What it means and what to do                                                                                          |
| -------------------------------- | ---- | ------- | --------------------------------------------------------------------------------------------------------------------- |
| `invalid_request`                | 400  | no      | The body or parameters are invalid, or an option is unsupported. Fix the request.                                     |
| `manifest_invalid`               | 400  | no      | A declared `ur.manifest` is malformed (for example overlapping ranges). Rebuild it with `toWire()`.                   |
| `manifest_mismatch`              | 400  | no      | A declared `ur.manifest` hash does not match the bytes sent. Recompute the manifest over the exact messages you send. |
| `authentication`                 | 401  | no      | Missing or invalid API key. Check `ULTRAROUTER_API_KEY` / `apiKey`.                                                   |
| `permission`                     | 403  | no      | The key lacks the scope the route needs (for example `config:write`). Use a key with that scope.                      |
| `not_found`                      | 404  | no      | Unknown model, request or resource. Check the id.                                                                     |
| `model_denied_by_policy`         | 403  | no      | Your workspace model policy forbids this model. Choose another model or change the policy.                            |
| `model_unpriced`                 | 403  | no      | The model has no price, so the call is refused before dispatch. Use a priced model. Raised as `ModelUnpricedError`.   |
| `capability_unsupported`         | 400  | no      | The model cannot honour a requested capability (tools, `json_schema`, vision, reasoning). Choose a model that can.    |
| `prompt_variables_missing`       | 400  | no      | The active hosted prompt needs `{{variables}}` you did not send in `ur.prompt_vars`. The message names them.          |
| `conflict`                       | 409  | no      | An idempotent write collided with a different payload under the same key. Use a new id for a new event.               |
| `rate_limited`                   | 429  | yes     | A rate limit was hit. Retried with backoff, honouring `Retry-After`.                                                  |
| `spend_cap_exceeded`             | 402  | no      | The key or workspace spend cap for the period is reached.                                                             |
| `max_cost_exceeded`              | 402  | no      | The estimated cost of this one call exceeds `ur.max_cost_usd`. Raise the cap or shrink the request.                   |
| `atomic_spend_guard_unavailable` | 503  | no      | Live Bench execution is not available on this deployment. Dry runs still work.                                        |
| `provider_unavailable`           | 502  | yes     | The upstream provider is unreachable or failed. Retried; add fallbacks with `models: [...]`.                          |
| `provider_timeout`               | 504  | yes     | The upstream provider exceeded its deadline. Retried.                                                                 |
| `content_filtered`               | 400  | no      | The provider refused the content (moderation or safety).                                                              |
| `context_length`                 | 400  | no      | The prompt plus the requested completion exceeds the model's context window. Shorten it or pick a larger model.       |
| `cancelled`                      | 499  | no      | The client disconnected before the request completed.                                                                 |
| `internal`                       | 500  | no      | An unexpected gateway failure. Report it with the `requestId`.                                                        |

The SDK treats the taxonomy as authoritative: a code marked "no" is never retried, even when it
arrives with a 5xx status or an envelope that says otherwise.

## Client-side codes

| Code               | Status          | Retried          | When                                                                                                               |
| ------------------ | --------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------ |
| `connection`       | `0`             | yes              | The request never got a response (DNS failure, connection refused or reset).                                       |
| `timeout`          | `0`             | no               | The total `timeout` elapsed (it covers every retry).                                                               |
| `aborted`          | `0`             | no               | Your `AbortSignal` fired.                                                                                          |
| `invalid_response` | response status | no               | The response could not be used (for example a non-JSON body where JSON was expected).                              |
| `invalid_request`  | `0`             | no               | The SDK refused before sending (for example a missing path parameter in `request()`).                              |
| `authentication`   | `0`             | no               | The constructor found no API key (`apiKey`, `ULTRAROUTER_API_KEY` or `UR_API_KEY`).                                |
| `http_<status>`    | that status     | 408, 429 and 5xx | A component in front of the gateway (a proxy, a load balancer) answered without the gateway's JSON error envelope. |

## Errors during a stream

A streamed response can fail after it has started. The gateway sends an `event: error` frame and
the `for await` loop throws an `UltraRouterError` with the code from that frame (its `status` is
`0`, because the HTTP status was already 200). Once a stream has opened it is never retried; a
streaming request that fails with a retryable response before it opens is retried like any other
request. See [streaming](./streaming.md).

## Errors from `useLearned().record()` and the outcome queue

`ur.outcomes.record()` does not throw for a delivery failure: it resolves a receipt whose `status`
is `delivered`, `queued` (the outcome is unknown, or the event was not refused; it stays in the
durable queue) or `rejected` (the gateway definitively refused the event, with the `error`
attached). It throws only `OutcomeStoreError`, when its store cannot persist the event.

`isDefinitiveRejection(err)` is the rule: a 4xx other than 401, 403, 408 and 429 whose body is a
well-formed gateway envelope (`err.envelope` is set) with `"retryable": false` and a code from
`EVENT_REJECTION_CODES` (`invalid_request`, `not_found`, `conflict`) at its taxonomy status. An error
decoded from anything else (an HTML page from a proxy, an empty body, another JSON shape) has
`err.envelope === undefined`, and the event stays queued. See [outcomes](./outcomes.md).

## Related

- [Retries, timeouts and idempotency](./retries-timeouts-idempotency.md)
- [Troubleshooting](./troubleshooting.md)
- [API reference](./api/sdk.md)
