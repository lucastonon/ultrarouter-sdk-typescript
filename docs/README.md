# @ultrarouter/sdk documentation

Guides for the TypeScript SDK of [ultrarouter](https://ultrarouter.dev), an OpenAI-compatible LLM
gateway and router. Every TypeScript example in these guides is a complete program that is
type-checked and executed in CI against a local mock gateway.

New here? Read [installation](./installation.md), then [configuration](./configuration.md), then
[chat completions](./chat-completions.md).

## Getting started

| Guide                                          | What it covers                                                                                                                     |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| [Installation and runtimes](./installation.md) | Install; ESM and CommonJS; supported runtimes (Node.js, Deno; Bun and edge untested); entry points; TypeScript setup.              |
| [Configuration](./configuration.md)            | Every constructor option, environment variables, base URL and self-hosting, defaults, Autopilot intent, Bench tag, custom `fetch`. |

## Model calls

| Guide                                             | What it covers                                                                                                                                      |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Chat completions](./chat-completions.md)         | Parameters, ultrarouter extensions (`call_type`, `router`, `compression`, `models`, `ur.*`), reasoning, cache breakpoints, the `ur` response block. |
| [Streaming](./streaming.md)                       | `for await` streams, the final chunk, stopping early, mid-stream errors.                                                                            |
| [Tools](./tools.md)                               | Function calling round trip, `tool_choice`, streamed tool calls.                                                                                    |
| [Structured outputs](./structured-outputs.md)     | `json_schema` and `json_object`, capability errors.                                                                                                 |
| [Embeddings](./embeddings.md)                     | Batches, base64 output, `dimensions`.                                                                                                               |
| [Models](./models.md)                             | `models.list` filters, `models.retrieve` offers, pricing and provenance fields.                                                                     |
| [OpenAI compatibility](./openai-compatibility.md) | `asOpenAI()`, using the `openai` client with the gateway, surface mapping.                                                                          |

## Reliability

| Guide                                                                  | What it covers                                                 |
| ---------------------------------------------------------------------- | -------------------------------------------------------------- |
| [Errors](./errors.md)                                                  | `UltraRouterError`, `ModelUnpricedError`, every error code.    |
| [Retries, timeouts and idempotency](./retries-timeouts-idempotency.md) | What is retried, backoff, timeouts, abort, idempotency keys.   |
| [Testing your app](./testing.md)                                       | Fake `fetch`, simulated errors and streams, integration tests. |
| [Troubleshooting and FAQ](./troubleshooting.md)                        | Symptoms, causes and fixes.                                    |

## ultrarouter resources

| Guide                                                         | What it covers                                                                                      |
| ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| [Call types](./call-types.md)                                 | Call-type configuration, evals, recommendations, hosted prompts, verified memory, Autopilot status. |
| [Feedback and generation stats](./feedback-and-generation.md) | Rating a request; reading tokens, cost, timing and routing of a request.                            |
| [Outcomes](./outcomes.md)                                     | Artifact types, artifacts, outcome events, the durable queue, `withArtifact`, `diffStats`.          |
| [Reviewer adapter](./reviewer.md)                             | Sending human approve / reject / edit decisions, signed and replay-safe.                            |
| [Learning status and checks](./learning.md)                   | Learning status and calibration, verdict sources, source checks, improvement reads, oracles.        |
| [History imports](./imports.md)                               | Importing prior usage or traces.                                                                    |
| [Preflight and learned context](./preflight.md)               | `preflight()`, `useLearned()`, per-request `messages`, hosted prompt rendering.                     |
| [Bench](./bench.md)                                           | Suites, paired runs, reports and the baseline-compare gate from code.                               |
| [Context runtime](./context-runtime.md)                       | `@ultrarouter/sdk/context`: modules, contracts, `compile`, manifests, knowledge packs.              |
| [Typed requests](./typed-requests.md)                         | `ur.request()` for any operation in the OpenAPI document.                                           |

## Command line and CI

| Guide                               | What it covers                                                     |
| ----------------------------------- | ------------------------------------------------------------------ |
| [The `ur` CLI](./cli.md)            | Every command, flag, environment variable and exit code.           |
| [GitHub Action](./github-action.md) | Every mode, input and output, and the least-privilege permissions. |

## Reference

| Page                                           | What it covers                                                        |
| ---------------------------------------------- | --------------------------------------------------------------------- |
| [API reference index](./api/README.md)         | Generated from the TSDoc of every export.                             |
| [`@ultrarouter/sdk`](./api/sdk.md)             | The client entry point.                                               |
| [`@ultrarouter/sdk/context`](./api/context.md) | The context runtime entry point.                                      |
| [API coverage](./api-coverage.md)              | Every gateway operation, the SDK method that covers it, and its test. |

## Runnable examples

[`examples/`](../examples/README.md) holds complete programs for the main flows. Each runs against
a real gateway with `ULTRAROUTER_API_KEY` set, and against the local mock in CI.

## For AI agents

Start with [`AGENTS.md`](../AGENTS.md) for canonical patterns and pitfalls. [`llms.txt`](../llms.txt)
indexes these guides and [`llms-full.txt`](../llms-full.txt) contains all of them in one file. All
three ship inside the npm package, under `node_modules/@ultrarouter/sdk/`.
