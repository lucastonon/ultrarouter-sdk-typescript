// The canonical, cross-SDK retention fixture (`test/fixtures/queue-retention-cases.json`, copied
// byte-for-byte into the Python SDK): EVERY case is one HTTP answer to one delivery attempt of one
// queued event, run here through the real client and transport, against the same expectations the
// Python SDK checks. `expect` says whether the event is still in the store afterwards; `outcome` says
// how (a receipt status, or a reviewer flush counter / dead letter).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { UltraRouter } from '../src/client.js';
import { MemoryOutcomeStore } from '../src/flywheel-queue.js';
import type { QueuedReviewerEvent, ReviewerEvent } from '../src/reviewer.js';
import type { FetchLike } from '../src/types.js';

interface RetentionCase {
  readonly id: string;
  readonly kind: 'outcome' | 'artifact-outcome' | 'reviewer';
  readonly status: number;
  readonly content_type: string;
  readonly body: string;
  readonly unreadable?: boolean;
  readonly expect: 'retain' | 'drop';
  readonly outcome: string;
  readonly rule: string;
}

interface RetentionFixture {
  readonly schema: string;
  readonly reviewer_event_id: string;
  readonly cases: readonly RetentionCase[];
}

const FIXTURE = JSON.parse(
  readFileSync(
    fileURLToPath(new URL('./fixtures/queue-retention-cases.json', import.meta.url)),
    'utf8',
  ),
) as RetentionFixture;

/** The answer to the delivery attempt, exactly as the fixture describes it. */
function answer(c: RetentionCase): Response {
  const headers = { 'content-type': c.content_type };
  if (c.unreadable === true) {
    const failing = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.error(new Error('connection reset while reading the body'));
      },
    });
    return new Response(failing, { status: c.status, headers });
  }
  return new Response(c.body, { status: c.status, headers });
}

function client(
  fetch: FetchLike,
  stores: { outcome?: MemoryOutcomeStore; reviewer?: MemoryOutcomeStore<QueuedReviewerEvent> },
): UltraRouter {
  return new UltraRouter({
    apiKey: 'ur_sk_test_fixture',
    baseURL: 'https://gw.fixture.test',
    fetch,
    maxRetries: 0,
    ...(stores.outcome !== undefined ? { outcomeStore: stores.outcome } : {}),
    ...(stores.reviewer !== undefined ? { reviewerStore: stores.reviewer } : {}),
  });
}

async function runOutcome(c: RetentionCase): Promise<{ left: number; outcome: string }> {
  const store = new MemoryOutcomeStore();
  let calls = 0;
  const ur = client(
    async () => {
      calls += 1;
      return answer(c);
    },
    { outcome: store },
  );
  const target = c.kind === 'outcome' ? { request: 'req_fixture' } : { artifact: 'art_fixture' };
  const receipt = await ur.ur.outcomes.record(target, { channel: 'behavioral', kind: 'accepted' });
  expect(calls).toBe(1);
  return { left: store.list().length, outcome: receipt.status };
}

async function runReviewer(c: RetentionCase): Promise<{ left: number; outcome: string }> {
  const store = new MemoryOutcomeStore<QueuedReviewerEvent>();
  let calls = 0;
  const ur = client(
    async () => {
      calls += 1;
      return answer(c);
    },
    { reviewer: store },
  );
  await ur.ur.reviewer.record({
    event_id: FIXTURE.reviewer_event_id,
    artifact_key: 'invoice:fixture',
    artifact_version: 1,
    decision: 'approved',
    effective_at: '2026-01-01T00:00:00Z',
  } as ReviewerEvent);
  let thrown: unknown = null;
  const report = await ur.ur.reviewer.flush().catch((err: unknown) => {
    thrown = err;
    return null;
  });
  expect(calls).toBe(1);
  // A 2xx answer, however malformed its verdicts (an event_id that is a list, an object, null, a
  // boolean…), never makes flush() throw; only a failed delivery (a non-2xx answer) may.
  if (c.status >= 200 && c.status < 300) expect(thrown).toBeNull();
  const left = store.list();
  let outcome = 'pending';
  if (report !== null && report.accepted === 1) outcome = 'accepted';
  else if (report !== null && report.duplicate === 1) outcome = 'duplicate';
  else if (report !== null && report.dropped === 1) outcome = 'dropped';
  else if (left.length === 1 && left[0]!.dead_letter !== undefined) outcome = 'dead_lettered';
  return { left: left.length, outcome };
}

describe('the canonical retention fixture', () => {
  it('is the v1 schema with unique ids and every kind covered both ways', () => {
    expect(FIXTURE.schema).toBe('ultrarouter.queue-retention-cases.v1');
    expect(new Set(FIXTURE.cases.map((c) => c.id)).size).toBe(FIXTURE.cases.length);
    for (const kind of ['outcome', 'artifact-outcome', 'reviewer'] as const) {
      for (const want of ['retain', 'drop'] as const) {
        expect(FIXTURE.cases.some((c) => c.kind === kind && c.expect === want)).toBe(true);
      }
    }
  });

  it.each(FIXTURE.cases.map((c) => [c.id, c] as const))('%s', async (_id, c) => {
    const result = c.kind === 'reviewer' ? await runReviewer(c) : await runOutcome(c);
    expect({ left: result.left, outcome: result.outcome }).toEqual({
      left: c.expect === 'retain' ? 1 : 0,
      outcome: c.outcome,
    });
  });
});
