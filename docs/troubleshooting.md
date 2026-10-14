# Troubleshooting and FAQ

Each entry names the symptom, the cause, and the fix. When you report a problem, include the
`requestId` from the error (`req_…`) and the SDK `VERSION`.

```ts
import UltraRouter, { VERSION, isUltraRouterError } from '@ultrarouter/sdk';

try {
  const ur = new UltraRouter();
  await ur.models.list();
  console.log(`sdk ${VERSION}: gateway reachable at ${ur.baseURL}`);
} catch (err) {
  if (isUltraRouterError(err))
    console.log(VERSION, err.code, err.status, err.requestId, err.message);
  else throw err;
}
```

## "missing API key: pass `apiKey` or set ULTRAROUTER_API_KEY / UR_API_KEY"

The constructor found no key. Set `ULTRAROUTER_API_KEY` (or `UR_API_KEY`) in the environment of the
process, or pass `apiKey`. On edge runtimes there is usually no `process.env`; pass the key
explicitly. See [configuration](./configuration.md).

## `authentication` (401)

The key was sent but rejected: it is mistyped, revoked, expired, or belongs to a different
deployment than `baseURL`. Check `ur.baseURL` and the key prefix (`ur_sk_live_…` / `ur_sk_test_…`).

## `permission` (403)

The key is valid but lacks the scope the route needs, for example `config:write` to create a call
type or `outcomes:write` to record outcomes. `ur.ur.key.get()` lists the key's scopes.

## `model_unpriced` (403)

The model has no price, so the gateway refuses the call before dispatch. It is never retried. Use a
priced model (`ur.models.list()` shows pricing), or declare pricing on the custom provider that
serves it. Catch it with `err instanceof ModelUnpricedError`. See
[errors](./errors.md#model_unpriced).

## `model_denied_by_policy` (403)

Your workspace's model policy forbids that model. Choose another model or change the policy.

## `capability_unsupported` (400)

You asked for something the model cannot do: tools, `json_schema`, vision or reasoning. Find a
capable model with `ur.models.list({ capability: 'tools' })` (or `json_schema`).

## `rate_limited` (429)

The SDK already retried with backoff (up to `maxRetries`, honouring `Retry-After`) before
surfacing this. Slow down, add your own queueing, or raise the limit for the key.

## `timeout`

The total `timeout` (default 600000 ms) elapsed. The timeout covers every retry and backoff. (A
call cancelled through your `AbortSignal` fails with `aborted` instead.) For long generations raise it, or stream so you see output early. See
[retries, timeouts and idempotency](./retries-timeouts-idempotency.md).

## `connection`

No response arrived: DNS failure, refused or reset connection, or TLS failure. Check `baseURL`,
network egress and any proxy. These are retried automatically.

## `http_502` / `http_503` and other `http_<status>` codes

Something in front of the gateway (a proxy, a load balancer, a CDN) answered without the gateway's
JSON error envelope. Check the component between your app and the gateway. 408, 429 and 5xx are
retried.

## Requests through a proxy

Point `baseURL` at the proxy origin. Model ids contain `/` (`openai/gpt-5.2-mini`); the SDK keeps
that `/` in `models.retrieve()` paths rather than encoding it, because many proxies reject encoded
slashes. If your proxy needs an agent or custom TLS, pass your own `fetch`.

## `ERR_REQUIRE_ESM`, "does not provide an export named default", or `UltraRouter is not a constructor`

The package ships both ESM and CommonJS. In CommonJS use the named export:

```js
const { UltraRouter } = require('@ultrarouter/sdk');
console.log(typeof UltraRouter); // 'function'
```

In ESM both `import UltraRouter from '@ultrarouter/sdk'` and
`import { UltraRouter } from '@ultrarouter/sdk'` work.

## TypeScript cannot find `@ultrarouter/sdk/context`

Use `"moduleResolution": "bundler"`, `"node16"` or `"nodenext"`; the legacy `"node"` resolution
does not read package `exports`. See [installation](./installation.md#typescript).

## `ur: command not found`

The CLI ships as the package binary. In a project that depends on `@ultrarouter/sdk`, run it with
`npx ur …` or from an npm script; without installing, name the package
(`npx --package=@ultrarouter/sdk@0.0.1 ur …` — a bare `npx ur` looks for a different package called
`ur`); or install the package globally. It needs Node.js 20 or later. See [CLI](./cli.md).

## Bench capture is refused with a live key

Bench capture needs a test key (`ur_sk_test_…`). With a live key the SDK prints a one-time warning
and the gateway refuses the capture unless your workspace explicitly allows live capture. See
[Bench](./bench.md).

## Calling from a browser

Do not ship an API key to browsers. Call the gateway from your server and expose your own
endpoint. Browsers also enforce CORS, which a server-side call avoids.

## A stream stops with an error halfway

A failure after a stream started arrives as an error frame; the `for await` loop throws an
`UltraRouterError` with the code from that frame (status `0`). A stream is never retried once it
has opened. See [streaming](./streaming.md).

## `ur.ur.outcomes.record()` did not throw, but nothing arrived

`record()` does not throw for a delivery failure; it resolves a receipt. `status: 'queued'` means
the delivery's outcome is unknown (a timeout, a connection failure, a 429 or 5xx) or the key was
refused (401/403): the event stays in the durable queue. Fix the cause and call
`ur.ur.outcomes.flush()` before your process exits, or use a `FileOutcomeStore` so queued events
survive restarts. See [outcomes](./outcomes.md).

## `OutcomeStoreError` from `record()` or `flush()`

A `FileOutcomeStore` file could not be read, is not valid JSON, or does not hold a list of entries.
The store refuses to treat it as empty and never overwrites it: inspect the file named in the error,
recover or move it, then restart. See [outcomes](./outcomes.md#the-durable-queue).

## Where are the models I expect?

`ur.models.list()` shows what your key can use on your gateway. Model ids in these docs are
illustrative.

## Related

- [Errors](./errors.md) · [Configuration](./configuration.md) · [Installation](./installation.md)
