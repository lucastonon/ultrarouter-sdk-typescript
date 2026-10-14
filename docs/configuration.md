# Configuration

Everything about a client is set when you construct it, and every request-shaping setting can be
overridden per call. With the two environment variables set, `new UltraRouter()` needs no
arguments at all.

## Environment variables

| Variable                                     | Used for            | Notes                                                                                                          |
| -------------------------------------------- | ------------------- | -------------------------------------------------------------------------------------------------------------- |
| `ULTRAROUTER_API_KEY` (or `UR_API_KEY`)      | The API key         | Required unless you pass `apiKey`. `ULTRAROUTER_API_KEY` wins when both are set.                               |
| `ULTRAROUTER_BASE_URL` (or `UR_BASE_URL`)    | The gateway URL     | Required unless you pass `baseURL`; there is no hosted default. `ULTRAROUTER_BASE_URL` wins when both are set. |
| `UR_BENCH`, `UR_BENCH_RUN`, `UR_BENCH_TRACE` | A Bench capture tag | Optional; used when the `bench` option is not passed. See [Bench](./bench.md).                                 |

Precedence for each setting is: the constructor option, then `ULTRAROUTER_*`, then `UR_*`, then the
built-in default where there is one. The API key and the base URL have no default — they are
required, and construction throws when neither the option nor an environment variable supplies them.
Empty environment variables count as unset. The `ur` CLI reads the same variables (and its
`--api-key` / `--base-url` flags win over them).

```bash
export ULTRAROUTER_API_KEY=ur_sk_test_...
export ULTRAROUTER_BASE_URL=https://gateway.example.com   # required: your own deployment (or http://localhost:8080 locally)
```

```ts
import UltraRouter from '@ultrarouter/sdk';

const ur = new UltraRouter(); // reads the environment
console.log(ur.baseURL);
```

## API keys

Keys look like `ur_sk_live_…` (live traffic) or `ur_sk_test_…` (test traffic). A key has scopes
that decide which routes it may call (for example `gateway:invoke` for chat, `config:write` to
change call types, `outcomes:write` for outcomes). Inspect the key a client uses with
`ur.ur.key.get()`:

```ts
import UltraRouter from '@ultrarouter/sdk';

const ur = new UltraRouter();
const key = await ur.ur.key.get();
console.log(key.mode, key.scopes, key.workspace_id);
```

Keep keys on the server. The SDK can run in a browser, but a key embedded in browser code is
readable by anyone who loads the page.

## Base URL and self-hosting

`baseURL` is the gateway origin without `/v1`; trailing slashes are removed. Point it at any
deployment of the gateway, for example one you run yourself or a staging environment:

```ts
import UltraRouter from '@ultrarouter/sdk';

const ur = new UltraRouter({
  apiKey: process.env.ULTRAROUTER_API_KEY,
  baseURL: process.env.ULTRAROUTER_BASE_URL, // e.g. https://gateway.example.com, or http://localhost:8080
});
console.log(ur.baseURL);
```

## All constructor options

| Option           | Type                                | Default                                                                  | Meaning                                                                                 |
| ---------------- | ----------------------------------- | ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------- |
| `apiKey`         | `string`                            | `ULTRAROUTER_API_KEY`, then `UR_API_KEY`                                 | The API key. Construction throws `authentication` when none is found.                   |
| `baseURL`        | `string`                            | `ULTRAROUTER_BASE_URL`, then `UR_BASE_URL` (required; no hosted default) | The gateway URL, without `/v1`. Construction throws `configuration` when none is found. |
| `defaultModel`   | `string`                            | none                                                                     | Used when a chat or embeddings call omits `model`.                                      |
| `defaults`       | `UltraRouterDefaults`               | `{}`                                                                     | Request defaults, each overridable per call (below).                                    |
| `autopilot`      | `'audit' \| 'recommend' \| 'auto'`  | none                                                                     | The one-line routing intent (below).                                                    |
| `bench`          | `string \| { suite, run?, trace? }` | `UR_BENCH*` env                                                          | A Bench capture tag stamped on every request (below).                                   |
| `timeout`        | `number` (ms)                       | `600000`                                                                 | Total time per call: retries and reading the body (a whole stream).                     |
| `maxRetries`     | `number`                            | `2`                                                                      | Retries for retryable failures.                                                         |
| `fetch`          | `FetchLike`                         | `globalThis.fetch`                                                       | A custom `fetch` (tests, proxies, instrumentation).                                     |
| `defaultHeaders` | `Record<string, string>`            | `{}`                                                                     | Headers sent on every request (per-call `headers` win).                                 |
| `outcomeStore`   | `OutcomeStore`                      | `MemoryOutcomeStore`                                                     | Where outcome events are persisted before they are sent.                                |
| `reviewerStore`  | `OutcomeStore<QueuedReviewerEvent>` | `MemoryOutcomeStore`                                                     | Where reviewer events are persisted before they are sent.                               |
| `preflightCache` | `{ maxEntries?: number }`           | `{ maxEntries: 1000 }`                                                   | The bound on the `preflight()` cache (LRU); `0` turns it off.                           |

## Request defaults and per-call precedence

`defaultModel` and `defaults` set values for every call. A per-call value always wins; an omitted
per-call value falls back to the default.

| Default                | Applies to       | Sent as                                               |
| ---------------------- | ---------------- | ----------------------------------------------------- |
| `defaultModel`         | chat, embeddings | `model`                                               |
| `defaults.router`      | chat             | `router`                                              |
| `defaults.compression` | chat             | `compression`                                         |
| `defaults.callType`    | chat, embeddings | `call_type`                                           |
| `defaults.provider`    | chat             | `provider`                                            |
| `defaults.maxCostUsd`  | chat, embeddings | `ur.max_cost_usd` (a per-call `ur.max_cost_usd` wins) |

```ts
import UltraRouter from '@ultrarouter/sdk';

const ur = new UltraRouter({
  defaultModel: 'openai/gpt-5.2-mini',
  defaults: {
    callType: 'support-reply',
    compression: 'off',
    provider: { sort: 'price' },
    maxCostUsd: 0.02,
  },
});

// Uses every default.
const a = await ur.chat.completions.create({ messages: [{ role: 'user', content: 'Hi' }] });
// Overrides the model and the call type for this call only.
const b = await ur.chat.completions.create({
  model: 'anthropic/claude-sonnet-4.6',
  call_type: 'escalation',
  messages: [{ role: 'user', content: 'Hi' }],
});
console.log(a.model, b.model);
```

## Autopilot intent

`autopilot` is a single intent setting that maps onto the request `router` field:

| `autopilot`   | Sends                  | Meaning                                                   |
| ------------- | ---------------------- | --------------------------------------------------------- |
| `'audit'`     | `router: 'off'`        | Observe only; serve the requested model.                  |
| `'recommend'` | `router: 'candidates'` | Rank approved candidate models.                           |
| `'auto'`      | `router: 'auto'`       | Let the router act once the gateway's evidence qualifies. |

The setting is a ceiling: a per-call `router` may lower autonomy (for example `off` on a client
set to `auto`) but a higher value is clamped down to the ceiling. `auto` is an intent, not a
bypass; the gateway still decides when routing is allowed. Omit `autopilot` for a plain
pass-through client. `ur.ur.autopilot.status()` reads the read-only readiness rollup.

```ts
import UltraRouter from '@ultrarouter/sdk';

const ur = new UltraRouter({ autopilot: 'recommend', defaultModel: 'openai/gpt-5.2-mini' });

const res = await ur.chat.completions.create({
  router: 'auto', // clamped to 'candidates' by the 'recommend' ceiling
  messages: [{ role: 'user', content: 'Hello' }],
});
console.log(ur.ur.autopilot.mode, res.ur.routing.mode);

const readiness = await ur.ur.autopilot.status();
console.log(readiness.state, readiness.total_requests);
```

## Bench capture tag

`bench` tags every request for a Bench suite by stamping `X-UR-Bench-Suite`, `X-UR-Bench-Run` and
`X-UR-Bench-Trace` headers (they also ride `asOpenAI()` clients). `trace` may be a function, called
per request. A per-call `bench` field overrides the client tag. Bench capture needs a test key
(`ur_sk_test_…`); with a live key the SDK warns once and the gateway refuses the capture unless your
workspace allows live capture. See [Bench](./bench.md).

```ts
import { randomUUID } from 'node:crypto';
import UltraRouter from '@ultrarouter/sdk';

const ur = new UltraRouter({
  bench: { suite: 'support-replies', run: 'nightly', trace: () => randomUUID() },
});
const res = await ur.chat.completions.create({
  model: 'openai/gpt-5.2-mini',
  messages: [{ role: 'user', content: 'Hello' }],
});
console.log(res.ur.request_id);
```

## Custom fetch and default headers

Pass your own `fetch` to add logging, route through a proxy agent, or fake the gateway in tests:

```ts
import UltraRouter, { type FetchLike } from '@ultrarouter/sdk';

const logged: FetchLike = async (input, init) => {
  const started = Date.now();
  const res = await fetch(input, init);
  console.log(
    init?.method ?? 'GET',
    String(input),
    res.status,
    `${String(Date.now() - started)}ms`,
  );
  return res;
};

const ur = new UltraRouter({ fetch: logged, defaultHeaders: { 'x-app-version': '1.4.0' } });
await ur.models.list();
```

## Outcome and reviewer stores

Outcome events (`ur.ur.outcomes.record`) and reviewer decisions (`ur.ur.reviewer.record`) are
persisted before they are sent and replayed on retry. The default `MemoryOutcomeStore` lasts for
the life of the process; `FileOutcomeStore(path)` (Node.js only) survives restarts:

```ts
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import UltraRouter, { FileOutcomeStore } from '@ultrarouter/sdk';

const ur = new UltraRouter({
  outcomeStore: new FileOutcomeStore(join(tmpdir(), 'ur-outcomes.json')),
});
const report = await ur.ur.outcomes.flush(); // send anything left over from a previous run
console.log(report.delivered, report.pending);
```

See [outcomes](./outcomes.md) and [the reviewer adapter](./reviewer.md).

## Related

- [Installation and runtimes](./installation.md)
- [Retries, timeouts and idempotency](./retries-timeouts-idempotency.md)
- [OpenAI compatibility](./openai-compatibility.md)
