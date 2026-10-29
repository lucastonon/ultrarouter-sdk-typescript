# API reference: `@ultrarouter/sdk/learning`

Generated from the TypeScript sources and their TSDoc by `scripts/gen-docs.mjs` (do not edit by hand). Version 0.1.0. 50 exports.

```ts
import { /* named exports */ } from '@ultrarouter/sdk/learning';
```

## Contents

- **Classes:** [`MemoryWebhookDedupeStore`](#memorywebhookdedupestore), [`OrderDesk`](#orderdesk)
- **Functions:** [`checkJsonSchemaLite`](#checkjsonschemalite), [`createOrderDesk`](#createorderdesk), [`createWebhookReceiver`](#createwebhookreceiver), [`evidenceHash`](#evidencehash), [`orderDeskScenarios`](#orderdeskscenarios), [`orderDeskTools`](#orderdesktools), [`parseWebhookOutcome`](#parsewebhookoutcome), [`runVerifier`](#runverifier), [`signWebhook`](#signwebhook), [`validateOutput`](#validateoutput), [`verdictFromCommand`](#verdictfromcommand), [`verifyWebhookSignature`](#verifywebhooksignature)
- **Constants:** [`ORDER_DESK`](#order_desk), [`WEBHOOK_DEFAULT_TOLERANCE_S`](#webhook_default_tolerance_s), [`WEBHOOK_SECRET_ENV`](#webhook_secret_env), [`WEBHOOK_SIGNATURE_HEADER`](#webhook_signature_header), [`WEBHOOK_TIMESTAMP_HEADER`](#webhook_timestamp_header)
- **Interfaces:** [`BusinessRule`](#businessrule), [`CheckResult`](#checkresult), [`CommandResult`](#commandresult), [`JsonSchemaLite`](#jsonschemalite), [`OrderDeskEnvironment`](#orderdeskenvironment), [`OrderDeskFunctionTool`](#orderdeskfunctiontool), [`OrderDeskOrder`](#orderdeskorder), [`OrderDeskOrderCheck`](#orderdeskordercheck), [`OrderDeskOrderState`](#orderdeskorderstate), [`OrderDeskScenario`](#orderdeskscenario), [`OrderDeskToolSpec`](#orderdesktoolspec), [`OrderDeskVerdict`](#orderdeskverdict), [`OutcomeReportParams`](#outcomereportparams), [`RuleVerdict`](#ruleverdict), [`RunVerifierOptions`](#runverifieroptions), [`SafeParseSchema`](#safeparseschema), [`VerifierVerdict`](#verifierverdict), [`VerifyWebhookParams`](#verifywebhookparams), [`WebhookDedupeStore`](#webhookdedupestore), [`WebhookOutcome`](#webhookoutcome), [`WebhookReceiver`](#webhookreceiver), [`WebhookReceiverOptions`](#webhookreceiveroptions), [`WebhookReporter`](#webhookreporter), [`WebhookRequest`](#webhookrequest)
- **Types:** [`OrderDeskToolResult`](#orderdesktoolresult), [`OutcomeReportResult`](#outcomereportresult), [`OutcomeSource`](#outcomesource), [`OutcomeVerdict`](#outcomeverdict), [`WebhookHandleResult`](#webhookhandleresult), [`WebhookRejectReason`](#webhookrejectreason), [`WebhookSignatureCheck`](#webhooksignaturecheck)

## Classes

### MemoryWebhookDedupeStore

class · `src/learning-kit/webhook.ts`

The default in-process [`WebhookDedupeStore`](#webhookdedupestore): claims expire after their TTL, and the oldest
claims are forgotten beyond `maxEntries` (default 10,000). One process only.

```ts signature
class MemoryWebhookDedupeStore
```

| Member | Description |
| --- | --- |
| `constructor(options: { maxEntries?: number; now?: () => number } = {})` | Create a store (`maxEntries` default 10,000; `now` default `Date.now`). |
| `claim(eventId: string, ttlMs: number): boolean` | Claim an id unless an unexpired claim exists. |
| `release(eventId: string): void` | Forget a claim. |
| `get size(): number { return this.claims.size; }` | The number of claims held (expired ones included until they are reclaimed or evicted). |

### OrderDesk

class · `src/learning-kit/order-desk.ts`

One episode of the order desk: a fresh copy of a scenario's state, the four tools, and the
verifier. Deterministic: the same calls always give the same results and the same verdict.

```ts signature
class OrderDesk
```

| Member | Description |
| --- | --- |
| `readonly scenario: OrderDeskScenario` | The scenario this episode runs. |
| `readonly notice: string` | The demonstration notice. |
| `constructor(scenario: string \| number)` | Start an episode of `scenario` (a scenario id such as `s1`, or an index into the scenarios). |
| `get task(): string { return this.scenario.task; }` | The task text to give the agent. |
| `namedOrders(): string[]` | The order ids the task names, in the order it names them. |
| `state(): { stock: Record<string, number>; orders: Record<string, OrderDeskOrderState> }` | The current state: stock per SKU and each order with its reserved units. |
| `calls(): { tool: string; ok: boolean }[]` | The tool calls made so far: name and whether it succeeded. |
| `call(tool: string, rawArgs: unknown): OrderDeskToolResult` | Run one tool. Unknown tools and invalid arguments answer an error and change nothing. - `lookup_order` → `{ ok, order_id, sku, quantity, status }` (`UNKNOWN_ORDER`). - `check_stock` → `{ ok, sku, in_stock }` (`UNKNOWN_SKU`). - `reserve_stock` → `{ ok: true }` when `quantity` ≤ stock: the stock drops by `quantity` and the order's reserved units become `quantity`; else `{ ok: false, error: 'INSUFFICIENT_STOCK', in_stock }` with nothing changed (`UNKNOWN_ORDER`, `SKU_MISMATCH` when the SKU is not the order's). - `set_order_status` → `{ ok: true }` for `reserved` or `backordered` (`UNKNOWN_ORDER`). |
| `callJson(tool: string, argumentsJson: string): string` | `call` with JSON arguments and a JSON answer (what a chat tool loop passes around). |
| `verify(): OrderDeskVerdict` | The state-based verifier. Orders are handled in the order the task names them: an order is expected `reserved` with its full quantity when the stock left after the earlier orders covers it, otherwise `backordered` with nothing reserved. The task passes when every named order does. |

## Functions

### checkJsonSchemaLite

function · `src/learning-kit/business-rules.ts`

Validate `value` against a [`JsonSchemaLite`](#jsonschemalite); returns `path: problem` strings.

```ts signature
function checkJsonSchemaLite(value: unknown, schema: JsonSchemaLite, path = '$'): string[]
```

### createOrderDesk

function · `src/learning-kit/order-desk.ts`

Start an order-desk episode (a scenario id such as `s1`, or an index into the scenarios).

```ts signature
function createOrderDesk(scenario: string | number): OrderDesk
```

### createWebhookReceiver

function · `src/learning-kit/webhook.ts`

Create a webhook receiver. The order of checks is fixed: both headers, the timestamp window, the
signature (constant-time), then the payload, then the event-id claim, then the report. A body is
never parsed before its signature is verified.

```ts signature
function createWebhookReceiver(options: WebhookReceiverOptions): WebhookReceiver
```

### evidenceHash

function · `src/learning-kit/verifier.ts`

`sha256:` + the hex SHA-256 of the canonical JSON of `value` (keys sorted recursively).

```ts signature
function evidenceHash(value: unknown): string
```

### orderDeskScenarios

function · `src/learning-kit/order-desk.ts`

The scenarios, in fixture order.

```ts signature
function orderDeskScenarios(): OrderDeskScenario[]
```

### orderDeskTools

function · `src/learning-kit/order-desk.ts`

The tools as OpenAI-style function definitions, ready for `tools: …`.

```ts signature
function orderDeskTools(): OrderDeskFunctionTool[]
```

### parseWebhookOutcome

function · `src/learning-kit/webhook.ts`

The default payload mapping: `{ event_id, request_id, verdict, observed_at?, evidence_hash? }`.

```ts signature
function parseWebhookOutcome(payload: unknown): WebhookOutcome
```

### runVerifier

function · `src/learning-kit/verifier.ts`

Run a check and turn its answer into a [`VerifierVerdict`](#verifierverdict). The check returns `true` /
`false`, or a [`CheckResult`](#checkresult) with the evidence to hash. A thrown error yields `unknown`
(or `fail` with `onError: 'fail'`).

```ts signature
async function runVerifier(check: () => boolean | CheckResult | Promise<boolean | CheckResult>, options: RunVerifierOptions = {}): Promise<VerifierVerdict>
```

### signWebhook

function · `src/learning-kit/webhook.ts`

Sign a webhook body the way [`createWebhookReceiver`](#createwebhookreceiver) verifies it. Returns the headers to
send. For senders and tests.

```ts signature
async function signWebhook(secret: string, rawBody: string, timestampSeconds: number = Math.floor(Date.now() / 1000)): Promise<Record<string, string>>
```

### validateOutput

function · `src/learning-kit/business-rules.ts`

Validate a structured output and apply business rules. `output` is the model's text (parsed as
JSON) or an already-parsed value. Schema problems are checked first; rules run only on a valid
value. A rule that throws counts as failed, with the error name as its reason.

```ts signature
function validateOutput<T = unknown>(output: unknown, schema: SafeParseSchema<T> | JsonSchemaLite, rules: readonly BusinessRule<T>[] = []): RuleVerdict<T>
```

### verdictFromCommand

function · `src/learning-kit/verifier.ts`

A command's verdict: exit code `0` passes, any other exit code fails, and a process killed by a
signal (no exit code) is `unknown`. The evidence hash covers the exit code and both outputs.

```ts signature
function verdictFromCommand(result: CommandResult): VerifierVerdict
```

### verifyWebhookSignature

function · `src/learning-kit/webhook.ts`

Verify a webhook signature: both headers present and well formed, the timestamp within the
tolerance of now, and the HMAC equal in constant time.

```ts signature
async function verifyWebhookSignature(params: VerifyWebhookParams): Promise<WebhookSignatureCheck>
```

## Constants

### ORDER_DESK

const · `src/learning-kit/order-desk-data.ts`

The order-desk environment: its tools, rules and scenarios.

```ts signature
const ORDER_DESK: OrderDeskEnvironment
```

### WEBHOOK_DEFAULT_TOLERANCE_S

const · `src/learning-kit/webhook.ts`

The default timestamp tolerance, in seconds (either direction).

```ts signature
const WEBHOOK_DEFAULT_TOLERANCE_S = 300
```

### WEBHOOK_SECRET_ENV

const · `src/learning-kit/webhook.ts`

The environment variable the secret is read from when none is passed.

```ts signature
const WEBHOOK_SECRET_ENV = 'ULTRAROUTER_WEBHOOK_SECRET'
```

### WEBHOOK_SIGNATURE_HEADER

const · `src/learning-kit/webhook.ts`

The default signature header.

```ts signature
const WEBHOOK_SIGNATURE_HEADER = 'x-webhook-signature'
```

### WEBHOOK_TIMESTAMP_HEADER

const · `src/learning-kit/webhook.ts`

The default timestamp header (Unix seconds).

```ts signature
const WEBHOOK_TIMESTAMP_HEADER = 'x-webhook-timestamp'
```

## Interfaces

### BusinessRule

interface · `src/learning-kit/business-rules.ts`

One business rule over the validated value. `check` returns `true` (or nothing) when the rule
holds; `false` or a string (the reason) when it does not.

```ts signature
interface BusinessRule<T> {
    name: string;
    check: (value: T) => boolean | string | void | null | undefined;
}
```

| Member | Description |
| --- | --- |
| `name: string` | A short name, used as the reason when `check` returns `false`. |
| `check: (value: T) => boolean \| string \| void \| null \| undefined` | The rule. |

### CheckResult

interface · `src/learning-kit/verifier.ts`

What a check function may return: a boolean, or a result with evidence and reasons.

```ts signature
interface CheckResult {
    pass: boolean;
    evidence?: unknown;
    reasons?: string[] | undefined;
}
```

| Member | Description |
| --- | --- |
| `pass: boolean` | Whether the task passed. |
| `evidence?: unknown` | The evidence behind it (hashed, never sent). |
| `reasons?: string[] \| undefined` | Why, in short phrases. |

### CommandResult

interface · `src/learning-kit/verifier.ts`

The result of a command you ran (for example a test suite through `child_process`).

```ts signature
interface CommandResult {
    exitCode: number | null;
    signal?: string | null | undefined;
    stdout?: string | undefined;
    stderr?: string | undefined;
}
```

| Member | Description |
| --- | --- |
| `exitCode: number \| null` | The exit code, or `null` when the process was killed by a signal. |
| `signal?: string \| null \| undefined` | The signal that killed it, if any. |
| `stdout?: string \| undefined` | Its standard output (hashed, never sent). |
| `stderr?: string \| undefined` | Its standard error (hashed, never sent). |

### JsonSchemaLite

interface · `src/learning-kit/business-rules.ts`

The JSON-Schema subset [`validateOutput`](#validateoutput) understands: `type` (`object`, `array`, `string`,
`number`, `integer`, `boolean`, `null`, or a list of them), `properties`, `required`,
`additionalProperties: false`, `items`, `enum`, `const`, `minimum`, `maximum`, `minLength`,
`maxLength`, `pattern`, `minItems` and `maxItems`. Other keywords are ignored.

```ts signature
interface JsonSchemaLite {
    type?: string | readonly string[];
    properties?: Readonly<Record<string, JsonSchemaLite>>;
    required?: readonly string[];
    additionalProperties?: boolean;
    items?: JsonSchemaLite;
    enum?: readonly unknown[];
    const?: unknown;
    minimum?: number;
    maximum?: number;
    minLength?: number;
    maxLength?: number;
    pattern?: string;
    minItems?: number;
    maxItems?: number;
}
```

| Member | Description |
| --- | --- |
| `type?: string \| readonly string[]` | The allowed JSON type or types. |
| `properties?: Readonly<Record<string, JsonSchemaLite>>` | Object property schemas. |
| `required?: readonly string[]` | Object properties that must be present. |
| `additionalProperties?: boolean` | `false` refuses properties not listed in `properties`. |
| `items?: JsonSchemaLite` | The schema of every array item. |
| `enum?: readonly unknown[]` | The allowed values. |
| `const?: unknown` | The one allowed value. |
| `minimum?: number` | The smallest allowed number. |
| `maximum?: number` | The largest allowed number. |
| `minLength?: number` | The shortest allowed string. |
| `maxLength?: number` | The longest allowed string. |
| `pattern?: string` | A regular expression a string must match. |
| `minItems?: number` | The fewest allowed array items. |
| `maxItems?: number` | The most allowed array items. |

### OrderDeskEnvironment

interface · `src/learning-kit/order-desk.ts`

The whole environment: tools, rules and scenarios (the shared fixture's shape).

```ts signature
interface OrderDeskEnvironment {
    schema_version: number;
    name: string;
    notice: string;
    tools: OrderDeskToolSpec[];
    rules: Record<string, string>;
    scenarios: OrderDeskScenario[];
}
```

| Member | Description |
| --- | --- |
| `schema_version: number` | The fixture schema version. |
| `name: string` | Always `order-desk`. |
| `notice: string` | The demonstration notice. |
| `tools: OrderDeskToolSpec[]` | The tools. |
| `rules: Record<string, string>` | The tool and verifier rules, in words. |
| `scenarios: OrderDeskScenario[]` | The scenarios. |

### OrderDeskFunctionTool

interface · `src/learning-kit/order-desk.ts`

An OpenAI-style function tool definition (what `chat.completions.create` takes in `tools`).

```ts signature
interface OrderDeskFunctionTool {
    type: 'function';
    function: {
        name: string;
        description: string;
        parameters: Record<string, unknown>;
    };
}
```

| Member | Description |
| --- | --- |
| `type: 'function'` | Always `function`. |
| `function: { name: string; description: string; parameters: Record<string, unknown> }` | The function. |

### OrderDeskOrder

interface · `src/learning-kit/order-desk.ts`

One order in a scenario.

```ts signature
interface OrderDeskOrder {
    sku: string;
    quantity: number;
    status: string;
}
```

| Member | Description |
| --- | --- |
| `sku: string` | The SKU ordered. |
| `quantity: number` | The quantity ordered. |
| `status: string` | The initial status. |

### OrderDeskOrderCheck

interface · `src/learning-kit/order-desk.ts`

One order's check by the verifier.

```ts signature
interface OrderDeskOrderCheck {
    orderId: string;
    expected: 'reserved' | 'backordered';
    status: string;
    reserved: number;
    pass: boolean;
}
```

| Member | Description |
| --- | --- |
| `orderId: string` | The order id. |
| `expected: 'reserved' \| 'backordered'` | What the verifier expected: `reserved` (full quantity) or `backordered` (nothing reserved). |
| `status: string` | The order's final status. |
| `reserved: number` | Units reserved at the end. |
| `pass: boolean` | Whether the order passed. |

### OrderDeskOrderState

interface · `src/learning-kit/order-desk.ts`

One order's state during an episode.

```ts signature
interface OrderDeskOrderState extends OrderDeskOrder {
    reserved: number;
}
```

| Member | Description |
| --- | --- |
| `reserved: number` | Units reserved for the order (0 until `reserve_stock` succeeds). |

### OrderDeskScenario

interface · `src/learning-kit/order-desk.ts`

One scenario: the task text, the starting stock and the orders.

```ts signature
interface OrderDeskScenario {
    id: string;
    task: string;
    stock: Record<string, number>;
    orders: Record<string, OrderDeskOrder>;
}
```

| Member | Description |
| --- | --- |
| `id: string` | The scenario id (`s1` …). |
| `task: string` | The task, naming the orders to process in order. |
| `stock: Record<string, number>` | Units in stock per SKU. |
| `orders: Record<string, OrderDeskOrder>` | The orders by id. |

### OrderDeskToolSpec

interface · `src/learning-kit/order-desk.ts`

One order-desk tool as the environment declares it.

```ts signature
interface OrderDeskToolSpec {
    name: string;
    description: string;
    parameters: JsonSchemaLite & Record<string, unknown>;
}
```

| Member | Description |
| --- | --- |
| `name: string` | The tool name. |
| `description: string` | What it does. |
| `parameters: JsonSchemaLite & Record<string, unknown>` | Its JSON-Schema parameters. |

### OrderDeskVerdict

interface · `src/learning-kit/order-desk.ts`

The verifier's verdict for one episode.

```ts signature
interface OrderDeskVerdict {
    verdict: 'pass' | 'fail';
    reasons: string[];
    evidenceHash: string;
    orders: OrderDeskOrderCheck[];
}
```

| Member | Description |
| --- | --- |
| `verdict: 'pass' \| 'fail'` | `pass` when every named order passed, else `fail`. |
| `reasons: string[]` | One reason per failing order (`<order>: expected <state>, got <status>/<reserved>`). |
| `evidenceHash: string` | `sha256:<hex>` over the canonical JSON of the final state. |
| `orders: OrderDeskOrderCheck[]` | Every named order's check, in task order. |

### OutcomeReportParams

interface · `src/outcome-report.ts`

The arguments of `ur.ur.outcomes.report`.

```ts signature
interface OutcomeReportParams<S extends OutcomeSource = OutcomeSource, V extends OutcomeVerdict = OutcomeVerdict> {
    verdict: V;
    source: S;
    idempotencyKey?: string | undefined;
    observedAt?: string | Date | undefined;
    evidenceHash?: string | undefined;
    supersedes?: string | undefined;
}
```

| Member | Description |
| --- | --- |
| `verdict: V` | The task verdict. `unknown` sends nothing (missing feedback stays unknown). |
| `source: S` | Where the verdict came from. `self_rating` is a proxy that never teaches. |
| `idempotencyKey?: string \| undefined` | Your own key for this verdict (for example the verifier name or a webhook event id). It is part of the derived identity: the same `(requestId, verdict, source, idempotencyKey)` is always the same event, so retrying never double-reports. Two independent verdicts of the same source on the same request need two keys. |
| `observedAt?: string \| Date \| undefined` | When the verdict was observed (ISO-8601 or a `Date`; default: the first time it is reported). Pass it explicitly when a report may be retried from another process, so the replay is byte-identical. |
| `evidenceHash?: string \| undefined` | A content hash of the evidence behind the verdict (never the evidence itself). |
| `supersedes?: string \| undefined` | The `source_event_id` of an earlier report this one revises. |

### RuleVerdict

interface · `src/learning-kit/business-rules.ts`

A validator's verdict: `pass` or `fail`, the reasons, the evidence hash and the parsed value.

```ts signature
interface RuleVerdict<T> {
    verdict: 'pass' | 'fail';
    reasons: string[];
    evidenceHash: string;
    value: T | undefined;
}
```

| Member | Description |
| --- | --- |
| `verdict: 'pass' \| 'fail'` | `pass` when the output is valid and every rule holds, else `fail`. |
| `reasons: string[]` | Why it failed (`path: message` for schema problems, the rule name or reason for rules). |
| `evidenceHash: string` | `sha256:<hex>` over the canonical JSON of the parsed value (or the raw text when unparseable). |
| `value: T \| undefined` | The parsed (and, with a zod schema, transformed) value, or `undefined` when invalid. |

### RunVerifierOptions

interface · `src/learning-kit/verifier.ts`

Options for [`runVerifier`](#runverifier).

```ts signature
interface RunVerifierOptions {
    onError?: 'unknown' | 'fail' | undefined;
}
```

| Member | Description |
| --- | --- |
| `onError?: 'unknown' \| 'fail' \| undefined` | The verdict when the check itself throws: `unknown` (default; a crashed verifier is not evidence the task failed, so nothing is reported) or `fail` (for test suites whose failing assertions throw). |

### SafeParseSchema

interface · `src/learning-kit/business-rules.ts`

Anything with zod's `safeParse` shape. zod itself is not a dependency: pass your own zod schema
(or any library with the same method).

```ts signature
interface SafeParseSchema<T> {
    safeParse(value: unknown): {
        success: true;
        data: T;
    } | {
        success: false;
        error: {
            issues: readonly {
                path: readonly PropertyKey[];
                message: string;
            }[];
        };
    };
}
```

| Member | Description |
| --- | --- |
| `safeParse(value: unknown): \| { success: true; data: T } \| { success: false; error: { issues: readonly { path: readonly PropertyKey[]; message: string }[] }; }` | Validate `value`; on failure, `error.issues` lists what is wrong. |

### VerifierVerdict

interface · `src/learning-kit/verifier.ts`

A verdict with the hash of its evidence and the local reasons behind it.

```ts signature
interface VerifierVerdict {
    verdict: OutcomeVerdict;
    evidenceHash: string | null;
    reasons: string[];
}
```

| Member | Description |
| --- | --- |
| `verdict: OutcomeVerdict` | The verdict. |
| `evidenceHash: string \| null` | `sha256:<hex>` over the canonical JSON of the evidence, or `null` when there is none. |
| `reasons: string[]` | Why, in short machine-readable phrases (kept local; never sent). |

### VerifyWebhookParams

interface · `src/learning-kit/webhook.ts`

The inputs of [`verifyWebhookSignature`](#verifywebhooksignature).

```ts signature
interface VerifyWebhookParams {
    secret: string;
    rawBody: string;
    signature: string | null | undefined;
    timestamp: string | null | undefined;
    toleranceSeconds?: number | undefined;
    now?: (() => number) | undefined;
}
```

| Member | Description |
| --- | --- |
| `secret: string` | The shared secret. |
| `rawBody: string` | The raw request body, exactly as received (before any JSON parsing). |
| `signature: string \| null \| undefined` | The signature header value, `sha256=<hex>`. |
| `timestamp: string \| null \| undefined` | The timestamp header value (Unix seconds). |
| `toleranceSeconds?: number \| undefined` | The tolerance, in seconds, either direction (default 300). |
| `now?: (() => number) \| undefined` | The clock, in ms (default `Date.now`). |

### WebhookDedupeStore

interface · `src/learning-kit/webhook.ts`

Where seen event ids are kept. `claim` must be atomic: it returns `true` only to the first caller
for an id (until the claim expires or is released). Implement it over Redis `SET NX PX` or a
unique database row to deduplicate across processes.

```ts signature
interface WebhookDedupeStore {
    claim(eventId: string, ttlMs: number): boolean | Promise<boolean>;
    release(eventId: string): void | Promise<void>;
}
```

| Member | Description |
| --- | --- |
| `claim(eventId: string, ttlMs: number): boolean \| Promise<boolean>` | Claim an event id for `ttlMs`; `true` when this call claimed it, `false` when already claimed. |
| `release(eventId: string): void \| Promise<void>` | Release a claim whose processing did not complete, so a redelivery is processed again. |

### WebhookOutcome

interface · `src/learning-kit/webhook.ts`

One delivered outcome, as your payload describes it.

```ts signature
interface WebhookOutcome {
    eventId: string;
    requestId: string;
    verdict: OutcomeVerdict;
    observedAt?: string | undefined;
    evidenceHash?: string | undefined;
}
```

| Member | Description |
| --- | --- |
| `eventId: string` | The sender's unique event id (the dedupe key). |
| `requestId: string` | The gateway request id the outcome is about. |
| `verdict: OutcomeVerdict` | The verdict. `unknown` reports nothing. |
| `observedAt?: string \| undefined` | When it happened (ISO-8601), if the sender says. |
| `evidenceHash?: string \| undefined` | A content hash of the sender's evidence, if any. |

### WebhookReceiver

interface · `src/learning-kit/webhook.ts`

A webhook receiver: hand it each request; answer the sender with `httpStatus`.

```ts signature
interface WebhookReceiver {
    handle(request: WebhookRequest): Promise<WebhookHandleResult>;
}
```

| Member | Description |
| --- | --- |
| `handle(request: WebhookRequest): Promise<WebhookHandleResult>` | Verify, deduplicate and report one delivery. |

### WebhookReceiverOptions

interface · `src/learning-kit/webhook.ts`

Options for [`createWebhookReceiver`](#createwebhookreceiver).

```ts signature
interface WebhookReceiverOptions {
    reporter: WebhookReporter;
    secret?: string | undefined;
    toleranceSeconds?: number | undefined;
    dedupe?: WebhookDedupeStore | undefined;
    dedupeTtlMs?: number | undefined;
    signatureHeader?: string | undefined;
    timestampHeader?: string | undefined;
    parse?: ((payload: unknown) => WebhookOutcome) | undefined;
    now?: (() => number) | undefined;
}
```

| Member | Description |
| --- | --- |
| `reporter: WebhookReporter` | Where verdicts are reported (pass `ur.ur.outcomes`). |
| `secret?: string \| undefined` | The shared secret (default: the `ULTRAROUTER_WEBHOOK_SECRET` environment variable). |
| `toleranceSeconds?: number \| undefined` | The timestamp tolerance in seconds, either direction (default 300). |
| `dedupe?: WebhookDedupeStore \| undefined` | Where seen event ids are kept (default: an in-process [`MemoryWebhookDedupeStore`](#memorywebhookdedupestore)). |
| `dedupeTtlMs?: number \| undefined` | How long an event id stays claimed, in ms (default 7 days; longer than any redelivery window). |
| `signatureHeader?: string \| undefined` | The signature header name (default `x-webhook-signature`). |
| `timestampHeader?: string \| undefined` | The timestamp header name (default `x-webhook-timestamp`). |
| `parse?: ((payload: unknown) => WebhookOutcome) \| undefined` | Map your payload to a [`WebhookOutcome`](#webhookoutcome). The default reads `{ event_id, request_id, verdict, observed_at?, evidence_hash? }`. Throw to refuse it. |
| `now?: (() => number) \| undefined` | The clock, in ms (default `Date.now`). |

### WebhookReporter

interface · `src/learning-kit/webhook.ts`

Anything with the client's `report` method (pass `ur.ur.outcomes`).

```ts signature
interface WebhookReporter {
    report(requestId: string, params: OutcomeReportParams<'webhook'>): Promise<OutcomeReportResult<'webhook'>>;
}
```

| Member | Description |
| --- | --- |
| `report(requestId: string, params: OutcomeReportParams<'webhook'>): Promise<OutcomeReportResult<'webhook'>>` | Report a webhook verdict on a request. |

### WebhookRequest

interface · `src/learning-kit/webhook.ts`

One received HTTP request: its headers and the raw body, exactly as received.

```ts signature
interface WebhookRequest {
    headers: Headers | Readonly<Record<string, string | readonly string[] | undefined>>;
    rawBody: string;
}
```

| Member | Description |
| --- | --- |
| `headers: Headers \| Readonly<Record<string, string \| readonly string[] \| undefined>>` | The request headers (a `Headers` object or Node's lower-cased header record). |
| `rawBody: string` | The raw body text. Verify before parsing: never re-serialize it. |

## Types

### OrderDeskToolResult

type · `src/learning-kit/order-desk.ts`

A tool's answer: `{ ok: true, … }` or `{ ok: false, error, … }`.

```ts signature
type OrderDeskToolResult = {
    ok: boolean;
    error?: string;
} & Record<string, unknown>;
```

### OutcomeReportResult

type · `src/outcome-report.ts`

What `report` resolves to for a given source and verdict.

```ts signature
type OutcomeReportResult<S extends OutcomeSource = OutcomeSource, V extends OutcomeVerdict = OutcomeVerdict> = V extends 'unknown' ? OutcomeNotReported<S> : OutcomeReported<S>;
```

### OutcomeSource

type · `src/outcome-report.ts`

Where a verdict came from. Only `self_rating` never teaches.

```ts signature
type OutcomeSource = 'verifier' | 'business_rule' | 'webhook' | 'human_review' | 'self_rating';
```

### OutcomeVerdict

type · `src/outcome-report.ts`

A task verdict: `pass`, `fail`, or `unknown` (nothing is sent).

```ts signature
type OutcomeVerdict = 'pass' | 'fail' | 'unknown';
```

### WebhookHandleResult

type · `src/learning-kit/webhook.ts`

What the receiver did, with the HTTP status to answer the sender: `reported` and `duplicate` are
200 (stop redelivering); `rejected` is 400 / 401 (never retried successfully); `deferred` is 503
(the gateway did not acknowledge yet; the claim is released so the sender's redelivery reports
again, under the same identity, so nothing is double-reported).

```ts signature
type WebhookHandleResult = {
    readonly status: 'reported';
    readonly httpStatus: 200;
    readonly eventId: string;
    readonly requestId: string;
    readonly report: OutcomeReportResult<'webhook'>;
} | {
    readonly status: 'duplicate';
    readonly httpStatus: 200;
    readonly eventId: string;
} | {
    readonly status: 'rejected';
    readonly httpStatus: 400 | 401;
    readonly reason: WebhookRejectReason;
} | {
    readonly status: 'deferred';
    readonly httpStatus: 503;
    readonly eventId: string;
    readonly reason: string;
};
```

### WebhookRejectReason

type · `src/learning-kit/webhook.ts`

Why a delivery was refused before anything was reported.

```ts signature
type WebhookRejectReason = 'missing_signature' | 'missing_timestamp' | 'malformed_signature' | 'malformed_timestamp' | 'stale_timestamp' | 'bad_signature' | 'malformed_payload';
```

### WebhookSignatureCheck

type · `src/learning-kit/webhook.ts`

The signature check's answer.

```ts signature
type WebhookSignatureCheck = {
    readonly ok: true;
} | {
    readonly ok: false;
    readonly reason: Exclude<WebhookRejectReason, 'malformed_payload'>;
};
```
