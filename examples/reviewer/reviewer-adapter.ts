/**
 * Reviewer integration, end to end.
 *
 * Your people already approve, reject or edit what the model drafts somewhere: a review queue, an
 * admin page, a ticket workflow. Those decisions are a valuable signal; this is the supported way to
 * send them to ultrarouter. It walks the whole integration in order:
 *
 * 1. read the guided setup (the mapping preview and the signature recipe);
 * 2. run the built-in test event and print the joined pair;
 * 3. replay it and show it is a duplicate, not a double count;
 * 4. produce a deliberately mismatched version and see it held for repair;
 * 5. queue a live decision durably and flush it, repairing anything dead-lettered;
 * 6. print integration health.
 *
 * Run (the key needs the `outcomes:write` scope):
 *
 *   ULTRAROUTER_API_KEY=ur_sk_test_... npx tsx examples/reviewer/reviewer-adapter.ts
 *
 * See docs/reviewer.md for the event fields, the signing recipe and the raw HTTP contract.
 */
import UltraRouter, { FileOutcomeStore, type QueuedReviewerEvent } from '@ultrarouter/sdk';

// Reads ULTRAROUTER_API_KEY and ULTRAROUTER_BASE_URL from the environment. The file store gives
// cross-restart durability: a queued decision survives a crash and is replayed by `flush()`.
const ur = new UltraRouter({
  reviewerStore: new FileOutcomeStore<QueuedReviewerEvent>('.ur-reviewer-queue.json'),
});

// ─── 1. guided setup: what will my verdicts become? ──────────────────────────────────────────────
const setup = await ur.ur.reviewer.setup();
console.log(`\nadapter: ${setup.adapter}   endpoint: ${setup.endpoint}`);
console.log(`signature: ${setup.signature.algorithm}`);
console.log(`  ${setup.signature.header} + ${setup.signature.timestamp_header}`);
console.log(`  key: ${setup.signature.key}`);
console.log(`  freshness window: ±${String(setup.signature.tolerance_seconds)}s`);
console.log(
  `corrections_consent: ${String(setup.corrections_consent)} (a final BODY is stored only when true)`,
);
console.log('\nmapping preview — what each reviewer verdict becomes in the ledger:');
for (const row of setup.mapping) {
  console.log(`  ${row.decision.padEnd(20)} → ${row.channel}:${row.kind}`);
  console.log(`      ${row.note}`);
}

// ─── 2. the test event: prove the join before wiring anything ────────────────────────────────────
const test = await ur.ur.reviewer.test('happy');
console.log('\ntest event — the joined pair:');
console.log(
  `  artifact ${test.artifact.id} (${test.artifact.key}, lifecycle ${test.artifact.lifecycle})`,
);
console.log(
  `  review   ${test.result.event_id} → ${test.result.channel}:${test.result.kind} (${test.result.status})`,
);
console.log(`  learning_use (server-assigned): ${JSON.stringify(test.result.learning_use)}`);
console.log(
  `  test data excluded from learning: ${String(test.excluded_from_learning)}; from invoicing: ${String(test.excluded_from_invoicing)}`,
);

// ─── 3. a replay is a visible no-op ──────────────────────────────────────────────────────────────
const replay = await ur.ur.reviewer.test('replay');
console.log(
  `\nreplay of the same event id → ${replay.result.status} (not a second row, not an error)`,
);

// ─── 4. a mismatched draft version is HELD, then repaired ────────────────────────────────────────
const mismatch = await ur.ur.reviewer.test('version_mismatch');
console.log(`\nmismatched version → ${mismatch.result.status}: ${mismatch.result.reason}`);
console.log(
  '  the decision is held, never guessed — repair it with the exact version the human saw.',
);

// ─── 5. the real thing: queue a decision from your reviewer, then flush ──────────────────────────
//
// Call this from wherever your reviewer clicks Approve. `event_id` is YOUR system's id — it is the
// idempotency key, so re-sending is always safe. `artifact_version` is the EXACT draft the human
// looked at; if it has moved on, we hold the event for repair rather than attaching a verdict to a
// draft nobody read.
await ur.ur.reviewer.record(
  {
    event_id: `demo-${Date.now().toString(36)}`,
    artifact_key: test.artifact.key,
    artifact_version: test.artifact.current_version,
    decision: 'approved_with_edits',
    effective_at: new Date().toISOString(),
    reviewer_id: 'reviewer-7',
    // Without `corrections_consent` send client-computed stats + a hash, never a body. With consent
    // you may send `{ draft, text }` and we compute the diff server-side and store the final.
    final: { hash: 'sha256:demo', diff_stats: { edit_ratio: 0.08, changed_spans: 1 } },
  },
  { reviewerSystem: 'my-review-queue' },
);
const flushed = await ur.ur.reviewer.flush();
console.log(
  `\nflush: accepted=${String(flushed.accepted)} duplicate=${String(flushed.duplicate)} dead-lettered=${String(flushed.deadLettered)} still-queued=${String(flushed.pending)}`,
);

// Anything the server could not join is HELD locally so you can repair it instead of losing it.
for (const entry of await ur.ur.reviewer.deadLetters()) {
  console.log(`  dead letter ${entry.event.event_id}: ${entry.dead_letter?.reason ?? ''}`);
  const repaired = await ur.ur.reviewer.repair(entry, { repinToCurrentVersion: true });
  console.log(`    repaired → ${repaired.result?.status ?? 'still failing'}`);
}

// ─── 6. health: is the integration actually working? ─────────────────────────────────────────────
const health = await ur.ur.reviewer.health();
console.log('\nintegration health:');
console.log(`  last successful event: ${health.last_success_at ?? 'none yet'}`);
console.log(
  `  accepted=${String(health.events.accepted)} duplicate=${String(health.events.duplicate)}`,
);
console.log(
  `  unmatched=${String(health.events.unmatched)} delayed=${String(health.events.delayed)} rejected=${String(health.events.rejected)}`,
);
for (const bf of health.backfills) {
  console.log(
    `  backfill ${bf.id}: ${String(bf.received)}/${bf.declared_total === null ? '?' : String(bf.declared_total)} received, complete=${String(bf.complete)}`,
  );
}
console.log(`  next action: ${health.next_repair.action} — ${health.next_repair.detail}`);
