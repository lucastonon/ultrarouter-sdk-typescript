// Learning controls: every `ur.learning.*` method's route, method and body; the actionable
// LearningError mapping; and the controls end to end against the mock gateway.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { UltraRouter } from '../src/client.js';
import { UltraRouterError } from '../src/errors.js';
import {
  LEARNING_ERROR_ACTIONS,
  LEARNING_ERROR_CODES,
  LearningError,
  learningErrorReason,
  toLearningError,
  type LearningErrorReason,
} from '../src/learning-controls.js';
import type { FetchLike } from '../src/types.js';
// @ts-expect-error -- plain ESM test helper without type declarations
import { startMockGateway } from './support/mock-gateway.mjs';

interface Captured {
  method: string;
  url: string;
  body: unknown;
}

function recording(answer: () => Response = () => Response.json({ state: 'active' })): {
  fetch: FetchLike;
  calls: Captured[];
} {
  const calls: Captured[] = [];
  const fetch: FetchLike = async (url, init) => {
    calls.push({
      method: init?.method ?? 'GET',
      url: String(url),
      body: init?.body === undefined ? undefined : JSON.parse(String(init.body)),
    });
    return answer();
  };
  return { fetch, calls };
}

const client = (fetch: FetchLike) =>
  new UltraRouter({ apiKey: 'k', baseURL: 'http://gw', fetch, maxRetries: 0 });

describe('routes', () => {
  it('maps every control to its route, method and body', async () => {
    const r = recording();
    const l = client(r.fetch).ur.learning;
    await l.status('ct_1');
    await l.enable('ct_1', { reflection_model: 'openai/gpt-5.2', promotion: 'evaluate' });
    await l.pause('ct_1');
    await l.resume('ct_1');
    await l.disable('ct_1');
    await l.versions('ct_1');
    await l.version('ct_1', 'lv_2');
    await l.rollback('ct_1', { version_id: 'lv_1', reason: 'regression' });
    await l.promote('ct_1', 'lv_3', { reason: 'looks good' });
    await l.reject('ct_1', 'lv_4');
    await l.evaluations('ct_1');
    const base = 'http://gw/v1/call-types/ct_1/learning';
    expect(r.calls.map((c) => [c.method, c.url, c.body])).toEqual([
      ['GET', base, undefined],
      ['POST', `${base}/enable`, { reflection_model: 'openai/gpt-5.2', promotion: 'evaluate' }],
      ['POST', `${base}/pause`, {}],
      ['POST', `${base}/resume`, {}],
      ['POST', `${base}/disable`, {}],
      ['GET', `${base}/versions`, undefined],
      ['GET', `${base}/versions/lv_2`, undefined],
      ['POST', `${base}/rollback`, { version_id: 'lv_1', reason: 'regression' }],
      ['POST', `${base}/versions/lv_3/promote`, { reason: 'looks good' }],
      ['POST', `${base}/versions/lv_4/reject`, {}],
      ['GET', `${base}/evaluations`, undefined],
    ]);
  });

  it('accepts a slug and encodes ids', async () => {
    const r = recording();
    await client(r.fetch).ur.learning.version('support reply', 'lv/2');
    expect(r.calls[0]!.url).toBe(
      'http://gw/v1/call-types/support%20reply/learning/versions/lv%2F2',
    );
  });
});

describe('actionable errors', () => {
  const refusal = (code: string, status: number) => () =>
    Response.json(
      { error: { code, message: `refused: ${code}`, request_id: 'req_x', retryable: false } },
      { status },
    );

  const cases: [string, number, LearningErrorReason][] = [
    ['consent_required', 403, 'missing_consent'],
    ['corrections_consent_required', 403, 'missing_consent'],
    ['learning_provider_unavailable', 409, 'provider_unavailable'],
    ['quota_exhausted', 429, 'quota_exhausted'],
    ['learning_budget_exhausted', 402, 'budget_exhausted'],
    ['spend_cap_exceeded', 402, 'budget_exhausted'],
    ['not_found', 404, 'not_found'],
    ['permission', 403, 'forbidden'],
  ];
  for (const [code, status, reason] of cases) {
    it(`${code} (${String(status)}) → LearningError(${reason})`, async () => {
      const r = recording(refusal(code, status));
      const err = await client(r.fetch)
        .ur.learning.enable('ct_1', { reflection_model: 'm' })
        .then(
          () => null,
          (e: unknown) => e,
        );
      expect(err).toBeInstanceOf(LearningError);
      expect(err).toBeInstanceOf(UltraRouterError);
      expect(err).toMatchObject({ reason, code, status, requestId: 'req_x' });
      expect((err as LearningError).action).toBe(LEARNING_ERROR_ACTIONS[reason]);
      expect((err as LearningError).message).toContain(`refused: ${code}`);
    });
  }

  it('leaves unrecognised gateway codes and transport failures unchanged', async () => {
    const other = recording(refusal('invalid_request', 400));
    const err = await client(other.fetch)
      .ur.learning.rollback('ct_1', { version_id: 'x' })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UltraRouterError);
    expect(err).not.toBeInstanceOf(LearningError);
    const down = client(async () => {
      throw new TypeError('fetch failed');
    });
    const transport = await down.ur.learning.status('ct_1').catch((e: unknown) => e);
    expect(transport).toMatchObject({ code: 'connection' });
    expect(transport).not.toBeInstanceOf(LearningError);
    expect(toLearningError('plain')).toBe('plain');
  });

  it('every reason has codes and an action; codes map back to their reason', () => {
    for (const [reason, codes] of Object.entries(LEARNING_ERROR_CODES)) {
      expect(codes.length).toBeGreaterThan(0);
      expect(LEARNING_ERROR_ACTIONS[reason as LearningErrorReason].length).toBeGreaterThan(10);
      for (const code of codes) expect(learningErrorReason(code)).toBe(reason);
    }
    expect(learningErrorReason('rate_limited')).toBeNull();
  });
});

describe('end to end against the mock gateway', () => {
  interface Gateway {
    url: string;
    close: () => Promise<void>;
  }
  let gw: Gateway;
  let ur: UltraRouter;
  beforeAll(async () => {
    gw = (await startMockGateway()) as Gateway;
    ur = new UltraRouter({ apiKey: 'ur_sk_test_learning', baseURL: gw.url, maxRetries: 0 });
  });
  afterAll(async () => {
    await gw.close();
  });

  it('status → enable → pause → resume → rollback → promote → reject → disable', async () => {
    const l = ur.ur.learning;
    expect((await l.status('ct_e2e')).state).toBe('not_enabled');
    const enabled = await l.enable('ct_e2e', {
      reflection_model: 'openai/gpt-5.2',
      promotion: { mode: 'evaluate', objective: 'success' },
    });
    expect(enabled).toMatchObject({ state: 'active', active: { id: 'lv_mock_2' } });
    expect(enabled.evidence).toMatchObject({
      arrived: 40,
      verified: 31,
      incorporated: 23,
      pending: 2,
    });
    expect((await l.pause('ct_e2e')).state).toBe('paused');
    expect((await l.resume('ct_e2e')).state).toBe('active');
    const history = await l.versions('ct_e2e');
    expect(history.data.map((v) => [v.id, v.state])).toEqual([
      ['lv_mock_3', 'evaluating'],
      ['lv_mock_2', 'active'],
      ['lv_mock_1', 'retired'],
    ]);
    const detail = await l.version('ct_e2e', 'lv_mock_2');
    expect(detail.lessons.length).toBeGreaterThan(0);
    const rolled = await l.rollback('ct_e2e', { version_id: 'lv_mock_1' });
    expect(rolled.active?.id).toBe('lv_mock_1');
    const evaluations = await l.evaluations('ct_e2e');
    expect(evaluations.data[0]).toMatchObject({
      decision: 'running',
      candidate: { version_id: 'lv_mock_3' },
    });
    expect((await l.promote('ct_e2e', 'lv_mock_3')).state).toBe('active');
    expect((await l.evaluations('ct_e2e')).data[0]?.decision).toBe('stopped_manual');
    expect((await l.disable('ct_e2e')).state).toBe('disabled');
  });

  it('refusals arrive as LearningError with their reason', async () => {
    await expect(
      ur.ur.learning.enable('ct_needs_consent', { reflection_model: 'm' }),
    ).rejects.toMatchObject({
      reason: 'missing_consent',
      status: 403,
    });
    await expect(
      ur.ur.learning.enable('ct_no_provider', { reflection_model: 'm' }),
    ).rejects.toMatchObject({
      reason: 'provider_unavailable',
    });
    await expect(ur.ur.learning.status('ct_missing')).rejects.toBeInstanceOf(LearningError);
    await expect(
      ur.ur.learning.rollback('ct_e2e', { version_id: 'lv_nope' }),
    ).rejects.toMatchObject({
      reason: 'not_found',
    });
  });
});
