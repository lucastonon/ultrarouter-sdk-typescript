// `ur.outcomes.report`: the verdict mapping (pinned to the shared fixture), the derived identity,
// validation, and the never-double-report guarantee under acknowledgement loss, flushes, repeated
// calls, a new process and concurrency.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { UltraRouter } from '../src/client.js';
import { MemoryOutcomeStore } from '../src/flywheel-queue.js';
import {
  OUTCOME_SOURCES,
  OUTCOME_VERDICTS,
  OUTCOME_VERDICTS_SCHEMA_VERSION,
  planOutcomeReport,
  reportSourceEventId,
  type OutcomeSource,
} from '../src/outcome-report.js';
import type { FetchLike } from '../src/types.js';
// @ts-expect-error -- plain ESM test helper without type declarations
import { startMockGateway } from './support/mock-gateway.mjs';

interface Receipt {
  id: string;
  request_id: string;
  status: string;
  kind: string;
  source_event_id: string | null;
}
interface Gateway {
  url: string;
  requests: { method: string; path: string; headers: Record<string, string>; raw: string }[];
  learning: { receipts: () => Receipt[] };
  close: () => Promise<void>;
}

const FIXTURE_PATH = fileURLToPath(new URL('./fixtures/outcome-verdicts.json', import.meta.url));
const FIXTURE = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8')) as {
  schema_version: number;
  sources: Record<string, unknown>;
  unknown: { sends: boolean; result: string };
};

let gw: Gateway;
beforeAll(async () => {
  gw = (await startMockGateway()) as Gateway;
});
afterAll(async () => {
  await gw.close();
});

function client(extra: ConstructorParameters<typeof UltraRouter>[0] = {}): UltraRouter {
  return new UltraRouter({
    apiKey: 'ur_sk_test_report',
    baseURL: gw.url,
    defaultModel: 'openai/gpt-5.2-mini',
    maxRetries: 0,
    ...extra,
  });
}

/** Serve one chat call on the mock so its request id is known there. */
async function servedRequest(ur = client()): Promise<string> {
  const res = await ur.chat.completions.create({ messages: [{ role: 'user', content: 'task' }] });
  return res.requestId;
}

const receiptsFor = (requestId: string) =>
  gw.learning.receipts().filter((r) => r.request_id === requestId);
const outcomePosts = (requestId: string) =>
  gw.requests.filter((r) => r.method === 'POST' && r.path === `/v1/requests/${requestId}/outcomes`);

/** A fetch that forwards to the mock but loses the answer of the first `drop` outcome POSTs. */
function ackLossFetch(drop: number): { fetch: FetchLike; dropped: () => number } {
  let dropped = 0;
  const fetch: FetchLike = async (url, init) => {
    const res = await globalThis.fetch(url, init);
    if (/\/outcomes$/.test(String(url)) && dropped < drop) {
      await res.text(); // the gateway processed it…
      dropped += 1;
      throw new TypeError('fetch failed: connection reset'); // …and the acknowledgement was lost
    }
    return res;
  };
  return { fetch, dropped: () => dropped };
}

describe('the verdict mapping', () => {
  it('is identical to the shared fixture, source by source', () => {
    expect(FIXTURE.schema_version).toBe(OUTCOME_VERDICTS_SCHEMA_VERSION);
    expect(JSON.parse(JSON.stringify(OUTCOME_VERDICTS))).toEqual(FIXTURE.sources);
    expect(Object.keys(FIXTURE.sources)).toEqual([...OUTCOME_SOURCES]);
    expect(FIXTURE.unknown).toEqual({ sends: false, result: 'not_reported' });
  });

  it('only self_rating is a proxy that never teaches', () => {
    for (const source of OUTCOME_SOURCES) {
      expect(OUTCOME_VERDICTS[source].teaches).toBe(source !== 'self_rating');
    }
    expect(OUTCOME_VERDICTS.self_rating.pass.channel).toBe('proxy');
  });

  for (const source of Object.keys(FIXTURE.sources) as OutcomeSource[]) {
    for (const verdict of ['pass', 'fail'] as const) {
      it(`${source} / ${verdict} sends exactly the fixture's channel, kind and value`, async () => {
        const ur = client();
        const requestId = await servedRequest(ur);
        const result = await ur.ur.outcomes.report(requestId, { verdict, source });
        const want = (FIXTURE.sources[source] as Record<string, Record<string, unknown>>)[verdict]!;
        const sent = JSON.parse(outcomePosts(requestId).at(-1)!.raw) as Record<string, unknown>;
        expect({ channel: sent.channel, kind: sent.kind, value: sent.value }).toEqual({
          channel: want.channel,
          kind: want.kind,
          value: want.value,
        });
        expect(result.status).toBe('delivered');
        expect(result.teaches).toBe(source !== 'self_rating');
        expect(result.channel).toBe(want.channel);
        expect(result.kind).toBe(want.kind);
        expect(result.sourceEventId).toBe(reportSourceEventId(requestId, verdict, source));
        expect(sent.source_event_id).toBe(result.sourceEventId);
        expect(typeof sent.observed_at).toBe('string');
      });
    }
  }

  it('unknown sends nothing and resolves a typed not_reported', async () => {
    const before = gw.requests.length;
    const result = await client().ur.outcomes.report('req_anything', {
      verdict: 'unknown',
      source: 'verifier',
    });
    expect(result).toEqual({
      status: 'not_reported',
      requestId: 'req_anything',
      verdict: 'unknown',
      source: 'verifier',
      teaches: false,
      reason: 'verdict_unknown',
    });
    expect(gw.requests.length).toBe(before);
    // Type level: an unknown verdict resolves the not-reported shape, a self-rating never teaches.
    const narrowed: 'not_reported' = result.status;
    void narrowed;
  });

  it('types self_rating as never teaching', async () => {
    const ur = client();
    const requestId = await servedRequest(ur);
    const r = await ur.ur.outcomes.report(requestId, { verdict: 'pass', source: 'self_rating' });
    const teaches: false = r.teaches;
    expect(teaches).toBe(false);
    expect(r.result?.learning_use).toEqual(['rank']);
  });
});

describe('the derived identity', () => {
  it('is rpt_ + sha256 of the documented material (test vector)', () => {
    const material = 'ur-outcome-report/v1\nreq_01HZX\npass\nverifier\nsuite-a';
    const hex = createHash('sha256').update(material, 'utf8').digest('hex');
    expect(reportSourceEventId('req_01HZX', 'pass', 'verifier', 'suite-a')).toBe(`rpt_${hex}`);
    expect(reportSourceEventId('req_01HZX', 'pass', 'verifier')).toBe(
      `rpt_${createHash('sha256').update('ur-outcome-report/v1\nreq_01HZX\npass\nverifier\n').digest('hex')}`,
    );
  });

  it('is stable, and changes with every part', () => {
    const base = reportSourceEventId('req_1', 'pass', 'verifier', 'k');
    expect(reportSourceEventId('req_1', 'pass', 'verifier', 'k')).toBe(base);
    for (const other of [
      reportSourceEventId('req_2', 'pass', 'verifier', 'k'),
      reportSourceEventId('req_1', 'fail', 'verifier', 'k'),
      reportSourceEventId('req_1', 'pass', 'business_rule', 'k'),
      reportSourceEventId('req_1', 'pass', 'verifier', 'k2'),
      reportSourceEventId('req_1', 'pass', 'verifier'),
    ]) {
      expect(other).not.toBe(base);
    }
    expect(base).toMatch(/^rpt_[0-9a-f]{64}$/);
  });
});

describe('validation', () => {
  it('refuses malformed input before anything is queued or sent', async () => {
    const store = new MemoryOutcomeStore();
    let calls = 0;
    const ur = new UltraRouter({
      apiKey: 'k',
      baseURL: 'http://gw',
      outcomeStore: store,
      fetch: async () => {
        calls += 1;
        return Response.json({});
      },
    });
    const bad: [string, Record<string, unknown>][] = [
      ['', { verdict: 'pass', source: 'verifier' }],
      ['has space', { verdict: 'pass', source: 'verifier' }],
      ['req_1', { verdict: 'maybe', source: 'verifier' }],
      ['req_1', { verdict: 'pass', source: 'gut_feeling' }],
      ['req_1', { verdict: 'pass', source: 'verifier', idempotencyKey: '' }],
      ['req_1', { verdict: 'pass', source: 'verifier', observedAt: 'not a date' }],
    ];
    for (const [requestId, params] of bad) {
      await expect(ur.ur.outcomes.report(requestId, params as never)).rejects.toMatchObject({
        code: 'invalid_request',
        status: 0,
      });
    }
    expect(calls).toBe(0);
    expect(store.list()).toHaveLength(0);
  });

  it('normalizes observedAt and passes evidenceHash / supersedes through', () => {
    const plan = planOutcomeReport('req_1', {
      verdict: 'fail',
      source: 'human_review',
      observedAt: new Date('2026-03-04T05:06:07Z'),
      evidenceHash: 'sha256:abc',
      supersedes: 'rpt_earlier',
    });
    if (!plan.send) throw new Error('expected a send');
    expect(plan.event).toEqual({
      channel: 'correction',
      kind: 'rejected',
      source_event_id: reportSourceEventId('req_1', 'fail', 'human_review'),
      observed_at: '2026-03-04T05:06:07.000Z',
      evidence_hash: 'sha256:abc',
      supersedes_event_id: 'rpt_earlier',
    });
  });
});

describe('never double-reports', () => {
  it('acknowledgement loss + the transport retry: one receipt, the same key and bytes twice', async () => {
    const ur0 = client();
    const requestId = await servedRequest(ur0);
    const loss = ackLossFetch(1);
    const ur = client({ fetch: loss.fetch, maxRetries: 2 });
    const result = await ur.ur.outcomes.report(requestId, { verdict: 'pass', source: 'verifier' });
    expect(loss.dropped()).toBe(1);
    const posts = outcomePosts(requestId);
    expect(posts).toHaveLength(2);
    expect(posts[1]!.raw).toBe(posts[0]!.raw);
    expect(posts[1]!.headers['idempotency-key']).toBe(posts[0]!.headers['idempotency-key']);
    expect(result.status).toBe('delivered');
    if (result.status !== 'delivered') throw new Error('unreachable');
    expect(result.result?.status).toBe('duplicate');
    const receipts = receiptsFor(requestId);
    expect(receipts).toHaveLength(1);
    expect(result.receipt?.id).toBe(receipts[0]!.id);
  });

  it('acknowledgement loss with no transport retry: queued, then a repeat call replays the same event', async () => {
    const ur0 = client();
    const requestId = await servedRequest(ur0);
    const loss = ackLossFetch(1);
    const store = new MemoryOutcomeStore();
    const ur = client({ fetch: loss.fetch, outcomeStore: store });
    const first = await ur.ur.outcomes.report(requestId, { verdict: 'fail', source: 'verifier' });
    expect(first.status).toBe('queued');
    expect(store.list()).toHaveLength(1);
    const again = await ur.ur.outcomes.report(requestId, { verdict: 'fail', source: 'verifier' });
    expect(again.status).toBe('delivered');
    expect(store.list()).toHaveLength(0);
    if (again.status !== 'delivered') throw new Error('unreachable');
    expect(again.result?.status).toBe('duplicate');
    expect(again.entryId).toBe(first.entryId);
    const posts = outcomePosts(requestId);
    expect(new Set(posts.map((p) => p.raw)).size).toBe(1);
    expect(new Set(posts.map((p) => p.headers['idempotency-key'])).size).toBe(1);
    expect(receiptsFor(requestId)).toHaveLength(1);
  });

  it('acknowledgement loss, then flush(): the queued event is replayed verbatim once', async () => {
    const requestId = await servedRequest();
    const loss = ackLossFetch(1);
    const ur = client({ fetch: loss.fetch });
    expect(
      (await ur.ur.outcomes.report(requestId, { verdict: 'pass', source: 'webhook' })).status,
    ).toBe('queued');
    const flushed = await ur.ur.outcomes.flush();
    expect(flushed).toMatchObject({ delivered: 1, pending: 0 });
    expect(flushed.results[0]?.status).toBe('duplicate');
    expect(receiptsFor(requestId)).toHaveLength(1);
  });

  it('a repeated call after delivery replays the identical bytes (observed_at included)', async () => {
    const ur = client();
    const requestId = await servedRequest(ur);
    const a = await ur.ur.outcomes.report(requestId, { verdict: 'pass', source: 'business_rule' });
    const b = await ur.ur.outcomes.report(requestId, { verdict: 'pass', source: 'business_rule' });
    const posts = outcomePosts(requestId);
    expect(posts).toHaveLength(2);
    expect(posts[1]!.raw).toBe(posts[0]!.raw);
    if (a.status !== 'delivered' || b.status !== 'delivered') throw new Error('unreachable');
    expect(b.result?.status).toBe('duplicate');
    expect(b.receipt?.id).toBe(a.receipt?.id);
    expect(receiptsFor(requestId)).toHaveLength(1);
  });

  it('a new process with the same durable store replays the stored event, not a new one', async () => {
    const requestId = await servedRequest();
    const store = new MemoryOutcomeStore();
    const down = client({
      outcomeStore: store,
      fetch: async () => {
        throw new TypeError('fetch failed');
      },
    });
    const queued = await down.ur.outcomes.report(requestId, {
      verdict: 'pass',
      source: 'verifier',
    });
    expect(queued.status).toBe('queued');
    const storedEvent = store.list()[0]!.event;
    const restarted = client({ outcomeStore: store });
    const delivered = await restarted.ur.outcomes.report(requestId, {
      verdict: 'pass',
      source: 'verifier',
    });
    expect(delivered.status).toBe('delivered');
    expect(JSON.parse(outcomePosts(requestId).at(-1)!.raw)).toEqual(storedEvent);
    expect(receiptsFor(requestId)).toHaveLength(1);
  });

  it('a different payload under the same identity is refused as a conflict, never a second event', async () => {
    const ur = client();
    const requestId = await servedRequest(ur);
    await ur.ur.outcomes.report(requestId, {
      verdict: 'pass',
      source: 'verifier',
      observedAt: '2026-01-01T00:00:00Z',
    });
    const changed = await ur.ur.outcomes.report(requestId, {
      verdict: 'pass',
      source: 'verifier',
      observedAt: '2026-01-02T00:00:00Z',
    });
    expect(changed.status).toBe('rejected');
    expect(changed.error?.code).toBe('conflict');
    expect(receiptsFor(requestId)).toHaveLength(1);
  });

  it('concurrent repeats of one identity share one send', async () => {
    const ur = client();
    const requestId = await servedRequest(ur);
    const [a, b, c] = await Promise.all([
      ur.ur.outcomes.report(requestId, { verdict: 'pass', source: 'human_review' }),
      ur.ur.outcomes.report(requestId, { verdict: 'pass', source: 'human_review' }),
      ur.ur.outcomes.report(requestId, { verdict: 'pass', source: 'human_review' }),
    ]);
    expect(outcomePosts(requestId)).toHaveLength(1);
    expect(b).toEqual(a);
    expect(c).toEqual(a);
  });

  it('two independent verdicts need two keys (idempotencyKey), and then both count', async () => {
    const ur = client();
    const requestId = await servedRequest(ur);
    await ur.ur.outcomes.report(requestId, {
      verdict: 'pass',
      source: 'verifier',
      idempotencyKey: 'unit',
    });
    await ur.ur.outcomes.report(requestId, {
      verdict: 'pass',
      source: 'verifier',
      idempotencyKey: 'e2e',
    });
    expect(receiptsFor(requestId)).toHaveLength(2);
  });
});

describe('immediate reporting', () => {
  it('a report before the request lands is delivered as pending with a durable receipt', async () => {
    const ur = client();
    const res = await ur.chat.completions.create(
      { messages: [{ role: 'user', content: 'x' }] },
      { episodeKey: 'ep-immediate' },
    );
    const report = await ur.ur.outcomes.report(res.requestId, {
      verdict: 'pass',
      source: 'verifier',
    });
    if (report.status !== 'delivered') throw new Error(`expected delivered, got ${report.status}`);
    expect(report.result?.status).toBe('pending');
    expect(report.receipt).toMatchObject({ status: 'pending', request_id: res.requestId });
    const applied = await ur.ur.outcomes.waitForReceipt(report.receipt!.id, { pollIntervalMs: 1 });
    expect(applied).toMatchObject({
      status: 'applied',
      outcome_status: 'accepted',
      episode: { status: 'associated', verdict: 'recorded' },
    });
  });
});

describe('the gateway answers a report can get', () => {
  const envelope = (code: string, message: string, retryable: boolean) => ({
    error: { code, message, request_id: 'req_e', retryable },
  });

  it('an unknown gateway-minted request id is refused at once (404 request_not_found): rejected', async () => {
    const r = await client().ur.outcomes.report('req_01HZZZZZZZZZZZZZZZZZZZZZZZ', {
      verdict: 'pass',
      source: 'verifier',
    });
    expect(r.status).toBe('rejected');
    expect(r.error?.code).toBe('not_found');
    expect(r.error?.message).toMatch(/^request_not_found:/);
  });

  it('a client-minted id that never shows up expires on its receipt', async () => {
    const ur = client();
    const r = await ur.ur.outcomes.report('req_c_never_served', {
      verdict: 'pass',
      source: 'verifier',
    });
    expect(r.result?.status).toBe('pending');
    const final = await ur.ur.outcomes.waitForReceipt(r.receipt!.id, { pollIntervalMs: 1 });
    expect(final).toMatchObject({ status: 'expired', reason: 'request_not_found' });
  });

  it('the first teaching verdict of an episode is recorded; a later one keeps the earlier', async () => {
    const ur = client();
    const a = await ur.chat.completions.create(
      { messages: [{ role: 'user', content: 'step 1' }] },
      { episodeKey: 'ep-two-verdicts' },
    );
    const b = await ur.chat.completions.create(
      { messages: [{ role: 'user', content: 'step 2' }] },
      { episodeKey: 'ep-two-verdicts' },
    );
    const first = await ur.ur.outcomes.report(a.requestId, { verdict: 'pass', source: 'verifier' });
    const second = await ur.ur.outcomes.report(b.requestId, { verdict: 'fail', source: 'webhook' });
    const one = await ur.ur.outcomes.waitForReceipt(first.receipt!.id, { pollIntervalMs: 1 });
    const two = await ur.ur.outcomes.waitForReceipt(second.receipt!.id, { pollIntervalMs: 1 });
    expect(one.episode).toMatchObject({ status: 'associated', verdict: 'recorded' });
    expect(two.episode).toMatchObject({ status: 'associated', verdict: 'kept_earlier' });
    expect(one.episode.trace_id).toBe(two.episode.trace_id);
    const proxy = await ur.ur.outcomes.report(a.requestId, {
      verdict: 'pass',
      source: 'self_rating',
    });
    expect(proxy.receipt?.episode.status).toBe('not_applicable');
  });

  it('429 outcome_backlog_full and a 500 keep the event queued for a later flush', async () => {
    for (const [status, body, headers] of [
      [
        429,
        envelope('outcome_backlog_full', 'outcome_backlog_full: too many pending outcomes', true),
        { 'retry-after': '30' },
      ],
      [500, envelope('internal', 'apply failed; retry', false), {}],
    ] as const) {
      const store = new MemoryOutcomeStore();
      let calls = 0;
      const ur = new UltraRouter({
        apiKey: 'k',
        baseURL: 'http://gw',
        maxRetries: 0,
        outcomeStore: store,
        fetch: async () => {
          calls += 1;
          return Response.json(body, { status, headers });
        },
      });
      const r = await ur.ur.outcomes.report('req_1', { verdict: 'pass', source: 'verifier' });
      expect([r.status, r.error?.code, calls]).toEqual(['queued', body.error.code, 1]);
      expect(store.list()).toHaveLength(1);
    }
  });

  it('409 conflict (a different payload under the same key) drops the event as rejected', async () => {
    const store = new MemoryOutcomeStore();
    const ur = new UltraRouter({
      apiKey: 'k',
      baseURL: 'http://gw',
      maxRetries: 0,
      outcomeStore: store,
      fetch: async () =>
        Response.json(envelope('conflict', 'idempotency_conflict: different payload', false), {
          status: 409,
        }),
    });
    const r = await ur.ur.outcomes.report('req_1', { verdict: 'pass', source: 'verifier' });
    expect([r.status, r.error?.code]).toEqual(['rejected', 'conflict']);
    expect(store.list()).toHaveLength(0);
  });
});
