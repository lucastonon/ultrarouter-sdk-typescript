# Plug-and-play learning

The gateway can adapt an agent from its own traffic: verified outcomes become candidate
adaptations, each candidate is evaluated against the version serving now (the incumbent), and it is
promoted only when a decision rule frozen before the evaluation says so. Your application does three
things, all through the public API:

1. **Correlate** every call with a request id, and every multi-step task with an episode key.
2. **Report** a trustworthy outcome for the finished task: a verdict from a check you trust, not
   the model's own opinion. An HTTP success, or a tool call that succeeded, is not task success.
3. **Steer** learning per call type: status, enable, pause, resume, disable, rollback, and manual
   promote or reject.

The client methods live on `ur.ur.outcomes` and `ur.ur.learning`. Starter verifiers, a
business-rule validator, a signed-webhook receiver and a small demonstration environment live in a
separate entry, `@ultrarouter/sdk/learning`. The receipt and learning routes need a gateway that
serves them; an older gateway answers `not_found`.

- [Correlation: request ids and episodes](#correlation-request-ids-and-episodes)
- [Report an outcome](#report-an-outcome)
- [Retries never double-report](#retries-never-double-report)
- [Immediate outcomes and receipts](#immediate-outcomes-and-receipts)
- [Starter outcome adapters](#starter-outcome-adapters)
- [Learning controls](#learning-controls)
- [The order-desk demonstration environment](#the-order-desk-demonstration-environment)
- [With the official `openai` client](#with-the-official-openai-client)
- [Streaming](#streaming)
- [Pitfalls](#pitfalls)
- [Related](#related)

## Correlation: request ids and episodes

Every chat completion and embeddings result carries `requestId`: the id the gateway echoes on the
`x-ur-request-id` header (the same value as `res.ur.request_id`). It is not enumerable, so it never
shows up in `JSON.stringify(res)`. A stream carries it as soon as it opens, before the first chunk.

To know the id before the call returns (and still know it when the response is lost), choose it
yourself: pass `{ requestId }` (1–64 characters of `A-Z a-z 0-9 _ -`; `mintRequestId()` makes one),
or construct the client with `requestIds: 'client'` to mint one for every chat and embeddings call.

An **episode** is one task that takes several calls (a tool loop). Send the same `episodeKey` with
every step (it rides `x-ur-artifact`, the same key as the body field `ur.artifact`) and report the
outcome once, on the final request: the verdict covers the whole episode. Give every independent
task its own key, even when two tasks open with identical text. Without a key the gateway groups
steps by their opening text, so two concurrent tasks that start the same way would be merged into
one episode and share one verdict.

```ts
import UltraRouter, { mintEpisodeKey, mintRequestId } from '@ultrarouter/sdk';

const ur = new UltraRouter({ defaultModel: 'openai/gpt-5.2-mini' });
const episodeKey = mintEpisodeKey(); // one per task

const requestId = mintRequestId(); // known before the call returns
const res = await ur.chat.completions.create(
  { messages: [{ role: 'user', content: 'Please process order A-100.' }] },
  { requestId, episodeKey },
);
console.log(res.requestId === requestId, res.ur.request_id);

// Or let the client mint every id.
const minting = new UltraRouter({ defaultModel: 'openai/gpt-5.2-mini', requestIds: 'client' });
const stream = await minting.chat.completions.create({
  stream: true,
  messages: [{ role: 'user', content: 'Count to three.' }],
});
console.log('stream opened as', stream.requestId); // before the first chunk
for await (const chunk of stream) process.stdout.write(chunk.choices[0]?.delta.content ?? '');
process.stdout.write('\n');
```

## Report an outcome

`ur.ur.outcomes.report(requestId, { verdict, source, ... })` takes a plain verdict and where it came
from, and sends the matching outcome event:

| `source`        | What it is                                      | `pass` sends                        | `fail` sends                    | Teaches? |
| --------------- | ----------------------------------------------- | ----------------------------------- | ------------------------------- | -------- |
| `verifier`      | An automated check: a test suite, a state check | `computable` / `oracle_pass`        | `computable` / `oracle_fail`    | yes      |
| `business_rule` | A structured-output or business-rule validation | `computable` / `oracle_pass`        | `computable` / `oracle_fail`    | yes      |
| `webhook`       | A delayed resolution from another system        | `resolution` / `resolved_true`      | `resolution` / `resolved_false` | yes      |
| `human_review`  | A person accepted or rejected the result        | `correction` / `accepted_unchanged` | `correction` / `rejected`       | yes      |
| `self_rating`   | The agent (or a model) rating its own work      | `proxy` / `thumbs`, value `1`       | `proxy` / `thumbs`, value `-1`  | never    |

- `verdict: 'unknown'` sends nothing and resolves `{ status: 'not_reported', reason:
'verdict_unknown' }`. Missing feedback stays unknown; never turn it into a pass or a fail.
- A `self_rating` is a proxy: it can help rank, but it never teaches. The result says so in its type
  (`teaches: false`).
- Optional fields: `idempotencyKey` (your key for this verdict; see below), `observedAt` (when it
  happened; ISO-8601 or a `Date`), `evidenceHash` (a hash of the evidence, never the evidence) and
  `supersedes` (the `sourceEventId` of an earlier report this one revises).

The mapping is pinned by a fixture shared with the Python SDK (`test/fixtures/outcome-verdicts.json`
in this repository), and exported as `OUTCOME_VERDICTS`.

```ts
import UltraRouter from '@ultrarouter/sdk';

const ur = new UltraRouter({ defaultModel: 'openai/gpt-5.2-mini' });
const res = await ur.chat.completions.create({
  messages: [{ role: 'user', content: 'Extract the invoice total as JSON.' }],
});

// …your own check decides…
const report = await ur.ur.outcomes.report(res.requestId, {
  verdict: 'pass',
  source: 'business_rule',
  evidenceHash: 'sha256:9f2c…',
});
console.log(report.status, report.kind, report.teaches, report.receipt?.status);

const unsure = await ur.ur.outcomes.report(res.requestId, {
  verdict: 'unknown',
  source: 'verifier',
});
console.log(unsure.status); // "not_reported": nothing was sent
await ur.ur.outcomes.flush();
```

`report` resolves `delivered` (the gateway answered: `result` and `receipt`), `queued` (the
outcome of the send is unknown or the gateway was unavailable; the identical event stays in the
durable queue for `ur.ur.outcomes.flush()`), or `rejected` (the gateway definitively refused the
event; see `error`). It never throws for a delivery failure; it throws `invalid_request` before
sending anything for a malformed request id, verdict, source or option.

| Gateway answer                                            | `report` resolves                                            |
| --------------------------------------------------------- | ------------------------------------------------------------ |
| 202, `result.status` `accepted`, `duplicate` or `pending` | `delivered`, with `result` and its `receipt`                 |
| 404 `request_not_found: …` (an unknown gateway-minted id) | `rejected`; nothing will ever apply it                       |
| 409 `conflict` (a different payload under the same key)   | `rejected`; the first event stands                           |
| 429 `outcome_backlog_full` (`Retry-After: 30`)            | `queued` once the transport's retries are spent; flush later |
| 500 (recording failed; retry)                             | `queued`; the next flush replays the identical event         |
| timeout, connection failure, other 5xx                    | `queued`                                                     |

## Retries never double-report

Every report carries a `source_event_id` derived from the request id, the verdict, the source and
your `idempotencyKey`: `rpt_` followed by the hex SHA-256 of
`"ur-outcome-report/v1\n<requestId>\n<verdict>\n<source>\n<idempotencyKey or empty>"`
(`reportSourceEventId()` computes it). The event goes through the durable outcome queue under that
identity, so:

- when the gateway records the outcome but its answer is lost, the transport retries with the same
  Idempotency-Key and the same bytes, and the gateway answers `duplicate` with the same receipt;
- a `flush()` replays a queued event verbatim;
- calling `report` again with the same arguments (your own retry, a resumed job) replays the
  identical event, `observed_at` included, so it is a duplicate too;
- concurrent calls with the same arguments share one send.

Two independent verdicts from the same source on the same request need two `idempotencyKey`s (for
example two verifiers), otherwise the second is a duplicate of the first. When a report may be
retried from another process, pass `observedAt` explicitly (or use a durable `FileOutcomeStore`):
a different `observedAt` under the same identity is a different payload, which the gateway refuses
as a `conflict` instead of counting twice.

```ts
import UltraRouter from '@ultrarouter/sdk';

const ur = new UltraRouter({ defaultModel: 'openai/gpt-5.2-mini' });
const res = await ur.chat.completions.create({ messages: [{ role: 'user', content: 'hi' }] });

const params = { verdict: 'pass', source: 'verifier', idempotencyKey: 'unit-suite' } as const;
const first = await ur.ur.outcomes.report(res.requestId, params);
const again = await ur.ur.outcomes.report(res.requestId, params); // e.g. after a crash and resume
console.log(first.sourceEventId === again.sourceEventId, again.result?.status); // true "duplicate"

const receipts = await ur.ur.outcomes.receiptsForRequest(res.requestId);
console.log(receipts.data.length); // 1
```

## Immediate outcomes and receipts

Report as soon as you have the verdict. The gateway writes request records asynchronously, so an
outcome can arrive before the request it names. It is then accepted durably: `result.status` is
`pending` and `receipt` describes it. The gateway applies it when the request lands; nothing on
your side waits or sleeps.

A receipt (`object: "outcome_receipt"`, id `ocr_…`) carries the request id, the channel and kind
as sent, the `source_event_id`, and, once applied, the recorded `outcome_event_id`, its
`outcome_status` (`accepted` the first time, `duplicate` when it was already recorded) and the
`artifact_id`. `expires_at` is its next deadline.

| Receipt `status` | Meaning                                                                                             |
| ---------------- | --------------------------------------------------------------------------------------------------- |
| `pending`        | Accepted; waiting for the request to be recorded.                                                   |
| `applied`        | Recorded.                                                                                           |
| `rejected`       | Refused once the request was known; `reason` says why.                                              |
| `failed`         | Recording kept hitting an internal error.                                                           |
| `expired`        | No request with this id appeared in your workspace within 15 minutes (`reason: request_not_found`). |

`episode` says how an applied teaching outcome relates to the request's episode: `status` is
`associated` (the episode carries a verdict; `trace_id` names it), `pending` (waiting for the
episode to be recorded), `not_recorded` (no episode held the request in time: episode recording
off, a held-out request, no consent) or `not_applicable` (the outcome does not teach: a proxy,
behavioral or mechanical signal). `verdict` says what the outcome did: `recorded` (it is the
episode's verdict), `kept_earlier` (the first verdict wins), `revised` (a `supersedes` revision
before any learned version used the episode) or `revised_after_incorporation` (recorded and
counted; the episode is not silently unlearned).

`ur.ur.outcomes.receipt(id)` and `ur.ur.outcomes.receiptsForRequest(requestId)` read the public
receipt routes. `ur.ur.outcomes.waitForReceipt(id, { timeoutMs, signal })` polls one with bounded
exponential backoff (250 ms, doubling, at most 4 s between reads; `pollIntervalMs` and
`maxPollIntervalMs` change it) until it reaches a final state. It rejects with
`ReceiptWaitTimeoutError` (code `timeout`, with `lastReceipt`) after `timeoutMs` (default 30 s),
and with an `aborted` error when the signal fires. Transient failures between reads are skipped; a
`not_found` or `permission` ends the wait.

```ts
import UltraRouter from '@ultrarouter/sdk';

const ur = new UltraRouter({ defaultModel: 'openai/gpt-5.2-mini' });
const res = await ur.chat.completions.create(
  { messages: [{ role: 'user', content: 'Please process order E-500.' }] },
  { episodeKey: 'order-E-500' },
);

const report = await ur.ur.outcomes.report(res.requestId, { verdict: 'pass', source: 'verifier' });
console.log(report.result?.status); // "pending" when the request has not landed yet

if (report.receipt !== null) {
  const receipt = await ur.ur.outcomes.waitForReceipt(report.receipt.id, {
    timeoutMs: 10_000,
    signal: AbortSignal.timeout(15_000),
  });
  console.log(receipt.status, receipt.episode.status, receipt.episode.verdict); // applied associated recorded
}
```

## Starter outcome adapters

`@ultrarouter/sdk/learning` holds small, dependency-free starters to read, copy and adapt. They
run in your process and send nothing by themselves; hand their verdicts to `report`.

### Verifiers

`runVerifier(check)` runs a check and turns its answer into `{ verdict, evidenceHash, reasons }`.
The check returns `true` / `false`, or `{ pass, evidence?, reasons? }`; the evidence is hashed
(`sha256:` over its canonical JSON) and stays local. A check that throws is `unknown` (a crashed
verifier is not evidence that the task failed) unless you pass `{ onError: 'fail' }`.
`verdictFromCommand({ exitCode, stdout, stderr })` does the same for a command you ran, such as a
test suite: exit code 0 passes, another code fails, a process killed by a signal is `unknown`.

```ts
import UltraRouter from '@ultrarouter/sdk';
import { runVerifier, verdictFromCommand } from '@ultrarouter/sdk/learning';

const ur = new UltraRouter({ defaultModel: 'openai/gpt-5.2-mini' });
const res = await ur.chat.completions.create({
  messages: [{ role: 'user', content: 'Write a function that adds two numbers.' }],
});

// A computable check over the result (here: a stand-in for running the generated code).
const add = (a: number, b: number): number => a + b;
const verdict = await runVerifier(() => ({
  pass: add(2, 3) === 5 && add(-1, 1) === 0,
  evidence: { cases: 2 },
}));

// Or the result of a test command you ran with child_process.
console.log(verdictFromCommand({ exitCode: 0, stdout: '12 passed' }).verdict); // "pass"

if (verdict.verdict !== 'unknown') {
  await ur.ur.outcomes.report(res.requestId, {
    verdict: verdict.verdict,
    source: 'verifier',
    ...(verdict.evidenceHash !== null ? { evidenceHash: verdict.evidenceHash } : {}),
  });
}
await ur.ur.outcomes.flush();
console.log(verdict.verdict, verdict.evidenceHash);
```

### Business rules

`validateOutput(output, schema, rules?)` checks a structured output (the model's JSON text, or a
parsed value) against a zod schema (anything with `safeParse`) or a small JSON-Schema subset
(`type`, `properties`, `required`, `additionalProperties: false`, `items`, `enum`, `const`,
`minimum`, `maximum`, `minLength`, `maxLength`, `pattern`, `minItems`, `maxItems`), then runs your
rules. A rule returns `true` (or nothing) when it holds, and `false` or a reason string when it
does not. The verdict is `pass` or `fail` with path-qualified reasons; it is never `unknown`.

```ts
import { validateOutput } from '@ultrarouter/sdk/learning';

const schema = {
  type: 'object',
  properties: {
    order_id: { type: 'string', pattern: '^[A-Z]-\\d{3}$' },
    action: { type: 'string', enum: ['reserve', 'backorder'] },
    quantity: { type: 'integer', minimum: 1 },
  },
  required: ['order_id', 'action'],
  additionalProperties: false,
} as const;

const rules = [
  {
    name: 'reserve_needs_quantity',
    check: (o: { action: string; quantity?: number }) =>
      o.action !== 'reserve' || o.quantity !== undefined || 'a reservation needs a quantity',
  },
];

console.log(validateOutput('{"order_id":"A-100","action":"reserve","quantity":2}', schema, rules));
console.log(validateOutput('{"order_id":"a100","action":"reserve"}', schema, rules).reasons);
// [ '$.order_id: must match ^[A-Z]-\d{3}$' ]
```

### Signed webhooks

A delayed outcome often comes from another system (an order shipped, a ticket stayed closed).
`createWebhookReceiver({ reporter: ur.ur.outcomes })` verifies each delivery and reports it with
`source: 'webhook'`:

1. both headers present: `x-webhook-signature: sha256=<hex>` and `x-webhook-timestamp` (Unix
   seconds), the signature being HMAC-SHA256, keyed with the shared secret, of
   `"<timestamp>.<raw body>"` (`signWebhook` computes it for a sender);
2. the timestamp within `toleranceSeconds` of now (default 300, either direction);
3. the signature compared in constant time;
4. only then the payload parsed (default `{ event_id, request_id, verdict, observed_at?,
evidence_hash? }`; pass `parse` for your own shape);
5. the event id claimed in a dedupe store (in-process `MemoryWebhookDedupeStore` by default;
   implement `WebhookDedupeStore` over Redis or a unique row to share it across processes);
6. the verdict reported with the event id as the `idempotencyKey`.

`handle` resolves the HTTP status to answer the sender with: `reported` and `duplicate` are 200,
`rejected` is 401 (signature, timestamp) or 400 (payload), and `deferred` is 503 when the gateway did
not acknowledge yet. A deferred event's claim is released, so the sender's redelivery is reported
again under the same identity, which can never count twice. The secret comes from
`ULTRAROUTER_WEBHOOK_SECRET` unless you pass `secret`; it never appears in a result or an error.

```ts
import UltraRouter from '@ultrarouter/sdk';
import { createWebhookReceiver, signWebhook } from '@ultrarouter/sdk/learning';

const ur = new UltraRouter({ defaultModel: 'openai/gpt-5.2-mini' });
const res = await ur.chat.completions.create({
  messages: [{ role: 'user', content: 'Draft the shipping notice for order 4711.' }],
});

// Your webhook endpoint hands each request's headers and RAW body to the receiver.
const receiver = createWebhookReceiver({ reporter: ur.ur.outcomes });

// What the other system sends (simulated here with the same shared secret).
const secret = process.env.ULTRAROUTER_WEBHOOK_SECRET ?? '';
const rawBody = JSON.stringify({
  event_id: 'evt_4711',
  request_id: res.requestId,
  verdict: 'pass',
});
const headers = await signWebhook(secret, rawBody);

console.log((await receiver.handle({ headers, rawBody })).status); // "reported"
console.log((await receiver.handle({ headers, rawBody })).status); // "duplicate"
const forged = await receiver.handle({ headers: await signWebhook('wrong', rawBody), rawBody });
console.log(forged.status, forged.httpStatus); // "rejected" 401
```

With Node's `http` module, collect the body as a string before calling `handle`
(`receiver.handle({ headers: req.headers, rawBody })`) and answer with `result.httpStatus`.

## Learning controls

`ur.ur.learning` steers learning for one call type (a `ct_…` id or a slug). Reads need a key with
`config:read`; changes need `config:write` (or an owner/admin session).

| Method                                                             | Does                                                                                                  |
| ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| `status(callTypeId)`                                               | The `learning` status (below).                                                                        |
| `enable(callTypeId, params)`                                       | Self-serve enable (below).                                                                            |
| `pause(callTypeId)` / `resume(callTypeId)`                         | Stop reflecting and evaluating while the active version keeps serving; start again.                   |
| `disable(callTypeId)`                                              | The kill switch: no learned version is served.                                                        |
| `versions(callTypeId)` / `version(callTypeId, versionId)`          | The history (`epb_…` versions with their state); one version's lessons, transitions and reflection.   |
| `rollback(callTypeId, { version_id? })`                            | Point the active version at an earlier version; without `version_id`, the one active before this one. |
| `promote(callTypeId, versionId)` / `reject(callTypeId, versionId)` | Manual decisions; a running evaluation of that version stops.                                         |
| `evaluations(callTypeId)`                                          | Evaluations (`lev_…`) with their frozen rule, arms, difference and decision.                          |

Every control resolves a `learning_control` result: the `action`, whether it `changed` anything
(controls are idempotent), the `version_id` it acted on, a `stopped_evaluation_id`, and the
resulting status as `learning`.

**Enable.** `enable(callTypeId, { reflection_model, lessons_mode?, lessons_k?, promotion?, recipe? })`
needs the workspace's corrections consent and a `reflection_model` that resolves to a
workspace-owned offer: one of your custom providers, or a provider your workspace stored its own
key for. There is no platform or paid fallback. `promotion` is an object of policy changes merged
over the current policy: `mode` (`evaluate`, `manual` or `immediate`), `objective` (`success` or
`cost_noninferior`), `min_verified_per_arm`, `max_verified_per_arm`, `alpha`, `min_effect_pp`,
`noninferiority_margin_pp`, `candidate_share` and `max_duration_hours`. `recipe` chooses the
learner's `validator`, `generation` and `observations`.

**Status.** `state` is `off`, `collecting` (enabled, waiting for evidence), `learning` (a
reflection is due or an evaluation runs), `paused`, `disabled`, `unavailable` (consent, provider or
repeated failures), `quota_exhausted` or `budget_exhausted` (refused for resources and retried with
backoff), with a `reason` code. The status also carries the `recipe`, the `reflection` model and
whether its provider is available, the `promotion` policy, the `active_version` and
`latest_candidate`, the running `evaluation` and the `last_evaluation`, `evidence` (recorded,
verified, consumed, `incorporated_active`, `backlog` — arrived is not incorporated), `budget`,
`usage` (tokens and failed calls, separately from cash) and `outcome_receipts` by state.

A candidate becomes active according to the promotion mode: under `evaluate`, a randomized
evaluation against the incumbent decided by a rule frozen before it starts (a negative or
inconclusive result keeps the incumbent); under `manual`, your promote or reject; under
`immediate`, publication is activation.

A refusal you can act on rejects with a `LearningError` (an `UltraRouterError`). The gateway names
the refusal as the first token of its message; the error carries it as `refusal`, its parenthesized
sub-reason as `detail`, the actionable `reason`, and the `action` to take:

| `reason`               | `refusal` (status)                                                                                    | Typical cause                                                                                                                                        |
| ---------------------- | ----------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `missing_consent`      | `corrections_consent_required` (409)                                                                  | The workspace's corrections consent is off.                                                                                                          |
| `provider_unavailable` | `reflection_model_not_workspace_owned` (400)                                                          | `detail`: `no_offer`, `platform_offer_only`, `no_workspace_key`, `model_denied_by_policy`, `workspace_funding_not_byok`, `workspace_funding_frozen`. |
| `not_enabled`          | `learning_not_enabled` (409)                                                                          | A control before `enable`.                                                                                                                           |
| `invalid_promotion`    | `promotion_invalid` (400)                                                                             | `detail` names the out-of-range policy field.                                                                                                        |
| `version_conflict`     | `no_rollback_target`, `rollback_target_not_earlier`, `version_already_active`, `version_active` (409) | The version is not in a state the control can act on.                                                                                                |
| `not_found`            | `not_found` (404)                                                                                     | Unknown call type or version.                                                                                                                        |
| `forbidden`            | `permission` (403)                                                                                    | The key lacks the scope, or the role is not allowed.                                                                                                 |

`quota_exhausted` and `budget_exhausted` are reasons too (a `spend_cap_exceeded` refusal maps to
`budget_exhausted`), but learning normally reports them as states, not refusals.
`LEARNING_ERROR_CODES` lists the refusals and codes each reason is recognised from; any other
refusal stays a plain `UltraRouterError`.

```ts
import UltraRouter, { LearningError } from '@ultrarouter/sdk';

const ur = new UltraRouter();
const callType = 'support-reply';
try {
  const enabled = await ur.ur.learning.enable(callType, {
    reflection_model: 'openai/gpt-5.2',
    promotion: { mode: 'evaluate', objective: 'success', min_verified_per_arm: 30 },
  });
  const status = enabled.learning;
  console.log(status.state, status.active_version?.id, status.latest_candidate?.state);
  console.log(
    status.evidence.verified,
    status.evidence.incorporated_active,
    status.outcome_receipts,
  );

  console.log((await ur.ur.learning.pause(callType)).learning.state); // "paused"
  console.log((await ur.ur.learning.resume(callType)).changed); // true

  const history = await ur.ur.learning.versions(callType);
  if (history.data.some((v) => v.state === 'retired')) {
    const rolled = await ur.ur.learning.rollback(callType); // to the previously active version
    console.log('serving', rolled.version_id);
  }
  const [latest] = (await ur.ur.learning.evaluations(callType)).data;
  console.log(latest?.decision, latest?.arms.candidate, latest?.difference);
} catch (err) {
  if (err instanceof LearningError) console.error(err.reason, err.refusal, err.detail, err.action);
  else throw err;
}
```

## The order-desk demonstration environment

`createOrderDesk(scenario)` starts an episode of a tiny, deterministic tool environment: stock per
SKU, a few orders, and four tools (`lookup_order`, `check_stock`, `reserve_stock`,
`set_order_status`; `orderDeskTools()` returns them as OpenAI function definitions). The verifier
reads only the final state: orders are handled in the order the task names them, and each must end
`reserved` with its full quantity when the stock left after the earlier orders covers it, otherwise
`backordered` with nothing reserved. Its six scenarios come from a fixture shared with the Python
SDK (`test/fixtures/toy-env.json`).

It shows the integration working end to end. It is a demonstration, not evidence that learning
improves an agent.

```ts
import UltraRouter, { type ChatMessage } from '@ultrarouter/sdk';
import { createOrderDesk, orderDeskTools } from '@ultrarouter/sdk/learning';

const ur = new UltraRouter({ defaultModel: 'openai/gpt-5.2-mini' });
const desk = createOrderDesk('s3');
const messages: ChatMessage[] = [{ role: 'user', content: desk.task }];
let finalRequestId = '';

for (let step = 0; step < 16; step += 1) {
  const res = await ur.chat.completions.create(
    { messages, tools: orderDeskTools() },
    { episodeKey: 'order-desk-s3' },
  );
  finalRequestId = res.requestId;
  const message = res.choices[0]?.message;
  const calls = (message?.tool_calls ?? []) as {
    id: string;
    function: { name: string; arguments: string };
  }[];
  messages.push({ role: 'assistant', content: message?.content ?? null, tool_calls: calls });
  if (calls.length === 0) break;
  for (const call of calls) {
    const result = desk.callJson(call.function.name, call.function.arguments);
    messages.push({ role: 'tool', tool_call_id: call.id, content: result });
  }
}

const verdict = desk.verify();
console.log(
  verdict.verdict,
  verdict.orders.map((o) => `${o.orderId}:${o.expected}`),
);
await ur.ur.outcomes.report(finalRequestId, {
  verdict: verdict.verdict,
  source: 'verifier',
  evidenceHash: verdict.evidenceHash,
});
await ur.ur.outcomes.flush();
```

## With the official `openai` client

Keep the official client and your loop; change the base URL and the key. Send the correlation
headers per call with `correlationHeaders({ requestId, episodeKey })`, and read the id back with
`readRequestId()` from the raw response of `.withResponse()` (or from the result body, which carries
the `ur` block).

```ts
import OpenAI from 'openai';
import UltraRouter, { correlationHeaders, mintRequestId, readRequestId } from '@ultrarouter/sdk';

const ur = new UltraRouter();
const openai = ur.asOpenAI(OpenAI); // or new OpenAI({ baseURL: `${gateway}/v1`, apiKey })

const requestId = mintRequestId();
const { data, response } = await openai.chat.completions
  .create(
    { model: 'openai/gpt-5.2-mini', messages: [{ role: 'user', content: 'Process order A-100.' }] },
    { headers: correlationHeaders({ requestId, episodeKey: 'order-A-100' }) },
  )
  .withResponse();
console.log(readRequestId(response) === requestId, readRequestId(data) === requestId);

await ur.ur.outcomes.report(requestId, { verdict: 'pass', source: 'human_review' });
await ur.ur.outcomes.flush();
```

## Streaming

A stream's `requestId` is set when it opens, so you can report on it as soon as the stream ends.
Streaming tool loops assemble tool-call deltas by `index` (arguments may arrive in fragments); see
[`examples/learning/08-streaming.ts`](../examples/learning/08-streaming.ts) for a complete loop.

```ts
import UltraRouter from '@ultrarouter/sdk';

const ur = new UltraRouter({ defaultModel: 'openai/gpt-5.2-mini', requestIds: 'client' });
const stream = await ur.chat.completions.create({
  stream: true,
  messages: [{ role: 'user', content: 'Summarize order A-100 in one line.' }],
});
const requestId = stream.requestId; // known before the first chunk
let text = '';
for await (const chunk of stream) text += chunk.choices[0]?.delta.content ?? '';

if (requestId !== null) {
  const verdict = text.includes('A-100') ? 'pass' : 'fail';
  const report = await ur.ur.outcomes.report(requestId, { verdict, source: 'business_rule' });
  console.log(report.status);
}
```

## Pitfalls

- **Report the task, not the call.** A 200 response or a tool that returned `ok` is not task
  success. Report the verdict of a check you trust, once per episode, on its final request.
- **Unknown stays unknown.** Do not turn missing feedback into a fail; report `unknown` or nothing.
- **Self-ratings never teach.** A `self_rating` outcome can rank, but learning ignores it.
- **One key per task.** Reusing an episode key across tasks merges them; omitting it on concurrent
  identical tasks merges them too.
- **Flush before you exit.** A `queued` report is in the durable queue; call
  `await ur.ur.outcomes.flush()` (or use a `FileOutcomeStore`) so it is delivered.
- **Revisions are explicit.** To change a verdict, report the new one with `supersedes` set to the
  earlier `sourceEventId`; a revision after the outcome was learned from is recorded, not unlearned.
- **Keep secrets out.** Outcomes carry ids, hashes and numbers only; evidence is hashed locally.

## Related

- [Outcomes and artifacts](./outcomes.md): the outcome ledger and the durable queue.
- [Learning status, verdict sources and oracles](./learning.md).
- [Retries, timeouts and idempotency](./retries-timeouts-idempotency.md).
- [OpenAI compatibility](./openai-compatibility.md).
- [`examples/learning/`](../examples/learning/): eight runnable programs.
