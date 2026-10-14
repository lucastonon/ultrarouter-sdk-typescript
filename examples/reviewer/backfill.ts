/**
 * Backfilling historical reviewer decisions.
 *
 * You likely have months of approve / reject / edit history in your review system. Send it as a
 * declared backfill so progress is attributable and a resumed run never double-counts:
 *
 * - Idempotency is yours: `event_id` is your review system's own id, so re-sending a decision is a
 *   `duplicate`, never a second row.
 * - Progress is declared, not inferred: you send `{ id, total }`, and `complete: true` on the last
 *   page.
 * - Nothing is lost or guessed: events that cannot be joined yet (an artifact you have not created, a
 *   draft that moved on) come back as repairable dead letters held in the local queue.
 *
 * Run (the key needs the `outcomes:write` scope):
 *
 *   ULTRAROUTER_API_KEY=ur_sk_test_... npx tsx examples/reviewer/backfill.ts
 */
import UltraRouter, { FileOutcomeStore, type QueuedReviewerEvent } from '@ultrarouter/sdk';

const ur = new UltraRouter({
  reviewerStore: new FileOutcomeStore<QueuedReviewerEvent>('.ur-reviewer-backfill.json'),
});

/** Your export, however it comes out of your review system. */
interface HistoricalReview {
  id: string;
  documentKey: string;
  draftVersion: number;
  verdict: 'approved' | 'approved_with_edits' | 'rejected' | 'regenerated';
  decidedAt: string;
  reviewer: string;
}

// Stand-in for `SELECT … FROM reviews WHERE decided_at >= …` in your own system.
const history: HistoricalReview[] = [
  {
    id: 'rv-2026-08-0001',
    documentKey: 'invoice:4711',
    draftVersion: 1,
    verdict: 'approved_with_edits',
    decidedAt: '2026-08-02T09:12:00Z',
    reviewer: 'reviewer-3',
  },
  {
    id: 'rv-2026-08-0002',
    documentKey: 'invoice:4712',
    draftVersion: 1,
    verdict: 'rejected',
    decidedAt: '2026-08-02T11:40:00Z',
    reviewer: 'reviewer-7',
  },
];

const BACKFILL_ID = 'reviews-2026-08';

for (const [i, row] of history.entries()) {
  await ur.ur.reviewer.record(
    {
      // YOUR id — the idempotency key. Re-running this script is free.
      event_id: row.id,
      artifact_key: row.documentKey,
      // The EXACT draft the human read. If it no longer matches, the event is held for repair
      // rather than attached to a draft nobody reviewed.
      artifact_version: row.draftVersion,
      decision: row.verdict,
      // The historical instant — NOT "now". This is what makes the event `delayed` rather than
      // pretending a months-old decision was instant.
      effective_at: row.decidedAt,
      reviewer_id: row.reviewer,
    },
    {
      reviewerSystem: 'my-review-queue',
      backfill: {
        id: BACKFILL_ID,
        total: history.length,
        // Declared explicitly on the last page — completion is never inferred from counts.
        ...(i === history.length - 1 ? { complete: true } : {}),
      },
    },
  );
}

const report = await ur.ur.reviewer.flush();
console.log(
  `backfill ${BACKFILL_ID}: accepted=${String(report.accepted)} duplicate=${String(report.duplicate)} dead-lettered=${String(report.deadLettered)} dropped=${String(report.dropped)} still-queued=${String(report.pending)}`,
);

const health = await ur.ur.reviewer.health();
for (const bf of health.backfills) {
  console.log(
    `  ${bf.id}: ${String(bf.received)}/${bf.declared_total === null ? '?' : String(bf.declared_total)} received, ${String(bf.accepted)} accepted, ${String(bf.rejected)} needing repair, complete=${String(bf.complete)}`,
  );
}
if (health.dead_letter_total > 0) {
  console.log(`  next action: ${health.next_repair.action} — ${health.next_repair.detail}`);
}
