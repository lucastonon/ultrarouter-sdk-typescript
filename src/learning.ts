/**
 * `@ultrarouter/sdk/learning`: starter outcome adapters and a demonstration environment for the
 * learning loop. Everything here runs in your process and sends nothing by itself; hand the verdicts
 * to `ur.ur.outcomes.report` on the client.
 *
 * - **Verifier helpers**: {@link runVerifier} and {@link verdictFromCommand} turn a computable
 *   check (a function, a test suite's exit code) into `pass` / `fail` / `unknown` plus an evidence
 *   hash.
 * - **Business-rule validator**: {@link validateOutput} checks a structured output against a zod
 *   schema or a JSON-Schema subset and your own rules.
 * - **Signed webhook receiver**: {@link createWebhookReceiver} verifies HMAC-SHA256 signatures with a
 *   timestamp window, deduplicates redeliveries by event id and reports with `source: 'webhook'`.
 * - **Order desk**: {@link createOrderDesk}, a deterministic four-tool environment with a
 *   state-based verifier, for examples and tests. A demonstration, not evidence of efficacy.
 *
 * These are starters: small, dependency-free and meant to be read, copied and adapted.
 *
 * @example
 * ```ts
 * import { createOrderDesk } from "@ultrarouter/sdk/learning";
 *
 * const desk = createOrderDesk("s1");
 * desk.call("reserve_stock", { order_id: "A-100", sku: "SKU-RED", quantity: 2 });
 * desk.call("set_order_status", { order_id: "A-100", status: "reserved" });
 * console.log(desk.verify().verdict); // "pass"
 * ```
 *
 * @packageDocumentation
 */

export {
  evidenceHash,
  runVerifier,
  verdictFromCommand,
  type CheckResult,
  type CommandResult,
  type RunVerifierOptions,
  type VerifierVerdict,
} from './learning-kit/verifier.js';
export {
  checkJsonSchemaLite,
  validateOutput,
  type BusinessRule,
  type JsonSchemaLite,
  type RuleVerdict,
  type SafeParseSchema,
} from './learning-kit/business-rules.js';
export {
  createWebhookReceiver,
  MemoryWebhookDedupeStore,
  parseWebhookOutcome,
  signWebhook,
  verifyWebhookSignature,
  WEBHOOK_DEFAULT_TOLERANCE_S,
  WEBHOOK_SECRET_ENV,
  WEBHOOK_SIGNATURE_HEADER,
  WEBHOOK_TIMESTAMP_HEADER,
  type VerifyWebhookParams,
  type WebhookDedupeStore,
  type WebhookHandleResult,
  type WebhookOutcome,
  type WebhookReceiver,
  type WebhookReceiverOptions,
  type WebhookRejectReason,
  type WebhookReporter,
  type WebhookRequest,
  type WebhookSignatureCheck,
} from './learning-kit/webhook.js';
export {
  createOrderDesk,
  OrderDesk,
  orderDeskScenarios,
  orderDeskTools,
  type OrderDeskEnvironment,
  type OrderDeskFunctionTool,
  type OrderDeskOrder,
  type OrderDeskOrderCheck,
  type OrderDeskOrderState,
  type OrderDeskScenario,
  type OrderDeskToolResult,
  type OrderDeskToolSpec,
  type OrderDeskVerdict,
} from './learning-kit/order-desk.js';
export { ORDER_DESK } from './learning-kit/order-desk-data.js';
export type {
  OutcomeReportParams,
  OutcomeReportResult,
  OutcomeSource,
  OutcomeVerdict,
} from './outcome-report.js';
