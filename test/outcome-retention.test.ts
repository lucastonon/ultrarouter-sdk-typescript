// Durable outcome queue retention: only a DEFINITIVE refusal of the event drops it — a well-formed
// gateway envelope with a non-retryable, event-specific taxonomy code at its canonical 4xx status. A
// timeout (the SDK's own deadline included), a cancellation, a connection failure, any 401/403/408/429
// (whatever its body, code or flag), a 5xx, an answer without the envelope (an HTML 400 from a proxy),
// an unreadable answer or a malformed success keeps the IDENTICAL event queued, replayed later with the
// same identity and the same Idempotency-Key — including after a process restart. A file store that
// cannot be read is never treated as empty and never overwritten.
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { UltraRouter } from '../src/client.js';
import { errorFromResponse, UltraRouterError } from '../src/errors.js';
import {
  FileOutcomeStore,
  isDefinitiveRejection,
  MemoryOutcomeStore,
  OutcomeQueue,
  OutcomeStoreError,
  type QueuedOutcome,
} from '../src/flywheel-queue.js';
import {
  ReviewerQueue,
  reviewerVerdictAction,
  type QueuedReviewerEvent,
  type ReviewerEvent,
} from '../src/reviewer.js';
import type { FetchLike } from '../src/types.js';

const RESULT = {
  status: 'accepted',
  outcome_event_id: 'oe_1',
  source_event_id: 'x',
};

function err(code: string, status: number, retryable: boolean): UltraRouterError {
  return new UltraRouterError({ code, message: code, status, retryable });
}

function failingQueue(error: UltraRouterError): OutcomeQueue {
  return new OutcomeQueue({ store: new MemoryOutcomeStore(), send: () => Promise.reject(error) });
}

/** The error the transport builds from a well-formed gateway envelope at `status`. */
function decoded(code: string, status: number, retryable = false): UltraRouterError {
  return errorFromResponse(status, {
    error: { code, message: code, request_id: 'req_1', retryable },
  });
}

describe('isDefinitiveRejection — what may drop an event', () => {
  it.each([
    ['invalid_request', 400],
    ['not_found', 404],
    ['conflict', 409],
  ])('a well-formed %s envelope at %i is a definitive refusal of the event', (code, status) => {
    expect(isDefinitiveRejection(decoded(code, status))).toBe(true);
  });

  it.each([
    ['timeout', 0, false],
    ['aborted', 0, false],
    ['connection', 0, true],
    ['invalid_response', 200, false],
    ['authentication', 401, false],
    ['permission', 403, false],
    ['cancelled', 499, false],
    ['request_timeout', 408, false],
    ['rate_limited', 429, false],
    ['rate_limited', 429, true],
    ['provider_unavailable', 502, true],
    ['internal', 500, false],
    ['upstream_maintenance', 503, false],
    ['not_found', 404, true],
    ['validation_failed', 422, false],
    ['spend_cap_exceeded', 402, false],
    ['model_denied_by_policy', 403, false],
    ['invalid_request', 401, false],
    ['invalid_request', 403, false],
    ['conflict', 408, false],
    ['not_found', 429, false],
    ['not_found', 400, false],
  ])(
    'a well-formed %s envelope at %i (retryable=%s) keeps the event',
    (code, status, retryable) => {
      expect(isDefinitiveRejection(decoded(code, status, retryable))).toBe(false);
    },
  );

  it('an error without a validated envelope never drops an event, whatever its code', () => {
    expect(isDefinitiveRejection(err('invalid_request', 400, false))).toBe(false);
    expect(isDefinitiveRejection(errorFromResponse(400, { error: { message: '<html>' } }))).toBe(
      false,
    );
    expect(isDefinitiveRejection(errorFromResponse(400, {}))).toBe(false);
  });

  it('an envelope whose code disagrees with the error code never drops an event', () => {
    const e = new UltraRouterError({
      code: 'invalid_request',
      message: 'x',
      status: 400,
      retryable: false,
      envelope: { code: 'not_found', message: 'x', request_id: 'r', retryable: false },
    });
    expect(isDefinitiveRejection(e)).toBe(false);
  });

  it('a non-UltraRouterError never drops an event', () => {
    expect(isDefinitiveRejection(new TypeError('boom'))).toBe(false);
  });
});

describe('the outcome queue keeps every ambiguous failure', () => {
  for (const e of [
    err('timeout', 0, false),
    err('aborted', 0, false),
    err('authentication', 401, false),
    err('permission', 403, false),
    err('cancelled', 499, false),
    err('rate_limited', 429, false),
    err('internal', 500, false),
    err('invalid_response', 200, false),
  ]) {
    it(`${e.code} (${String(e.status)}) ⇒ queued, the identical event kept`, async () => {
      const queue = failingQueue(e);
      const receipt = await queue.enqueue(
        { artifact: 'art_1' },
        { channel: 'resolution', kind: 'resolved_true' },
      );
      expect(receipt.status).toBe('queued');
      expect(await queue.size()).toBe(1);
    });
  }

  it('a definitive refusal ⇒ rejected and dropped', async () => {
    const queue = failingQueue(decoded('invalid_request', 400));
    const receipt = await queue.enqueue(
      { artifact: 'a' },
      { channel: 'behavioral', kind: 'accepted' },
    );
    expect(receipt.status).toBe('rejected');
    expect(await queue.size()).toBe(0);
  });
});

describe('through the client: a timed-out send stays queued and replays with the same key', () => {
  it('the SDK deadline expiring mid-delivery keeps the event; flush replays identical bytes + key', async () => {
    const seen: { key: string | undefined; body: string }[] = [];
    let attempt = 0;
    const fetch: FetchLike = async (_url, init) => {
      attempt += 1;
      const headers = init?.headers as Record<string, string>;
      seen.push({ key: headers['idempotency-key'], body: String(init?.body) });
      if (attempt === 1) {
        // Never answers: only the SDK's 30 ms deadline ends the attempt.
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        });
      }
      return new Response(JSON.stringify({ data: [RESULT] }), {
        status: 201,
        headers: { 'content-type': 'application/json' },
      });
    };
    const store = new MemoryOutcomeStore();
    const ur = new UltraRouter({
      apiKey: 'ur_sk_test_x',
      baseURL: 'https://gw.test',
      fetch,
      timeout: 30,
      maxRetries: 0,
      outcomeStore: store,
    });
    const receipt = await ur.ur.outcomes.record(
      { artifact: 'art_1' },
      { channel: 'resolution', kind: 'resolved_true' },
    );
    expect(receipt.status).toBe('queued');
    if (receipt.status === 'queued') expect(receipt.error.code).toBe('timeout');
    expect(store.list()).toHaveLength(1);

    const report = await ur.ur.outcomes.flush();
    expect(report.delivered).toBe(1);
    expect(seen).toHaveLength(2);
    expect(seen[1]!.body).toBe(seen[0]!.body); // identical event bytes
    expect(seen[0]!.key).toBe(`ur-outcome-${receipt.entryId}`);
    expect(seen[1]!.key).toBe(seen[0]!.key); // the same Idempotency-Key on the replay
  });

  it('a 401 refuses the credentials, not the event: it stays queued', async () => {
    let calls = 0;
    const fetch: FetchLike = async () => {
      calls += 1;
      return new Response(
        JSON.stringify({ error: { code: 'authentication', message: 'bad key' } }),
        { status: 401, headers: { 'content-type': 'application/json' } },
      );
    };
    const store = new MemoryOutcomeStore();
    const ur = new UltraRouter({
      apiKey: 'ur_sk_test_x',
      baseURL: 'https://gw.test',
      fetch,
      maxRetries: 0,
      outcomeStore: store,
    });
    const receipt = await ur.ur.outcomes.record(
      { artifact: 'a' },
      { channel: 'behavioral', kind: 'accepted' },
    );
    expect(receipt.status).toBe('queued');
    expect(calls).toBe(1);
    expect(store.list()).toHaveLength(1);
  });
});

describe('the same Idempotency-Key after a restart (FileOutcomeStore)', () => {
  it('a fresh client on the same file replays with the key of the first attempt', async () => {
    const path = join(mkdtempSync(join(tmpdir(), 'ur-key-')), 'queue.json');
    const keys: (string | undefined)[] = [];
    const failing: FetchLike = async (_url, init) => {
      keys.push((init?.headers as Record<string, string>)['idempotency-key']);
      throw new TypeError('fetch failed');
    };
    const first = new UltraRouter({
      apiKey: 'ur_sk_test_x',
      baseURL: 'https://gw.test',
      fetch: failing,
      maxRetries: 0,
      outcomeStore: new FileOutcomeStore(path),
    });
    const receipt = await first.ur.outcomes.record(
      { artifact: 'a' },
      { channel: 'behavioral', kind: 'accepted' },
    );
    expect(receipt.status).toBe('queued');

    const ok: FetchLike = async (_url, init) => {
      keys.push((init?.headers as Record<string, string>)['idempotency-key']);
      return new Response(JSON.stringify({ data: [RESULT] }), {
        status: 201,
        headers: { 'content-type': 'application/json' },
      });
    };
    const second = new UltraRouter({
      apiKey: 'ur_sk_test_x',
      baseURL: 'https://gw.test',
      fetch: ok,
      outcomeStore: new FileOutcomeStore(path),
    });
    const report = await second.ur.outcomes.flush();
    expect(report.delivered).toBe(1);
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBe(`ur-outcome-${receipt.entryId}`);
    expect(keys[1]).toBe(keys[0]);
  });
});

describe('FileOutcomeStore — empty only when the file is absent', () => {
  const entry = (id: string): QueuedOutcome => ({
    id,
    target: { artifact: 'a' },
    event: { channel: 'behavioral', kind: 'accepted', observed_at: 'x', source_event_id: id },
    enqueued_at: 'x',
    attempts: 0,
  });

  it('starts empty when the file does not exist, and writes it with mode 0600', async () => {
    const path = join(mkdtempSync(join(tmpdir(), 'ur-fs-')), 'nested', 'queue.json');
    const store = new FileOutcomeStore(path);
    expect(await store.list()).toEqual([]);
    await store.append(entry('e1'));
    expect(JSON.parse(readFileSync(path, 'utf8'))).toHaveLength(1);
    if (process.platform !== 'win32') {
      const { statSync } = await import('node:fs');
      expect(statSync(path).mode & 0o777).toBe(0o600);
    }
  });

  for (const [name, content] of [
    ['malformed JSON', '[{"id":"e1", "target"'],
    ['a non-array', '{"id":"e1"}'],
    ['entries without ids', '[{"target":{}}]'],
  ] as const) {
    it(`${name}: every operation throws OutcomeStoreError and the file is preserved`, async () => {
      const path = join(mkdtempSync(join(tmpdir(), 'ur-fs-')), 'queue.json');
      writeFileSync(path, content);
      const store = new FileOutcomeStore(path);
      await expect(store.list()).rejects.toBeInstanceOf(OutcomeStoreError);
      await expect(store.append(entry('e2'))).rejects.toBeInstanceOf(OutcomeStoreError);
      await expect(store.remove('e1')).rejects.toBeInstanceOf(OutcomeStoreError);
      expect(readFileSync(path, 'utf8')).toBe(content); // never overwritten
    });
  }

  it('an unreadable file throws OutcomeStoreError (not "empty") and is preserved', async () => {
    if (process.platform === 'win32' || process.getuid?.() === 0) return; // permissions do not bind
    const path = join(mkdtempSync(join(tmpdir(), 'ur-fs-')), 'queue.json');
    const content = JSON.stringify([entry('keep-me')]);
    writeFileSync(path, content);
    chmodSync(path, 0o000);
    try {
      const store = new FileOutcomeStore(path);
      await expect(store.list()).rejects.toMatchObject({ name: 'OutcomeStoreError', path });
      await expect(store.append(entry('e2'))).rejects.toBeInstanceOf(OutcomeStoreError);
    } finally {
      chmodSync(path, 0o600);
    }
    expect(readFileSync(path, 'utf8')).toBe(content);
  });

  it('record() surfaces a broken store instead of claiming the event is queued', async () => {
    const path = join(mkdtempSync(join(tmpdir(), 'ur-fs-')), 'queue.json');
    writeFileSync(path, 'not json');
    const ur = new UltraRouter({
      apiKey: 'ur_sk_test_x',
      baseURL: 'https://gw.test',
      fetch: async () => new Response('{}', { status: 200 }),
      outcomeStore: new FileOutcomeStore(path),
    });
    await expect(
      ur.ur.outcomes.record({ artifact: 'a' }, { channel: 'behavioral', kind: 'accepted' }),
    ).rejects.toBeInstanceOf(OutcomeStoreError);
    expect(readFileSync(path, 'utf8')).toBe('not json');
  });
});

describe('the reviewer queue keeps a batch on every failure; only a 4xx answer is raised', () => {
  const reviewerEvent = (id: string): ReviewerEvent =>
    ({
      event_id: id,
      artifact_key: 'invoice:1',
      artifact_version: 1,
      decision: 'approved',
      effective_at: '2026-01-01T00:00:00Z',
    }) as ReviewerEvent;

  for (const e of [
    err('timeout', 0, false),
    err('aborted', 0, false),
    err('connection', 0, true),
    err('rate_limited', 429, false),
    err('internal', 500, false),
  ]) {
    it(`${e.code} (${String(e.status)}) ends the flush quietly with the batch queued`, async () => {
      const queue = new ReviewerQueue({
        store: new MemoryOutcomeStore<QueuedReviewerEvent>(),
        send: () => Promise.reject(e),
      });
      await queue.enqueue(reviewerEvent('r1'));
      const report = await queue.flush();
      expect(report.pending).toBe(1);
      expect(await queue.size()).toBe(1);
    });
  }

  it('a non-retryable 4xx answer is raised, and the batch stays queued', async () => {
    const queue = new ReviewerQueue({
      store: new MemoryOutcomeStore<QueuedReviewerEvent>(),
      send: () => Promise.reject(err('authentication', 401, false)),
    });
    await queue.enqueue(reviewerEvent('r1'));
    await expect(queue.flush()).rejects.toMatchObject({ code: 'authentication' });
    expect(await queue.size()).toBe(1);
  });
});

describe('a store shared by two clients: the flushing client delivers with ITS configuration', () => {
  it('client B flushes client A’s queued event with B’s base URL and headers, same identity and key', async () => {
    const store = new MemoryOutcomeStore();
    const seen: { url: string; headers: Record<string, string>; body: string }[] = [];
    const record =
      (status: number): FetchLike =>
      async (url, init) => {
        seen.push({
          url: String(url),
          headers: init?.headers as Record<string, string>,
          body: String(init?.body),
        });
        return status === 0
          ? Promise.reject(new TypeError('fetch failed'))
          : new Response(JSON.stringify({ data: [RESULT] }), {
              status,
              headers: { 'content-type': 'application/json' },
            });
      };
    const a = new UltraRouter({
      apiKey: 'ur_sk_test_a',
      baseURL: 'https://a.test',
      fetch: record(0),
      maxRetries: 0,
      defaultHeaders: { 'x-client': 'a' },
      outcomeStore: store,
    });
    const b = new UltraRouter({
      apiKey: 'ur_sk_test_b',
      baseURL: 'https://b.test',
      fetch: record(201),
      defaultHeaders: { 'x-client': 'b' },
      outcomeStore: store,
    });
    const receipt = await a.ur.outcomes.record(
      { artifact: 'art' },
      { channel: 'behavioral', kind: 'accepted' },
    );
    expect(receipt.status).toBe('queued');
    const report = await b.ur.outcomes.flush();
    expect(report.delivered).toBe(1);
    expect(seen).toHaveLength(2);
    expect(seen[1]!.url.startsWith('https://b.test/')).toBe(true);
    expect(seen[1]!.headers['x-client']).toBe('b');
    expect(seen[1]!.headers.authorization).toBe('Bearer ur_sk_test_b');
    expect(seen[1]!.body).toBe(seen[0]!.body);
    expect(seen[1]!.headers['idempotency-key']).toBe(seen[0]!.headers['idempotency-key']);
    expect(store.list()).toHaveLength(0);
  });
});

// ── The retention RULE, through the real client and real HTTP responses. An event is dropped ONLY on a
// validated, event-specific terminal rejection: a well-formed gateway envelope (code, message,
// request_id, retryable all present and typed), a non-retryable taxonomy code about the event
// (`invalid_request`, `not_found`, `conflict`) at its canonical status, `retryable: false`. 401, 403,
// 408 and 429 are retained whatever they carry; anything malformed or unreadable is retained. ──

/** A well-formed gateway error envelope. */
function envelope(code: string, retryable = false): string {
  return JSON.stringify({ error: { code, message: code, request_id: 'req_x', retryable } });
}

/** Record one outcome through a client whose gateway answers with `respond`; return receipt + store. */
async function recordAgainst(
  respond: () => Response | Promise<Response>,
  target: { artifact: string } | { request: string } = { artifact: 'art_1' },
): Promise<{ status: string; code: string | undefined; queued: number }> {
  const store = new MemoryOutcomeStore();
  const ur = new UltraRouter({
    apiKey: 'ur_sk_test_x',
    baseURL: 'https://gw.test',
    fetch: async () => respond(),
    maxRetries: 0,
    outcomeStore: store,
  });
  const receipt = await ur.ur.outcomes.record(target, { channel: 'behavioral', kind: 'accepted' });
  return {
    status: receipt.status,
    code: receipt.status === 'delivered' ? undefined : receipt.error.code,
    queued: store.list().length,
  };
}

const json = (body: string, status: number): Response =>
  new Response(body, { status, headers: { 'content-type': 'application/json' } });

describe('retention: only a validated, event-specific terminal rejection drops an event', () => {
  it.each([
    [
      'an HTML 400 from a proxy',
      () =>
        new Response('<html><body>400 Bad Request</body></html>', {
          status: 400,
          headers: { 'content-type': 'text/html' },
        }),
    ],
    ['a plain-text 400', () => new Response('Bad Request', { status: 400 })],
    ['an empty 400', () => new Response('', { status: 400 })],
    [
      'an HTML 413 from a proxy',
      () => new Response('<html>Request Entity Too Large</html>', { status: 413 }),
    ],
    [
      'a 400 JSON body that is not an envelope',
      () => json(JSON.stringify({ message: 'bad' }), 400),
    ],
    [
      'a 400 envelope without request_id/retryable',
      () => json(JSON.stringify({ error: { code: 'invalid_request', message: 'bad' } }), 400),
    ],
    [
      'a 400 envelope with a non-string code',
      () =>
        json(
          JSON.stringify({ error: { code: 7, message: 'm', request_id: 'r', retryable: false } }),
          400,
        ),
    ],
    ['a 422 with a code outside the taxonomy', () => json(envelope('validation_failed'), 422)],
    [
      'a 400 invalid_request that says retryable: true',
      () => json(envelope('invalid_request', true), 400),
    ],
    [
      'a not_found code on a 400 (status does not follow from the code)',
      () => json(envelope('not_found'), 400),
    ],
    [
      'a 402 spend_cap_exceeded (the workspace, not the event)',
      () => json(envelope('spend_cap_exceeded'), 402),
    ],
    [
      'a 400 capability_unsupported (not an outcome-event code)',
      () => json(envelope('capability_unsupported'), 400),
    ],
    ['a 499 cancelled', () => json(envelope('cancelled'), 499)],
    [
      'a 400 whose body cannot be read',
      () =>
        new Response(
          new ReadableStream({
            start(c) {
              c.error(new Error('reset'));
            },
          }),
          { status: 400 },
        ),
    ],
  ] as const)('%s ⇒ queued, the event kept', async (_name, respond) => {
    const r = await recordAgainst(respond);
    expect(r.status).toBe('queued');
    expect(r.queued).toBe(1);
  });

  it.each([
    ['401 with {}', () => json('{}', 401)],
    ['401 with HTML', () => new Response('<html>Unauthorized</html>', { status: 401 })],
    ['401 with a well-formed invalid_request', () => json(envelope('invalid_request'), 401)],
    ['403 with an unfamiliar denial code', () => json(envelope('denied_by_edge_proxy'), 403)],
    ['403 with a well-formed not_found', () => json(envelope('not_found'), 403)],
    ['408 with retryable: false', () => json(envelope('request_timeout', false), 408)],
    ['408 with a well-formed conflict', () => json(envelope('conflict'), 408)],
    ['429 with retryable: false', () => json(envelope('rate_limited', false), 429)],
    ['429 with a well-formed invalid_request', () => json(envelope('invalid_request'), 429)],
  ] as const)(
    '%s ⇒ ALWAYS queued (401/403/408/429 never drop an event)',
    async (_name, respond) => {
      const r = await recordAgainst(respond);
      expect(r.status).toBe('queued');
      expect(r.queued).toBe(1);
    },
  );

  it.each([
    ['invalid_request', 400],
    ['not_found', 404],
    ['conflict', 409],
  ] as const)('a well-formed %s at %i ⇒ rejected and dropped', async (code, status) => {
    const r = await recordAgainst(() => json(envelope(code), status));
    expect(r).toEqual({ status: 'rejected', code, queued: 0 });
  });

  it.each([
    [
      'an empty 2xx body (request target)',
      () => new Response('', { status: 202 }),
      { request: 'req_1' },
    ],
    ['a 2xx {} (request target)', () => json('{}', 202), { request: 'req_1' }],
    [
      'a 2xx result row without a known status',
      () => json(JSON.stringify({ data: [{ id: null }] }), 202),
      { artifact: 'art_1' },
    ],
    [
      'a 2xx data that is not a list',
      () => json(JSON.stringify({ data: { status: 'accepted' } }), 202),
      { artifact: 'art_1' },
    ],
    [
      'a 2xx HTML page',
      () => new Response('<html>ok</html>', { status: 200 }),
      { artifact: 'art_1' },
    ],
  ] as const)(
    '%s ⇒ queued (a malformed success is not a delivery)',
    async (_name, respond, target) => {
      const r = await recordAgainst(respond, target);
      expect(r.status).toBe('queued');
      expect(r.queued).toBe(1);
    },
  );
});

describe('reviewer queue: per-event verdicts are validated before anything is dropped', () => {
  const reviewerEvent = (id: string): ReviewerEvent =>
    ({
      event_id: id,
      artifact_key: 'invoice:1',
      artifact_version: 1,
      decision: 'approved',
      effective_at: '2026-01-01T00:00:00Z',
    }) as ReviewerEvent;
  const queueAnswering = (data: unknown): ReviewerQueue =>
    new ReviewerQueue({
      store: new MemoryOutcomeStore<QueuedReviewerEvent>(),
      send: async () => ({ data }) as never,
    });

  it.each([
    [
      'a rejected verdict without `repairable`',
      [{ event_id: 'r1', status: 'rejected', reason: 'x' }],
    ],
    [
      'a rejected verdict with a non-boolean `repairable`',
      [{ event_id: 'r1', status: 'rejected', reason: 'x', repairable: 'no' }],
    ],
    ['an unknown status', [{ event_id: 'r1', status: 'weird', reason: 'x', repairable: false }]],
    ['a missing status', [{ event_id: 'r1', reason: 'x', repairable: false }]],
    [
      'a rejected verdict without a reason',
      [{ event_id: 'r1', status: 'rejected', repairable: false }],
    ],
  ])('%s ⇒ the event stays queued', async (_name, data) => {
    const queue = queueAnswering(data);
    await queue.enqueue(reviewerEvent('r1'));
    const report = await queue.flush();
    expect(report.dropped).toBe(0);
    expect(report.pending).toBe(1);
    expect(await queue.size()).toBe(1);
  });

  it('an accepted verdict needs only its event id and status; a refusal needs reason + repairable', async () => {
    const queue = queueAnswering([{ event_id: 'r1', status: 'accepted' }]);
    await queue.enqueue(reviewerEvent('r1'));
    const report = await queue.flush();
    expect(report.accepted).toBe(1);
    expect(await queue.size()).toBe(0);
  });

  it('a 2xx answer whose `data` is not a list keeps the batch and ends the flush quietly', async () => {
    const queue = queueAnswering({ r1: 'accepted' });
    await queue.enqueue(reviewerEvent('r1'));
    const report = await queue.flush();
    expect(report.pending).toBe(1);
    expect(await queue.size()).toBe(1);
  });

  it('a validated terminal refusal (rejected, repairable: false, a reason) is dropped', async () => {
    const queue = queueAnswering([
      { event_id: 'r1', status: 'rejected', reason: 'unknown_artifact', repairable: false },
    ]);
    await queue.enqueue(reviewerEvent('r1'));
    const report = await queue.flush();
    expect(report.dropped).toBe(1);
    expect(await queue.size()).toBe(0);
  });

  it('through the client: an HTML 400 or a 401/403/408/429 keeps the batch queued', async () => {
    for (const respond of [
      () => new Response('<html>Bad Request</html>', { status: 400 }),
      () => json('{}', 401),
      () => json(envelope('permission'), 403),
      () => json(envelope('request_timeout'), 408),
      () => json(envelope('rate_limited'), 429),
    ]) {
      const store = new MemoryOutcomeStore<QueuedReviewerEvent>();
      const ur = new UltraRouter({
        apiKey: 'ur_sk_test_x',
        baseURL: 'https://gw.test',
        fetch: async () => respond(),
        maxRetries: 0,
        reviewerStore: store,
      });
      await ur.ur.reviewer.record(reviewerEvent('r1'));
      await ur.ur.reviewer.flush().catch(() => undefined);
      expect(store.list()).toHaveLength(1);
    }
  });
});

describe('reviewerVerdictAction: a verdict whose event_id is not a string moves nothing', () => {
  it.each([
    ['a list', ['evt_1']],
    ['an object', { event_id: 'evt_1' }],
    ['a number', 1],
    ['null', null],
    ['true', true],
    ['false', false],
  ])('event_id as %s ⇒ keep (no throw)', (_name, eventId) => {
    for (const verdict of [
      { event_id: eventId, status: 'accepted', reason: 'r', repairable: false },
      { event_id: eventId, status: 'rejected', reason: 'r', repairable: false },
      { event_id: eventId, status: 'rejected', reason: 'r', repairable: true },
    ]) {
      expect(reviewerVerdictAction(verdict)).toBe('keep');
    }
  });
});
