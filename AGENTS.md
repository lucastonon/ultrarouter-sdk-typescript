# AGENTS.md — using and changing `@ultrarouter/sdk`

This file is for AI coding agents (and humans who like short, exact instructions). It has two parts:
how to **use** the SDK in an application, and how to **work on** this repository.

## Part 1 — using the SDK

`@ultrarouter/sdk` is the official TypeScript client for ultrarouter, an OpenAI-compatible LLM
gateway and router. It mirrors the `openai` client (`chat.completions.create`, `embeddings.create`,
`models.list`) and adds ultrarouter resources under `ur.*`. Zero runtime dependencies, ESM and
CommonJS; tested on Node.js 20+ and Deno 2, expected to work (untested) on Bun and edge runtimes.

### Install and configure

<!-- doctest: skip — installs from the npm registry -->

```bash
npm install @ultrarouter/sdk
export ULTRAROUTER_API_KEY=ur_sk_test_...         # or UR_API_KEY
export ULTRAROUTER_BASE_URL=https://gateway.example.com  # optional; default https://api.ultrarouter.dev
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

### Pitfalls

- **Keys are server-side secrets.** Never ship an API key to a browser; call the gateway from your
  server. Use `ur_sk_test_…` keys for tests and Bench capture.
- **Default import vs named import.** ESM: `import UltraRouter from '@ultrarouter/sdk'` or
  `import { UltraRouter } from '@ultrarouter/sdk'`. CommonJS:
  `const { UltraRouter } = require('@ultrarouter/sdk')`.
- **The context runtime is a separate entry:** `import { compile } from '@ultrarouter/sdk/context'`.
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
src/context-runtime/  GENERATED: the vendored context runtime. Never edit by hand.
src/generated/        GENERATED by `npm run codegen` from openapi/openapi.yaml (gitignored)
openapi/openapi.yaml  the synced API specification (two-line header + byte-identical body)
test/                 unit tests (vitest); test/support/mock-gateway.mjs is the local mock gateway
contract-tests/       hermetic batteries that drive the BUILT package and CLI as a user would
examples/             runnable example programs (executed in CI against the mock gateway)
docs/                 guides; docs/api/ and docs/api-coverage.md are GENERATED
scripts/              build, docs, doctest, smoke, leak-scan and spec tooling
action.yml            the GitHub Action
```

### Commands

<!-- doctest: skip — the contributor commands; `npm run check` runs them all, in this order, in CI -->

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
npm run check          # all of the above, in order (the CI gate)
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
