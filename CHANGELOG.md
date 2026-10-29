# Changelog

All notable changes to `@ultrarouter/sdk` are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html). Before 1.0.0, a minor version may
contain breaking changes; they are always listed under **Changed** or **Removed**.

## [Unreleased]

The version in `package.json` is now `0.1.0`: these changes ship as the 0.1.0 release.

### Fixed

- The acknowledgement-loss example verifies the exact answer instead of hardcoding success;
  negative executions check wrong non-empty and empty answers report failure.
- Learning examples now resolve a call type before traffic and send its slug on every call; controls
  use its `ct_...` ID. The controls-only example refuses a missing ID or slug before any request.
  Setup instructions require both knowledge and corrections consent, granted by an owner/admin.
  The guide explains limited candidate exposure during randomized evaluation before activation.

### Added

- **Plug-and-play learning** (new guide: `docs/plug-and-play-learning.md`; eight runnable programs in
  `examples/learning/`).
  - Request and episode correlation: chat completion and embeddings results expose `requestId` (the
    `x-ur-request-id` the gateway echoes; not enumerable), and a stream exposes it as soon as it
    opens. Per-call `requestId` and `episodeKey` options send `x-ur-request-id` and `x-ur-artifact`;
    the `requestIds: 'client'` constructor option mints `req_c_<ULID>` ids so the id is known before
    the call returns. `mintRequestId`, `mintEpisodeKey`, `correlationHeaders` and `readRequestId`
    cover the official `openai` client path.
  - `ur.outcomes.report(requestId, { verdict, source, idempotencyKey?, observedAt?, evidenceHash?,
supersedes? })`: a `pass` / `fail` verdict from a `verifier`, `business_rule`, `webhook`,
    `human_review` or `self_rating` source mapped onto the outcome channels by `OUTCOME_VERDICTS`
    (pinned by `test/fixtures/outcome-verdicts.json`, shared with the Python SDK). `unknown` sends
    nothing and resolves `not_reported`; a `self_rating` is typed `teaches: false`. Each report
    carries a `source_event_id` derived from the request, verdict, source and caller key
    (`reportSourceEventId`) and goes through the durable queue under that identity, so a lost
    acknowledgement, a flush, a repeated call or a restarted process never double-reports.
  - Outcome receipts (`ocr_…`): `ur.outcomes.receipt(id)` (`GET /v1/outcome-receipts/{id}`),
    `ur.outcomes.receiptsForRequest(requestId)` (`GET /v1/requests/{id}/outcome-receipts`) and
    `ur.outcomes.waitForReceipt(id, { timeoutMs, signal })` (bounded exponential backoff over the
    public receipt route; `ReceiptWaitTimeoutError`; cancellable with an `AbortSignal`). A receipt
    carries its `status` (`pending`, `applied`, `rejected`, `failed`, `expired`), `reason`,
    `outcome_status`, `artifact_id`, `expires_at` and its `episode` association
    (`{ status, trace_id, verdict }`); a report's `result` is the request shortcut's answer
    (`accepted`, `duplicate` or `pending`) with its receipt.
  - Learning controls per call type: `ur.learning.status` (the `learning` status: state, recipe,
    reflection provider, promotion policy, active version, latest candidate, evaluations, evidence,
    budget, usage, outcome receipts), `enable` (`reflection_model`, `lessons_mode`, `lessons_k`,
    `promotion` as an object of policy changes, `recipe`), `pause`, `resume`, `disable`,
    `versions`, `version`, `rollback` (`version_id` optional: the previously active version),
    `promote`, `reject` and `evaluations`. Every control resolves a `learning_control` result.
    A refusal you can act on is a `LearningError` with a `reason`, the gateway's named `refusal`
    (the first token of its message), its `detail` and an `action`: `missing_consent`,
    `provider_unavailable` (`reflection_model_not_workspace_owned (<detail>)`), `not_enabled`,
    `invalid_promotion`, `version_conflict`, `quota_exhausted`, `budget_exhausted`, `not_found`,
    `forbidden`.
  - Every receipt and learning type is aliased from the generated OpenAPI types.
- A new entry point, `@ultrarouter/sdk/learning`, with starter outcome adapters: `runVerifier` and
  `verdictFromCommand` (a computable check or a command's exit code becomes a verdict plus an
  evidence hash), `validateOutput` (a zod schema or a JSON-Schema subset plus business rules), and
  `createWebhookReceiver` (HMAC-SHA256 signatures verified in constant time inside a timestamp
  window, redeliveries deduplicated by event id through an atomic claim store, the secret read from
  `ULTRAROUTER_WEBHOOK_SECRET`, and the signed timestamp used as `observedAt` when the payload has
  none); and `createOrderDesk`, a deterministic four-tool demonstration environment with a
  state-based verifier (`test/fixtures/toy-env.json`, shared with the Python SDK: a second
  reservation of an order is `ALREADY_RESERVED`, and every SKU's final stock must match what was
  reserved). The environment demonstrates the integration; it is not evidence of efficacy.
- The OpenAPI document is resynced. Besides the receipt and learning routes, it adds the
  lab-authorised episode-memory routes (`GET /v1/call-types/{id}/episode-memory`, `…/enable`,
  `…/disable`), the per-key default call type (`PATCH /v1/workspaces/{id}/api-keys/{keyId}`), the
  workspace self-learning switch (`GET` / `PUT /v1/workspaces/{id}/self-learning`), adaptive
  rollouts and prepaid billing; these have no dedicated method and are reached with
  `ur.request()` (most need an owner session, not an API key). Batch outcome rows may now be
  `pending` with a receipt.

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

- Learning setup and refusal guidance require the full owner/admin self-learning opt-in
  (knowledge and corrections consent); the synced API specification carries the same requirement.
- The durable outcome queue treats a success result with `status: "pending"` as delivered (the
  gateway holds a receipt and applies the outcome once the request lands) instead of resending it.
  The shared retention fixture gains the two `pending` cases; the Python SDK takes the same change.
- Installation instructions no longer advertise a registry install: the package is not on the npm
  registry yet. The README, `AGENTS.md`, the installation, CLI and troubleshooting guides, the
  examples README and `llms*.txt` now describe building the tarball from the public GitHub source
  and installing it; the GitHub Action guide notes that its install step needs the package on the
  registry.
- The core bundle budget rises from 15 kB to 19 kB min+gz for the learning surface; the new
  `@ultrarouter/sdk/learning` entry has its own 10 kB budget and is never loaded by the client.

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
