# AGENTS.md — using and changing `@ultrarouter/sdk`

This file is for AI coding agents (and humans who like short, exact instructions). It has two parts:
how to **use** the SDK in an application, and how to **work on** this repository.

## Part 1 — using the SDK

`@ultrarouter/sdk` is the official TypeScript client for ultrarouter, an OpenAI-compatible LLM
gateway and router. It mirrors the `openai` client (`chat.completions.create`, `embeddings.create`,
`models.list`) and adds ultrarouter resources under `ur.*`. Zero runtime dependencies, ESM and
CommonJS; tested on Node.js 20+ and Deno 2, expected to work (untested) on Bun and edge runtimes.

### Install and configure

The package is **not on the npm registry yet**: `npm install @ultrarouter/sdk` fails (404). Build it
from the public GitHub source and install the tarball; never tell a user to install it from the
registry.

<!-- doctest: skip — clones the public repository and builds the package -->

```bash
git clone https://github.com/lucastonon/ultrarouter-sdk-typescript.git
(cd ultrarouter-sdk-typescript && npm ci && npm run build && npm pack)   # → ultrarouter-sdk-0.1.0.tgz
npm install ./ultrarouter-sdk-typescript/ultrarouter-sdk-0.1.0.tgz
export ULTRAROUTER_API_KEY=ur_sk_test_...         # or UR_API_KEY
export ULTRAROUTER_BASE_URL=https://gateway.example.com  # required; your deployment (or http://localhost:8080 locally)
```

### Canonical patterns

Create one client and reuse it. Model ids are provider-prefixed (`openai/gpt-5.2-mini`); the ids
your gateway serves come from `models.list()`.

```ts
import UltraRouter, { ModelUnpricedError, UltraRouterError } from '@ultrarouter/sdk';

const ur = new UltraRouter({ defaultModel: 'openai/gpt-5.2-mini' });

// 1. Chat completion. Every response carries the `ur` block (request id, served model, cost).
const res = await ur.chat.completions.create({
  messages: [{ role: 'user', content: 'Give me one word for "fast".' }],
});
console.log(res.choices[0]?.message.content, res.ur.request_id);

// 2. Streaming: the last chunk carries `usage` and `ur`.
const stream = await ur.chat.completions.create({
  stream: true,
  messages: [{ role: 'user', content: 'Count to three.' }],
});
for await (const chunk of stream) process.stdout.write(chunk.choices[0]?.delta.content ?? '');
process.stdout.write('\n');

// 3. Errors are typed. Branch on `code`, never on the message text.
try {
  await ur.chat.completions.create({
    model: 'example/unpriced-model',
    messages: [{ role: 'user', content: 'hi' }],
  });
} catch (err) {
  if (err instanceof ModelUnpricedError) console.log('choose a priced model');
  else if (err instanceof UltraRouterError) console.log(err.code, err.status, err.retryable);
  else throw err;
}
```

Use the official `openai` package unchanged by pointing it at the gateway:

```ts
import OpenAI from 'openai';
import UltraRouter from '@ultrarouter/sdk';

const openai = new UltraRouter().asOpenAI(OpenAI);
const res = await openai.chat.completions.create({
  model: 'openai/gpt-5.2-mini',
  messages: [{ role: 'user', content: 'hi' }],
});
console.log(res.choices[0]?.message.content);
```

Call any API operation, fully typed, even when it has no dedicated method:

```ts
import UltraRouter from '@ultrarouter/sdk';

const ur = new UltraRouter();
const detail = await ur.request('get', '/v1/models/{id}', { path: { id: 'openai/gpt-5.2-mini' } });
console.log(detail.offers.length);
```

### Plug-and-play learning

Correlate every call (`requestId` on every result; `{ requestId, episodeKey }` per call), report the
verdict of a check you trust once per task on its final request, and steer learning per call type.
The full guide is `docs/plug-and-play-learning.md`; the starters are in `@ultrarouter/sdk/learning`.

Before enabling learning, an owner/admin must grant the workspace self-learning opt-in
(knowledge and corrections consent) on the dashboard Learning page or through the signed-in
session `PUT /v1/workspaces/{id}/self-learning` with `{"enabled":true}`. An API key cannot grant
consent; corrections consent alone is insufficient.

```ts
import UltraRouter, { LearningError, mintEpisodeKey } from '@ultrarouter/sdk';
import { createOrderDesk } from '@ultrarouter/sdk/learning';

const ur = new UltraRouter({ defaultModel: 'openai/gpt-5.2-mini' });
const desk = createOrderDesk('s1'); // a deterministic demo environment with a real verifier
const res = await ur.chat.completions.create(
  { messages: [{ role: 'user', content: desk.task }] },
  { episodeKey: mintEpisodeKey() }, // the same key on every step of one task; a new key per task
);

// verdict: 'pass' | 'fail' | 'unknown'; source: verifier | business_rule | webhook | human_review | self_rating
const verdict = desk.verify();
const report = await ur.ur.outcomes.report(res.requestId, {
  verdict: verdict.verdict,
  source: 'verifier',
  evidenceHash: verdict.evidenceHash,
});
console.log(report.status, report.result?.status); // "delivered" "pending" (applied once the request lands)

try {
  console.log((await ur.ur.learning.status('support-reply')).state);
} catch (err) {
  if (err instanceof LearningError) console.log(err.reason, err.action);
  else throw err;
}
```

### Pitfalls

- **Keys are server-side secrets.** Never ship an API key to a browser; call the gateway from your
  server. Use `ur_sk_test_…` keys for tests and Bench capture.
- **Default import vs named import.** ESM: `import UltraRouter from '@ultrarouter/sdk'` or
  `import { UltraRouter } from '@ultrarouter/sdk'`. CommonJS:
  `const { UltraRouter } = require('@ultrarouter/sdk')`.
- **The context runtime is a separate entry:** `import { compile } from '@ultrarouter/sdk/context'`.
  So are the learning starters: `import { createWebhookReceiver } from '@ultrarouter/sdk/learning'`.
- **Retries are automatic** for retryable errors only (`rate_limited`, `provider_unavailable`,
  `provider_timeout`, network errors, and 408/429/5xx without a gateway code). A stream is retried
  only on a retryable response before it opens. Set `maxRetries: 0` in tests.
- **`model_unpriced` (403)** means the gateway has no price for the model; it is never retried.
  Pick a priced model.
- **Outcomes are queued durably.** `ur.outcomes.record` does not throw for a delivery failure (only
  an `OutcomeStoreError` when its store cannot persist); a timeout, any 401/403/408/429/5xx, or an
  answer without a well-formed gateway envelope (an HTML 400 from a proxy) keeps the event queued.
  Only `invalid_request` / `not_found` / `conflict` in a well-formed envelope drops it
  (`isDefinitiveRejection`). Call `await ur.ur.outcomes.flush()` before your process exits (or use
  `withArtifact`, which flushes for you); replays reuse the event's identity and Idempotency-Key.
- **Report verdicts, not HTTP success.** `ur.ur.outcomes.report` takes the verdict of a check you
  trust. `unknown` sends nothing; `self_rating` never teaches. Report once per episode, on its final
  request; give concurrent tasks distinct `episodeKey`s even when their text is identical.
- **Never sleep before reporting.** An outcome reported before the gateway wrote the request is
  accepted as `pending` with a receipt; `waitForReceipt(id)` follows it (bounded backoff, no DB).
- **Retries are safe by construction.** The same `(requestId, verdict, source, idempotencyKey)` is
  always the same event; pass `observedAt` when a report may be retried from another process.
- **`preflight()` with per-request case modules needs `messages`;** otherwise the answer is
  `knowledge: null` with `knowledge_reason: "case_query_missing"`.
- **Do not invent methods.** If a method is not in `docs/api/sdk.md`, use `ur.request()` with the
  path from `docs/api-coverage.md`.

### Where the documentation lives

All of these ship inside the package (`node_modules/@ultrarouter/sdk/`) and live in the repository:

- `README.md` — overview and quickstart.
- `llms.txt` — an index of every guide; `llms-full.txt` — every guide concatenated.
- `docs/README.md` — the guide index; `docs/*.md` — one guide per topic.
- `docs/api/sdk.md`, `docs/api/context.md` — the complete API reference (generated).
- `docs/api-coverage.md` — every HTTP operation and the method that calls it.
- `docs/cli.md`, `docs/github-action.md` — the `ur` CLI and the GitHub Action.

## Part 2 — working on this repository

### Layout

```text
src/                  the SDK (client.ts, types.ts, errors.ts, http.ts, resources.ts, …)
src/cli/              the `ur` CLI (a separate bundle entry; Node-only code lives here)
src/context.ts        the @ultrarouter/sdk/context entry
src/learning.ts       the @ultrarouter/sdk/learning entry (starters in src/learning-kit/)
src/context-runtime/  GENERATED: the vendored context runtime. Never edit by hand.
src/generated/        GENERATED by `npm run codegen` from openapi/openapi.yaml (gitignored)
openapi/openapi.yaml  the synced API specification (two-line header + byte-identical body)
test/                 unit tests (vitest); test/support/mock-gateway.mjs is the local mock gateway
contract-tests/       hermetic batteries that drive the BUILT package and CLI as a user would
examples/             runnable example programs (executed by `npm run examples` against the mock gateway)
docs/                 guides; docs/api/ and docs/api-coverage.md are GENERATED
scripts/              build, docs, doctest, smoke, leak-scan and spec tooling
action.yml            the GitHub Action
```

### Commands

<!-- doctest: skip — the contributor commands; `npm run check` runs them all, in this order -->

```bash
npm ci                 # install (Node 20+)
npm run codegen        # regenerate src/generated/types.ts from openapi/openapi.yaml
npm run typecheck      # tsc: src, tests, the context entry, examples
npm test               # vitest unit suite
npm run build          # tsup: ESM + CJS + .d.ts, plus the CLI bundle
npm run contract       # hermetic batteries against the built package (needs build)
npm run doctest        # type-check + run the TS/JS blocks and the CLI shell blocks in README, AGENTS.md, docs/ (needs build)
npm run examples       # run every example against the mock gateway (needs build)
npm run docs:gen       # regenerate docs/api/*, docs/api-coverage.md, llms.txt, llms-full.txt
npm run docs:check     # fail if generated docs are stale; forbidden-claim lint
npm run size           # bundle size budgets
npm run smoke          # npm pack → install into a temp consumer → ESM/CJS/tsc/CLI/npx/OpenAI (+ Deno) checks
npm run leak-scan      # secrets, local paths, secret files in the tree + full git history + npm tarball
npm run check          # all of the above, in order (the gate; the ci workflow runs the same list on manual dispatch)
npm run test:integration  # against a REAL gateway; skipped unless ULTRAROUTER_API_KEY + ULTRAROUTER_BASE_URL are set
```

### Rules

- `openapi/openapi.yaml` is synced, never hand-edited: `node scripts/openapi-sync.mjs <spec>` then
  `npm run codegen`. `npm run spec:check` verifies the header hash.
- `src/context-runtime/**` is generated by the gateway project's vendoring tool; never edit it. To
  document an undocumented export, add a documented re-export in `src/context.ts`.
- Every public export needs TSDoc, and every member of an SDK-authored exported interface or class
  too (`test/tsdoc.test.ts`). Then run `npm run docs:gen`.
- A new API operation: add a typed method (or rely on `ur.request()`), add it to
  `scripts/lib/coverage-map.mjs` with the test that proves it (`test/coverage-map.test.ts` enforces
  this), document it, and regenerate the docs.
- Every ``ts block in the docs must be a complete program that passes `npm run doctest`, and every
``bash block must run in the doctest sandbox (`test/doctest/sandbox/`, with `ur` and `npx` bound
  to the built CLI). Opting out needs `<!-- doctest: skip — reason -->` right above the block; a
  block that is meant to fail declares it with `<!-- doctest: exit <n> — reason -->`.
- No savings or performance claims in docs (`npm run docs:check`), and no secret, local path or
  secret file in the tree, the history or the tarball (`npm run leak-scan`; extra patterns can be
  supplied with `--patterns-file` or `ULTRAROUTER_LEAK_PATTERNS_FILE`).
- Never interpolate `${{ … }}` into a `run:` script in `action.yml` or the workflows: pass values
  through `env:` (`test/action.test.ts` enforces it), and pin third-party actions to commit SHAs.
- Zero runtime dependencies: anything the SDK needs at runtime is bundled or written here.
- `test/fixtures/queue-retention-cases.json` pins the durable-queue retention rules case by case and
  is shared byte-for-byte with the Python SDK (`test/queue-retention-fixture.test.ts` runs every
  case). A rule change edits the file in both SDKs together, never one alone.
- `test/fixtures/outcome-verdicts.json` (the verdict → channel/kind mapping of
  `ur.outcomes.report`) and `test/fixtures/toy-env.json` (the order-desk environment) are shared
  byte-for-byte with the Python SDK too; `test/order-desk.test.ts` pins their SHA-256 and
  `test/outcome-report.test.ts` checks `OUTCOME_VERDICTS` against the first. Change them in both SDKs
  together.
- `LearningError` maps a learning refusal by the gateway's named refusal (the first `snake_case`
  token of the error message, with an optional `(detail)`), then by the error code
  (`LEARNING_ERROR_CODES` in `src/learning-controls.ts`); keep the table in step with the Python
  SDK.
