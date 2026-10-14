# Examples

Complete, runnable programs for the main flows. Each one reads `ULTRAROUTER_API_KEY` (and the
optional `ULTRAROUTER_BASE_URL`) from the environment, so the same file runs against your gateway
and, in this repository's CI, against a local mock gateway (`npm run examples`).

```bash
npm install @ultrarouter/sdk
export ULTRAROUTER_API_KEY=ur_sk_test_...
npx tsx examples/quickstart.ts
```

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

## Type-checking

`examples/tsconfig.json` type-checks every example against the SDK source (`npm run typecheck`).
