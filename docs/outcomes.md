# Outcomes and artifacts

Model calls are only half of the story; what matters is what happened to the thing your application
produced. Was the draft accepted, edited or rejected? Did the forecast come true? Did the extracted
JSON pass validation? The outcome ledger records those facts so routing, evals and learning can use
them.

Three concepts:

| Concept           | What it is                                                                                                                     | SDK                   |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------ | --------------------- |
| **Artifact type** | A named kind of artifact plus its _objective_: what "it worked" means for it. Declared once, versioned.                        | `ur.ur.artifactTypes` |
| **Artifact**      | One unit of value your application produced (a reply, a forecast, an extraction), keyed by your own `key`.                     | `ur.ur.artifacts`     |
| **Outcome event** | A typed fact about an artifact (or one of its claims, or a request): channel + kind + an optional numeric value. Never a body. | `ur.ur.outcomes`      |

Everything on this page needs an API key with the `outcomes:write` scope.

- [Quick start: `withArtifact`](#quick-start-withartifact)
- [Declare an artifact type](#declare-an-artifact-type)
- [Create and read artifacts](#create-and-read-artifacts)
- [Record outcomes](#record-outcomes)
- [The durable queue](#the-durable-queue)
- [Record the approved final](#record-the-approved-final)
- [Batch and pending claims](#batch-and-pending-claims)

## Quick start: `withArtifact`

`withArtifact(key, fn)` binds every chat and embeddings call inside `fn` to one artifact (it sets
`ur.artifact = key` on each request), gives you `record` and `final` for that artifact, and flushes
the outcome queue when `fn` finishes, whether it returns or throws.

```ts
import UltraRouter from '@ultrarouter/sdk';

const ur = new UltraRouter({ defaultModel: 'openai/gpt-5.2-mini' });

const draft = await ur.withArtifact('ticket-4821-reply', async (scope) => {
  const res = await scope.chat.completions.create({
    messages: [
      { role: 'user', content: 'Draft a reply to ticket 4821: the parcel arrived damaged.' },
    ],
  });
  const text = 'choices' in res ? (res.choices[0]?.message.content ?? '') : '';

  // A mechanical fact you can check in code right away.
  await scope.record({ channel: 'mechanical', kind: 'schema_valid' });
  return text;
});
console.log(draft);
```

The artifact is created lazily, on the first `record` or `final`, so a scope that only chats makes
no extra request.

## Declare an artifact type

Declare the objective before you record outcomes, so every artifact of that type is judged against
the same definition. Versions are append-only: an unchanged upsert is a no-op that returns the
existing version, so it is safe to call at startup.

```ts
import UltraRouter from '@ultrarouter/sdk';

const ur = new UltraRouter();

const type = await ur.ur.artifactTypes.upsert({
  name: 'support-reply',
  archetype: 'draft',
  objective: {
    metric: 'acceptance_rate',
    direction: 'higher_is_better',
    unit: 'ratio',
    source: 'support agent review',
    window: 'P7D',
    resolution_criteria: 'The agent sends the draft with no more than light edits.',
  },
});
console.log(type.name, 'objective version', type.version);
```

| Objective field       | Meaning                                                                                                        |
| --------------------- | -------------------------------------------------------------------------------------------------------------- |
| `metric`              | `claim_resolution`, `oracle_delta`, `correction_rate`, `acceptance_rate`, `engagement_rate` or `task_success`. |
| `direction`           | Which direction is good, e.g. `higher_is_better` or `true_is_good`.                                            |
| `unit`                | The unit of the metric, e.g. `ratio`, `boolean`, `usd`.                                                        |
| `source`              | Where the resolving signal comes from (a reviewer, a system, an oracle name).                                  |
| `window`              | How long resolution may take, as an ISO-8601 duration (`P7D`, `P12M`).                                         |
| `resolution_criteria` | How it resolves, in words. Keep it free of personal data.                                                      |
| `predicate_id`        | Optional machine predicate: `equals`, `within_tolerance`, `ge`, `le`, `resolved_by_source`.                    |
| `alternatives`        | Optional named alternatives for computable comparisons.                                                        |

`archetype` is one of `forecast`, `recommendation`, `draft`, `extraction`, `answer` or `action`.

## Create and read artifacts

```ts
import UltraRouter from '@ultrarouter/sdk';

const ur = new UltraRouter();

// Upsert by your own key. Optional: an artifact type, declared claims, the requests it came from.
const artifact = await ur.ur.artifacts.create({
  key: 'forecast-2026-q3-revenue',
  archetype: 'forecast',
  claims: [
    {
      key: 'q3-revenue',
      claim_type: 'numeric_forecast',
      statement: 'Q3 revenue lands between 1.1M and 1.3M',
      resolves_by: '2026-10-15T00:00:00.000Z',
      stated_confidence: 0.7,
    },
  ],
});
console.log(artifact.id, artifact.lifecycle, artifact.claims.length);

const again = await ur.ur.artifacts.get(artifact.id);
console.log(again.key, again.current_version);

// Keyset pagination: pass `next_cursor` back as `cursor`; it is null on the last page.
const first = await ur.ur.artifacts.list({ archetype: 'forecast', limit: 50 });
for (const a of first.data) console.log(a.key);
if (first.next_cursor !== null) {
  const second = await ur.ur.artifacts.list({
    archetype: 'forecast',
    limit: 50,
    cursor: first.next_cursor,
  });
  console.log('next page:', second.data.length);
}
```

`create` fields: `key` (required, unique per workspace), `archetype` (default `answer`),
`artifact_type` (pins that type's current objective version), `claims[]`, `request_ids[]` (the
requests it was assembled from), `occurred_at`, `situation_facets` (labels and values only), and the
grant fields `grant_id` + `attestation` used by [`useLearned`](./preflight.md). A request already
grouped into another artifact is a `conflict` error. Artifacts never carry bodies; reads return
metadata only.

You can also bind a request to an artifact as it is served, without `withArtifact`, by sending
`ur: { artifact: '<key>' }` on the chat or embeddings call. The response echoes the bound id in
`res.ur.artifact_id`.

## Record outcomes

An outcome event has a `channel` (closed vocabulary) and a `kind` (a closed vocabulary per channel):

| Channel      | Use it for                                   | Example kinds                                             |
| ------------ | -------------------------------------------- | --------------------------------------------------------- |
| `mechanical` | Facts your code checks immediately           | `schema_valid`, `tool_success`, `tool_error`              |
| `correction` | A human's judgement of a draft               | `accepted_unchanged`, `edited`, `rejected`, `regenerated` |
| `behavioral` | What a user did                              | `accepted`                                                |
| `resolution` | Whether a claim came true                    | `resolved_true`, `resolved_false`                         |
| `computable` | A score your own evaluator computed          | `scored`                                                  |
| `proxy`      | Indirect signals that rank but are not proof |                                                           |

The gateway refuses a kind it does not know with a named reason. Optional fields: `value` (numbers
and diff statistics only), `confidence`, `claim_id` / `claim_key` (target a claim instead of the
artifact), `artifact_version`, `observed_at` (when it happened in your world; defaults to now),
`source_event_id` (your idempotency id), `supersedes_event_id`, `evidence_hash`,
`tool_error_class` (for `mechanical:tool_error`) and `alternative_id`.

```ts
import UltraRouter from '@ultrarouter/sdk';

const ur = new UltraRouter({ defaultModel: 'openai/gpt-5.2-mini' });
const artifact = await ur.ur.artifacts.create({
  key: 'forecast-2026-q3-revenue',
  archetype: 'forecast',
});

// On an artifact (a bare string is an artifact id) …
const receipt = await ur.ur.outcomes.record(artifact.id, {
  channel: 'resolution',
  kind: 'resolved_true',
  claim_key: 'q3-revenue',
  observed_at: '2026-10-14T12:00:00.000Z',
});
console.log(receipt.status, receipt.entryId);

// … or on a request (it lands on the request's artifact, created if needed).
const res = await ur.chat.completions.create({
  messages: [{ role: 'user', content: 'Extract the total.' }],
});
await ur.ur.outcomes.record(
  { request: res.ur.request_id },
  { channel: 'mechanical', kind: 'schema_valid' },
);

// `recordOutcome` is the same method at the top level.
await ur.recordOutcome(artifact.id, {
  channel: 'computable',
  kind: 'scored',
  value: { score: 0.82 },
});
```

The fields `source`, `producer`, `learning_use` and `latency_class` are assigned by the gateway from
your credential and the event; the input type does not have them, so you cannot set them by accident.

To report a task verdict on a request without choosing a channel and kind yourself, use
`ur.ur.outcomes.report(requestId, { verdict, source })`: it maps `pass` / `fail` from a verifier, a
business rule, a webhook, a human review or a self-rating onto the right event, sends nothing for
`unknown`, and derives a stable identity so retries never double-report. An outcome on a request the
gateway has not finished writing is accepted as `pending` with a durable receipt. See
[plug-and-play learning](./plug-and-play-learning.md#report-an-outcome).

## The durable queue

`ur.outcomes.record` never throws for a delivery failure and never loses an event:

1. It finalizes the event: `observed_at` and `source_event_id` are fixed now.
2. It **persists** the event to the client's outcome store **before** the first network send.
3. It tries one delivery and resolves a receipt.
4. Unless the gateway definitively refused the event, it stays queued; `flush()` replays it
   **verbatim**, with the **same `Idempotency-Key`** (`ur-outcome-<entry id>`, derived from the
   persisted entry, so it is the same after a process restart too).

Because a replay is byte-identical (same `observed_at`, same `source_event_id`, same key), the
gateway sees it as a `duplicate` of the event it may already have, never as a second, conflicting
event.

A success answer leaves the queue when its result `status` is `accepted`, `duplicate`, `conflict`,
`rejected` or `pending`. `pending` is the request shortcut's durable acceptance: the gateway holds a
receipt and applies the outcome once the request it names has been written.

Only a **definitive refusal of the event** drops it (`isDefinitiveRejection(err)` is the exact
rule). All of these must hold:

- the answer is a 4xx other than 401, 403, 408 and 429 — those four keep the event whatever their
  body, code or `retryable` flag says;
- its body is a well-formed gateway error envelope, `{ "error": { "code", "message", "request_id",
"retryable" } }` with every field present and typed (the error's `envelope` property);
- the code refuses the event itself — `invalid_request` (400), `not_found` (404) or `conflict`
  (409), the list in `EVENT_REJECTION_CODES` — at the status the taxonomy assigns it;
- the envelope says `"retryable": false`.

Everything else keeps the event queued, because its outcome is unknown or the event itself was not
refused: a timeout (including the SDK's own deadline), a cancellation, a connection failure, any
401 / 403 / 408 / 429 or 5xx answer, an answer without the envelope (an HTML 400 from a proxy, an
empty or unreadable body), a code about something else (a spend cap, a permission) or one this SDK
does not know, and a success the contract does not describe. Fix what the error names (for example
the key) and flush again.

| Receipt `status` | Meaning                                                                                             |
| ---------------- | --------------------------------------------------------------------------------------------------- |
| `delivered`      | The gateway recorded it; `result` holds the server row (`accepted` or `duplicate`).                 |
| `queued`         | The outcome is unknown, or the event was not refused; it stays in the store for the next `flush()`. |
| `rejected`       | The gateway definitively refused the event; `error` explains it. It is removed from the queue.      |

The one thing `record()` does throw is an `OutcomeStoreError`: a store that cannot persist the
event (for example a `FileOutcomeStore` whose file is unreadable) cannot honour "persist first".

The default store, `MemoryOutcomeStore`, lives in the process. For events that must survive a
restart, pass a `FileOutcomeStore` (Node.js only; `node:fs` is loaded lazily, so edge bundles are
unaffected) or your own `OutcomeStore`. `FileOutcomeStore` rewrites its JSON file atomically (a
temporary file with mode `0600`, then a rename). It starts empty **only** when the file does not
exist: a file that cannot be read, is not valid JSON or does not hold a list of entries makes every
operation throw `OutcomeStoreError`, and the file is never overwritten, so the events in it can be
recovered. Point each client at its own file.

```ts
import UltraRouter, { FileOutcomeStore } from '@ultrarouter/sdk';

const ur = new UltraRouter({ outcomeStore: new FileOutcomeStore('.ur-outcomes.json') });

await ur.ur.outcomes.record({ request: 'req_123' }, { channel: 'behavioral', kind: 'accepted' });

// Drain anything still queued, for example before the process exits.
const report = await ur.ur.outcomes.flush();
console.log(`delivered=${report.delivered} rejected=${report.rejected} pending=${report.pending}`);
```

`OutcomeStore` is a small interface (`append`, `update`, `remove`, `list`, sync or async); implement
it over Redis, a database table or anything durable. `append` must not resolve before the entry is
durable. A store may be shared by several clients (for example an in-memory store handed to two
clients): each client delivers with its own configuration — the client that calls `flush()` sends
every queued event with its own key, base URL, headers, timeout and retries — and every replay
keeps the event's identity and Idempotency-Key, so delivering the same entry twice is a harmless
`duplicate`. The reviewer adapter uses the same store interface (`reviewerStore`); see
[Reviewer decisions](./reviewer.md).

## Record the approved final

When a human edits and approves a draft, record the final on the artifact. What you may send depends
on whether your workspace granted **corrections consent**:

- **Without consent** (the default): send statistics only. `diffStats(draft, final)` computes them
  locally; the draft and the final never leave your process. The row is stored as metadata only.
- **With consent**: send `{ final, draft? }` and the gateway stores the final (encrypted) and computes
  the statistics itself. Sending a body without consent is rejected with `invalid_request`.

```ts
import UltraRouter, { diffStats } from '@ultrarouter/sdk';

const ur = new UltraRouter();
const artifact = await ur.ur.artifacts.create({ key: 'ticket-4821-reply', archetype: 'draft' });

const draft = 'Sorry your parcel arrived damaged. We will send a replacement.';
const final =
  'Sorry your parcel arrived damaged. We will ship a replacement today, free of charge.';

const stats = diffStats(draft, final); // pure, local: lengths, edit ratio, changed spans, sha256
const version = await ur.ur.artifacts.final(artifact.id, {
  diff_stats: stats,
  final_hash: stats.final_hash,
});
console.log(
  stats.edit_ratio.toFixed(3),
  stats.changed_spans,
  version.stored,
  version.client_computed,
);
```

`diffStats` returns `{ edit_ratio, changed_spans, lengths: { draft, final }, final_hash }`.
`edit_ratio` is 0 for identical text and 1 for no shared content; on very large inputs it degrades
conservatively (it can only report more change, never less).

## Batch and pending claims

```ts
import UltraRouter from '@ultrarouter/sdk';

const ur = new UltraRouter();

// Up to 1,000 events per call, each keyed by request_id, artifact_id or artifact_key.
const batch = await ur.ur.outcomes.batch([
  { artifact_key: 'ticket-4821-reply', channel: 'correction', kind: 'edited' },
  { artifact_key: 'ticket-4822-reply', channel: 'correction', kind: 'accepted_unchanged' },
  { request_id: 'req_123', channel: 'mechanical', kind: 'schema_valid' },
]);
console.log(`accepted=${batch.accepted} duplicate=${batch.duplicate} rejected=${batch.rejected}`);

// Claims still waiting for a resolution (`overdue` = past `resolves_by`).
const pending = await ur.ur.outcomes.pending({ state: 'overdue', limit: 20 });
for (const claim of pending.data)
  console.log(claim.artifact_key, claim.claim_key, claim.resolves_by);
```

`batch` is a direct call (not queued): each row gets its own verdict (`accepted`, `duplicate`,
`conflict` or `rejected` with a `reason`). It is the right tool for backfills. `pending` is keyset
paginated (`cursor` / `next_cursor`) and filterable by `state`, `since` and `archetype`.

## Pitfalls

- **Never put text in `value`.** Outcomes carry numbers, ids and hashes only; use `artifacts.final`
  (with consent) for text.
- **Call `flush()` before exit** when you use `record` outside `withArtifact`, or use a
  `FileOutcomeStore` so queued events survive a restart.
- **Reuse `source_event_id` only for the same event.** The same id with a different payload is a
  `conflict`.
- **`observed_at` is when it happened**, not when you send it; it must not be earlier than the
  artifact's `occurred_at`.

## Related

- [Reviewer decisions](./reviewer.md) — the signed adapter for approve / reject / edit decisions
- [History imports](./imports.md) — bring past traffic and outcomes in bulk
- [Learning status](./learning.md) — what the ledger is doing with your outcomes
- [Plug-and-play learning](./plug-and-play-learning.md) — verdict reports, receipts and learning
  controls
- [Preflight and learned context](./preflight.md) — record outcomes that quote an exposure grant
- API reference: [`ArtifactsResource`](./api/sdk.md#artifactsresource),
  [`OutcomesResource`](./api/sdk.md#outcomesresource), [`diffStats`](./api/sdk.md#diffstats)
