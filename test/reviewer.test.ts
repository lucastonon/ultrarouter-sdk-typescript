// (client half) — the reviewer adapter.
//
// Covers the whole `ur.reviewer.*` surface against an in-process recording `fetch`: guided setup,
// the test scenarios, the SIGNED delivery (the MAC must describe the exact bytes that were sent and
// must be recomputable independently), the durable local queue + flush, dead-letter retention for a
// repairable refusal, the repair round-trip, health, and — the load-bearing pair — a replay is a
// duplicate the queue removes, while a NON-repairable refusal is dropped and a repairable one is not.
import { createHmac } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { UltraRouter } from '../src/client.js';
import { UltraRouterError } from '../src/errors.js';
import { FileOutcomeStore, MemoryOutcomeStore } from '../src/flywheel-queue.js';
import {
  REVIEWER_SIGNATURE_HEADER,
  REVIEWER_TIMESTAMP_HEADER,
  ReviewerQueue,
  reviewerSignedPayload,
  signReviewerPayload,
  type QueuedReviewerEvent,
  type ReviewerEvent,
  type ReviewerEventResult,
  type ReviewerEventsResponse,
} from '../src/reviewer.js';
import type { FetchLike } from '../src/types.js';

const KEY = 'ur_sk_test_reviewer_adapter_key';

interface Captured {
  url: string;
  method: string;
  headers: Record<string, string>;
  raw: string | undefined;
  body: unknown;
}

function recorder(router: (call: Captured, n: number) => Response): {
  fetch: FetchLike;
  calls: Captured[];
} {
  const calls: Captured[] = [];
  const fetch: FetchLike = (url, init) => {
    const headers: Record<string, string> = {};
    const raw = init?.headers as Record<string, string> | undefined;
    if (raw) for (const [k, v] of Object.entries(raw)) headers[k.toLowerCase()] = v;
    const bodyRaw = init?.body === undefined ? undefined : String(init.body);
    calls.push({
      url: String(url),
      method: init?.method ?? 'GET',
      headers,
      raw: bodyRaw,
      body: bodyRaw === undefined ? undefined : JSON.parse(bodyRaw),
    });
    return Promise.resolve(router(calls[calls.length - 1] as Captured, calls.length));
  };
  return { fetch, calls };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function event(over: Partial<ReviewerEvent> = {}): ReviewerEvent {
  return {
    event_id: 'rev_1',
    artifact_key: 'invoice:4711',
    artifact_version: 1,
    decision: 'approved_with_edits',
    effective_at: '2026-09-14T10:00:00Z',
    ...over,
  } as ReviewerEvent;
}

function result(over: Partial<ReviewerEventResult> = {}): ReviewerEventResult {
  return {
    event_id: 'rev_1',
    status: 'accepted',
    reason: '',
    artifact_id: 'art_1',
    artifact_version: 1,
    channel: 'correction',
    kind: 'edited',
    latency_class: 'instant',
    learning_use: ['calibrate', 'train'],
    outcome_event_id: 'oev_1',
    final_version: 2,
    repairable: false,
    ...over,
  } as ReviewerEventResult;
}

function eventsResponse(rows: ReviewerEventResult[]): ReviewerEventsResponse {
  return {
    object: 'reviewer_events',
    adapter: 'reviewer.v1',
    data: rows,
    accepted: rows.filter((r) => r.status === 'accepted').length,
    duplicate: rows.filter((r) => r.status === 'duplicate').length,
    rejected: rows.filter((r) => r.status === 'rejected').length,
    unsupported: rows.filter((r) => r.status === 'unsupported').length,
  } as ReviewerEventsResponse;
}

describe(' reviewer adapter — signing', () => {
  it('signs `<timestamp>.<raw body>` with the API key, verifiable independently', async () => {
    const sig = await signReviewerPayload(KEY, '1757800000', '{"a":1}');
    const expected = `sha256=${createHmac('sha256', KEY).update('1757800000.{"a":1}', 'utf8').digest('hex')}`;
    expect(sig).toBe(expected);
    expect(reviewerSignedPayload('1757800000', '{"a":1}')).toBe('1757800000.{"a":1}');
  });

  it('the header signature describes the EXACT bytes the transport sent', async () => {
    const { fetch, calls } = recorder(() => jsonResponse(eventsResponse([result()])));
    const ur = new UltraRouter({ apiKey: KEY, baseURL: 'https://gw.test', fetch });
    await ur.ur.reviewer.send([event()], { reviewerSystem: 'acme-review' });

    const call = calls[0];
    expect(call?.url).toBe('https://gw.test/v1/flywheel/reviewer/events');
    const ts = call?.headers[REVIEWER_TIMESTAMP_HEADER];
    const sig = call?.headers[REVIEWER_SIGNATURE_HEADER];
    expect(ts).toMatch(/^\d+$/);
    // Recompute from the captured raw body — if the client signed anything else, this fails.
    const recomputed = `sha256=${createHmac('sha256', KEY)
      .update(`${String(ts)}.${String(call?.raw)}`, 'utf8')
      .digest('hex')}`;
    expect(sig).toBe(recomputed);
  });

  it('a retry replays the identical body AND signature (so the server sees a duplicate)', async () => {
    const { fetch, calls } = recorder((_call, n) =>
      n === 1
        ? jsonResponse({ error: { code: 'provider_unavailable', message: 'boom' } }, 503)
        : jsonResponse(eventsResponse([result({ status: 'duplicate' })])),
    );
    const ur = new UltraRouter({ apiKey: KEY, baseURL: 'https://gw.test', fetch, maxRetries: 1 });
    await ur.ur.reviewer.send([event()]);
    expect(calls).toHaveLength(2);
    expect(calls[0]?.raw).toBe(calls[1]?.raw);
    expect(calls[0]?.headers[REVIEWER_SIGNATURE_HEADER]).toBe(
      calls[1]?.headers[REVIEWER_SIGNATURE_HEADER],
    );
  });
});

describe(' reviewer adapter — the event surface cannot set provenance', () => {
  it('the wire event carries no learning_use / source / producer field', async () => {
    const { fetch, calls } = recorder(() => jsonResponse(eventsResponse([result()])));
    const ur = new UltraRouter({ apiKey: KEY, baseURL: 'https://gw.test', fetch });
    await ur.ur.reviewer.send([event()]);
    const sent = (calls[0]?.body as { events: Record<string, unknown>[] }).events[0] ?? {};
    for (const forbidden of ['learning_use', 'source', 'producer', 'latency_class']) {
      expect(Object.keys(sent)).not.toContain(forbidden);
    }
    // …and the generated type has no such key either, so a caller cannot add one:
    // @ts-expect-error `learning_use` is not part of ReviewerEvent.
    const illegal: ReviewerEvent = { ...event(), learning_use: ['train'] };
    expect(illegal.event_id).toBe('rev_1');
  });
});

describe(' reviewer adapter — guided setup + health', () => {
  it('setup() reads the mapping preview and never echoes a secret', async () => {
    const setup = {
      object: 'reviewer_setup',
      adapter: 'reviewer.v1',
      endpoint: '/v1/flywheel/reviewer/events',
      signature: {
        header: REVIEWER_SIGNATURE_HEADER,
        timestamp_header: REVIEWER_TIMESTAMP_HEADER,
        algorithm: 'HMAC-SHA256',
        key: 'your ultrarouter API key',
        tolerance_seconds: 900,
      },
      required_scope: 'outcomes:write',
      mapping: [
        {
          decision: 'approved',
          channel: 'correction',
          kind: 'accepted_unchanged',
          accepts_final: true,
          note: 'n',
        },
      ],
      corrections_consent: false,
      test_artifact_key: 'ur:reviewer-adapter:setup-test',
      events_received: 0,
    };
    const { fetch, calls } = recorder(() => jsonResponse(setup));
    const ur = new UltraRouter({ apiKey: KEY, baseURL: 'https://gw.test', fetch });
    const got = await ur.ur.reviewer.setup();
    expect(calls[0]?.url).toBe('https://gw.test/v1/flywheel/reviewer/setup');
    expect(calls[0]?.method).toBe('GET');
    expect(got.mapping[0]?.kind).toBe('accepted_unchanged');
    expect(JSON.stringify(got)).not.toContain(KEY);
  });

  it('test(scenario) posts the scenario and returns the joined pair', async () => {
    const { fetch, calls } = recorder(() =>
      jsonResponse({
        object: 'reviewer_test',
        scenario: 'version_mismatch',
        artifact: { object: 'artifact', id: 'art_t', key: 'ur:reviewer-adapter:setup-test' },
        result: result({
          status: 'rejected',
          reason: 'version_mismatch:claimed=999,current=1',
          repairable: true,
        }),
        excluded_from_learning: true,
        excluded_from_invoicing: true,
      }),
    );
    const ur = new UltraRouter({ apiKey: KEY, baseURL: 'https://gw.test', fetch });
    const got = await ur.ur.reviewer.test('version_mismatch');
    expect(calls[0]?.body).toEqual({ scenario: 'version_mismatch' });
    expect(got.excluded_from_learning).toBe(true);
    expect(got.excluded_from_invoicing).toBe(true);
    expect(got.result.repairable).toBe(true);
  });

  it('health() reads the six named states', async () => {
    const { fetch, calls } = recorder(() =>
      jsonResponse({
        object: 'reviewer_health',
        adapter: 'reviewer.v1',
        last_success_at: '2026-09-14T10:00:00Z',
        last_success_event_id: 'rev_1',
        events: {
          accepted: 1,
          duplicate: 2,
          unmatched: 3,
          delayed: 4,
          rejected: 5,
          unsupported: 0,
        },
        dead_letters: [],
        dead_letter_total: 0,
        backfills: [],
        next_repair: { action: 'none', detail: 'ok', event_id: null },
      }),
    );
    const ur = new UltraRouter({ apiKey: KEY, baseURL: 'https://gw.test', fetch });
    const got = await ur.ur.reviewer.health();
    expect(calls[0]?.url).toBe('https://gw.test/v1/flywheel/reviewer/health');
    expect(got.events).toEqual({
      accepted: 1,
      duplicate: 2,
      unmatched: 3,
      delayed: 4,
      rejected: 5,
      unsupported: 0,
    });
  });
});

describe(' reviewer adapter — the durable local queue', () => {
  it('record() persists BEFORE any network call; flush() sends and clears accepted events', async () => {
    const { fetch, calls } = recorder(() => jsonResponse(eventsResponse([result()])));
    const store = new MemoryOutcomeStore<QueuedReviewerEvent>();
    const ur = new UltraRouter({
      apiKey: KEY,
      baseURL: 'https://gw.test',
      fetch,
      reviewerStore: store,
    });

    await ur.ur.reviewer.record(event(), { reviewerSystem: 'acme-review' });
    expect(calls).toHaveLength(0); // durable first — nothing on the wire yet
    expect(store.list()).toHaveLength(1);

    const report = await ur.ur.reviewer.flush();
    expect(report.accepted).toBe(1);
    expect(report.pending).toBe(0);
    expect(store.list()).toHaveLength(0);
    expect(calls[0]?.body).toMatchObject({ reviewer_system: 'acme-review' });
  });

  it('a replay flushed twice is a duplicate, and the queue still empties', async () => {
    const { fetch } = recorder(() =>
      jsonResponse(eventsResponse([result({ status: 'duplicate' })])),
    );
    const ur = new UltraRouter({ apiKey: KEY, baseURL: 'https://gw.test', fetch });
    await ur.ur.reviewer.record(event());
    const report = await ur.ur.reviewer.flush();
    expect(report.duplicate).toBe(1);
    expect(report.accepted).toBe(0);
    expect(report.pending).toBe(0);
  });

  it('a REPAIRABLE refusal is kept as a dead letter (a human decision is never dropped)', async () => {
    const { fetch } = recorder(() =>
      jsonResponse(
        eventsResponse([
          result({ status: 'rejected', reason: 'unmatched_artifact_key', repairable: true }),
        ]),
      ),
    );
    const ur = new UltraRouter({ apiKey: KEY, baseURL: 'https://gw.test', fetch });
    await ur.ur.reviewer.record(event());
    const report = await ur.ur.reviewer.flush();
    expect(report.deadLettered).toBe(1);
    expect(report.dropped).toBe(0);
    const dead = await ur.ur.reviewer.deadLetters();
    expect(dead).toHaveLength(1);
    expect(dead[0]?.dead_letter?.reason).toBe('unmatched_artifact_key');
    // …and it is no longer "pending", so a second flush does not resend it blindly.
    expect(report.pending).toBe(0);
  });

  it('a TERMINAL refusal is dropped (re-sending the identical payload can never change it)', async () => {
    const { fetch } = recorder(() =>
      jsonResponse(
        eventsResponse([
          result({ status: 'rejected', reason: 'ledger_conflict', repairable: false }),
        ]),
      ),
    );
    const ur = new UltraRouter({ apiKey: KEY, baseURL: 'https://gw.test', fetch });
    await ur.ur.reviewer.record(event());
    const report = await ur.ur.reviewer.flush();
    expect(report.dropped).toBe(1);
    expect(report.deadLettered).toBe(0);
    expect(await ur.ur.reviewer.deadLetters()).toHaveLength(0);
  });

  it('a retryable transport failure leaves everything queued for the next flush', async () => {
    let fail = true;
    const { fetch } = recorder(() =>
      fail
        ? jsonResponse({ error: { code: 'provider_unavailable', message: 'down' } }, 503)
        : jsonResponse(eventsResponse([result()])),
    );
    const ur = new UltraRouter({ apiKey: KEY, baseURL: 'https://gw.test', fetch, maxRetries: 0 });
    await ur.ur.reviewer.record(event());
    const first = await ur.ur.reviewer.flush();
    expect(first.pending).toBe(1);
    expect(first.accepted).toBe(0);

    fail = false;
    const second = await ur.ur.reviewer.flush();
    expect(second.accepted).toBe(1);
    expect(second.pending).toBe(0);
  });

  it('a TERMINAL request-level failure (bad signature) is thrown, not swallowed', async () => {
    const { fetch } = recorder(() =>
      jsonResponse(
        { error: { code: 'permission', message: 'invalid_signature: …', retryable: false } },
        403,
      ),
    );
    const store = new MemoryOutcomeStore<QueuedReviewerEvent>();
    const ur = new UltraRouter({
      apiKey: KEY,
      baseURL: 'https://gw.test',
      fetch,
      maxRetries: 0,
      reviewerStore: store,
    });
    await ur.ur.reviewer.record(event());
    await expect(ur.ur.reviewer.flush()).rejects.toBeInstanceOf(UltraRouterError);
    // The event is STILL queued — a refused delivery never destroys the evidence, and a
    // transport-level refusal is NOT a per-event dead letter (the event was never judged).
    expect(store.list()).toHaveLength(1);
    expect(store.list()[0]?.attempts).toBe(1);
    expect(await ur.ur.reviewer.deadLetters()).toHaveLength(0);
  });

  it('groups a declared backfill into its own delivery and preserves the declaration', async () => {
    const { fetch, calls } = recorder((call) => {
      const body = call.body as { events: { event_id: string }[] };
      return jsonResponse(eventsResponse(body.events.map((e) => result({ event_id: e.event_id }))));
    });
    const ur = new UltraRouter({ apiKey: KEY, baseURL: 'https://gw.test', fetch });
    await ur.ur.reviewer.record(event({ event_id: 'live_1' }));
    await ur.ur.reviewer.record(event({ event_id: 'bf_1' }), {
      backfill: { id: 'bf_sep', total: 2 },
    });
    await ur.ur.reviewer.record(event({ event_id: 'bf_2' }), {
      backfill: { id: 'bf_sep', total: 2, complete: true },
    });
    const report = await ur.ur.reviewer.flush();
    expect(report.accepted).toBe(3);
    expect(calls).toHaveLength(2);
    expect((calls[0]?.body as { backfill?: unknown }).backfill).toBeUndefined();
    expect((calls[1]?.body as { backfill?: { id: string } }).backfill?.id).toBe('bf_sep');
  });

  it('respects the batch size (the server accepts ≤ 500 per delivery)', async () => {
    const sent: number[] = [];
    const queue = new ReviewerQueue({
      store: new MemoryOutcomeStore<QueuedReviewerEvent>(),
      batchSize: 2,
      send: (entries) => {
        sent.push(entries.length);
        return Promise.resolve(
          eventsResponse(entries.map((e) => result({ event_id: e.event.event_id }))),
        );
      },
    });
    for (let i = 0; i < 5; i += 1) await queue.enqueue(event({ event_id: `e${String(i)}` }));
    const report = await queue.flush();
    expect(sent).toEqual([2, 2, 1]);
    expect(report.accepted).toBe(5);
  });

  it('survives a process restart with a FileOutcomeStore', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ur-reviewer-'));
    const path = join(dir, 'reviewer-queue.json');

    const first = new ReviewerQueue({
      store: new FileOutcomeStore<QueuedReviewerEvent>(path),
      send: () => Promise.reject(new Error('offline')),
    });
    await first.enqueue(event({ event_id: 'persisted' }));
    await first.flush().catch(() => undefined);

    // A "new process" reads the same file and finds the event intact.
    const reopened = new ReviewerQueue({
      store: new FileOutcomeStore<QueuedReviewerEvent>(path),
      send: (entries) =>
        Promise.resolve(eventsResponse(entries.map((e) => result({ event_id: e.event.event_id })))),
    });
    expect(await reopened.size()).toBe(1);
    const report = await reopened.flush();
    expect(report.accepted).toBe(1);
    expect(await reopened.size()).toBe(0);
  });
});

describe(' reviewer adapter — dead-letter repair', () => {
  it('repair() re-drives the stored event and clears the local dead letter on success', async () => {
    let phase: 'refuse' | 'repair' = 'refuse';
    const { fetch, calls } = recorder((call) => {
      if (call.url.endsWith('/repair')) {
        return jsonResponse({
          object: 'reviewer_repair',
          event_id: 'rev_1',
          before: { status: 'rejected', reason: 'version_mismatch:claimed=999,current=1' },
          result: result({ status: 'accepted', reason: 'repaired' }),
        });
      }
      return jsonResponse(
        eventsResponse([
          phase === 'refuse'
            ? result({
                status: 'rejected',
                reason: 'version_mismatch:claimed=999,current=1',
                repairable: true,
              })
            : result(),
        ]),
      );
    });
    const ur = new UltraRouter({ apiKey: KEY, baseURL: 'https://gw.test', fetch });
    await ur.ur.reviewer.record(event({ artifact_version: 999 }), {
      reviewerSystem: 'acme-review',
    });
    await ur.ur.reviewer.flush();
    const dead = await ur.ur.reviewer.deadLetters();
    expect(dead).toHaveLength(1);

    phase = 'repair';
    const repaired = await ur.ur.reviewer.repair(dead[0] as QueuedReviewerEvent, {
      repinToCurrentVersion: true,
    });
    expect(repaired.result?.status).toBe('accepted');
    // The FULL original event was re-sent — we keep it locally so a repair never has to guess.
    const repairCall = calls.find((c) => c.url.endsWith('/repair'));
    expect(repairCall?.body).toMatchObject({
      repin_to_current_version: true,
      reviewer_system: 'acme-review',
      event: { event_id: 'rev_1', artifact_version: 999 },
    });
    expect(await ur.ur.reviewer.deadLetters()).toHaveLength(0);
  });

  it('a repair that still fails leaves the dead letter in place', async () => {
    const { fetch } = recorder((call) =>
      call.url.endsWith('/repair')
        ? jsonResponse({
            object: 'reviewer_repair',
            event_id: 'rev_1',
            before: { status: 'rejected', reason: 'unmatched_artifact_key' },
            result: result({
              status: 'rejected',
              reason: 'unmatched_artifact_key',
              repairable: true,
            }),
          })
        : jsonResponse(
            eventsResponse([
              result({ status: 'rejected', reason: 'unmatched_artifact_key', repairable: true }),
            ]),
          ),
    );
    const ur = new UltraRouter({ apiKey: KEY, baseURL: 'https://gw.test', fetch });
    await ur.ur.reviewer.record(event());
    await ur.ur.reviewer.flush();
    const dead = await ur.ur.reviewer.deadLetters();
    await ur.ur.reviewer.repair(dead[0] as QueuedReviewerEvent);
    expect(await ur.ur.reviewer.deadLetters()).toHaveLength(1);
  });
});
