// (unit half) — the PURE `ur flywheel-pr` core (
// ), unit-tested with no process, no network and no forge. The hermetic end-to-end proofs (a real
// built bin against a stub forge + gateway + git fixtures) live in `contract-tests/flywheel-ci/`;
// this file pins the pure decisions those runs depend on:
//
// - the IMMUTABLE candidate identity + the two CROSS-REPO goldens the gateway asserts verbatim;
// - candidate validation, which FAILS CLOSED with a named reason on every bad input;
// - the unified-diff generator (prefix/suffix trimming + the `\ No newline` marker);
// - OBSERVED-diff classification for both change shapes;
// - delivery-mode resolution, which never reads an unreadable permission as consent to write;
// - the rollout-gate PARSER, which refuses a pressed/inconsistent/malformed server decision;
// - the decision callback: mandatory actor + reason, a deterministic idempotency key, and the
// MAC recipe (recomputed here with node:crypto — an independent implementation).
import { createHmac } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  APP_CI_CALLBACK_SIGNATURE_HEADER,
  APP_CI_CALLBACK_TIMESTAMP_HEADER,
  APP_IDENTITY_PARITY_HASH,
  APP_IDENTITY_PARITY_VECTOR,
  CANDIDATE_DECISIONS,
  CANDIDATE_REF_PARITY_IDENTITY,
  CANDIDATE_REF_PARITY_REFERENCE,
  CandidateRefusedError,
  DecisionRefusedError,
  PlanRefusedError,
  appCiCallbackId,
  buildDecisionCallback,
  buildRolloutGateRequest,
  callbackSignatureHeaders,
  candidateBranchName,
  candidateReference,
  changedConfigKeys,
  classifyCandidateDiff,
  parseCandidate,
  parseRolloutGate,
  patchFileName,
  planCandidateChange,
  renderCandidatePlan,
  renderRolloutSection,
  resolveDeliveryMode,
  unavailableRolloutGate,
  unifiedDiff,
  type FlywheelCandidate,
} from '../src/cli/flywheel-pr.js';
import { hashEvidenceContract, sha256Hex } from '../src/cli/gate.js';
import type { WorkflowBinding } from '../src/cli/detect.js';

const BODY =
  'Learned from this workspace’s own recorded outcomes:\n- refunds quote the original method (n=61, base_rate)';

function candidateJson(over: Record<string, unknown> = {}): string {
  return JSON.stringify({
    workspaceId: 'ws_acme',
    leverKey: 'learned_context',
    moduleId: 'lcm_1111111111111111111111aa',
    moduleVersion: 'lcm1_2222222222222222222222222222bb',
    packHash: 'lcp1_3333333333333333333333333333cc',
    rankerVersion: 'lcr1_4444444444444444',
    k: 3,
    keySpec: 'sit1',
    sourceSnapshot: '2026-09-10T00:00:00.000Z',
    situationClass: 'support/refund',
    epoch: 4,
    bodyHash: sha256Hex(BODY),
    state: 'screened',
    workflowId: 'wf_refund',
    body: BODY,
    ...over,
  });
}

const WORKFLOW: WorkflowBinding = {
  id: 'wf_refund',
  objective: 'refund-accuracy',
  evaluatorVersion: 'eval.v3',
  coverage: 'application',
  testCommand: 'true',
  surfaces: [
    { kind: 'context_module', paths: ['context/refund/**'] },
    { kind: 'prompt', paths: ['prompts/refund/**'] },
  ],
};

const CONFIG = `${JSON.stringify(
  {
    repository: 'acme/app',
    datasetSplit: 'holdout-a',
    evidenceEpoch: 'epoch-2026-09',
    workflows: [WORKFLOW],
  },
  null,
  2,
)}\n`;

// ─────────────────────────────── identity + cross-repo parity ───────────────────────────────

describe('the immutable candidate identity', () => {
  it('matches the gateway goldens byte for byte (cross-repo parity)', () => {
    expect(candidateReference(CANDIDATE_REF_PARITY_IDENTITY)).toBe(CANDIDATE_REF_PARITY_REFERENCE);
    expect(hashEvidenceContract(APP_IDENTITY_PARITY_VECTOR)).toBe(APP_IDENTITY_PARITY_HASH);
  });

  it('leaves a candidate-free evidence contract byte-identical (no drift for users)', () => {
    const withCandidate = { ...APP_IDENTITY_PARITY_VECTOR };
    const { candidateRef: _ignored, ...bare } = withCandidate;
    expect(hashEvidenceContract({ ...bare, candidateRef: undefined })).toBe(
      hashEvidenceContract(bare),
    );
    expect(hashEvidenceContract(bare)).not.toBe(APP_IDENTITY_PARITY_HASH);
  });

  it('recomputes the reference from provenance and refuses a tampered body', () => {
    const c = parseCandidate(candidateJson());
    expect(c.candidateRef).toBe(candidateReference(c));
    expect(candidateBranchName(c.candidateRef)).toBe(`ultrarouter/candidate/${c.candidateRef}`);
    expect(patchFileName(c.candidateRef)).toMatch(
      /^ultrarouter-candidate-urcand1_[0-9a-f]{32}\.patch$/,
    );
    expect(() => parseCandidate(candidateJson({ body: `${BODY} tampered` }))).toThrow(
      /candidate_body_hash_mismatch/,
    );
  });

  it('FAILS CLOSED with a NAMED reason on every bad candidate', () => {
    const cases: readonly [string, string][] = [
      ['not json', 'invalid_candidate_json'],
      ['[]', 'invalid_candidate_json'],
      [candidateJson({ state: 'adopted' }), 'adopted_is_not_ci'],
      [candidateJson({ state: 'parked' }), 'candidate_not_screened'],
      [candidateJson({ state: 'screening' }), 'candidate_not_screened'],
      [candidateJson({ state: 'nonsense' }), 'unknown_lever_state'],
      [candidateJson({ body: '   ', bodyHash: sha256Hex('   ') }), 'empty_candidate_body'],
      [candidateJson({ moduleId: '' }), 'missing_field'],
      [candidateJson({ k: 'three' }), 'missing_field'],
    ];
    for (const [raw, reason] of cases) {
      let caught: unknown;
      try {
        parseCandidate(raw);
      } catch (e) {
        caught = e;
      }
      expect(caught, reason).toBeInstanceOf(CandidateRefusedError);
      expect((caught as CandidateRefusedError).reason).toBe(reason);
    }
  });
});

// ─────────────────────────────── the unified diff ───────────────────────────────

describe('the unified diff is a real, applyable patch', () => {
  it('creates a new file with a /dev/null source and a 0,0 old range', () => {
    const diff = unifiedDiff([{ path: 'a/b.md', before: null, after: 'one\ntwo\n' }]);
    expect(diff).toBe(
      'diff --git a/a/b.md b/a/b.md\nnew file mode 100644\n--- /dev/null\n+++ b/a/b.md\n@@ -0,0 +1,2 @@\n+one\n+two\n',
    );
  });

  it('trims common prefix/suffix to three lines of context', () => {
    const before = `${['a', 'b', 'c', 'd', 'e', 'X', 'f', 'g', 'h', 'i'].join('\n')}\n`;
    const after = `${['a', 'b', 'c', 'd', 'e', 'Y', 'f', 'g', 'h', 'i'].join('\n')}\n`;
    const diff = unifiedDiff([{ path: 'f.txt', before, after }]);
    expect(diff).toContain('@@ -3,7 +3,7 @@');
    expect(diff).toContain('-X');
    expect(diff).toContain('+Y');
    expect(diff).not.toContain(' a\n'); // the first two lines are outside the context window
  });

  it('emits the `\\ No newline` marker when a side does not end with one', () => {
    const diff = unifiedDiff([{ path: 'f.txt', before: 'one\ntwo', after: 'one\nTWO' }]);
    expect(diff).toContain('-two\n\\ No newline at end of file\n');
    expect(diff).toContain('+TWO\n\\ No newline at end of file\n');
  });

  it('represents a newline-only EOF change as a -/+ pair, never as shared context', () => {
    const diff = unifiedDiff([{ path: 'f.txt', before: 'one\ntwo', after: 'one\ntwo\n' }]);
    expect(diff).toContain('-two');
    expect(diff).toContain('\\ No newline at end of file');
    expect(diff).toContain('+two');
  });

  it('is empty when nothing changed', () => {
    expect(unifiedDiff([{ path: 'f.txt', before: 'same\n', after: 'same\n' }])).toBe('');
  });
});

// ─────────────────────────────── observed-diff classification ───────────────────────────────

describe(' classification keys on the OBSERVED diff', () => {
  it('accepts a code-owned change on the lever’s own configured surface', () => {
    expect(
      classifyCandidateDiff({
        leverKey: 'learned_context',
        shape: 'code_owned',
        workflow: WORKFLOW,
        changedPaths: ['context/refund/learned.md'],
      }),
    ).toEqual({ kind: 'in_surface', lever: 'learned_context', surfaces: ['context_module'] });
  });

  it('refuses an unmapped path AND a configured surface the lever may not touch', () => {
    expect(
      classifyCandidateDiff({
        leverKey: 'learned_context',
        shape: 'code_owned',
        workflow: WORKFLOW,
        changedPaths: ['src/elsewhere.ts'],
      }),
    ).toMatchObject({ kind: 'out_of_surface', offending: ['src/elsewhere.ts'] });
    expect(
      classifyCandidateDiff({
        leverKey: 'learned_context',
        shape: 'code_owned',
        workflow: WORKFLOW,
        changedPaths: ['prompts/refund/system.txt'],
      }),
    ).toMatchObject({ kind: 'out_of_surface' });
  });

  it('refuses an unknown lever family rather than defaulting it open', () => {
    expect(
      classifyCandidateDiff({
        leverKey: 'something_new',
        shape: 'code_owned',
        workflow: WORKFLOW,
        changedPaths: ['context/refund/learned.md'],
      }),
    ).toEqual({ kind: 'unknown_lever', lever: 'something_new' });
  });

  it('calls a diff spanning two allowed kinds `bundled` (unattributable to one lever)', () => {
    const bundleWorkflow: WorkflowBinding = {
      ...WORKFLOW,
      surfaces: [
        { kind: 'context_module', paths: ['context/**'] },
        { kind: 'prompt', paths: ['prompts/**'] },
      ],
    };
    expect(
      classifyCandidateDiff({
        leverKey: 'prompt_optimization',
        shape: 'code_owned',
        workflow: bundleWorkflow,
        changedPaths: ['prompts/a.txt', 'context/b.md'],
      }),
    ).toMatchObject({ kind: 'out_of_surface' }); // `context` is not prompt_optimization's surface
  });

  it('lets a gateway-owned change touch ONLY its own workflow’s candidateRef key', () => {
    expect(
      classifyCandidateDiff({
        leverKey: 'learned_context',
        shape: 'gateway_owned',
        workflow: WORKFLOW,
        changedPaths: ['ur-app-ci.config.json'],
        changedConfigKeys: ['workflows[wf_refund].candidateRef'],
      }),
    ).toMatchObject({ kind: 'in_surface' });
    expect(
      classifyCandidateDiff({
        leverKey: 'learned_context',
        shape: 'gateway_owned',
        workflow: WORKFLOW,
        changedPaths: ['ur-app-ci.config.json'],
        changedConfigKeys: [
          'workflows[wf_refund].candidateRef',
          'workflows[wf_refund].testCommand',
        ],
      }),
    ).toMatchObject({ kind: 'out_of_surface', offending: ['workflows[wf_refund].testCommand'] });
    expect(
      classifyCandidateDiff({
        leverKey: 'learned_context',
        shape: 'gateway_owned',
        workflow: WORKFLOW,
        changedPaths: [],
        changedConfigKeys: [],
      }),
    ).toMatchObject({ kind: 'out_of_surface', offending: ['no_observed_change'] });
  });

  it('diffs config keys by a workflow’s stable id, not its array index', () => {
    const a = {
      workflows: [
        { id: 'x', v: 1 },
        { id: 'y', v: 2 },
      ],
    };
    const reordered = {
      workflows: [
        { id: 'y', v: 2 },
        { id: 'x', v: 1 },
      ],
    };
    expect(changedConfigKeys(a, reordered)).toEqual([]);
    expect(
      changedConfigKeys(a, {
        workflows: [
          { id: 'x', v: 9 },
          { id: 'y', v: 2 },
        ],
      }),
    ).toEqual(['workflows[x].v']);
  });
});

// ─────────────────────────────── the plan ───────────────────────────────

describe('the plan is shown before anything is written', () => {
  const candidate = parseCandidate(candidateJson());

  it('gateway-owned: the reference lands in the config, the payload only in the preview', () => {
    const plan = planCandidateChange({
      candidate,
      shape: 'gateway_owned',
      workflow: WORKFLOW,
      baseBranch: 'main',
      configPath: 'ur-app-ci.config.json',
      configBefore: CONFIG,
    });
    expect(plan.classification.kind).toBe('in_surface');
    expect(plan.files).toHaveLength(1);
    expect(plan.files[0]?.after).toContain(candidate.candidateRef);
    expect(plan.files[0]?.after).not.toContain('refunds quote the original method');
    expect(plan.payloadDiff).toContain('refunds quote the original method');
    expect(plan.payloadHash).toBe(candidate.bodyHash);
    const preview = renderCandidatePlan(plan, candidate, {
      mode: 'open_pr',
      reason: 'repo_write_granted',
      apply: false,
    });
    expect(preview).toContain(`destination branch: ${plan.destinationBranch}`);
    expect(preview).toContain('--- proposed diff ---');
    expect(preview).toContain('PLAN ONLY, nothing written');
    expect(preview).toContain('never auto-merged');
  });

  it('code-owned: a file diff carrying the immutable reference in its header', () => {
    const plan = planCandidateChange({
      candidate,
      shape: 'code_owned',
      workflow: WORKFLOW,
      baseBranch: 'main',
      configPath: 'ur-app-ci.config.json',
      configBefore: CONFIG,
      modulePath: 'context/refund/learned.md',
      moduleBefore: null,
    });
    expect(plan.payloadDiff).toBeNull();
    expect(plan.diff).toContain('new file mode 100644');
    expect(plan.diff).toContain(candidate.candidateRef);
    expect(plan.diff).toContain('refunds quote the original method');
  });

  it('refuses a bad config, an unknown workflow and a missing module path — each by name', () => {
    const base = {
      candidate,
      workflow: WORKFLOW,
      baseBranch: 'main',
      configPath: 'c.json',
    } as const;
    expect(() =>
      planCandidateChange({ ...base, shape: 'gateway_owned', configBefore: '{' }),
    ).toThrow(PlanRefusedError);
    expect(() =>
      planCandidateChange({
        ...base,
        shape: 'gateway_owned',
        workflow: { ...WORKFLOW, id: 'wf_other' },
        configBefore: CONFIG,
      }),
    ).toThrow(/workflow_not_found/);
    expect(() =>
      planCandidateChange({ ...base, shape: 'code_owned', configBefore: CONFIG }),
    ).toThrow(/missing_module_path/);
  });
});

// ─────────────────────────────── delivery-mode resolution ───────────────────────────────

describe('an unreadable write permission is never consent to write', () => {
  it('resolves every requested mode to `patch` without a confirmed grant', () => {
    for (const requested of ['auto', 'attach', 'open_pr'] as const) {
      expect(resolveDeliveryMode({ requested, repositoryWrite: 'denied', prNumber: 3 })).toEqual({
        ok: true,
        mode: 'patch',
        reason: 'no_repo_write_permission',
        repositoryWrite: 'denied',
      });
      expect(resolveDeliveryMode({ requested, repositoryWrite: 'unknown', prNumber: 3 })).toEqual({
        ok: true,
        mode: 'patch',
        reason: 'repo_write_unknown',
        repositoryWrite: 'unknown',
      });
    }
  });

  it('attaches when a PR exists, opens one when it does not, and honours an explicit patch', () => {
    expect(
      resolveDeliveryMode({ requested: 'auto', repositoryWrite: 'granted', prNumber: 7 }),
    ).toMatchObject({
      mode: 'attach',
    });
    expect(
      resolveDeliveryMode({ requested: 'auto', repositoryWrite: 'granted', prNumber: null }),
    ).toMatchObject({
      mode: 'open_pr',
    });
    expect(
      resolveDeliveryMode({ requested: 'patch', repositoryWrite: 'granted', prNumber: 7 }),
    ).toMatchObject({
      mode: 'patch',
      reason: 'patch_requested',
    });
  });

  it('refuses `attach` with no PR instead of silently writing somewhere else', () => {
    expect(
      resolveDeliveryMode({ requested: 'attach', repositoryWrite: 'granted', prNumber: null }),
    ).toEqual({
      ok: false,
      reason: 'attach_requires_pr',
    });
  });
});

// ─────────────────────────────── the rollout gate parser ───────────────────────────────

describe('the CLI reads the rollout decision and never invents one', () => {
  const candidate = parseCandidate(candidateJson());

  it('sends the observed identity, the headline and the shape', () => {
    const request = buildRolloutGateRequest({
      candidate,
      observed: APP_IDENTITY_PARITY_VECTOR,
      headline: 'ready_for_rollout',
      requiresRepositoryWrite: true,
      shape: 'gateway_owned',
    });
    expect(request.schema).toBe('ur.flywheel.rollout.request.v1');
    expect(request.candidate_ref).toBe(candidate.candidateRef);
    expect(request.candidate_state).toBe('screened');
    expect(request.observed_identity).toEqual(APP_IDENTITY_PARITY_VECTOR);
  });

  it('accepts a well-formed decision and preserves each named blocker', () => {
    const gate = parseRolloutGate({
      unlocked: false,
      pressed: false,
      blockers: [
        { reason: 'stale_head', family: 'frozen_baseline', message: 'the head moved' },
        {
          reason: 'consent_revoked',
          family: 'consent',
          message: 'consent was revoked',
          detail: 'x',
        },
      ],
      evidence_hash: 'abc',
      candidate_ref: candidate.candidateRef,
    });
    expect(gate?.blockers.map((b) => b.reason)).toEqual(['stale_head', 'consent_revoked']);
    const rendered = renderRolloutSection(gate!);
    expect(rendered).toContain('is BLOCKED');
    expect(rendered).toContain('`stale_head`');
    expect(rendered).toContain('`consent_revoked`');
  });

  it('REFUSES a pressed, inconsistent or malformed decision (→ fail closed)', () => {
    expect(parseRolloutGate({ unlocked: true, pressed: true, blockers: [] })).toBeNull();
    expect(
      parseRolloutGate({ unlocked: true, pressed: false, blockers: [{ reason: 'stale_head' }] }),
    ).toBeNull();
    expect(parseRolloutGate({ unlocked: true, blockers: [] })).toBeNull(); // `pressed` omitted
    expect(parseRolloutGate({ unlocked: 'yes', pressed: false, blockers: [] })).toBeNull();
    expect(parseRolloutGate({ unlocked: false })).toBeNull();
    expect(parseRolloutGate({ unlocked: false, blockers: [{ reason: '' }] })).toBeNull();
    expect(parseRolloutGate(null)).toBeNull();
    const fallback = unavailableRolloutGate('urcand1_x', 'ev');
    expect(fallback.unlocked).toBe(false);
    expect(fallback.pressed).toBe(false);
    expect(fallback.blockers[0]?.reason).toBe('authorization_unavailable');
  });

  it('renders the unlocked state without ever claiming CI started or measured anything', () => {
    const gate = parseRolloutGate({
      unlocked: true,
      pressed: false,
      blockers: [],
      evidence_hash: 'abc',
      candidate_ref: 'urcand1_x',
    });
    const rendered = renderRolloutSection(gate!);
    expect(rendered).toContain('is UNLOCKED');
    expect(rendered).toContain('CI does not press it');
    expect(rendered).not.toMatch(/measured improvement|proven improvement|lift of/i);
  });
});

// ─────────────────────────────── the decision callback ───────────────────────────────

describe('the human decision callback is signed, replay-safe and mandatory-reasoned', () => {
  const base = {
    workspaceId: 'ws_acme',
    candidateRef: 'urcand1_deadbeefdeadbeefdeadbeefdeadbeef',
    evidenceHash: 'e'.repeat(64),
    actorId: 'usr_alice',
    reason: 'contradicts our refund SOP',
    surface: 'pull_request' as const,
    decidedAt: '2026-09-14T10:00:00.000Z',
  };

  it('requires a known decision, an actor and a non-empty reason', () => {
    for (const bad of [
      { ...base, decision: 'adopt' },
      { ...base, decision: 'reject', actorId: '  ' },
      { ...base, decision: 'reject', reason: '' },
    ]) {
      expect(() => buildDecisionCallback(bad)).toThrow(DecisionRefusedError);
    }
    for (const decision of CANDIDATE_DECISIONS) {
      expect(buildDecisionCallback({ ...base, decision }).body.decision).toBe(decision);
    }
  });

  it('derives a DETERMINISTIC idempotency key so a re-send is the same callback', () => {
    const a = buildDecisionCallback({ ...base, decision: 'reject' });
    const b = buildDecisionCallback({
      ...base,
      decision: 'reject',
      decidedAt: '2026-10-01T00:00:00.000Z',
    });
    expect(a.body.callback_id).toBe(b.body.callback_id);
    expect(a.body.callback_id).toBe(
      appCiCallbackId({
        kind: 'decision',
        workspaceId: base.workspaceId,
        candidateRef: base.candidateRef,
        evidenceHash: base.evidenceHash,
        decision: 'reject',
        actorId: base.actorId,
      }),
    );
    expect(buildDecisionCallback({ ...base, decision: 'accept' }).body.callback_id).not.toBe(
      a.body.callback_id,
    );
    expect(
      buildDecisionCallback({ ...base, decision: 'reject', actorId: 'usr_bob' }).body.callback_id,
    ).not.toBe(a.body.callback_id);
  });

  it('signs the EXACT bytes it sends, with the MAC recipe and its own header namespace', async () => {
    const { rawBody } = buildDecisionCallback({ ...base, decision: 'reject' });
    const nowMs = Date.parse('2026-09-14T10:00:00.000Z');
    const headers = await callbackSignatureHeaders('ur_sk_test_x', rawBody, nowMs);
    const timestamp = String(Math.floor(nowMs / 1000));
    const expected = `sha256=${createHmac('sha256', 'ur_sk_test_x').update(`${timestamp}.${rawBody}`, 'utf8').digest('hex')}`;
    expect(headers[APP_CI_CALLBACK_TIMESTAMP_HEADER]).toBe(timestamp);
    expect(headers[APP_CI_CALLBACK_SIGNATURE_HEADER]).toBe(expected);
    // Domain separation: an app-CI callback can never be replayed at the reviewer endpoint.
    expect(APP_CI_CALLBACK_SIGNATURE_HEADER).not.toBe('x-ur-reviewer-signature');
  });

  it('carries no body and no secret — ids, hashes, the reason text and the actor only', () => {
    const { body, rawBody } = buildDecisionCallback({ ...base, decision: 'revert' });
    expect(Object.keys(body).sort()).toEqual([
      'actor_id',
      'callback_id',
      'candidate_ref',
      'decided_at',
      'decision',
      'evidence_hash',
      'kind',
      'reason',
      'schema',
      'surface',
      'workspace_id',
    ]);
    expect(rawBody).not.toContain('ur_sk_');
  });
});

// The candidate type is exercised structurally above; this keeps the import meaningful.
const _typeCheck: FlywheelCandidate = parseCandidate(candidateJson());
void _typeCheck;
