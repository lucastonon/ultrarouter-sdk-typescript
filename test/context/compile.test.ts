/**
 * The admission algorithm, including every base refusal code. A synthetic profile (built from the
 * public builders) turns on the authoritative-kind, release-binding, availability and limit rules;
 * each case triggers exactly one base reason, and a final assertion proves the corpus exercised all
 * of them. Ordering (`selection` vs `volatility`) and the happy path (entries, hashes, `toWire`) are
 * covered too.
 */
import { describe, expect, it } from 'vitest';

import {
  CONTEXT_REFUSAL_REASONS,
  ULTRAROUTER_PROFILE,
  compile,
  toWire,
  type CompatibilityProfile,
  type Contract,
  type ContextCandidate,
  type Envelope,
  type Module,
  type Pin,
} from '../../src/context.js';

const ASOF = '2026-04-01T00:00:00.000Z';
const FUTURE = '2026-05-01T00:00:00.000Z';

const reasonsSeen = new Set<string>();

const MATRIX_PROFILE: CompatibilityProfile = {
  ...ULTRAROUTER_PROFILE,
  name: 'matrix',
  orderRule: 'selection',
  authoritativeKinds: ['policy'],
  releaseBinding: { kinds: ['policy'], facet: 'policyRelease', releaseKey: 'policyReleases' },
  // Undated modules are admissible here; AVAILABILITY_REFUSED is exercised via a
  // future-dated module (after_cutoff), and the undated-refusal path is covered by the
  // tests in profiles.test.ts.
};

function makeModule(id: string, kind: string, overrides: Partial<Module> = {}): Module {
  return {
    id,
    version: '1',
    kind,
    memoryClass: 'semantic',
    trustClass: 'authoritative',
    privacyClass: 'workspace_private',
    availability: { from: null, to: null },
    contentHash: `hash:${id}`,
    tokenEstimate: 10,
    facets: {},
    ...overrides,
  };
}

function makeEnvelope(overrides: Partial<Envelope> = {}): Envelope {
  return {
    id: 'env-1',
    tenant: 'tenant-1',
    stage: 'stage-1',
    mode: 'live',
    asOf: ASOF,
    cutoffs: {},
    budgets: {},
    seed: 'seed',
    pins: [],
    releases: {},
    permissionEpoch: 'epoch-1',
    ...overrides,
  };
}

function makeContract(overrides: Partial<Contract> = {}): Contract {
  return {
    stage: 'stage-1',
    requiredKinds: [],
    optionalKinds: [],
    forbiddenKinds: [],
    budgets: {},
    limits: [],
    pinPolicy: 'strict',
    slots: ['instruction', 'reference', 'exemplar'],
    ...overrides,
  };
}

function pinFor(module: Module, purpose = 'p'): Pin {
  return { id: module.id, kind: module.kind, contentHash: module.contentHash, purpose };
}

function candidates(...modules: Module[]): ContextCandidate[] {
  return modules.map((module) => ({ module }));
}

/** Run compile and record the reasons emitted (for the coverage assertion). */
function run(
  envelope: Envelope,
  contract: Contract,
  cands: readonly ContextCandidate[],
  profile: CompatibilityProfile = MATRIX_PROFILE,
): ReturnType<typeof compile> {
  const result = compile(envelope, contract, cands, profile);
  for (const refusal of result.refusals) reasonsSeen.add(refusal.reason);
  return result;
}

describe('compile — the happy path', () => {
  it('admits a mandatory pin + an optional module and stamps the hashes', () => {
    const policy = makeModule('policy', 'policy', { facets: { policyRelease: 'r1' } });
    const optional = makeModule('note', 'note', {
      trustClass: 'approved_derived',
      memoryClass: 'episodic',
    });
    const envelope = makeEnvelope({
      pins: [pinFor(policy)],
      releases: { policyReleases: ['r1'] },
    });
    const contract = makeContract({ requiredKinds: ['policy'], optionalKinds: ['note'] });
    const result = run(envelope, contract, candidates(policy, optional));
    expect(result.ok).toBe(true);
    const manifest = result.manifest;
    expect(manifest).not.toBeNull();
    if (manifest === null) return;
    expect(manifest.entries.map((entry) => entry.moduleId)).toEqual(['policy', 'note']);
    expect(manifest.entries[0]?.mandatory).toBe(true);
    expect(manifest.entries[1]?.mandatory).toBe(false);
    expect(manifest.manifestHash).toMatch(/^[0-9a-f]{64}$/);
    expect(manifest.scaffoldHash).toMatch(/^[0-9a-f]{64}$/);
    expect(manifest.envelopeHash).toMatch(/^[0-9a-f]{64}$/);
    const wire = toWire(manifest);
    expect(wire.entries.map((entry) => entry.kind)).toEqual(['policy', 'note']);
    expect(wire.manifest_hash).toBe(manifest.manifestHash);
  });

  it('reorders by volatility under the ultrarouter profile (stable prefix first)', () => {
    const episodic = makeModule('epi', 'epi', { memoryClass: 'episodic' });
    const procedural = makeModule('proc', 'proc', { memoryClass: 'procedural' });
    const envelope = makeEnvelope();
    const contract = makeContract({ optionalKinds: ['epi', 'proc'] });
    const result = compile(
      envelope,
      contract,
      candidates(episodic, procedural),
      ULTRAROUTER_PROFILE,
    );
    expect(result.ok).toBe(true);
    // procedural (most stable) is ordered before episodic (most volatile).
    expect(result.manifest?.entries.map((entry) => entry.moduleId)).toEqual(['proc', 'epi']);
  });
});

describe('compile — every base refusal code', () => {
  it('STAGE_CONTRACT_MISMATCH', () => {
    const result = run(makeEnvelope({ stage: 'a' }), makeContract({ stage: 'b' }), []);
    expect(result.ok).toBe(false);
    expect(result.refusals.some((r) => r.reason === 'STAGE_CONTRACT_MISMATCH')).toBe(true);
  });

  it('PLANNER_BOUND_EXCEEDED', () => {
    const envelope = makeEnvelope({ budgets: { plannerPass: 3 } });
    const contract = makeContract({ budgets: { plannerPass: 2 } });
    const result = run(envelope, contract, []);
    expect(result.refusals.some((r) => r.reason === 'PLANNER_BOUND_EXCEEDED')).toBe(true);
  });

  it('PINNED_CONTEXT_NOT_REQUESTED', () => {
    const stray = makeModule('stray', 'stray');
    const envelope = makeEnvelope({ pins: [pinFor(stray)] });
    const contract = makeContract({ requiredKinds: [], optionalKinds: [] });
    const result = run(envelope, contract, candidates(stray));
    expect(result.refusals.some((r) => r.reason === 'PINNED_CONTEXT_NOT_REQUESTED')).toBe(true);
  });

  it('REQUIRED_CONTEXT_NOT_PINNED', () => {
    const contract = makeContract({ requiredKinds: ['policy'] });
    const result = run(makeEnvelope({ pins: [] }), contract, []);
    expect(result.refusals.some((r) => r.reason === 'REQUIRED_CONTEXT_NOT_PINNED')).toBe(true);
  });

  it('PINNED_CONTEXT_MISMATCH', () => {
    const module = makeModule('m', 'policy', {
      contentHash: 'actual',
      facets: { policyRelease: 'r1' },
    });
    const envelope = makeEnvelope({
      pins: [{ id: 'm', kind: 'policy', contentHash: 'stale', purpose: 'p' }],
      releases: { policyReleases: ['r1'] },
    });
    const contract = makeContract({ requiredKinds: ['policy'] });
    const result = run(envelope, contract, candidates(module));
    expect(result.refusals.some((r) => r.reason === 'PINNED_CONTEXT_MISMATCH')).toBe(true);
  });

  it('REQUIRED_CONTEXT_MISSING', () => {
    const envelope = makeEnvelope({
      pins: [{ id: 'gone', kind: 'policy', contentHash: 'h', purpose: 'p' }],
    });
    const contract = makeContract({ requiredKinds: ['policy'] });
    const result = run(envelope, contract, []);
    expect(result.refusals.some((r) => r.reason === 'REQUIRED_CONTEXT_MISSING')).toBe(true);
  });

  it('AUTHORITATIVE_CONTEXT_UNTRUSTED', () => {
    const policy = makeModule('policy', 'policy', {
      trustClass: 'approved_derived',
      facets: { policyRelease: 'r1' },
    });
    const envelope = makeEnvelope({ pins: [pinFor(policy)], releases: { policyReleases: ['r1'] } });
    const contract = makeContract({ requiredKinds: ['policy'] });
    const result = run(envelope, contract, candidates(policy));
    expect(result.refusals.some((r) => r.reason === 'AUTHORITATIVE_CONTEXT_UNTRUSTED')).toBe(true);
  });

  it('POLICY_RELEASE_MISMATCH', () => {
    const policy = makeModule('policy', 'policy', { facets: { policyRelease: 'wrong' } });
    const envelope = makeEnvelope({ pins: [pinFor(policy)], releases: { policyReleases: ['r1'] } });
    const contract = makeContract({ requiredKinds: ['policy'] });
    const result = run(envelope, contract, candidates(policy));
    expect(result.refusals.some((r) => r.reason === 'POLICY_RELEASE_MISMATCH')).toBe(true);
  });

  it('FORBIDDEN_KIND', () => {
    const bad = makeModule('bad', 'secrets');
    const contract = makeContract({ optionalKinds: ['secrets'], forbiddenKinds: ['secrets'] });
    const result = run(makeEnvelope(), contract, candidates(bad));
    expect(result.refusals.some((r) => r.reason === 'FORBIDDEN_KIND')).toBe(true);
  });

  it('BUDGET_EXCEEDED', () => {
    const a = makeModule('a', 'note', { tokenEstimate: 10 });
    const b = makeModule('b', 'note', { tokenEstimate: 10 });
    const contract = makeContract({ optionalKinds: ['note'], budgets: { tokens: 15 } });
    const result = run(makeEnvelope(), contract, candidates(a, b));
    expect(result.ok).toBe(true);
    expect(result.refusals.some((r) => r.reason === 'BUDGET_EXCEEDED')).toBe(true);
  });

  it('UNTRUSTED_IN_INSTRUCTION_SLOT', () => {
    const untrusted = makeModule('u', 'note', { trustClass: 'untrusted' });
    const contract = makeContract({ optionalKinds: ['note'] });
    const result = run(makeEnvelope(), contract, [{ module: untrusted, slot: 'instruction' }]);
    expect(result.refusals.some((r) => r.reason === 'UNTRUSTED_IN_INSTRUCTION_SLOT')).toBe(true);
  });

  it('AVAILABILITY_REFUSED', () => {
    const future = makeModule('f', 'note', { availability: { from: FUTURE, to: null } });
    const contract = makeContract({ optionalKinds: ['note'] });
    const result = run(makeEnvelope(), contract, candidates(future));
    expect(result.refusals.some((r) => r.reason === 'AVAILABILITY_REFUSED')).toBe(true);
  });

  it('LIMIT_EXCEEDED', () => {
    const a = makeModule('a', 'ex', { tokenEstimate: 1 });
    const b = makeModule('b', 'ex', { tokenEstimate: 1 });
    const contract = makeContract({
      optionalKinds: ['ex'],
      limits: [{ kind: 'ex', max: 1 }],
      budgets: { tokens: 1000 },
    });
    const result = run(makeEnvelope(), contract, candidates(a, b));
    expect(result.refusals.some((r) => r.reason === 'LIMIT_EXCEEDED')).toBe(true);
  });

  it('covered every base refusal reason', () => {
    for (const reason of CONTEXT_REFUSAL_REASONS) {
      expect(reasonsSeen.has(reason), `reason ${reason} was not exercised`).toBe(true);
    }
  });
});
