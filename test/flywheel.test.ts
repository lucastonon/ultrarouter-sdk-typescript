// — the outcome-ledger surface.
//
// Covers, against the in-process stub-gateway (a recording `fetch`), every method the SDK
// ships: ur.artifactTypes.upsert, ur.artifacts.create|get|list|final, ur.outcomes.record|batch|
// pending|flush, the recordOutcome alias, withArtifact(key, fn), the ur.artifact / ur.situation
// request options, the pure diffStats no-consent final path, and — the load-bearing one — the
// RETRY GUARANTEE: the whole event (observed_at + source_event_id + artifact_version) is persisted
// BEFORE the first send and replayed VERBATIM, so a retry is only ever a duplicate, never a conflict.
import { describe, expect, it, vi } from 'vitest';

import { UltraRouter } from '../src/client.js';
import { UltraRouterError } from '../src/errors.js';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  FileOutcomeStore,
  MemoryOutcomeStore,
  OutcomeQueue,
  type OutcomeStore,
  type QueuedOutcome,
} from '../src/flywheel-queue.js';
import type { OutcomeInput, OutcomeResult } from '../src/outcomes.js';
import type { FetchLike } from '../src/types.js';

interface Captured {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

/** A fetch that records EVERY call and replies via a router `(call, n) => Response`. */
function recorder(router: (call: Captured, n: number) => Response): {
  fetch: FetchLike;
  calls: Captured[];
} {
  const calls: Captured[] = [];
  const fetch: FetchLike = (url, init) => {
    const headers: Record<string, string> = {};
    const raw = init?.headers as Record<string, string> | undefined;
    if (raw) for (const [k, v] of Object.entries(raw)) headers[k.toLowerCase()] = v;
    const call: Captured = {
      url: String(url),
      method: init?.method ?? 'GET',
      headers,
      body: init?.body === undefined ? undefined : JSON.parse(String(init.body)),
    };
    calls.push(call);
    return Promise.resolve(router(call, calls.length));
  };
  return { fetch, calls };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function artifactFixture(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    object: 'artifact',
    id: 'art_1',
    key: 'thesis:acme',
    archetype: 'forecast',
    artifact_type_version_id: 'atv_1',
    call_type_id: null,
    situation_key: null,
    occurred_at: '2026-09-14T00:00:00Z',
    exposure_arm: 'pre_lever',
    exposure_epoch: 0,
    lifecycle: 'open',
    current_version: 1,
    request_ids: [],
    claims: [],
    created_at: '2026-09-14T00:00:00Z',
    updated_at: '2026-09-14T00:00:00Z',
    ...over,
  };
}

function outcomeResult(over: Partial<OutcomeResult> = {}): OutcomeResult {
  return {
    status: 'accepted',
    id: 'oev_1',
    source_event_id: 'evt_1',
    canonical_target_id: 'art_1',
    target_kind: 'artifact',
    artifact_version: 1,
    latency_class: 'instant',
    source: 'declared',
    learning_use: ['calibrate'],
    reason: null,
    ...over,
  };
}

const client = (fetch: FetchLike, opts: Record<string, unknown> = {}): UltraRouter =>
  new UltraRouter({ apiKey: 'ur_sk_test_flw', baseURL: 'http://gw', fetch, ...opts });

// ─────────────────────────────── artifact types ───────────────────────────────

describe('ur.artifactTypes.upsert', () => {
  it('POSTs the objective to /v1/artifact-types and unwraps the { artifact_type } envelope', async () => {
    const { fetch, calls } = recorder(() =>
      jsonResponse({
        artifact_type: {
          object: 'artifact_type',
          id: 'atv_1',
          name: 'thesis',
          archetype: 'forecast',
          version: 1,
          objective: {
            metric: 'claim_resolution',
            unit: 'boolean',
            direction: 'true_is_good',
            resolution_criteria: 'filing vs claim',
            source: 'analyst',
            window: 'P12M',
          },
          created_at: '2026-09-14T00:00:00Z',
        },
      }),
    );
    const ur = client(fetch);
    const at = await ur.ur.artifactTypes.upsert({
      name: 'thesis',
      archetype: 'forecast',
      objective: {
        metric: 'claim_resolution',
        unit: 'boolean',
        direction: 'true_is_good',
        resolution_criteria: 'filing vs claim',
        source: 'analyst',
        window: 'P12M',
      },
    });
    const call = calls[0]!;
    expect(call.method).toBe('POST');
    expect(call.url).toBe('http://gw/v1/artifact-types');
    expect((call.body as { name: string }).name).toBe('thesis');
    expect((call.body as { objective: { metric: string } }).objective.metric).toBe(
      'claim_resolution',
    );
    expect(at.object).toBe('artifact_type');
    expect(at.version).toBe(1);
  });
});

// ─────────────────────────────── artifacts ───────────────────────────────

describe('ur.artifacts.* ', () => {
  it('create upserts by key and unwraps { artifact }', async () => {
    const { fetch, calls } = recorder(() => jsonResponse({ artifact: artifactFixture() }, 201));
    const ur = client(fetch);
    const art = await ur.ur.artifacts.create({
      key: 'thesis:acme',
      archetype: 'forecast',
      artifact_type: 'thesis',
      request_ids: ['req_a', 'req_b'],
      claims: [{ key: 'eps_beat', claim_type: 'earnings_direction', stated_confidence: 0.7 }],
    });
    const call = calls[0]!;
    expect(call.method).toBe('POST');
    expect(call.url).toBe('http://gw/v1/artifacts');
    expect((call.body as { key: string }).key).toBe('thesis:acme');
    expect(art.id).toBe('art_1');
    expect(art.object).toBe('artifact');
  });

  it('get reads one artifact by id and unwraps { artifact }', async () => {
    const { fetch, calls } = recorder(() => jsonResponse({ artifact: artifactFixture() }));
    const ur = client(fetch);
    const art = await ur.ur.artifacts.get('art_1');
    expect(calls[0]!.method).toBe('GET');
    expect(calls[0]!.url).toBe('http://gw/v1/artifacts/art_1');
    expect(art.key).toBe('thesis:acme');
  });

  it('list keyset-paginates with filters (never OFFSET)', async () => {
    const { fetch, calls } = recorder(() =>
      jsonResponse({ object: 'list', data: [artifactFixture()], next_cursor: 'c2' }),
    );
    const ur = client(fetch);
    const page = await ur.ur.artifacts.list({
      archetype: 'forecast',
      key: 'thesis:acme',
      limit: 25,
    });
    expect(calls[0]!.method).toBe('GET');
    expect(calls[0]!.url).toContain('/v1/artifacts?');
    expect(calls[0]!.url).toContain('archetype=forecast');
    expect(calls[0]!.url).toContain('key=thesis%3Aacme');
    expect(calls[0]!.url).toContain('limit=25');
    expect(calls[0]!.url).not.toContain('offset');
    expect(page.next_cursor).toBe('c2');
  });

  it('final on the NO-CONSENT path sends client-computed diff_stats + final_hash (never a body)', async () => {
    const { diffStats } = await import('../src/diff-stats.js');
    const stats = diffStats('draft text here', 'final text here');
    const { fetch, calls } = recorder(() =>
      jsonResponse({
        object: 'artifact_version',
        id: 'av_2',
        artifact_id: 'art_1',
        version: 2,
        final_hash: stats.final_hash,
        diff_stats: stats,
        client_computed: true,
        stored: 'metadata_only',
        created_at: '2026-09-14T00:00:00Z',
      }),
    );
    const ur = client(fetch);
    const res = await ur.ur.artifacts.final('art_1', {
      diff_stats: stats,
      final_hash: stats.final_hash,
    });
    const call = calls[0]!;
    expect(call.method).toBe('POST');
    expect(call.url).toBe('http://gw/v1/artifacts/art_1/final');
    // The no-consent path carries NO `final`/`draft` body — stats + hash only.
    expect((call.body as Record<string, unknown>).final).toBeUndefined();
    expect((call.body as Record<string, unknown>).draft).toBeUndefined();
    expect((call.body as { final_hash: string }).final_hash).toBe(stats.final_hash);
    expect(res.client_computed).toBe(true);
    expect(res.stored).toBe('metadata_only');
  });
});

// ─────────────────────────────── outcomes ───────────────────────────────

describe('ur.outcomes.*', () => {
  it('record posts { outcomes: [event] } to the artifact route with observed_at + source_event_id fixed', async () => {
    const { fetch, calls } = recorder(() =>
      jsonResponse({ object: 'list', data: [outcomeResult()] }, 202),
    );
    const ur = client(fetch);
    const receipt = await ur.ur.outcomes.record('art_1', {
      channel: 'behavioral',
      kind: 'accepted',
    });
    const call = calls[0]!;
    expect(call.method).toBe('POST');
    expect(call.url).toBe('http://gw/v1/artifacts/art_1/outcomes');
    const sent = (call.body as { outcomes: OutcomeInput[] }).outcomes[0]!;
    expect(sent.channel).toBe('behavioral');
    expect(sent.kind).toBe('accepted');
    // The SDK FIXES these at enqueue (the retry guarantee) — they are present on the wire.
    expect(typeof sent.observed_at).toBe('string');
    expect(typeof sent.source_event_id).toBe('string');
    // Provenance is the server's — the SDK never sends source/producer/learning_use.
    expect((sent as Record<string, unknown>).source).toBeUndefined();
    expect((sent as Record<string, unknown>).producer).toBeUndefined();
    expect((sent as Record<string, unknown>).learning_use).toBeUndefined();
    expect(receipt.status).toBe('delivered');
    if (receipt.status === 'delivered') expect(receipt.result.status).toBe('accepted');
  });

  it('record with a { request } target uses the bare request-shortcut route', async () => {
    const { fetch, calls } = recorder(() => jsonResponse(outcomeResult(), 202));
    const ur = client(fetch);
    await ur.ur.outcomes.record(
      { request: 'req_9' },
      { channel: 'resolution', kind: 'resolved_true' },
    );
    const call = calls[0]!;
    expect(call.url).toBe('http://gw/v1/requests/req_9/outcomes');
    // The request shortcut takes a BARE event (not wrapped in { outcomes: [...] }).
    expect((call.body as { channel: string }).channel).toBe('resolution');
    expect((call.body as Record<string, unknown>).outcomes).toBeUndefined();
  });

  it('recordOutcome is a thin alias of ur.outcomes.record', async () => {
    const { fetch, calls } = recorder(() =>
      jsonResponse({ object: 'list', data: [outcomeResult()] }, 202),
    );
    const ur = client(fetch);
    await ur.recordOutcome('art_1', { channel: 'behavioral', kind: 'accepted' });
    expect(calls[0]!.url).toBe('http://gw/v1/artifacts/art_1/outcomes');
  });

  it('batch posts ≤ 1,000 events keyed by target and returns the verdict rollup', async () => {
    const { fetch, calls } = recorder(() =>
      jsonResponse({
        object: 'list',
        data: [{ ...outcomeResult(), key: 'req_1' }],
        accepted: 1,
        duplicate: 0,
        conflict: 0,
        rejected: 0,
      }),
    );
    const ur = client(fetch);
    const res = await ur.ur.outcomes.batch([
      { request_id: 'req_1', channel: 'behavioral', kind: 'accepted' },
    ]);
    expect(calls[0]!.url).toBe('http://gw/v1/outcomes/batch');
    expect((calls[0]!.body as { outcomes: unknown[] }).outcomes).toHaveLength(1);
    expect(res.accepted).toBe(1);
  });

  it('pending lists claims awaiting resolution with keyset filters', async () => {
    const { fetch, calls } = recorder(() =>
      jsonResponse({ object: 'list', data: [], next_cursor: null }),
    );
    const ur = client(fetch);
    await ur.ur.outcomes.pending({ state: 'overdue', archetype: 'forecast' });
    expect(calls[0]!.method).toBe('GET');
    expect(calls[0]!.url).toContain('/v1/outcomes/pending?');
    expect(calls[0]!.url).toContain('state=overdue');
    expect(calls[0]!.url).toContain('archetype=forecast');
  });
});

// ─────────────────────────────── RETRY GUARANTEE ───────────────────────────────

describe('the durable outcome queue + retry guarantee', () => {
  /** A store that logs the ORDER of every operation, so we can prove persist-before-send. */
  function orderedStore(log: string[]): OutcomeStore {
    const inner = new MemoryOutcomeStore();
    return {
      append: (e) => {
        log.push(`append:${e.id}`);
        inner.append(e);
      },
      update: (e) => {
        log.push(`update:${e.id}`);
        inner.update(e);
      },
      remove: (id) => {
        log.push(`remove:${id}`);
        inner.remove(id);
      },
      list: () => inner.list(),
    };
  }

  it('persists the WHOLE event BEFORE the first send, and a retry replays it VERBATIM (duplicate, never conflict)', async () => {
    const log: string[] = [];
    const store = orderedStore(log);
    const sent: QueuedOutcome['event'][] = [];
    let ids = 0;
    let first = true;
    const queue = new OutcomeQueue({
      store,
      now: () => Date.parse('2026-09-14T12:00:00Z'),
      genId: () => `gen-${String(ids++)}`,
      send: (entry) => {
        // Every attempt sends the SAME stored event object — the send log captures it.
        sent.push(entry.event);
        if (first) {
          first = false;
          // A retryable failure AFTER the server would have recorded it: the classic
          // "inserted, response lost" case the retry guarantee exists for.
          return Promise.reject(
            new UltraRouterError({
              code: 'connection',
              message: 'reset',
              status: 0,
              retryable: true,
            }),
          );
        }
        return Promise.resolve(outcomeResult({ status: 'duplicate' }));
      },
    });

    const receipt = await queue.enqueue(
      { artifact: 'art_1' },
      // Caller pins artifact_version — it MUST survive verbatim across the retry.
      { channel: 'resolution', kind: 'resolved_true', artifact_version: 3 },
    );

    // 1) persist-before-send: the append is logged before the first send touched the wire.
    expect(log[0]).toBe('append:gen-1'); // gen-0 = source_event_id, gen-1 = entry id
    expect(sent).toHaveLength(1);
    // 2) the first attempt failed retryably ⇒ the event stays durably queued.
    expect(receipt.status).toBe('queued');
    expect(await queue.size()).toBe(1);

    // 3) flush replays the SAME event VERBATIM — byte-identical, no re-derivation.
    const report = await queue.flush();
    expect(sent).toHaveLength(2);
    expect(sent[1]).toEqual(sent[0]); // deep-equal: observed_at + source_event_id + artifact_version identical
    expect(sent[1]!.observed_at).toBe('2026-09-14T12:00:00.000Z');
    expect(sent[1]!.source_event_id).toBe('gen-0');
    expect(sent[1]!.artifact_version).toBe(3);
    // 4) because the payload was identical, the server saw a DUPLICATE (never a conflict).
    expect(report.delivered).toBe(1);
    expect(report.results[0]!.status).toBe('duplicate');
    expect(report.pending).toBe(0);
    expect(await queue.size()).toBe(0);
  });

  it('a caller-supplied observed_at / source_event_id is preserved (never overwritten)', async () => {
    const sent: QueuedOutcome['event'][] = [];
    const queue = new OutcomeQueue({
      store: new MemoryOutcomeStore(),
      send: (entry) => {
        sent.push(entry.event);
        return Promise.resolve(outcomeResult());
      },
    });
    await queue.enqueue(
      { artifact: 'art_1' },
      {
        channel: 'resolution',
        kind: 'resolved_true',
        observed_at: '2027-01-30T00:00:00Z',
        source_event_id: 'filing:Q4',
      },
    );
    expect(sent[0]!.observed_at).toBe('2027-01-30T00:00:00Z');
    expect(sent[0]!.source_event_id).toBe('filing:Q4');
  });

  it('a terminal (non-retryable) rejection drops the entry and never re-queues it', async () => {
    const queue = new OutcomeQueue({
      store: new MemoryOutcomeStore(),
      send: () =>
        Promise.reject(
          new UltraRouterError({
            code: 'invalid_request',
            message: 'bad',
            status: 400,
            retryable: false,
            // A definitive refusal carries the well-formed gateway envelope it was decoded from.
            envelope: {
              code: 'invalid_request',
              message: 'bad',
              request_id: 'req_1',
              retryable: false,
            },
          }),
        ),
    });
    const receipt = await queue.enqueue(
      { artifact: 'art_1' },
      { channel: 'behavioral', kind: 'accepted' },
    );
    expect(receipt.status).toBe('rejected');
    expect(await queue.size()).toBe(0);
  });

  it('FileOutcomeStore gives CROSS-RESTART durability (persist → new store on the same file → replay)', async () => {
    const path = join(mkdtempSync(join(tmpdir(), 'ur-flw-')), 'queue.json');
    // Session 1: a failing send leaves the finalized event persisted on disk.
    const q1 = new OutcomeQueue({
      store: new FileOutcomeStore(path),
      send: () =>
        Promise.reject(
          new UltraRouterError({ code: 'connection', message: 'x', status: 0, retryable: true }),
        ),
    });
    const r1 = await q1.enqueue(
      { artifact: 'art_x' },
      { channel: 'resolution', kind: 'resolved_true', artifact_version: 9 },
    );
    expect(r1.status).toBe('queued');

    // Session 2: a FRESH store on the SAME file (a process restart) loads the event + replays it.
    let replayed: QueuedOutcome['event'] | undefined;
    const q2 = new OutcomeQueue({
      store: new FileOutcomeStore(path),
      send: (entry) => {
        replayed = entry.event;
        return Promise.resolve(outcomeResult({ status: 'duplicate' }));
      },
    });
    expect(await q2.size()).toBe(1);
    const report = await q2.flush();
    expect(report.delivered).toBe(1);
    expect(replayed?.artifact_version).toBe(9);
    expect(typeof replayed?.source_event_id).toBe('string');
    expect(await q2.size()).toBe(0);
  });

  it('never logs the outcome event', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const queue = new OutcomeQueue({
      store: new MemoryOutcomeStore(),
      send: () => Promise.resolve(outcomeResult()),
    });
    await queue.enqueue({ artifact: 'art_1' }, { channel: 'behavioral', kind: 'accepted' });
    await queue.flush();
    expect(spy).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
    spy.mockRestore();
    warn.mockRestore();
    errorSpy.mockRestore();
  });
});

// ─────────────────────────────── request options + withArtifact ───────────────────────────────

describe('ur.artifact / ur.situation request options ', () => {
  it('a chat request carries ur.artifact + ur.situation verbatim', async () => {
    const { fetch, calls } = recorder(() =>
      jsonResponse({
        id: 'c',
        object: 'chat.completion',
        created: 1,
        model: 'm',
        choices: [
          { index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' },
        ],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        ur: {
          request_id: 'req_1',
          call_type: null,
          model_served: 'm',
          provider: 'openai',
          routing: { mode: 'off', fallback_used: false },
          compression: { applied: 'off' },
          cost_usd: 0,
          byok: false,
        },
      }),
    );
    const ur = client(fetch);
    await ur.chat.completions.create({
      model: 'm',
      messages: [{ role: 'user', content: 'hi' }],
      ur: { artifact: 'thesis:acme', situation: { region: 'us', tier: 'pro' } },
    });
    const body = calls[0]!.body as { ur: { artifact: string; situation: Record<string, unknown> } };
    expect(body.ur.artifact).toBe('thesis:acme');
    expect(body.ur.situation).toEqual({ region: 'us', tier: 'pro' });
  });
});

describe('withArtifact(key, fn)', () => {
  it('binds ur.artifact on every call, targets record at the artifact, and FLUSHES at the end', async () => {
    const { fetch, calls } = recorder((call) => {
      if (call.url.endsWith('/v1/artifacts') && call.method === 'POST') {
        return jsonResponse({ artifact: artifactFixture({ id: 'art_boo', key: 'boo' }) }, 201);
      }
      if (call.url.endsWith('/outcomes')) {
        return jsonResponse(
          { object: 'list', data: [outcomeResult({ canonical_target_id: 'art_boo' })] },
          202,
        );
      }
      // chat
      return jsonResponse({
        id: 'c',
        object: 'chat.completion',
        created: 1,
        model: 'm',
        choices: [
          { index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' },
        ],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        ur: {
          request_id: 'req_1',
          call_type: null,
          model_served: 'm',
          provider: 'openai',
          routing: { mode: 'off', fallback_used: false },
          compression: { applied: 'off' },
          cost_usd: 0,
          byok: false,
        },
      });
    });
    const ur = client(fetch);
    let scopeKey = '';
    await ur.withArtifact('boo', async (scope) => {
      scopeKey = scope.key;
      await scope.chat.completions.create({
        model: 'm',
        messages: [{ role: 'user', content: 'hi' }],
      });
      await scope.record({ channel: 'behavioral', kind: 'accepted' });
    });
    expect(scopeKey).toBe('boo');
    // The chat call carried ur.artifact = the scope key.
    const chatCall = calls.find((c) => c.url.endsWith('/v1/chat/completions'))!;
    expect((chatCall.body as { ur: { artifact: string } }).ur.artifact).toBe('boo');
    // The outcome landed on the upsert-resolved artifact id (art_boo), and was delivered by the
    // end-of-scope flush (the queue is empty afterward).
    const outcomeCall = calls.find((c) => c.url.endsWith('/outcomes'))!;
    expect(outcomeCall.url).toBe('http://gw/v1/artifacts/art_boo/outcomes');
  });

  it('flushes even when fn throws (never lose a durably-queued outcome)', async () => {
    let outcomePosts = 0;
    const { fetch } = recorder((call) => {
      if (call.url.endsWith('/v1/artifacts') && call.method === 'POST') {
        return jsonResponse({ artifact: artifactFixture({ id: 'art_z', key: 'z' }) }, 201);
      }
      if (call.url.endsWith('/outcomes')) {
        outcomePosts += 1;
        return jsonResponse({ object: 'list', data: [outcomeResult()] }, 202);
      }
      return jsonResponse({}, 200);
    });
    const ur = client(fetch);
    await expect(
      ur.withArtifact('z', async (scope) => {
        await scope.record({ channel: 'behavioral', kind: 'accepted' });
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    // The record's enqueue already delivered it; the finally-flush found nothing left. Either
    // way the outcome reached the server exactly once.
    expect(outcomePosts).toBe(1);
  });
});

// ─────────────────────────────── flywheel status + calibration ───────────────────────────────

function flywheelStatusFixture(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    object: 'flywheel_status',
    workspace_id: 'ws_1',
    usage: {
      period: '2026-09-01',
      tracked_artifacts: 4,
      accepted_outcomes: 3,
      analysis_units: {
        reserved: 0,
        settled: 0,
        monthly_cap: null,
        lifetime_used: 0,
        lifetime_cap: null,
      },
      evaluation_compute_usd: { reserved_micro_usd: 0, settled_micro_usd: 0, cap_micro_usd: 0 },
      actual_cogs: { analysis_micro_usd: 0, failed_attempt_micro_usd: 0 },
      storage: {
        retained_payload_bytes: 0,
        retained_payload_bytes_cap: null,
        ledger_index_bytes: 0,
        ledger_index_bytes_cap: null,
        paused: false,
      },
      metadata_artifacts_monthly_cap: null,
      overage_paused: true,
    },
    channels: [
      { channel: 'behavioral', accepted_outcomes: 3, last_observed_at: '2026-09-14T00:00:00Z' },
    ],
    imports: {
      total: 1,
      completed: 1,
      running: 0,
      failed: 0,
      last_import_at: '2026-09-14T00:00:00Z',
    },
    learning: {
      flywheel_class: 'unavailable',
      flywheel_class_reason: 'collecting',
      active_levers: [],
      calibration_available: false,
    },
    ...over,
  };
}

describe('ur.flywheel.status | calibration', () => {
  it('status() GETs /v1/flywheel/status and returns usage + integration health', async () => {
    const { fetch, calls } = recorder(() => jsonResponse(flywheelStatusFixture()));
    const ur = client(fetch);
    const status = await ur.ur.flywheel.status();
    expect(calls).toHaveLength(1);
    expect(calls[0]!.method).toBe('GET');
    expect(calls[0]!.url).toBe('http://gw/v1/flywheel/status');
    expect(status.object).toBe('flywheel_status');
    expect(status.workspace_id).toBe('ws_1');
    expect(status.usage.period).toBe('2026-09-01');
    expect(status.channels).toHaveLength(1);
    expect(status.imports.total).toBe(1);
  });

  it('calibration() reads the SAME /v1/flywheel/status route and surfaces the learning block (invents no calibration route, fabricates no track record)', async () => {
    const { fetch, calls } = recorder(() => jsonResponse(flywheelStatusFixture()));
    const ur = client(fetch);
    const cal = await ur.ur.flywheel.calibration();
    // The SDK maps calibration onto the ONE existing status route — never a fabricated /v1/flywheel/calibration.
    expect(calls).toHaveLength(1);
    expect(calls[0]!.method).toBe('GET');
    expect(calls[0]!.url).toBe('http://gw/v1/flywheel/status');
    // The honest availability the server declares: unavailable / collecting, no lift.
    expect(cal.calibration_available).toBe(false);
    expect(cal.flywheel_class).toBe('unavailable');
    expect(cal.flywheel_class_reason).toBe('collecting');
    expect(cal.active_levers).toEqual([]);
  });
});

// ─────────────────────────────── history imports ───────────────────────────────

function importFixture(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    object: 'import',
    id: 'imp_1',
    format: 'usage_summary',
    format_version: '1',
    import_class: 'usage_only',
    status: 'completed',
    key_mode: 'test',
    corrections_consent: false,
    record_count: 2,
    accepted_count: 2,
    duplicate_count: 0,
    rejected_count: 0,
    unsupported_count: 0,
    report: {
      format: 'usage_summary',
      format_version: '1',
      import_class: 'usage_only',
      class_truth: 'usage-only summaries: no prompt, output, quality figure or replayable case.',
      record_count: 2,
      accepted: 2,
      duplicate: 0,
      rejected: 0,
      unsupported: 0,
      redacted: 0,
      missing_lineage: 0,
      bodies_stored: 0,
      reasons: {},
      unsupported_fields: [],
      parse_errors: [],
      replayable: false,
      usage_exposure: [
        {
          model: 'openai/gpt-5.2-mini',
          requests: 2,
          input_tokens: 10,
          output_tokens: 5,
          cost_micro_usd: 1000,
        },
      ],
      spend_micro_usd: 1000,
    },
    created_at: '2026-09-14T00:00:00Z',
    updated_at: '2026-09-14T00:00:00Z',
    ...over,
  };
}

describe('ur.imports.*', () => {
  it('create POSTs to /v1/imports and unwraps the { import } envelope', async () => {
    const { fetch, calls } = recorder(() => jsonResponse({ import: importFixture() }));
    const ur = client(fetch);
    const imp = await ur.ur.imports.create({
      format: 'usage_summary',
      mode: 'commit',
      records: [
        {
          model: 'openai/gpt-5.2-mini',
          requests: 2,
          input_tokens: 10,
          output_tokens: 5,
          cost_micro_usd: 1000,
        },
      ],
    });
    expect(calls[0]!.method).toBe('POST');
    expect(calls[0]!.url).toBe('http://gw/v1/imports');
    expect((calls[0]!.body as { format: string }).format).toBe('usage_summary');
    expect((calls[0]!.body as { mode: string }).mode).toBe('commit');
    expect(imp.object).toBe('import');
    expect(imp.id).toBe('imp_1');
    expect(imp.report.replayable).toBe(false);
  });

  it('preview mode carries mode=preview (nothing stored server-side)', async () => {
    const { fetch, calls } = recorder(() =>
      jsonResponse({ import: importFixture({ status: 'preview' }) }),
    );
    const ur = client(fetch);
    const imp = await ur.ur.imports.create({
      format: 'usage_summary',
      mode: 'preview',
      records: [],
    });
    expect((calls[0]!.body as { mode: string }).mode).toBe('preview');
    expect(imp.status).toBe('preview');
  });

  it('get / list / cancel hit the right routes and unwrap the envelope', async () => {
    const { fetch, calls } = recorder((call) => {
      if (call.method === 'GET' && /\/v1\/imports(\?|$)/.test(call.url)) {
        return jsonResponse({ object: 'list', data: [importFixture()], next_cursor: null });
      }
      if (call.url.endsWith('/cancel')) {
        return jsonResponse({ import: importFixture({ status: 'cancelled' }) });
      }
      return jsonResponse({ import: importFixture() });
    });
    const ur = client(fetch);

    const got = await ur.ur.imports.get('imp_1');
    expect(calls[0]!.url).toBe('http://gw/v1/imports/imp_1');
    expect(got.id).toBe('imp_1');

    const page = await ur.ur.imports.list({ limit: 25 });
    expect(calls[1]!.url).toBe('http://gw/v1/imports?limit=25');
    expect(page.object).toBe('list');
    expect(page.data).toHaveLength(1);

    const cancelled = await ur.ur.imports.cancel('imp_1');
    expect(calls[2]!.method).toBe('POST');
    expect(calls[2]!.url).toBe('http://gw/v1/imports/imp_1/cancel');
    expect(cancelled.status).toBe('cancelled');
  });
});

// ─────────────────────────────── ur.manifest request option ───────────────────────────────

describe('ur.manifest request option', () => {
  it('a chat request carries ur.manifest verbatim (the toWire shape the gateway witnesses)', async () => {
    const manifest = {
      scaffold_hash: 'sc_1',
      manifest_hash: 'mf_1',
      envelope_hash: 'ev_1',
      entries: [
        {
          kind: 'system_sop',
          slot: 'instruction',
          trust_class: 'authoritative',
          memory_class: 'core',
          content_hash: 'sha256:abc',
          mandatory: true,
          order: 0,
          range: { message_index: 0, start: 0, end: 5 },
        },
      ],
    };
    const { fetch, calls } = recorder(() =>
      jsonResponse({
        id: 'c',
        object: 'chat.completion',
        created: 1,
        model: 'm',
        choices: [
          { index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' },
        ],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        ur: {
          request_id: 'req_1',
          call_type: null,
          model_served: 'm',
          provider: 'openai',
          routing: { mode: 'off', fallback_used: false },
          compression: { applied: 'off' },
          cost_usd: 0,
          byok: false,
        },
      }),
    );
    const ur = client(fetch);
    await ur.chat.completions.create({
      model: 'm',
      messages: [{ role: 'user', content: 'hello' }],
      ur: { manifest },
    });
    const body = calls[0]!.body as { ur: { manifest: typeof manifest } };
    expect(body.ur.manifest).toEqual(manifest);
  });
});

// ─────────────────────────────── bounded experiments (run surface) ───────────────────────────────

function enrolledExecutionFixture(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    object: 'flywheel_experiment_execution',
    execution_id: 'fxe_1',
    experiment_id: 'fxp_1',
    phase: 'screen',
    pair_key: 'idea-a',
    slot: 0,
    arm: 'treated',
    candidate_hash: 'cand_1',
    assignment_version: 'asg_1',
    created: true,
    created_at: '2026-09-14T00:00:00Z',
    ...over,
  };
}

function outcomeCostFixture(): Record<string, unknown> {
  return {
    rows_measured_micro_usd: 0,
    rows_unpriced: 0,
    rows_unpriced_unresolved: 0,
    rows: 1,
    holds: 0,
    settled_micro_usd: 0,
    ambiguous_micro_usd: 0,
    reserved_micro_usd: 0,
    difference_micro_usd: 0,
    unexplained_micro_usd: 0,
    holds_reconciled: 0,
    holds_released_after_dispatch: 0,
    unlanded_holds: 0,
    rowless_resolved_holds: 0,
    complete: true,
  };
}

function recordedOutcomeFixture(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    object: 'flywheel_experiment_execution_outcome',
    experiment_id: 'fxp_1',
    execution_id: 'fxe_1',
    status: 'complete',
    created: true,
    outcome_hash: 'oh_1',
    trusted_recorded: [],
    missing_request_ids: [],
    cost: outcomeCostFixture(),
    experiment_state: 'screening',
    ...over,
  };
}

function dryRunOutcomeFixture(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    object: 'flywheel_experiment_execution_outcome_dry_run',
    experiment_id: 'fxp_1',
    execution_id: 'fxe_1',
    status: 'complete',
    refusal: null,
    detail: null,
    recorded_outcome: 'none',
    outcome_hash: 'oh_1',
    trusted_recorded: [],
    missing_request_ids: [],
    unlisted_request_ids: [],
    open_holds: [],
    ...over,
  };
}

const sampleOutcomeParams = {
  terminal: 'delivered' as const,
  reason_codes: [],
  reason_vocab: 'rv_1',
  receipts: [
    {
      ordinal: 0,
      stage: 'writer',
      call_type: 'ct_writer',
      request_id: 'req_1',
      extractor_version: 'ex_1',
      numbers: { post_length: 120 },
    },
  ],
  final_content_hash: 'fch_1',
  request_ids: ['req_1'],
};

function gatewayError(code: string, message: string, status: number): Response {
  return jsonResponse(
    { error: { code, message, request_id: 'req_err', retryable: false } },
    status,
  );
}

describe('ur.flywheel.experiments.* (bounded-experiment run surface)', () => {
  it('enrol POSTs { phase, pair_key, slot } and returns the gateway-decided arm', async () => {
    const { fetch, calls } = recorder(() => jsonResponse(enrolledExecutionFixture()));
    const ur = client(fetch);
    const execution = await ur.ur.flywheel.experiments.enrol('fxp_1', {
      phase: 'screen',
      pair_key: 'idea-a',
      slot: 0,
    });
    const call = calls[0]!;
    expect(call.method).toBe('POST');
    expect(call.url).toBe('http://gw/v1/flywheel/experiments/fxp_1/executions');
    expect(call.headers.authorization).toBe('Bearer ur_sk_test_flw');
    expect(call.body).toEqual({ phase: 'screen', pair_key: 'idea-a', slot: 0 });
    // The arm is the gateway's — the SDK never sends or chooses it.
    expect((call.body as Record<string, unknown>).arm).toBeUndefined();
    expect(execution.arm).toBe('treated');
    expect(execution.execution_id).toBe('fxe_1');
    expect(execution.created).toBe(true);
  });

  it('outcome records the terminal outcome (no dry_run query) and returns the recorded shape', async () => {
    const { fetch, calls } = recorder(() => jsonResponse(recordedOutcomeFixture()));
    const ur = client(fetch);
    const result = await ur.ur.flywheel.experiments.outcome('fxp_1', 'fxe_1', sampleOutcomeParams);
    const call = calls[0]!;
    expect(call.method).toBe('POST');
    expect(call.url).toBe('http://gw/v1/flywheel/experiments/fxp_1/executions/fxe_1/outcome');
    expect(call.url).not.toContain('dry_run');
    expect((call.body as { terminal: string }).terminal).toBe('delivered');
    expect(result.object).toBe('flywheel_experiment_execution_outcome');
    expect(result.status).toBe('complete');
    expect(result.cost.complete).toBe(true);
  });

  it('outcome with dryRun sends ?dry_run=true and returns the dry-run shape', async () => {
    const { fetch, calls } = recorder(() => jsonResponse(dryRunOutcomeFixture()));
    const ur = client(fetch);
    const result = await ur.ur.flywheel.experiments.outcome('fxp_1', 'fxe_1', sampleOutcomeParams, {
      dryRun: true,
    });
    const call = calls[0]!;
    expect(call.url).toBe(
      'http://gw/v1/flywheel/experiments/fxp_1/executions/fxe_1/outcome?dry_run=true',
    );
    // The dry-run flag is a query parameter, never leaked into the body.
    expect((call.body as Record<string, unknown>).dryRun).toBeUndefined();
    expect((call.body as Record<string, unknown>).dry_run).toBeUndefined();
    expect(result.object).toBe('flywheel_experiment_execution_outcome_dry_run');
    expect(result.recorded_outcome).toBe('none');
    expect(result.refusal).toBeNull();
    expect(result.open_holds).toEqual([]);
  });

  it('evaluateScreen and evaluateTest POST to their routes with no body', async () => {
    const { fetch, calls } = recorder((call) =>
      jsonResponse(
        call.url.endsWith('/screen/evaluate')
          ? {
              object: 'flywheel_experiment_screen_evaluation',
              experiment_id: 'fxp_1',
              computed: false,
              experiment_state: 'screening',
              screen: { progress: {}, executions: [] },
            }
          : {
              object: 'flywheel_experiment_test_evaluation',
              experiment_id: 'fxp_1',
              computed: false,
              experiment_state: 'test_open',
              test: { progress: {}, executions: [] },
            },
      ),
    );
    const ur = client(fetch);
    const screen = await ur.ur.flywheel.experiments.evaluateScreen('fxp_1');
    expect(calls[0]!.method).toBe('POST');
    expect(calls[0]!.url).toBe('http://gw/v1/flywheel/experiments/fxp_1/screen/evaluate');
    expect(calls[0]!.body).toBeUndefined();
    expect(screen.object).toBe('flywheel_experiment_screen_evaluation');

    const test = await ur.ur.flywheel.experiments.evaluateTest('fxp_1');
    expect(calls[1]!.url).toBe('http://gw/v1/flywheel/experiments/fxp_1/test/evaluate');
    expect(calls[1]!.body).toBeUndefined();
    expect(test.object).toBe('flywheel_experiment_test_evaluation');
  });

  it('surfaces a named refusal with its code on every run method (never swallowed)', async () => {
    // enrol → experiment_not_live
    const enrol = client(
      recorder(() => gatewayError('conflict', 'experiment_not_live', 409)).fetch,
    );
    const enrolErr = await enrol.ur.flywheel.experiments
      .enrol('fxp_1', { phase: 'screen', pair_key: 'p', slot: 0 })
      .catch((e: unknown) => e);
    expect(enrolErr).toBeInstanceOf(UltraRouterError);
    expect((enrolErr as UltraRouterError).code).toBe('conflict');
    expect((enrolErr as UltraRouterError).message).toContain('experiment_not_live');

    // outcome → outcome_conflict
    const outcome = client(
      recorder(() =>
        gatewayError('conflict', 'outcome_conflict: a different outcome is recorded', 409),
      ).fetch,
    );
    const outcomeErr = await outcome.ur.flywheel.experiments
      .outcome('fxp_1', 'fxe_1', sampleOutcomeParams)
      .catch((e: unknown) => e);
    expect(outcomeErr).toBeInstanceOf(UltraRouterError);
    expect((outcomeErr as UltraRouterError).code).toBe('conflict');
    expect((outcomeErr as UltraRouterError).message).toContain('outcome_conflict');

    // a dry run of an unknown execution → the named refusal reaches the caller too
    const dry = client(recorder(() => gatewayError('not_found', 'execution_unknown', 404)).fetch);
    const dryErr = await dry.ur.flywheel.experiments
      .outcome('fxp_1', 'fxe_missing', sampleOutcomeParams, { dryRun: true })
      .catch((e: unknown) => e);
    expect((dryErr as UltraRouterError).code).toBe('not_found');
    expect((dryErr as UltraRouterError).message).toContain('execution_unknown');

    // evaluateScreen / evaluateTest → experiment_not_found
    const screen = client(
      recorder(() => gatewayError('not_found', 'experiment_not_found', 404)).fetch,
    );
    const screenErr = await screen.ur.flywheel.experiments
      .evaluateScreen('fxp_missing')
      .catch((e: unknown) => e);
    expect((screenErr as UltraRouterError).code).toBe('not_found');
    expect((screenErr as UltraRouterError).message).toContain('experiment_not_found');

    const testClient = client(
      recorder(() => gatewayError('not_found', 'experiment_not_found', 404)).fetch,
    );
    const testErr = await testClient.ur.flywheel.experiments
      .evaluateTest('fxp_missing')
      .catch((e: unknown) => e);
    expect((testErr as UltraRouterError).code).toBe('not_found');
    expect((testErr as UltraRouterError).message).toContain('experiment_not_found');
  });
});
