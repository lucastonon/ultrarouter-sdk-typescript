// Outcome receipts: reading one receipt or a request's receipts (and tolerating the envelope
// shapes), and waitForReceipt's bounded backoff, timeout, cancellation and error handling — all over
// the public receipt routes only.
import { afterEach, describe, expect, it, vi } from 'vitest';

import { UltraRouter } from '../src/client.js';
import { UltraRouterError } from '../src/errors.js';
import {
  ReceiptWaitTimeoutError,
  isTerminalReceiptState,
  parseOutcomeReceipt,
  parseOutcomeReceiptList,
} from '../src/outcome-receipts.js';
import type { FetchLike } from '../src/types.js';

const receipt = (status: string, extra: Record<string, unknown> = {}) => ({
  id: 'rcpt_1',
  request_id: 'req_1',
  status,
  channel: 'computable',
  kind: 'oracle_pass',
  ...extra,
});

/** A fetch answering GET receipt reads from a script, recording each read's time and URL. */
function scripted(answers: (() => Response)[]): {
  fetch: FetchLike;
  reads: { at: number; url: string }[];
} {
  const reads: { at: number; url: string }[] = [];
  const fetch: FetchLike = async (url) => {
    reads.push({ at: Date.now(), url: String(url) });
    const next = answers[Math.min(reads.length - 1, answers.length - 1)]!;
    return next();
  };
  return { fetch, reads };
}

const json =
  (body: unknown, status = 200) =>
  () =>
    Response.json(body, { status });
const gatewayError =
  (code: string, status: number, retryable = false) =>
  () =>
    Response.json({ error: { code, message: code, request_id: 'req_e', retryable } }, { status });

function client(fetch: FetchLike): UltraRouter {
  return new UltraRouter({ apiKey: 'k', baseURL: 'http://gw', fetch, maxRetries: 0 });
}

afterEach(() => {
  vi.useRealTimers();
});

describe('reading receipts', () => {
  it('receipt(id) reads the public route and accepts a bare or wrapped receipt', async () => {
    const bare = scripted([json(receipt('applied'))]);
    expect(await client(bare.fetch).ur.outcomes.receipt('rcpt_1')).toMatchObject({
      status: 'applied',
    });
    expect(bare.reads[0]!.url).toBe('http://gw/v1/outcome-receipts/rcpt_1');
    const wrapped = scripted([json({ receipt: receipt('pending') })]);
    expect((await client(wrapped.fetch).ur.outcomes.receipt('rcpt_1')).status).toBe('pending');
  });

  it('receiptsForRequest reads every receipt of a request in any list envelope', async () => {
    for (const body of [
      { object: 'list', data: [receipt('applied'), receipt('pending', { id: 'rcpt_2' })] },
      { receipts: [receipt('applied'), receipt('pending', { id: 'rcpt_2' })] },
      [receipt('applied'), receipt('pending', { id: 'rcpt_2' })],
    ]) {
      const s = scripted([json(body)]);
      const list = await client(s.fetch).ur.outcomes.receiptsForRequest('req_1');
      expect(list.data.map((r) => r.id)).toEqual(['rcpt_1', 'rcpt_2']);
      expect(s.reads[0]!.url).toBe('http://gw/v1/requests/req_1/outcome-receipts');
    }
  });

  it('an unrecognisable body is a typed invalid_response', () => {
    expect(() => parseOutcomeReceipt({ nope: true })).toThrow(UltraRouterError);
    expect(() => parseOutcomeReceiptList({ data: [{ id: 1 }] })).toThrow(UltraRouterError);
    expect(() => parseOutcomeReceiptList('x')).toThrow(UltraRouterError);
  });

  it('knows the terminal states', () => {
    for (const s of ['applied', 'rejected', 'failed', 'expired'])
      expect(isTerminalReceiptState(s)).toBe(true);
    expect(isTerminalReceiptState('pending')).toBe(false);
    expect(isTerminalReceiptState('weird')).toBe(false);
  });
});

describe('waitForReceipt', () => {
  it('resolves on the first terminal state, polling with doubling delays capped at 4 s', async () => {
    vi.useFakeTimers();
    const answers = [
      ...Array.from({ length: 7 }, () => json(receipt('pending'))),
      json(receipt('applied', { episode: 'associated' })),
    ];
    const s = scripted(answers);
    const wait = client(s.fetch).ur.outcomes.waitForReceipt('rcpt_1');
    await vi.advanceTimersByTimeAsync(20_000);
    await expect(wait).resolves.toMatchObject({ status: 'applied', episode: 'associated' });
    const gaps = s.reads.slice(1).map((r, i) => r.at - s.reads[i]!.at);
    expect(gaps).toEqual([250, 500, 1000, 2000, 4000, 4000, 4000]);
    expect(s.reads.every((r) => r.url === 'http://gw/v1/outcome-receipts/rcpt_1')).toBe(true);
  });

  it('honours custom intervals', async () => {
    vi.useFakeTimers();
    const s = scripted([
      json(receipt('pending')),
      json(receipt('pending')),
      json(receipt('expired')),
    ]);
    const wait = client(s.fetch).ur.outcomes.waitForReceipt('rcpt_1', {
      pollIntervalMs: 10,
      maxPollIntervalMs: 15,
    });
    await vi.advanceTimersByTimeAsync(100);
    await expect(wait).resolves.toMatchObject({ status: 'expired' });
    expect(s.reads.slice(1).map((r, i) => r.at - s.reads[i]!.at)).toEqual([10, 15]);
  });

  it('times out with ReceiptWaitTimeoutError carrying the last receipt', async () => {
    vi.useFakeTimers();
    const s = scripted([json(receipt('pending'))]);
    const wait = client(s.fetch).ur.outcomes.waitForReceipt('rcpt_1', { timeoutMs: 3_000 });
    const settled = wait.then(
      () => null,
      (err: unknown) => err,
    );
    await vi.advanceTimersByTimeAsync(5_000);
    const err = await settled;
    expect(err).toBeInstanceOf(ReceiptWaitTimeoutError);
    expect(err).toMatchObject({ code: 'timeout', receiptId: 'rcpt_1' });
    expect((err as ReceiptWaitTimeoutError).lastReceipt?.status).toBe('pending');
    // Reads at 0, 250, 750, 1750; the next (3750) is past the deadline.
    expect(s.reads).toHaveLength(4);
  });

  it('is cancelled by an AbortSignal, before or during the wait', async () => {
    const pre = new AbortController();
    pre.abort(new Error('stop'));
    const s0 = scripted([json(receipt('pending'))]);
    await expect(
      client(s0.fetch).ur.outcomes.waitForReceipt('rcpt_1', { signal: pre.signal }),
    ).rejects.toMatchObject({ code: 'aborted' });
    expect(s0.reads).toHaveLength(0);

    vi.useFakeTimers();
    const ctl = new AbortController();
    const s = scripted([json(receipt('pending'))]);
    const wait = client(s.fetch).ur.outcomes.waitForReceipt('rcpt_1', { signal: ctl.signal });
    const settled = wait.then(
      () => null,
      (err: unknown) => err,
    );
    await vi.advanceTimersByTimeAsync(300);
    ctl.abort(new Error('user cancelled'));
    const err = await settled;
    expect(err).toBeInstanceOf(UltraRouterError);
    expect(err).toMatchObject({ code: 'aborted' });
    expect(s.reads).toHaveLength(2);
  });

  it('keeps polling through transient failures, but stops on a definitive one', async () => {
    vi.useFakeTimers();
    const transient = scripted([
      gatewayError('provider_unavailable', 503, true),
      () => {
        throw new TypeError('fetch failed');
      },
      json(receipt('applied')),
    ]);
    const wait = client(transient.fetch).ur.outcomes.waitForReceipt('rcpt_1');
    await vi.advanceTimersByTimeAsync(2_000);
    await expect(wait).resolves.toMatchObject({ status: 'applied' });

    vi.useRealTimers();
    const missing = scripted([gatewayError('not_found', 404)]);
    await expect(client(missing.fetch).ur.outcomes.waitForReceipt('rcpt_x')).rejects.toMatchObject({
      code: 'not_found',
      status: 404,
    });
    expect(missing.reads).toHaveLength(1);
  });

  it('a receipt already final resolves after one read', async () => {
    const s = scripted([json(receipt('rejected', { reason: 'request_not_found' }))]);
    await expect(client(s.fetch).ur.outcomes.waitForReceipt('rcpt_1')).resolves.toMatchObject({
      status: 'rejected',
      reason: 'request_not_found',
    });
    expect(s.reads).toHaveLength(1);
  });
});
