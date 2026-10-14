# Reviewer decisions

Your people already approve, reject or edit what the model drafts: in a review queue, an admin page,
a ticket workflow. Those decisions are among the most valuable signals you have. The reviewer adapter
(`ur.ur.reviewer`) is the supported way to send them to ultrarouter: a small, signed, idempotent HTTP
contract plus a typed client with a durable local queue.

There are no third-party connectors here, and none are promised. You call the adapter from wherever
your reviewer clicks _Approve_, or post the documented HTTP request from any language.

Needs an API key with the `outcomes:write` scope.

- [What an event is](#what-an-event-is)
- [What each decision becomes](#what-each-decision-becomes)
- [The TypeScript path](#the-typescript-path)
- [Prove the integration first](#prove-the-integration-first)
- [Backfill historical decisions](#backfill-historical-decisions)
- [Dead letters and repair](#dead-letters-and-repair)
- [The raw HTTP recipe](#the-raw-http-recipe)
- [Responses and refusals](#responses-and-refusals)

## What an event is

| Field              | Required | What it is                                                                                                        |
| ------------------ | -------- | ----------------------------------------------------------------------------------------------------------------- |
| `event_id`         | yes      | **Your** review system's stable id. It is the idempotency key: re-sending it is free.                             |
| `artifact_key`     | one of   | The stable key of the reviewed artifact (for example `invoice:4711`).                                             |
| `artifact_id`      | one of   | Or its ultrarouter id. Send exactly one of the two.                                                               |
| `artifact_version` | yes      | The exact draft version the person read.                                                                          |
| `decision`         | yes      | `approved`, `approved_with_edits`, `rejected` or `regenerated`.                                                   |
| `effective_at`     | yes      | When the decision happened in your world (ISO 8601), not when you upload it.                                      |
| `reviewer_id`      | no       | An opaque reviewer id. Never a name or an email address.                                                          |
| `final`            | no       | The approved final: `{ hash, diff_stats }`, or `{ draft, text }` when your workspace granted corrections consent. |

There is deliberately no `learning_use`, `source` or `producer` field: provenance comes from the API
key you authenticate with, and how an event may be used is derived by the gateway. The TypeScript
type (`ReviewerEvent`) does not have those fields, and the HTTP route refuses them.

## What each decision becomes

`ur.ur.reviewer.setup()` returns this mapping as a machine-readable preview before you send anything:

| Your decision         | Recorded as                     |
| --------------------- | ------------------------------- |
| `approved`            | `correction:accepted_unchanged` |
| `approved_with_edits` | `correction:edited`             |
| `rejected`            | `correction:rejected`           |
| `regenerated`         | `correction:regenerated`        |

A reviewer's verdict is a **correction** about the draft. It is evidence about the draft, not proof
that the final is correct: nothing here resolves a claim or produces a quality score on its own.

## The TypeScript path

```ts
import UltraRouter, { FileOutcomeStore, type QueuedReviewerEvent } from '@ultrarouter/sdk';

const ur = new UltraRouter({
  // Queued decisions survive a restart and are replayed verbatim by flush().
  reviewerStore: new FileOutcomeStore<QueuedReviewerEvent>('.ur-reviewer-queue.json'),
});

// Call this from your "Approve" handler. Nothing touches the network until flush().
await ur.ur.reviewer.record(
  {
    event_id: 'rv-1001', // your id: the idempotency key
    artifact_key: 'invoice:4711',
    artifact_version: 3, // the exact draft the person read
    decision: 'approved_with_edits',
    effective_at: '2026-09-14T10:00:00.000Z',
    reviewer_id: 'reviewer-7',
    final: { hash: 'sha256:9f2c', diff_stats: { edit_ratio: 0.08, changed_spans: 1 } },
  },
  { reviewerSystem: 'my-review-queue' },
);

const report = await ur.ur.reviewer.flush();
console.log(
  `accepted=${report.accepted} duplicate=${report.duplicate} dead-lettered=${report.deadLettered}`,
  `dropped=${report.dropped} still-queued=${report.pending}`,
);
```

| Method                                          | What it does                                                                            |
| ----------------------------------------------- | --------------------------------------------------------------------------------------- |
| `setup()`                                       | The mapping preview, the signature recipe, your consent state and the required scope.   |
| `test(scenario?)`                               | Runs a guided scenario end to end: `happy` (default), `replay` or `version_mismatch`.   |
| `record(event, { backfill?, reviewerSystem? })` | Persists one decision locally and resolves its queue-entry id. Sends nothing.           |
| `flush()`                                       | Sends everything queued, in batches, signed. Resolves a `ReviewerFlushReport`.          |
| `send(events, opts?)`                           | Sends a signed batch immediately, bypassing the queue.                                  |
| `deadLetters()`                                 | Events refused with a repairable reason, still held locally.                            |
| `repair(entry, { repinToCurrentVersion? })`     | Re-drives one dead letter. On success it is cleared locally.                            |
| `health()`                                      | Integration health: last success, counts, backfill progress and the next repair action. |

The queue uses the same `OutcomeStore` interface as outcomes (see [the durable queue](./outcomes.md#the-durable-queue));
the default is in memory. Events leave the queue only through the gateway's per-event verdicts, and
only through a verdict that validates (`reviewerVerdictAction`): an object with the event's
`event_id` and a defined `status`, plus, for a refusal, a string `reason` and a boolean `repairable`.
`flush()` never throws for an individual refusal — `accepted` / `duplicate` remove the event, a
`rejected` / `unsupported` verdict with `repairable: true` becomes a dead letter, and one with
`repairable: false` is dropped and counted. A missing or malformed verdict (a refusal without
`repairable` or `reason`, an unknown status) keeps the event queued. A failure whose outcome is unknown (a timeout, a cancellation, a connection failure, a 408,
429 or 5xx answer, a success without a list of verdicts) leaves the whole batch queued and ends the
flush quietly. Any other 4xx answer for the whole request (a 401 or 403, a bad signature, an invalid
batch, an HTML error page from a proxy) also leaves the batch queued, and is thrown as an
`UltraRouterError`. A failed delivery never removes an event.

## Prove the integration first

```ts
import UltraRouter from '@ultrarouter/sdk';

const ur = new UltraRouter();

const setup = await ur.ur.reviewer.setup();
console.log(
  `${setup.signature.algorithm}: ${setup.signature.header} + ${setup.signature.timestamp_header}`,
);
for (const row of setup.mapping) console.log(`${row.decision} → ${row.channel}:${row.kind}`);

// The happy path: a test artifact plus an edited final, joined.
const happy = await ur.ur.reviewer.test('happy');
console.log(happy.result.status, happy.excluded_from_learning, happy.excluded_from_invoicing);

// A replay of the same event id is a visible no-op.
const replay = await ur.ur.reviewer.test('replay');
console.log('replay →', replay.result.status);

const health = await ur.ur.reviewer.health();
console.log('next action:', health.next_repair.action, '-', health.next_repair.detail);
```

Test scenarios run against a reserved artifact. Their data never enters learning or invoicing, and
the response says so field by field (`excluded_from_learning`, `excluded_from_invoicing`).

## Backfill historical decisions

Send months of history as a declared backfill so progress is attributable and a resumed run never
double-counts. You declare `{ id, total }` on each event and `complete: true` on the last one;
completion is never inferred from counts.

```ts
import UltraRouter from '@ultrarouter/sdk';

const ur = new UltraRouter();
const history = [
  {
    id: 'rv-0001',
    key: 'invoice:4711',
    version: 1,
    verdict: 'approved_with_edits',
    at: '2026-08-02T09:12:00Z',
  },
  {
    id: 'rv-0002',
    key: 'invoice:4712',
    version: 1,
    verdict: 'rejected',
    at: '2026-08-02T11:40:00Z',
  },
] as const;

for (const [i, row] of history.entries()) {
  await ur.ur.reviewer.record(
    {
      event_id: row.id,
      artifact_key: row.key,
      artifact_version: row.version,
      decision: row.verdict,
      effective_at: row.at, // the historical instant, not "now"
    },
    {
      reviewerSystem: 'my-review-queue',
      backfill: {
        id: 'reviews-2026-08',
        total: history.length,
        ...(i === history.length - 1 ? { complete: true } : {}),
      },
    },
  );
}
const report = await ur.ur.reviewer.flush();
console.log(`accepted=${report.accepted} duplicate=${report.duplicate} pending=${report.pending}`);
```

Re-running a backfill is safe: every `event_id` you already sent comes back as `duplicate`.

## Dead letters and repair

Some refusals can be fixed: the artifact does not exist yet, or the draft moved on since the person
read it. The client keeps those events locally as **dead letters** (the gateway keeps receipts, not
your payloads), so you can repair them instead of losing a person's decision.

```ts
import UltraRouter from '@ultrarouter/sdk';

const ur = new UltraRouter();
await ur.ur.reviewer.flush();

for (const entry of await ur.ur.reviewer.deadLetters()) {
  console.log(entry.event.event_id, entry.dead_letter?.reason);
  // Opt in to re-pinning to the current draft version; it is never done silently.
  const repaired = await ur.ur.reviewer.repair(entry, { repinToCurrentVersion: true });
  console.log('repaired →', repaired.result?.status ?? 'still failing');
}
```

`repinToCurrentVersion` is opt-in on purpose: "the person reviewed draft 2" and "draft 3 exists now"
are different facts.

## The raw HTTP recipe

If your review system posts webhooks rather than running Node.js, this is the whole contract.

**Sign the request.** The signature is HMAC-SHA256 over `"<unix-seconds>.<exact request body>"`,
hex-encoded, prefixed `sha256=`, keyed by **your ultrarouter API key**, sent as
`X-UR-Reviewer-Signature` together with `X-UR-Reviewer-Timestamp`:

<!-- doctest: skip — a raw HTTP call to the hosted gateway with your own key; `test/reviewer.test.ts` verifies the same signature recipe -->

```bash
UR_API_KEY=ur_sk_live_your_key
BODY='{"reviewer_system":"my-review-queue","events":[{"event_id":"rv-1001","artifact_key":"invoice:4711","artifact_version":3,"decision":"approved_with_edits","effective_at":"2026-09-14T10:00:00Z","final":{"hash":"sha256:9f2c","diff_stats":{"edit_ratio":0.08,"changed_spans":1}}}]}'
TS=$(date +%s)
SIG="sha256=$(printf '%s.%s' "$TS" "$BODY" | openssl dgst -sha256 -hmac "$UR_API_KEY" -hex | sed 's/^.* //')"

curl -sS https://gateway.example.com/v1/flywheel/reviewer/events \
  -H "Authorization: Bearer $UR_API_KEY" \
  -H 'Content-Type: application/json' \
  -H "X-UR-Reviewer-Timestamp: $TS" \
  -H "X-UR-Reviewer-Signature: $SIG" \
  --data-raw "$BODY"
```

The timestamp is part of the signed bytes, so a captured request cannot be replayed with a fresh
timestamp. The accepted clock skew is `setup.signature.tolerance_seconds`; the durable `event_id`
idempotency is the real replay defence and never expires.

The same three steps in Python:

```python
import hashlib, hmac, json, time, requests

body = json.dumps({"events": [event]}, separators=(",", ":"))
ts = str(int(time.time()))
sig = "sha256=" + hmac.new(api_key.encode(), f"{ts}.{body}".encode(), hashlib.sha256).hexdigest()
requests.post(
    f"{base_url}/v1/flywheel/reviewer/events",
    data=body,  # the exact bytes you signed, not a re-serialized dict
    headers={
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        "X-UR-Reviewer-Timestamp": ts,
        "X-UR-Reviewer-Signature": sig,
    },
)
```

Sign the bytes you send. If your HTTP library re-serializes the payload, the signature will not match
and the delivery is refused. The SDK exports the same recipe (`signReviewerPayload`,
`reviewerSignatureHeaders`) so you can check another implementation against it:

```ts
import { createHmac } from 'node:crypto';
import { signReviewerPayload } from '@ultrarouter/sdk';

const body = JSON.stringify({ events: [] });
const sdk = await signReviewerPayload('ur_sk_test_key', '1767225600', body);
const manual = `sha256=${createHmac('sha256', 'ur_sk_test_key').update(`1767225600.${body}`).digest('hex')}`;
console.log(sdk === manual); // true
```

Repair and health over plain HTTP are `POST /v1/flywheel/reviewer/repair` with
`{ "event": { … the original event … }, "repin_to_current_version": true }` and
`GET /v1/flywheel/reviewer/health` (both with the `Authorization` header only).

## Responses and refusals

The events route answers `200` with a verdict per event:

| `status`      | Meaning                                                                              |
| ------------- | ------------------------------------------------------------------------------------ |
| `accepted`    | Recorded. `reason` may carry markers such as `delayed` or `final_absent`.            |
| `duplicate`   | You sent this `event_id` before. A visible no-op, not a second row and not an error. |
| `rejected`    | Refused with a named reason. `repairable: true` means re-driving it can fix it.      |
| `unsupported` | This deployment cannot act on it (for example no store for a consented final).       |

Named refusals you may see:

| Reason                                 | What to do                                                                   |
| -------------------------------------- | ---------------------------------------------------------------------------- |
| `unmatched_artifact_key`               | The artifact does not exist yet. Create it, then re-send the same event id.  |
| `wrong_tenant_artifact_id`             | That artifact id is not in this workspace. Check which key you used.         |
| `version_mismatch:claimed=2,current=3` | The draft moved on. Repair with the version the person actually read.        |
| `final_body_without_consent`           | Enable corrections consent, or send `diff_stats` + `hash` instead of a body. |
| `ledger_conflict`                      | That `event_id` was used for a different payload. Use a new id.              |

Request-level failures are `403` responses naming `missing_signature`, `stale_signature` or
`invalid_signature`. They fail closed: nothing is written.

## What the contract will not do

- Invent an artifact for a review that points at something it never saw.
- Treat a missing final as an approved one (an `approved` decision without a final is recorded and
  marked `final_absent`).
- Store a final body without corrections consent.
- Attach a decision to a draft version other than the one the person read; it is held for repair.
- Let you set `learning_use`, `source` or `producer`.

## Related

- [Outcomes and artifacts](./outcomes.md) — the ledger these decisions land in, and `diffStats`
- [Learning status](./learning.md) — what the ledger does with them
- Runnable programs: [`examples/reviewer/reviewer-adapter.ts`](../examples/reviewer/reviewer-adapter.ts),
  [`examples/reviewer/backfill.ts`](../examples/reviewer/backfill.ts)
- API reference: [`ReviewerResource`](./api/sdk.md#reviewerresource),
  [`signReviewerPayload`](./api/sdk.md#signreviewerpayload)
