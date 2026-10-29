/**
 * `@ultrarouter/sdk`: the official TypeScript SDK for the ultrarouter gateway. The default export is
 * the {@link UltraRouter} client; every type, error and helper is a named export. Fetch-based, zero
 * runtime dependencies, ESM and CommonJS, and portable to Node.js, Bun, Deno and edge runtimes.
 *
 * @example
 * ```ts
 * import UltraRouter from "@ultrarouter/sdk";
 *
 * const ur = new UltraRouter({ defaultModel: "openai/gpt-5.2-mini" });
 * const res = await ur.chat.completions.create({ messages: [{ role: "user", content: "hi" }] });
 * console.log(res.choices[0]?.message.content, res.ur.cost_usd);
 * ```
 *
 * @packageDocumentation
 */

export {
  UltraRouter,
  DEFAULT_MAX_RETRIES,
  DEFAULT_TIMEOUT_MS,
  type ArtifactScope,
  type AsOpenAI,
  type ChatCompletionsCreate,
  type ArtifactsResource,
  type BenchResource,
  type CallTypesResource,
  type ChatResource,
  type EmbeddingsResource,
  type ExperimentOutcomeOptions,
  type ExperimentsResource,
  type FlywheelResource,
  type HostedPromptsResource,
  type ImportsResource,
  type LearnedRecordOptions,
  type LearnedSession,
  type LearningResource,
  type KnowledgeResource,
  type ModelListQuery,
  type ModelsResource,
  type OraclesResource,
  type OutcomesResource,
  type ReviewerDeliveryOptions,
  type ReviewerResource,
  type SourceChecksResource,
  type UrNamespace,
  type VerifiedMemoryResource,
} from './client.js';
export { UltraRouter as default } from './client.js';
export { VERSION } from './version.js';
export {
  UltraRouterError,
  ModelUnpricedError,
  GATEWAY_ERROR_CODES,
  GATEWAY_ERROR_TAXONOMY,
  isGatewayErrorCode,
  isRetryableStatus,
  isUltraRouterError,
  type GatewayErrorCode,
  type GatewayErrorEnvelope,
} from './errors.js';
export type { OpenAICompatConfig, OpenAIConstructor } from './openai-adapter.js';
export * from './types.js';
export * from './resources.js';
// The outcome ledger: artifacts, outcomes, the durable queue and the pure diff helper.
export * from './diff-stats.js';
export * from './artifacts.js';
export * from './outcomes.js';
export * from './flywheel-queue.js';
// Plug-and-play learning: request/episode correlation, verdict reports, receipts and learning controls.
export * from './correlation.js';
export * from './outcome-report.js';
export * from './outcome-receipts.js';
export * from './learning-controls.js';
// Learning status and history imports.
export * from './flywheel-status.js';
export * from './imports.js';
// The signed reviewer-decision adapter.
export * from './reviewer.js';
// preflight() types and cache helpers, plus the pure learned-module placement rule (also on
// `@ultrarouter/sdk/context`).
export * from './preflight.js';
export * from './learned-placement.js';
// The hosted-prompt render rule (also on `@ultrarouter/sdk/context`).
export * from './prompt-render.js';
