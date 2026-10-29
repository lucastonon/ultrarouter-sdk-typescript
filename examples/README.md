# Examples

Complete, runnable programs for the main flows. Each one reads `ULTRAROUTER_API_KEY` and
`ULTRAROUTER_BASE_URL` from the environment, so the same file runs against your gateway and, in this
repository's checks, against a local mock gateway (`npm run examples`).

The package is not published to the npm registry yet. Inside a clone of this repository the
examples import the built package by its own name, so build it first and run an example with `tsx`
(the `openai` examples use the `openai` dev dependency):

<!-- doctest: skip — needs a clone of this repository, a build and a reachable gateway -->

```bash
npm ci && npm run build
export ULTRAROUTER_API_KEY=ur_sk_test_...
export ULTRAROUTER_BASE_URL=http://localhost:8080
npx tsx examples/quickstart.ts
```

In your own project, install the package from a tarball first (see
[installation](../docs/installation.md#install)).

Model ids are illustrative; `ur.models.list()` shows what your gateway serves.

## Model calls

| Example                                                      | What it shows                                                                   |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------- |
| [`quickstart.ts`](./quickstart.ts)                           | One chat completion and the `ur` response block.                                |
| [`streaming.ts`](./streaming.ts)                             | Printing a streamed reply and reading the final chunk's usage and cost.         |
| [`tools.ts`](./tools.ts)                                     | The full function-calling round trip, including sending tool results back.      |
| [`structured-output.ts`](./structured-output.ts)             | `json_schema` output, parsed into a typed object.                               |
| [`embeddings.ts`](./embeddings.ts)                           | Embedding a batch and comparing vectors.                                        |
| [`models.ts`](./models.ts)                                   | Listing and filtering the catalog; one model's provider offers.                 |
| [`openai-drop-in.ts`](./openai-drop-in.ts)                   | Using the official `openai` client through `asOpenAI()` (needs `npm i openai`). |
| [`errors-and-retries.ts`](./errors-and-retries.ts)           | Error codes, the typed `ModelUnpricedError`, retries and timeouts.              |
| [`testing-with-fake-fetch.ts`](./testing-with-fake-fetch.ts) | Unit-testing code that uses the SDK with a fake `fetch` (no network).           |
| [`typed-request.ts`](./typed-request.ts)                     | `ur.request()` for any operation in the OpenAPI document.                       |

## ultrarouter resources

| Example                                                          | What it shows                                                                          |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| [`call-types.ts`](./call-types.ts)                               | Creating and updating a call type, evals and recommendations.                          |
| [`feedback-and-generation.ts`](./feedback-and-generation.ts)     | Rating a request and reading its generation stats.                                     |
| [`outcomes.ts`](./outcomes.ts)                                   | Artifacts, outcome events, `withArtifact`, and a metadata-only final with `diffStats`. |
| [`preflight.ts`](./preflight.ts)                                 | `preflight()` and `useLearned()` for callers that call their model directly.           |
| [`hosted-prompts.ts`](./hosted-prompts.ts)                       | Hosted prompt versions, `getPrompt()` and `renderPrompt()`.                            |
| [`context-runtime.ts`](./context-runtime.ts)                     | The pure context runtime: `fromMessages`, `compile`, `toWire`, `toMessages`.           |
| [`knowledge-pack.ts`](./knowledge-pack.ts)                       | Loading and validating a `*.ur.md` knowledge pack.                                     |
| [`bench.ts`](./bench.ts)                                         | Bench suites, runs and the compare gate from code.                                     |
| [`reviewer/reviewer-adapter.ts`](./reviewer/reviewer-adapter.ts) | The reviewer adapter end to end: setup, test event, repair, health.                    |
| [`reviewer/backfill.ts`](./reviewer/backfill.ts)                 | Backfilling historical reviewer decisions.                                             |

## Plug-and-play learning

Eight programs under [`learning/`](./learning/) connect an agent to the learning loop. They run the
order-desk demonstration environment from `@ultrarouter/sdk/learning` (a deterministic toy with a
state-based verifier: it shows the integration working, it is not evidence that learning improves
an agent). Each reads `ULTRAROUTER_API_KEY` and `ULTRAROUTER_BASE_URL` (and optionally
`ULTRAROUTER_MODEL`), prints a few lines and exits non-zero when the integration fails.

| Example                                                                    | What it shows                                                                                                                            |
| -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| [`learning/01-openai-client.ts`](./learning/01-openai-client.ts)           | An existing `openai` agent loop: new base URL and key, per-call request id + episode key, outcome reporting.                             |
| [`learning/02-native-verifier.ts`](./learning/02-native-verifier.ts)       | The native SDK and a real state-based verifier; the verdict is reported with its evidence hash.                                          |
| [`learning/03-multi-step-episode.ts`](./learning/03-multi-step-episode.ts) | A multi-step tool episode under one episode key; two concurrent tasks with identical text kept apart.                                    |
| [`learning/04-immediate-outcome.ts`](./learning/04-immediate-outcome.ts)   | Reporting right after the final response (a `pending` receipt), then `waitForReceipt`. No sleeps.                                        |
| [`learning/05-delayed-webhook.ts`](./learning/05-delayed-webhook.ts)       | A delayed outcome by signed webhook: verification, redelivery deduplication, a forged copy refused (needs `ULTRAROUTER_WEBHOOK_SECRET`). |
| [`learning/06-ack-loss-retry.ts`](./learning/06-ack-loss-retry.ts)         | A lost acknowledgement plus an app-level retry: identical bytes and key, one receipt.                                                    |
| [`learning/07-learning-controls.ts`](./learning/07-learning-controls.ts)   | Learning status, pause / resume, history, rollback, evaluations and disable, with actionable errors.                                     |
| [`learning/08-streaming.ts`](./learning/08-streaming.ts)                   | A streaming tool loop: the request id at stream open, tool-call deltas assembled, the outcome reported.                                  |

## Type-checking

`examples/tsconfig.json` type-checks every example against the SDK source (`npm run typecheck`).
