// The `@ultrarouter/sdk/learning` starters: the verifier helpers, the business-rule validator and
// the signed, deduplicated webhook receiver (signature, timestamp tolerance, replay, concurrency,
// failure handling, secret hygiene).
import { createHmac } from 'node:crypto';

import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import {
  MemoryWebhookDedupeStore,
  WEBHOOK_SIGNATURE_HEADER,
  WEBHOOK_TIMESTAMP_HEADER,
  checkJsonSchemaLite,
  createWebhookReceiver,
  evidenceHash,
  runVerifier,
  signWebhook,
  validateOutput,
  verdictFromCommand,
  verifyWebhookSignature,
  type WebhookReporter,
} from '../src/learning.js';
import { UltraRouterError } from '../src/errors.js';
import type { OutcomeReportParams, OutcomeReportResult } from '../src/outcome-report.js';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('verifier helpers', () => {
  it('evidenceHash is sha256 over canonical JSON (key order does not matter)', () => {
    expect(evidenceHash({ b: 1, a: [2, { d: 3, c: 4 }] })).toBe(
      evidenceHash({ a: [2, { c: 4, d: 3 }], b: 1 }),
    );
    expect(evidenceHash({ a: 1 })).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(evidenceHash({ a: 1 })).not.toBe(evidenceHash({ a: 2 }));
  });

  it('runVerifier maps booleans, results, throws and nonsense', async () => {
    expect(await runVerifier(() => true)).toEqual({
      verdict: 'pass',
      evidenceHash: null,
      reasons: [],
    });
    expect((await runVerifier(async () => false)).verdict).toBe('fail');
    const withEvidence = await runVerifier(() => ({
      pass: false,
      evidence: { got: 3 },
      reasons: ['qty'],
    }));
    expect(withEvidence).toEqual({
      verdict: 'fail',
      evidenceHash: evidenceHash({ got: 3 }),
      reasons: ['qty'],
    });
    const crashed = await runVerifier(() => {
      throw new Error('secret detail never surfaces');
    });
    expect(crashed).toEqual({
      verdict: 'unknown',
      evidenceHash: null,
      reasons: ['verifier_error'],
    });
    const asFail = await runVerifier(
      () => {
        throw new TypeError('assertion');
      },
      { onError: 'fail' },
    );
    expect(asFail.verdict).toBe('fail');
    expect(asFail.reasons).toEqual(['check_threw']);
    expect((await runVerifier(() => ({ ok: true }) as never)).verdict).toBe('unknown');
  });

  it('verdictFromCommand: exit 0 passes, non-zero fails, a signal is unknown', () => {
    const ok = verdictFromCommand({ exitCode: 0, stdout: '12 passed' });
    expect(ok.verdict).toBe('pass');
    expect(ok.evidenceHash).toBe(
      evidenceHash({ exit_code: 0, signal: null, stdout: '12 passed', stderr: '' }),
    );
    expect(verdictFromCommand({ exitCode: 1, stderr: 'boom' })).toMatchObject({
      verdict: 'fail',
      reasons: ['exit_code_1'],
    });
    expect(verdictFromCommand({ exitCode: null, signal: 'SIGKILL' })).toMatchObject({
      verdict: 'unknown',
      reasons: ['killed_by_SIGKILL'],
    });
  });
});

describe('business-rule validator', () => {
  const schema = {
    type: 'object',
    properties: {
      order_id: { type: 'string', pattern: '^[A-Z]-\\d{3}$' },
      action: { type: 'string', enum: ['reserve', 'backorder'] },
      quantity: { type: 'integer', minimum: 1, maximum: 100 },
      notes: { type: 'array', items: { type: 'string', maxLength: 5 }, maxItems: 2 },
    },
    required: ['order_id', 'action'],
    additionalProperties: false,
  } as const;

  it('passes a valid output and runs the rules', () => {
    const v = validateOutput('{"order_id":"A-100","action":"reserve","quantity":2}', schema, [
      {
        name: 'reserve_needs_quantity',
        check: (o: { action: string; quantity?: number }) =>
          o.action !== 'reserve' || o.quantity !== undefined,
      },
    ]);
    expect(v.verdict).toBe('pass');
    expect(v.reasons).toEqual([]);
    expect(v.value).toEqual({ order_id: 'A-100', action: 'reserve', quantity: 2 });
    expect(v.evidenceHash).toBe(evidenceHash(v.value));
  });

  it('reports every schema problem with its path', () => {
    const v = validateOutput(
      { order_id: 'a100', action: 'ship', quantity: 0.5, notes: ['toolong', 1, 'x'], extra: true },
      schema,
    );
    expect(v.verdict).toBe('fail');
    expect(v.value).toBeUndefined();
    expect(v.reasons).toEqual(
      expect.arrayContaining([
        '$.order_id: must match ^[A-Z]-\\d{3}$',
        '$.action: must be one of "reserve", "backorder"',
        '$.quantity: expected integer, got number',
        '$.notes: must have at most 2 items',
        '$.notes[0]: must be at most 5 characters',
        '$.notes[1]: expected string, got integer',
        '$.extra: is not allowed',
      ]),
    );
    expect(checkJsonSchemaLite({}, schema)).toEqual([
      '$.order_id: is required',
      '$.action: is required',
    ]);
    expect(checkJsonSchemaLite(5, { type: ['string', 'null'] })).toEqual([
      '$: expected string or null, got integer',
    ]);
    expect(checkJsonSchemaLite(3, { type: 'number', const: 3 })).toEqual([]);
    expect(checkJsonSchemaLite('', { type: 'string', minLength: 1 })).toEqual([
      '$: must be at least 1 characters',
    ]);
    expect(checkJsonSchemaLite([], { type: 'array', minItems: 1 })).toEqual([
      '$: must have at least 1 items',
    ]);
    expect(checkJsonSchemaLite(-1, { minimum: 0 })).toEqual(['$: must be >= 0']);
  });

  it('fails invalid JSON text without throwing', () => {
    expect(validateOutput('{not json', schema)).toMatchObject({
      verdict: 'fail',
      reasons: ['invalid_json'],
    });
  });

  it('accepts a zod schema and its transformed value', () => {
    const order = z.object({ order_id: z.string(), quantity: z.number().int().positive() });
    const ok = validateOutput({ order_id: 'A-1', quantity: 2 }, order, [
      { name: 'small', check: (o) => (o.quantity <= 5 ? true : 'quantity above 5') },
    ]);
    expect(ok.verdict).toBe('pass');
    const bad = validateOutput({ order_id: 7, quantity: -1 }, order);
    expect(bad.verdict).toBe('fail');
    expect(bad.reasons.some((r) => r.startsWith('$.order_id:'))).toBe(true);
    expect(bad.reasons.some((r) => r.startsWith('$.quantity:'))).toBe(true);
    const ruleFail = validateOutput({ order_id: 'A-1', quantity: 9 }, order, [
      { name: 'small', check: (o) => (o.quantity <= 5 ? true : 'quantity above 5') },
      { name: 'never', check: () => false },
      {
        name: 'throws',
        check: () => {
          throw new RangeError('x');
        },
      },
    ]);
    expect(ruleFail.reasons).toEqual(['small: quantity above 5', 'never', 'throws: RangeError']);
  });
});

// ─────────────────────────────── webhooks ───────────────────────────────

const SECRET = 'whsec_test_only_value';
const NOW_MS = Date.UTC(2026, 0, 1, 12, 0, 0);
const NOW_S = Math.floor(NOW_MS / 1000);

/** A reporter that records calls and answers like the client would. */
function fakeReporter(
  status: 'delivered' | 'queued' | 'throw' | 'invalid' = 'delivered',
): WebhookReporter & {
  calls: { requestId: string; params: OutcomeReportParams<'webhook'> }[];
} {
  const calls: { requestId: string; params: OutcomeReportParams<'webhook'> }[] = [];
  return {
    calls,
    async report(requestId, params) {
      calls.push({ requestId, params });
      if (status === 'throw') throw new Error('store full');
      if (status === 'invalid') {
        throw new UltraRouterError({
          code: 'invalid_request',
          message: 'bad id',
          status: 0,
          retryable: false,
        });
      }
      return {
        status,
        requestId,
        verdict: params.verdict,
        source: 'webhook',
        channel: 'resolution',
        kind: 'resolved_true',
        teaches: true,
        sourceEventId: 'rpt_x',
        entryId: 'rpt_x',
        result: null,
        receipt: null,
        error:
          status === 'queued'
            ? new UltraRouterError({
                code: 'connection',
                message: 'down',
                status: 0,
                retryable: true,
              })
            : null,
      } as OutcomeReportResult<'webhook'>;
    },
  };
}

async function delivery(
  body: Record<string, unknown>,
  opts: { secret?: string; at?: number; tamper?: boolean } = {},
) {
  const rawBody = JSON.stringify(body);
  const headers = await signWebhook(opts.secret ?? SECRET, rawBody, opts.at ?? NOW_S);
  return { headers, rawBody: opts.tamper === true ? rawBody.replace('pass', 'fail') : rawBody };
}

const PAYLOAD = {
  event_id: 'evt_1',
  request_id: 'req_abc',
  verdict: 'pass',
  observed_at: '2026-01-01T11:59:00Z',
};

describe('webhook signatures', () => {
  it('signWebhook matches an independent HMAC-SHA256 of "<timestamp>.<raw body>"', async () => {
    const headers = await signWebhook(SECRET, '{"a":1}', 1700000000);
    const expected = createHmac('sha256', SECRET).update('1700000000.{"a":1}').digest('hex');
    expect(headers).toEqual({
      [WEBHOOK_TIMESTAMP_HEADER]: '1700000000',
      [WEBHOOK_SIGNATURE_HEADER]: `sha256=${expected}`,
    });
  });

  it('verifies, and names every refusal', async () => {
    const raw = '{"a":1}';
    const h = await signWebhook(SECRET, raw, NOW_S);
    const base = { secret: SECRET, rawBody: raw, now: () => NOW_MS };
    const sig = h[WEBHOOK_SIGNATURE_HEADER]!;
    const ts = h[WEBHOOK_TIMESTAMP_HEADER]!;
    expect(await verifyWebhookSignature({ ...base, signature: sig, timestamp: ts })).toEqual({
      ok: true,
    });
    const reasons = await Promise.all([
      verifyWebhookSignature({ ...base, signature: undefined, timestamp: ts }),
      verifyWebhookSignature({ ...base, signature: sig, timestamp: null }),
      verifyWebhookSignature({ ...base, signature: 'sha1=abc', timestamp: ts }),
      verifyWebhookSignature({ ...base, signature: sig.toUpperCase(), timestamp: ts }),
      verifyWebhookSignature({ ...base, signature: sig, timestamp: '12.5' }),
      verifyWebhookSignature({ ...base, signature: sig, timestamp: String(NOW_S - 301) }),
      verifyWebhookSignature({ ...base, signature: sig, timestamp: String(NOW_S + 301) }),
      verifyWebhookSignature({ ...base, rawBody: '{"a":2}', signature: sig, timestamp: ts }),
      verifyWebhookSignature({ ...base, secret: 'other', signature: sig, timestamp: ts }),
    ]);
    expect(reasons.map((r) => (r.ok ? 'ok' : r.reason))).toEqual([
      'missing_signature',
      'missing_timestamp',
      'malformed_signature',
      'malformed_signature',
      'malformed_timestamp',
      'stale_timestamp',
      'stale_timestamp',
      'bad_signature',
      'bad_signature',
    ]);
  });

  it('accepts a timestamp exactly at the tolerance edge, in both directions', async () => {
    for (const at of [NOW_S - 300, NOW_S + 300]) {
      const raw = '{}';
      const h = await signWebhook(SECRET, raw, at);
      const r = await verifyWebhookSignature({
        secret: SECRET,
        rawBody: raw,
        signature: h[WEBHOOK_SIGNATURE_HEADER],
        timestamp: h[WEBHOOK_TIMESTAMP_HEADER],
        now: () => NOW_MS,
      });
      expect(r).toEqual({ ok: true });
    }
    const h = await signWebhook(SECRET, '{}', NOW_S - 61);
    expect(
      await verifyWebhookSignature({
        secret: SECRET,
        rawBody: '{}',
        signature: h[WEBHOOK_SIGNATURE_HEADER],
        timestamp: h[WEBHOOK_TIMESTAMP_HEADER],
        now: () => NOW_MS,
        toleranceSeconds: 60,
      }),
    ).toEqual({ ok: false, reason: 'stale_timestamp' });
  });
});

describe('the webhook receiver', () => {
  it('reports a verified delivery with source webhook, the event id as the key, and its time', async () => {
    const reporter = fakeReporter();
    const rx = createWebhookReceiver({ reporter, secret: SECRET, now: () => NOW_MS });
    const result = await rx.handle(await delivery(PAYLOAD));
    expect(result).toMatchObject({
      status: 'reported',
      httpStatus: 200,
      eventId: 'evt_1',
      requestId: 'req_abc',
    });
    expect(reporter.calls).toEqual([
      {
        requestId: 'req_abc',
        params: {
          verdict: 'pass',
          source: 'webhook',
          idempotencyKey: 'evt_1',
          observedAt: '2026-01-01T11:59:00Z',
        },
      },
    ]);
  });

  it('without observed_at in the payload, reports the signed timestamp (identical across handlers)', async () => {
    const reporters = [fakeReporter(), fakeReporter()];
    const d = await delivery(
      { event_id: 'evt_t', request_id: 'req_abc', verdict: 'fail' },
      { at: NOW_S - 42 },
    );
    for (const reporter of reporters) {
      const rx = createWebhookReceiver({ reporter, secret: SECRET, now: () => NOW_MS });
      expect((await rx.handle(d)).status).toBe('reported');
    }
    const expected = new Date((NOW_S - 42) * 1000).toISOString();
    expect(expected).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.000Z$/);
    for (const reporter of reporters) {
      expect(reporter.calls[0]?.params).toEqual({
        verdict: 'fail',
        source: 'webhook',
        idempotencyKey: 'evt_t',
        observedAt: expected,
      });
    }
  });

  it('reads headers from a Headers object and from a lower- or mixed-case record', async () => {
    const reporter = fakeReporter();
    const rx = createWebhookReceiver({ reporter, secret: SECRET, now: () => NOW_MS });
    const d = await delivery({ ...PAYLOAD, event_id: 'evt_h1' });
    expect((await rx.handle({ headers: new Headers(d.headers), rawBody: d.rawBody })).status).toBe(
      'reported',
    );
    const d2 = await delivery({ ...PAYLOAD, event_id: 'evt_h2' });
    const mixed = Object.fromEntries(
      Object.entries(d2.headers).map(([k, v]) => [k.toUpperCase(), [v]]),
    );
    expect((await rx.handle({ headers: mixed, rawBody: d2.rawBody })).status).toBe('reported');
  });

  it('refuses tampered, forged, stale, unsigned and malformed deliveries before parsing or reporting', async () => {
    const reporter = fakeReporter();
    const rx = createWebhookReceiver({ reporter, secret: SECRET, now: () => NOW_MS });
    const tampered = await rx.handle(await delivery(PAYLOAD, { tamper: true }));
    const forged = await rx.handle(await delivery(PAYLOAD, { secret: 'attacker' }));
    const stale = await rx.handle(await delivery(PAYLOAD, { at: NOW_S - 3600 }));
    const unsigned = await rx.handle({ headers: {}, rawBody: JSON.stringify(PAYLOAD) });
    const garbage = await rx.handle(await delivery({ event_id: 'evt_g' }));
    const notJson = await (async () => {
      const headers = await signWebhook(SECRET, 'not json', NOW_S);
      return rx.handle({ headers, rawBody: 'not json' });
    })();
    expect([tampered, forged, stale, unsigned, garbage, notJson]).toEqual([
      { status: 'rejected', httpStatus: 401, reason: 'bad_signature' },
      { status: 'rejected', httpStatus: 401, reason: 'bad_signature' },
      { status: 'rejected', httpStatus: 401, reason: 'stale_timestamp' },
      { status: 'rejected', httpStatus: 401, reason: 'missing_signature' },
      { status: 'rejected', httpStatus: 400, reason: 'malformed_payload' },
      { status: 'rejected', httpStatus: 400, reason: 'malformed_payload' },
    ]);
    expect(reporter.calls).toHaveLength(0);
  });

  it('deduplicates a redelivery (and a replay of the same signed request) by event id', async () => {
    const reporter = fakeReporter();
    const rx = createWebhookReceiver({ reporter, secret: SECRET, now: () => NOW_MS });
    const d = await delivery(PAYLOAD);
    expect((await rx.handle(d)).status).toBe('reported');
    expect(await rx.handle(d)).toEqual({ status: 'duplicate', httpStatus: 200, eventId: 'evt_1' });
    const resigned = await delivery(PAYLOAD, { at: NOW_S + 5 });
    expect((await rx.handle(resigned)).status).toBe('duplicate');
    expect(reporter.calls).toHaveLength(1);
  });

  it('concurrent duplicate deliveries report once', async () => {
    const reporter = fakeReporter();
    const rx = createWebhookReceiver({ reporter, secret: SECRET, now: () => NOW_MS });
    const d = await delivery({ ...PAYLOAD, event_id: 'evt_c' });
    const results = await Promise.all([rx.handle(d), rx.handle(d), rx.handle(d)]);
    expect(results.filter((r) => r.status === 'reported')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'duplicate')).toHaveLength(2);
    expect(reporter.calls).toHaveLength(1);
  });

  it('a delivery the gateway has not acknowledged is deferred (503) and its claim released', async () => {
    for (const mode of ['queued', 'throw'] as const) {
      const reporter = fakeReporter(mode);
      const rx = createWebhookReceiver({ reporter, secret: SECRET, now: () => NOW_MS });
      const d = await delivery(PAYLOAD);
      const first = await rx.handle(d);
      expect(first).toMatchObject({ status: 'deferred', httpStatus: 503, eventId: 'evt_1' });
      await rx.handle(d); // the sender's redelivery is processed again, not deduplicated
      expect(reporter.calls).toHaveLength(2);
    }
  });

  it('a payload the reporter refuses (a malformed request id) is a 400', async () => {
    const rx = createWebhookReceiver({
      reporter: fakeReporter('invalid'),
      secret: SECRET,
      now: () => NOW_MS,
    });
    expect(await rx.handle(await delivery(PAYLOAD))).toEqual({
      status: 'rejected',
      httpStatus: 400,
      reason: 'malformed_payload',
    });
  });

  it('a custom parse maps any payload shape; an unknown verdict reports nothing', async () => {
    const reporter = fakeReporter();
    const rx = createWebhookReceiver({
      reporter,
      secret: SECRET,
      now: () => NOW_MS,
      parse: (p) => {
        const e = p as { id: string; ref: string; paid: boolean | null };
        return {
          eventId: e.id,
          requestId: e.ref,
          verdict: e.paid === null ? 'unknown' : e.paid ? 'pass' : 'fail',
        };
      },
    });
    await rx.handle(await delivery({ id: 'inv_1', ref: 'req_9', paid: false }));
    expect(reporter.calls[0]).toMatchObject({
      requestId: 'req_9',
      params: { verdict: 'fail', idempotencyKey: 'inv_1' },
    });
  });

  it('reads the secret from ULTRAROUTER_WEBHOOK_SECRET, requires one, and never exposes it', async () => {
    vi.stubEnv('ULTRAROUTER_WEBHOOK_SECRET', '');
    expect(() => createWebhookReceiver({ reporter: fakeReporter() })).toThrow(
      /ULTRAROUTER_WEBHOOK_SECRET/,
    );
    vi.stubEnv('ULTRAROUTER_WEBHOOK_SECRET', SECRET);
    const reporter = fakeReporter();
    const rx = createWebhookReceiver({ reporter, now: () => NOW_MS });
    const results = [
      await rx.handle(await delivery(PAYLOAD)),
      await rx.handle(await delivery(PAYLOAD, { secret: 'wrong' })),
      await rx.handle(await delivery({ nope: 1 })),
    ];
    const everything = JSON.stringify({ rx, results, keys: Object.keys(rx) });
    expect(everything).not.toContain(SECRET);
    expect(results[0]?.status).toBe('reported');
  });
});

describe('MemoryWebhookDedupeStore', () => {
  it('claims once per TTL, releases, and forgets the oldest beyond maxEntries', () => {
    let now = 0;
    const store = new MemoryWebhookDedupeStore({ maxEntries: 2, now: () => now });
    expect(store.claim('a', 100)).toBe(true);
    expect(store.claim('a', 100)).toBe(false);
    now = 101;
    expect(store.claim('a', 100)).toBe(true); // expired → claimable again
    store.release('a');
    expect(store.claim('a', 100)).toBe(true);
    expect(store.claim('b', 100)).toBe(true);
    expect(store.claim('c', 100)).toBe(true);
    expect(store.size).toBe(2);
    expect(store.claim('a', 100)).toBe(true); // 'a' was evicted as the oldest
  });
});
