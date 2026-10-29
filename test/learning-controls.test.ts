// Learning controls: every `ur.learning.*` method's route, method and body; the actionable
// LearningError mapping by the gateway's named refusal (the message's first token) and code; and
// the controls end to end against the mock gateway, whose answers validate against the published
// API description (test/mock-gateway.test.ts).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { UltraRouter } from '../src/client.js';
import { UltraRouterError } from '../src/errors.js';
import {
  LEARNING_ERROR_ACTIONS,
  LEARNING_ERROR_CODES,
  LearningError,
  learningErrorReason,
  parseLearningRefusal,
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

function recording(answer: () => Response = () => Response.json({ object: 'learning' })): {
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
  it('replaces, reads and clears tool documentation with encoded call type ids', async () => {
    const r = recording();
    const learning = client(r.fetch).ur.learning;
    const tools = [
      {
        type: 'function' as const,
        function: {
          name: 'reserve_stock',
          parameters: { type: 'object', properties: { status: { enum: ['reserved'] } } },
        },
      },
    ];
    await learning.putToolDocumentation('ct/1', { tools });
    await learning.toolDocumentation('ct/1');
    await learning.putToolDocumentation('ct/1', { tools: [] });
    const path = 'http://gw/v1/call-types/ct%2F1/learning/tool-documentation';
    expect(r.calls).toEqual([
      { method: 'PUT', url: path, body: { tools } },
      { method: 'GET', url: path, body: undefined },
      { method: 'PUT', url: path, body: { tools: [] } },
    ]);
  });
  it('maps every control to its route, method and body', async () => {
    const r = recording();
    const ur = client(r.fetch);
    await ur.ur.learning.status('ct_1');
    await ur.ur.learning.enable('ct_1', {
      reflection_model: 'openai/gpt-5.2',
      promotion: { mode: 'evaluate', min_verified_per_arm: 40 },
    });
    await ur.ur.learning.pause('ct_1');
    await ur.ur.learning.resume('ct_1');
    await ur.ur.learning.disable('ct_1');
    await ur.ur.learning.versions('ct_1');
    await ur.ur.learning.version('ct_1', 'epb_2');
    await ur.ur.learning.rollback('ct_1', { version_id: 'epb_1' });
    await ur.ur.learning.rollback('ct_1');
    await ur.ur.learning.promote('ct_1', 'epb_3');
    await ur.ur.learning.reject('ct_1', 'epb_4');
    await ur.ur.learning.evaluations('ct_1');
    const base = 'http://gw/v1/call-types/ct_1/learning';
    expect(r.calls.map((c) => [c.method, c.url, c.body])).toEqual([
      ['GET', base, undefined],
      [
        'POST',
        `${base}/enable`,
        {
          reflection_model: 'openai/gpt-5.2',
          promotion: { mode: 'evaluate', min_verified_per_arm: 40 },
        },
      ],
      ['POST', `${base}/pause`, undefined],
      ['POST', `${base}/resume`, undefined],
      ['POST', `${base}/disable`, undefined],
      ['GET', `${base}/versions`, undefined],
      ['GET', `${base}/versions/epb_2`, undefined],
      ['POST', `${base}/rollback`, { version_id: 'epb_1' }],
      ['POST', `${base}/rollback`, {}],
      ['POST', `${base}/versions/epb_3/promote`, undefined],
      ['POST', `${base}/versions/epb_4/reject`, undefined],
      ['GET', `${base}/evaluations`, undefined],
    ]);
  });

  it('accepts a slug and encodes ids', async () => {
    const r = recording();
    await client(r.fetch).ur.learning.version('support reply', 'epb/2');
    expect(r.calls[0]!.url).toBe(
      'http://gw/v1/call-types/support%20reply/learning/versions/epb%2F2',
    );
  });
});

describe('actionable errors', () => {
  const refusal = (code: string, status: number, message: string) => () =>
    Response.json({ error: { code, message, request_id: 'req_x', retryable: false } }, { status });

  const cases: [string, number, string, LearningErrorReason, string, string | null][] = [
    [
      'conflict',
      409,
      'corrections_consent_required: learning stores episode content, so the workspace corrections consent must be on',
      'missing_consent',
      'corrections_consent_required',
      null,
    ],
    [
      'invalid_request',
      400,
      "reflection_model_not_workspace_owned (no_workspace_key): 'openai/gpt-5.2' must resolve to a workspace-owned offer",
      'provider_unavailable',
      'reflection_model_not_workspace_owned',
      'no_workspace_key',
    ],
    [
      'invalid_request',
      400,
      "reflection_model_not_workspace_owned (workspace_funding_frozen): 'x' must resolve",
      'provider_unavailable',
      'reflection_model_not_workspace_owned',
      'workspace_funding_frozen',
    ],
    [
      'conflict',
      409,
      'learning_not_enabled: learning is not enabled for this call type',
      'not_enabled',
      'learning_not_enabled',
      null,
    ],
    [
      'invalid_request',
      400,
      'promotion_invalid (min_exceeds_max)',
      'invalid_promotion',
      'promotion_invalid',
      'min_exceeds_max',
    ],
    [
      'conflict',
      409,
      'no_rollback_target: nothing earlier',
      'version_conflict',
      'no_rollback_target',
      null,
    ],
    [
      'conflict',
      409,
      'rollback_target_not_earlier: a rollback moves the pointer back',
      'version_conflict',
      'rollback_target_not_earlier',
      null,
    ],
    [
      'conflict',
      409,
      'version_already_active: already active',
      'version_conflict',
      'version_already_active',
      null,
    ],
    [
      'conflict',
      409,
      'version_active: roll back first',
      'version_conflict',
      'version_active',
      null,
    ],
    ['not_found', 404, "version 'epb_9' not found", 'not_found', 'not_found', null],
    ['permission', 403, 'the key lacks config:write', 'forbidden', 'permission', null],
    [
      'spend_cap_exceeded',
      402,
      'the workspace spend cap is reached',
      'budget_exhausted',
      'spend_cap_exceeded',
      null,
    ],
  ];
  for (const [code, status, message, reason, named, detail] of cases) {
    it(`${String(status)} ${message.split(/[ :(]/)[0]!} → LearningError(${reason})`, async () => {
      const r = recording(refusal(code, status, message));
      const err = await client(r.fetch)
        .ur.learning.enable('ct_1', { reflection_model: 'm' })
        .then(
          () => null,
          (e: unknown) => e,
        );
      expect(err).toBeInstanceOf(LearningError);
      expect(err).toBeInstanceOf(UltraRouterError);
      expect(err).toMatchObject({
        reason,
        code,
        status,
        requestId: 'req_x',
        refusal: named,
        detail,
      });
      expect((err as LearningError).action).toBe(LEARNING_ERROR_ACTIONS[reason]);
      expect((err as LearningError).message).toContain(message);
    });
  }

  it('leaves unrecognised refusals and transport failures unchanged', async () => {
    const other = recording(refusal('conflict', 409, 'idempotency_conflict: something else'));
    const err = await client(other.fetch)
      .ur.learning.rollback('ct_1', { version_id: 'x' })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UltraRouterError);
    expect(err).not.toBeInstanceOf(LearningError);
    const plain = recording(refusal('invalid_request', 400, 'reflection_model: Required'));
    expect(
      await client(plain.fetch)
        .ur.learning.enable('ct_1', { reflection_model: '' })
        .catch((e: unknown) => e),
    ).not.toBeInstanceOf(LearningError);
    const down = client(async () => {
      throw new TypeError('fetch failed');
    });
    const transport = await down.ur.learning.status('ct_1').catch((e: unknown) => e);
    expect(transport).toMatchObject({ code: 'connection' });
    expect(transport).not.toBeInstanceOf(LearningError);
    expect(toLearningError('plain')).toBe('plain');
  });

  it('parses the named refusal at the start of a message only', () => {
    expect(parseLearningRefusal('no_rollback_target: x')).toEqual({
      refusal: 'no_rollback_target',
      detail: null,
    });
    expect(parseLearningRefusal('promotion_invalid (alpha_out_of_range)')).toEqual({
      refusal: 'promotion_invalid',
      detail: 'alpha_out_of_range',
    });
    expect(parseLearningRefusal("reflection_model_not_workspace_owned (no_offer): 'm' …")).toEqual({
      refusal: 'reflection_model_not_workspace_owned',
      detail: 'no_offer',
    });
    for (const none of [
      "version 'x' not found",
      'call type ct_1 not found',
      'plain',
      '',
      'a_b c: d',
    ]) {
      expect(parseLearningRefusal(none)).toBeNull();
    }
  });

  it('every reason has refusals and an action; each maps back to its reason', () => {
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
    const off = await l.status('ct_e2e');
    expect(off).toMatchObject({ object: 'learning', state: 'off', enabled: false });
    const enabled = await l.enable('ct_e2e', {
      reflection_model: 'openai/gpt-5.2',
      promotion: { mode: 'evaluate', objective: 'success' },
    });
    expect(enabled).toMatchObject({ object: 'learning_control', action: 'enable', changed: true });
    expect(enabled.learning).toMatchObject({
      state: 'learning',
      governed: true,
      active_version: { id: 'epb_mock_2' },
      latest_candidate: { id: 'epb_mock_3', state: 'evaluating' },
    });
    expect(enabled.learning.evidence).toMatchObject({ verified: 31, incorporated_active: 23 });
    expect(enabled.learning.outcome_receipts).toMatchObject({ pending: 1, applied: 30 });
    expect(enabled.learning.recipe).toMatchObject({ validator: 'elv2', legacy: false });

    const paused = await l.pause('ct_e2e');
    expect([paused.changed, paused.learning.state]).toEqual([true, 'paused']);
    expect((await l.pause('ct_e2e')).changed).toBe(false); // idempotent
    expect((await l.resume('ct_e2e')).learning.state).toBe('learning');

    const history = await l.versions('ct_e2e');
    expect(history.data.map((v) => [v.id, v.state])).toEqual([
      ['epb_mock_3', 'evaluating'],
      ['epb_mock_2', 'active'],
      ['epb_mock_1', 'retired'],
    ]);
    const detail = await l.version('ct_e2e', 'epb_mock_2');
    expect(detail.lessons.length).toBeGreaterThan(0);
    expect(detail.transitions.length).toBeGreaterThan(0);

    const rolled = await l.rollback('ct_e2e'); // to the previously active version
    expect(rolled).toMatchObject({ action: 'rollback', version_id: 'epb_mock_1' });
    expect(rolled.learning.active_version?.id).toBe('epb_mock_1');

    const evaluations = await l.evaluations('ct_e2e');
    expect(evaluations.data[0]).toMatchObject({
      decision: 'running',
      candidate_version_id: 'epb_mock_3',
      arms: { candidate: { verified: 12, pass: 9 } },
    });
    const promoted = await l.promote('ct_e2e', 'epb_mock_3');
    expect(promoted).toMatchObject({
      version_id: 'epb_mock_3',
      stopped_evaluation_id: 'lev_mock_1',
    });
    expect(promoted.learning.active_version?.id).toBe('epb_mock_3');
    expect((await l.evaluations('ct_e2e')).data[0]?.decision).toBe('stopped_manual');
    expect((await l.disable('ct_e2e')).learning.state).toBe('disabled');
  });

  it('refusals arrive as LearningError with their reason, refusal and detail', async () => {
    await expect(
      ur.ur.learning.enable('ct_needs_consent', { reflection_model: 'm' }),
    ).rejects.toMatchObject({ reason: 'missing_consent', status: 409 });
    await expect(
      ur.ur.learning.enable('ct_no_provider', { reflection_model: 'm' }),
    ).rejects.toMatchObject({ reason: 'provider_unavailable', detail: 'no_workspace_key' });
    await expect(
      ur.ur.learning.enable('ct_bad_policy', {
        reflection_model: 'm',
        promotion: { min_verified_per_arm: 300, max_verified_per_arm: 100 },
      }),
    ).rejects.toMatchObject({ reason: 'invalid_promotion', detail: 'min_exceeds_max' });
    await expect(ur.ur.learning.pause('ct_never_enabled')).rejects.toMatchObject({
      reason: 'not_enabled',
      refusal: 'learning_not_enabled',
    });
    await expect(ur.ur.learning.status('ct_missing')).rejects.toBeInstanceOf(LearningError);
    await ur.ur.learning.enable('ct_conflicts', { reflection_model: 'm' });
    await expect(
      ur.ur.learning.rollback('ct_conflicts', { version_id: 'epb_nope' }),
    ).rejects.toMatchObject({ reason: 'not_found' });
    await expect(
      ur.ur.learning.rollback('ct_conflicts', { version_id: 'epb_mock_3' }),
    ).rejects.toMatchObject({ reason: 'version_conflict', refusal: 'rollback_target_not_earlier' });
    await expect(ur.ur.learning.promote('ct_conflicts', 'epb_mock_2')).rejects.toMatchObject({
      reason: 'version_conflict',
      refusal: 'version_already_active',
    });
    await expect(ur.ur.learning.reject('ct_conflicts', 'epb_mock_2')).rejects.toMatchObject({
      reason: 'version_conflict',
      refusal: 'version_active',
    });
  });
});
