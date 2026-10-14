# Typed requests for any operation

The client has dedicated methods for the common operations. For everything else in the published
OpenAPI document there is `ur.request(method, pathTemplate, init)`: a single method whose path,
parameters, body and result are all typed from the OpenAPI document that ships with this package. It
uses the same transport as every other method, so retries, timeouts, abort signals, idempotency keys
and error handling behave identically.

```ts
import UltraRouter from '@ultrarouter/sdk';

const ur = new UltraRouter();

// No path parameters: the path literal alone selects the operation and its response type.
const plans = await ur.request('get', '/v1/flywheel/plans');
console.log(plans.object, plans.plans.length);

// Path parameters fill the `{placeholders}`; each value is percent-encoded.
const model = await ur.request('get', '/v1/models/{id}', { path: { id: 'openai/gpt-5.2-mini' } });
console.log(model.id, model.offers.length);

// A JSON body, typed from the operation's request schema.
const grant = await ur.request('post', '/v1/flywheel/grants', {
  body: { call_type: 'support-reply', artifact_key: 'ticket-4821' },
});
console.log(grant.arm, grant.grant_id);

// Query parameters: numbers and booleans are stringified; `undefined` values are skipped.
const pending = await ur.request('get', '/v1/outcomes/pending', {
  query: { state: 'overdue', limit: 10 },
});
console.log(pending.data.length, pending.next_cursor);
```

## Signature

```text
request(method, path, init?) → Promise<typed success body>

method  'get' | 'post' | 'put' | 'patch' | 'delete'
path    a path template from the OpenAPI document, e.g. '/v1/call-types/{id}/evals'
init    { path?, query?, body?, signal?, timeout?, maxRetries?, headers?, idempotencyKey? }
```

| `init` field                                                   | Meaning                                                                                            |
| -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `path`                                                         | Values for every `{placeholder}`. A missing one is refused before any request (`invalid_request`). |
| `query`                                                        | Query-string parameters, typed from the operation.                                                 |
| `body`                                                         | The JSON body, typed from the operation's request schema.                                          |
| `signal`, `timeout`, `maxRetries`, `headers`, `idempotencyKey` | The usual [per-call request options](./retries-timeouts-idempotency.md).                           |

The result is the operation's `200`, `201` or `202` JSON body. A response that is not JSON (for example
a Markdown export) resolves as a string, and an empty body as `{}`. A non-2xx response rejects with an
[`UltraRouterError`](./errors.md), exactly like the dedicated methods.

TypeScript rejects a path that does not exist, a method the path does not support, a missing path
parameter, and a body or query of the wrong shape, at compile time.

## When to use it

Prefer the dedicated method when there is one: it adds behaviour the raw operation does not have, such
as unwrapping envelopes (`ur.ur.artifacts.get` returns the artifact, not `{ artifact }`), the durable
outcome queue, signing (`ur.ur.reviewer`, `ur.ur.oracles.claimJobs`), preflight caching, streaming,
construction defaults (`defaultModel`, `defaults`) and model-id encoding (`models.retrieve` keeps the
provider `/` as a path separator; `request()` encodes every parameter as one segment).

Use `request()` for operations without a dedicated method, for example learning plans, candidate
confirmations, prompt candidates and exposure grants. [API coverage](./api-coverage.md) lists every
operation in the document and the method that covers it.

Some operations in the document authenticate with a dashboard session only (workspace administration,
API-key management, provider keys). An API key cannot call those; the gateway answers
`authentication` or `permission`.

## Types for your own wrappers

The type machinery is exported so you can type your own helpers:

| Type                       | Meaning                                                             |
| -------------------------- | ------------------------------------------------------------------- |
| `OperationId`              | Every `operationId` in the document.                                |
| `OperationResponse<Op>`    | The success body of an operation, by `operationId`.                 |
| `OperationRequestBody<Op>` | The JSON request body of an operation (`never` when it takes none). |
| `OperationQuery<Op>`       | The query parameters of an operation.                               |
| `HttpMethod`               | `'get' \| 'post' \| 'put' \| 'patch' \| 'delete'`.                  |
| `ApiPath<M>`               | Every path template that defines method `M`.                        |
| `ApiResponse<M, P>`        | The success body for a method and path template.                    |
| `ApiRequestInit<M, P>`     | The `{ path, query, body }` options for a method and path template. |

```ts
import UltraRouter, { type OperationRequestBody, type OperationResponse } from '@ultrarouter/sdk';

type Grant = OperationResponse<'mintExposureGrant'>;
type GrantRequest = OperationRequestBody<'mintExposureGrant'>;

const ur = new UltraRouter();

async function grantFor(callType: string, artifactKey: string): Promise<Grant> {
  const body: GrantRequest = { call_type: callType, artifact_key: artifactKey };
  return ur.request('post', '/v1/flywheel/grants', { body });
}

const grant = await grantFor('support-reply', 'ticket-4822');
console.log(grant.object, grant.epoch);
```

## Related

- [API coverage](./api-coverage.md) — every operation and the method that covers it
- [Errors](./errors.md) and [retries, timeouts and idempotency](./retries-timeouts-idempotency.md)
- [Testing your application](./testing.md) — inject `fetch` to test code that uses `request()`
- API reference: [`UltraRouter.request`](./api/sdk.md#ultrarouter), [`ApiPath`](./api/sdk.md#apipath)
