# Changelog

All notable changes to `@ultrarouter/sdk` are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html). Before 1.0.0, a minor version may
contain breaking changes; they are always listed under **Changed** or **Removed**.

## [Unreleased]

### Added

- The bounded-experiment RUN surface under `ur.flywheel.experiments`, for a key with the
  `flywheel:experiment:run` scope: `enrol(experimentId, { phase, pair_key, slot })` enrols one
  execution slot (the gateway decides the arm, never the caller; a repeat of the same tuple returns
  the same execution, so a resume is safe), `outcome(experimentId, executionId, params)` records the
  one body-free terminal outcome and takes `{ dryRun: true }` to send `?dry_run=true` and return the
  dry-run answer with nothing written (the recorded and dry-run shapes are separate types,
  `ExperimentExecutionOutcome` and `ExperimentExecutionOutcomeDryRun`, discriminated by `object`), and
  `evaluateScreen` / `evaluateTest` run the screen / prospective-test evaluation explicitly. Named
  refusals (`experiment_not_live`, `phase_not_open`, `outcome_conflict`, `receipt_missing:<stage>`, …)
  reach the caller on the typed `UltraRouterError`. The `EXPERIMENT_EXECUTION_HEADER`
  (`x-ur-experiment-execution`) constant is exported for the header every call of a run carries. The
  owner-session operations (holds, reconcile, judgements, acknowledge, test fund / manifest) stay
  unmapped — an API key cannot call them. New guide section: "Running a bounded experiment" in
  `docs/learning.md`.
- Native passthrough coverage for the two operations the gateway added: `createResponse`
  (`POST /v1/responses`, the OpenAI Responses API) and `createMessage` (`POST /v1/messages`, the
  Anthropic Messages API). Both are opaque passthrough surfaces with no dedicated method; they are
  mapped as raw-request operations in the coverage table and reached with `ur.request()`. The
  intended client is the official `openai` / `@anthropic-ai/sdk` pointed at your gateway
  (`OPENAI_BASE_URL=<gateway>/v1`, `ANTHROPIC_BASE_URL=<gateway>`, your `ur_sk_…` key): the body is
  forwarded to the provider unchanged and metered, callers tag calls with the `X-UR-Call-Type`,
  `X-UR-Trace` and `X-UR-Timeout-Ms` request headers, and every non-streaming response carries the
  `X-UR-Request-Id` and `X-UR-Cost-Micro-USD` response headers. New guide: `docs/passthrough.md`.

### Changed

- Installation instructions no longer advertise a registry install: the package is not on the npm
  registry yet. The README, `AGENTS.md`, the installation, CLI and troubleshooting guides, the
  examples README and `llms*.txt` now describe building the tarball from the public GitHub source
  and installing it; the GitHub Action guide notes that its install step needs the package on the
  registry.
- **Breaking:** the client now requires a gateway base URL — there is no hosted default. Pass
  `baseURL`, or set `ULTRAROUTER_BASE_URL` (or `UR_BASE_URL`). When none is configured the
  `UltraRouter` constructor throws an `UltraRouterError` with code `configuration` whose message
  names the option, both environment variables, and `http://localhost:8080` as the local-gateway
  example. The `ur` CLI resolves `--base-url` the same way and fails closed (exit 2) with the same
  message, and the GitHub Action's `base-url` input is now `required` with no default.

### Removed

- The `DEFAULT_BASE_URL` export and the built-in hosted default gateway URL. ultrarouter is
  self-hosted; the SDK no longer presents a hosted gateway that does not exist.

## [0.0.1] - 2026-10-13

The first public release of the TypeScript SDK, built against the current published ultrarouter
OpenAPI document (`openapi/openapi.yaml`, `spec-sha256` in its header).

### Added

- `UltraRouter` client with the OpenAI-compatible surface: `chat.completions.create` (including
  streaming, tools, structured outputs, `reasoning_effort` / `reasoning` and `cache_control`
  content parts), `embeddings.create`, `models.list` and `models.retrieve` (new: one model with
  every provider offer, origin and hosting jurisdiction, and weights availability).
- Configuration from the environment: `ULTRAROUTER_API_KEY` (or `UR_API_KEY`) and, new,
  `ULTRAROUTER_BASE_URL` (or `UR_BASE_URL`) for your own deployment.
- The `ur` namespace: call types (CRUD, eval triggers, eval run listing, model recommendations,
  hosted prompt versions, verified-memory controls), feedback, generation stats, API key
  introspection (`ur.key.get`), the Autopilot readiness read, Bench (suites, paired runs, reports,
  baselines and the compare gate), artifact types, artifacts, outcomes with a durable local queue,
  the signed reviewer-decision adapter, learning status, verdict sources and planted-failure checks,
  improvement reads, oracles (including the signed pull transport) and history imports.
- `ur.request(method, path, init)`: a typed escape hatch for every operation in the OpenAPI
  document, with path, query and body types derived from the specification.
- Types derived from the specification keep every nullable value exact, never `unknown`: a chat
  choice's `finish_reason` and `message.content` are `string | null`, a message's `content` in
  `ChatCompletionCreateParams` and `PreflightParams` is `string | ChatContentPart[] | null`, and an
  eval run's `run_spec` (`EvalRunList`) is the verified run spec, the integrity-refused stub or
  `null`. The hand-written response types are checked against the specification in both
  directions, with no exception.
- `preflight()`, `useLearned()`, `getPrompt()` and `renderPrompt()` for callers that call model
  providers directly. `preflight()` accepts the optional `messages` field (the same `ChatMessage`
  objects `chat.completions.create` takes): a call type whose learned module is rendered per request
  needs it, and without it the gateway answers `knowledge: null` with
  `knowledge_reason: "case_query_missing"`. The preflight cache is keyed on a digest of the messages.
- Typed errors: `UltraRouterError`, the full `GATEWAY_ERROR_TAXONOMY` (code → status and
  retryability), `isUltraRouterError`, and `ModelUnpricedError` for the gateway's `model_unpriced`
  refusal (HTTP 403), which is never retried.
- Retries that follow the gateway's own signals: an error body that says `"retryable": false` is
  never retried, even with a 5xx status (the explicit flag wins over the status class); a code the
  gateway marks non-retryable (for example `model_unpriced`, `invalid_request`, `internal`,
  `atomic_spend_guard_unavailable`) is never retried, whatever its status; a response without
  that information retries on 408, 429 and 5xx. Jittered backoff honours `Retry-After`, and
  non-streaming POSTs carry an idempotency key that stays stable across retries.
- One total deadline per call: the `timeout` covers every attempt, the backoff and reading the
  response body, and for a stream the whole stream; your `AbortSignal` keeps cancelling until the
  body is read or the stream is torn down. A stalled body or stream fails with `timeout` (or
  `aborted`) instead of hanging.
- A Server-Sent Events parser that follows the standard: LF, CRLF and CR line endings (also split
  across network chunks), comments and unknown fields; a stream that ends before `[DONE]` is an
  error, never a silent truncation.
- A durable outcome queue that only drops an event the gateway definitively refused
  (`isDefinitiveRejection`): a 4xx other than 401/403/408/429 whose body is a well-formed gateway
  error envelope (`UltraRouterError.envelope`) with `"retryable": false` and an event-specific code
  (`EVENT_REJECTION_CODES`: `invalid_request`, `not_found`, `conflict`) at its taxonomy status.
  Timeouts, cancellations, connection failures, every 401/403/408/429 and 5xx, answers without the
  envelope (an HTML 400 from a proxy, an empty or unreadable body) and malformed successes keep it
  queued, and every replay reuses the event's identity and its `Idempotency-Key`
  (`ur-outcome-<entry id>`), also after a restart. The reviewer queue removes an event only on a
  per-event verdict that validates (`reviewerVerdictAction`); a failed delivery never removes one.
  The rules are pinned case by case in `test/fixtures/queue-retention-cases.json`, which the Python
  SDK runs byte-for-byte too.
  `FileOutcomeStore` writes atomically with mode `0600` and starts empty only when its file is
  absent: an unreadable or malformed file raises `OutcomeStoreError` and is never overwritten.
- A bounded preflight cache (least recently used, expired entries swept), configurable with
  `preflightCache: { maxEntries }`.
- Model ids passed to `models.retrieve` are encoded per path segment, and `.` / `..` / empty
  segments are refused before any request is sent.
- `asOpenAI()` for the official `openai` client.
- `@ultrarouter/sdk/context`: the pure context runtime (modules, envelopes, contracts, `compile`,
  manifests, `render` / `toMessages`, `fromMessages`, `toWire`, lint, native delivery planning, the
  SOP compiler), knowledge packs (`loadPack`, `validatePack`, `renderPack`, `parsePack`) and the
  learned-module placement rule.
- The `ur` CLI: `bench run | baseline | gate`, `app-ci`, `flywheel-pr` (and `flywheel-pr decision`),
  `import`, `outcomes import | pending`, `flywheel status | calibration`, `context lint`,
  `pack validate`, `--help` and `--version`. Gates fail closed: `ur bench run` validates every flag
  combination before it captures anything; `ur app-ci` refuses to treat failed change discovery as
  "no changes"; `ur app-ci` and `ur flywheel-pr` run a harness only when the checkout is the
  claimed `--head` (`HEAD` is that commit and no tracked file differs, apart from the digest-bound
  config and lockfile), and otherwise stop with a named `candidate_*` error before anything is
  written or published; a harness that exits non-zero or is killed by a signal never passes,
  whatever it reported. Credentials are removed from every published comment and Check Run: a
  credential-bearing header line (`Cookie`, `Set-Cookie`, `Authorization` with any scheme,
  `X-API-Key`, `*-Token`, `*-Secret`, …) loses its whole value, every cookie pair and quoted value
  included; an assignment or query parameter loses its own value; quoted values are escape-aware at
  every JSON-encoding level, so an escaped quote never ends a value early; known token shapes, URL
  passwords and email addresses go too. Redaction runs in linear time.
- A GitHub Action (`action.yml`) with `bench`, `app-ci` and `flywheel-pr` modes. Inputs are data:
  none is interpolated into a shell script, each is validated and passed as one argument (only
  `capture` is executed, by design), and third-party steps are pinned to commit SHAs.
- Documentation for humans and agents: guides under `docs/`, a generated API reference, an API
  coverage table, `AGENTS.md`, `llms.txt` and `llms-full.txt`, and runnable examples. Every
  TypeScript and JavaScript block in the docs is type-checked and executed in CI against a local mock
  gateway, and so is every CLI shell block that can run offline; the rest (installing from the
  registry, other runtimes, a pull request on GitHub) are marked and listed with their reason.
- Tested on Node.js 20, 22 and 24 and on Deno 2 (the packed package, in CI).
- A leak scan of the tree, the full git history and the npm tarball for secrets, absolute local
  paths and committed secret files, with optional extra patterns from a file
  (`--patterns-file` / `ULTRAROUTER_LEAK_PATTERNS_FILE`). The history scan takes every changed path
  from git's own `--raw -z` output (binary, empty, renamed and deleted files included) and scans
  the content of every text blob any commit introduced, so a secret file or a secret removed by a
  later commit is still reported.

[Unreleased]: https://github.com/lucastonon/ultrarouter-sdk-typescript/compare/v0.0.1...HEAD
[0.0.1]: https://github.com/lucastonon/ultrarouter-sdk-typescript/releases/tag/v0.0.1
