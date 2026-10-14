/**
 * Compatibility profiles parameterise one compiler. These tests drive `compile` with synthetic
 * profiles and adapters (authored for this repository) and pin the behaviours a profile can change:
 * refusal code vocabularies, adapter pre-refusals folded in candidate order, budget strategies,
 * availability policy and strict modes, release bindings, authoritative kinds, ordering rules,
 * result ceilings and default kind caps, and custom manifest encoders. They also pin what a profile
 * or a module can NOT change: `ext` never grants authority.
 */
import { describe, expect, it } from 'vitest';

import {
  canonicalJson,
  compile,
  defineKinds,
  defineRefusals,
  sha256Hex,
  ULTRAROUTER_PROFILE,
  type CompatibilityProfile,
  type ContextCandidate,
  type Contract,
  type Envelope,
  type Module,
} from '../../src/context.js';

const ASOF = '2026-03-01T00:00:00.000Z';

function envelope(over: Partial<Envelope> = {}): Envelope {
  return {
    id: 'env-profile',
    tenant: 'tenant-a',
    stage: 'draft',
    mode: 'live',
    asOf: ASOF,
    cutoffs: {},
    budgets: {},
    seed: 'seed',
    pins: [],
    releases: {},
    permissionEpoch: 'epoch-1',
    ...over,
  };
}

function contract(over: Partial<Contract> = {}): Contract {
  return {
    stage: 'draft',
    requiredKinds: [],
    optionalKinds: ['guide', 'example', 'note', 'policy'],
    forbiddenKinds: [],
    budgets: {},
    limits: [],
    pinPolicy: 'none',
    slots: ['instruction', 'reference', 'exemplar'],
    ...over,
  };
}

function mod(id: string, over: Partial<Module> = {}): Module {
  return {
    id,
    version: '1',
    kind: 'guide',
    memoryClass: 'semantic',
    trustClass: 'approved_derived',
    privacyClass: 'internal',
    availability: { from: '2026-01-01T00:00:00.000Z', to: null },
    contentHash: `sha256:${id}`,
    tokenEstimate: 10,
    facets: {},
    ...over,
  };
}

const cand = (module: Module, extra: Partial<ContextCandidate> = {}): ContextCandidate => ({
  module,
  ...extra,
});

function profile(over: Partial<CompatibilityProfile> = {}): CompatibilityProfile {
  return { ...ULTRAROUTER_PROFILE, name: 'synthetic', ...over };
}

describe('refusal vocabularies', () => {
  it('renders base reasons through the profile registry (custom codes, detail-aware)', () => {
    const custom = profile({
      refusals: defineRefusals({
        extraCodes: ['CTX_SHED', 'CTX_STALE', 'CTX_UNDATED'],
        map: (reason, detail) =>
          reason === 'BUDGET_EXCEEDED'
            ? 'CTX_SHED'
            : reason === 'AVAILABILITY_REFUSED'
              ? detail === 'unknown'
                ? 'CTX_UNDATED'
                : 'CTX_STALE'
              : undefined,
      }),
      availability: { refuseUndated: true },
    });
    const result = compile(
      envelope(),
      contract({ budgets: { tokens: 15 } }),
      [
        cand(mod('a', { tokenEstimate: 10 })),
        cand(mod('b', { tokenEstimate: 10 })),
        cand(mod('late', { availability: { from: '2026-06-01T00:00:00.000Z', to: null } })),
        cand(mod('undated', { availability: { from: null, to: null } })),
      ],
      custom,
    );
    expect(result.ok).toBe(true);
    const byModule = Object.fromEntries(result.refusals.map((r) => [r.moduleId, r]));
    expect(byModule.b).toMatchObject({ reason: 'BUDGET_EXCEEDED', code: 'CTX_SHED' });
    expect(byModule.late).toMatchObject({
      reason: 'AVAILABILITY_REFUSED',
      code: 'CTX_STALE',
      detail: 'after_cutoff',
    });
    expect(byModule.undated).toMatchObject({
      reason: 'AVAILABILITY_REFUSED',
      code: 'CTX_UNDATED',
      detail: 'unknown',
    });
    expect(custom.refusals.codes).toEqual(expect.arrayContaining(['BUDGET_EXCEEDED', 'CTX_SHED']));
  });

  it('falls back to the base reason when the map does not cover it', () => {
    const custom = profile({ refusals: defineRefusals({ map: () => undefined }) });
    const result = compile(
      envelope(),
      contract({ forbiddenKinds: ['note'] }),
      [cand(mod('n', { kind: 'note' }))],
      custom,
    );
    expect(result.refusals[0]).toMatchObject({ reason: 'FORBIDDEN_KIND', code: 'FORBIDDEN_KIND' });
  });
});

describe('adapter pre-refusals', () => {
  it('folds them inline, in candidate order, with the adapter code verbatim', () => {
    const result = compile(
      envelope(),
      contract(),
      [
        cand(mod('first'), {
          adapterRefusal: { code: 'SCOPE_OUTSIDE_TENANT', message: 'belongs to another tenant' },
        }),
        cand(mod('ok')),
        cand(mod('dup'), {
          adapterRefusal: {
            code: 'DUPLICATE_INPUT',
            message: 'already supplied',
            reason: 'duplicate',
            detail: 'by-hash',
          },
        }),
      ],
      ULTRAROUTER_PROFILE,
    );
    expect(result.ok).toBe(true);
    expect(result.refusals.map((r) => [r.moduleId, r.code, r.reason])).toEqual([
      ['first', 'SCOPE_OUTSIDE_TENANT', 'SCOPE_OUTSIDE_TENANT'],
      ['dup', 'DUPLICATE_INPUT', 'duplicate'],
    ]);
    expect(result.refusals[1]?.detail).toBe('by-hash');
    expect(result.manifest?.entries.map((e) => e.moduleId)).toEqual(['ok']);
  });

  it('a refused pinned module is fatal: no manifest', () => {
    const pinned = mod('pin', { kind: 'policy', trustClass: 'authoritative' });
    const result = compile(
      envelope({
        pins: [
          { id: 'pin', kind: 'policy', contentHash: pinned.contentHash, purpose: 'the policy' },
        ],
      }),
      contract({ pinPolicy: 'strict', requiredKinds: ['policy'] }),
      [cand(pinned, { adapterRefusal: { code: 'LEASE_EVICTED', message: 'lease expired' } })],
      ULTRAROUTER_PROFILE,
    );
    expect(result.ok).toBe(false);
    expect(result.manifest).toBeNull();
    expect(result.refusals.find((r) => r.code === 'LEASE_EVICTED')?.fatal).toBe(true);
  });
});

describe('ext never grants authority', () => {
  it('an untrusted module stays out of the instruction slot whatever its ext says', () => {
    const sneaky = mod('sneaky', {
      trustClass: 'untrusted',
      ext: { trustClass: 'authoritative', approved: true },
    });
    const result = compile(
      envelope(),
      contract(),
      [cand(sneaky, { slot: 'instruction' })],
      ULTRAROUTER_PROFILE,
    );
    expect(result.refusals[0]).toMatchObject({
      moduleId: 'sneaky',
      reason: 'UNTRUSTED_IN_INSTRUCTION_SLOT',
    });
    expect(result.manifest?.entries).toEqual([]);
  });

  it('an untrusted module defaults to the reference slot, and ext round-trips onto the entry', () => {
    const ref = mod('ref', { trustClass: 'untrusted', ext: { source: 'customer-upload' } });
    const result = compile(envelope(), contract(), [cand(ref)], ULTRAROUTER_PROFILE);
    expect(result.manifest?.entries[0]).toMatchObject({
      moduleId: 'ref',
      slot: 'reference',
      ext: { source: 'customer-upload' },
    });
  });
});

describe('budget strategies', () => {
  const candidates = [
    cand(mod('big', { tokenEstimate: 30, memoryClass: 'procedural' })),
    cand(mod('mid', { tokenEstimate: 20, memoryClass: 'semantic' })),
    cand(mod('small', { tokenEstimate: 5, memoryClass: 'episodic' })),
  ];
  const keepByClass = (rank: Record<string, number>) => (entry: { memoryClass: string }) =>
    rank[entry.memoryClass] ?? 0;

  it('prefix shedding is monotone: after the first overflow everything lower is shed', () => {
    const p = profile({
      budget: {
        kind: 'tokens',
        limit: () => 40,
        keepPriority: keepByClass({ procedural: 3, semantic: 2, episodic: 1 }),
      },
    });
    const result = compile(envelope(), contract(), candidates, p);
    expect(result.manifest?.entries.map((e) => e.moduleId).sort()).toEqual(['big']);
    expect(result.refusals.map((r) => r.moduleId).sort()).toEqual(['mid', 'small']);
  });

  it('greedy shedding skips an overflow and keeps trying smaller modules', () => {
    const p = profile({
      budget: {
        kind: 'tokens',
        limit: () => 40,
        keepPriority: keepByClass({ procedural: 3, semantic: 2, episodic: 1 }),
        shedMode: 'greedy',
      },
    });
    const result = compile(envelope(), contract(), candidates, p);
    expect(result.manifest?.entries.map((e) => e.moduleId).sort()).toEqual(['big', 'small']);
    expect(result.refusals.map((r) => r.moduleId)).toEqual(['mid']);
  });

  it('a count budget admits at most N modules in selection order', () => {
    const p = profile({ budget: { kind: 'count', limit: () => 2 } });
    const result = compile(envelope(), contract(), candidates, p);
    expect(result.manifest?.entries).toHaveLength(2);
    expect(result.refusals).toEqual([
      expect.objectContaining({ moduleId: 'small', reason: 'BUDGET_EXCEEDED', detail: 'count' }),
    ]);
  });

  it('a null limit is unbounded', () => {
    const p = profile({ budget: { kind: 'count', limit: () => null } });
    expect(compile(envelope(), contract(), candidates, p).manifest?.entries).toHaveLength(3);
  });
});

describe('availability policy and strict modes', () => {
  const undated = cand(mod('undated', { availability: { from: null, to: null } }));
  const strictProfile = profile({ availability: { refuseUndated: true, strictModes: ['strict'] } });

  it('by default an undated module is always available', () => {
    expect(
      compile(envelope(), contract(), [undated], ULTRAROUTER_PROFILE).manifest?.entries,
    ).toHaveLength(1);
  });

  it('refuseUndated refuses it non-fatally outside strict modes', () => {
    const result = compile(envelope({ mode: 'live' }), contract(), [undated], strictProfile);
    expect(result.ok).toBe(true);
    expect(result.refusals[0]).toMatchObject({
      reason: 'AVAILABILITY_REFUSED',
      detail: 'unknown',
      fatal: false,
    });
  });

  it('…and fatally in a strict mode', () => {
    const result = compile(envelope({ mode: 'strict' }), contract(), [undated], strictProfile);
    expect(result.ok).toBe(false);
    expect(result.refusals[0]?.fatal).toBe(true);
  });

  it('refuses an expired module', () => {
    const expired = cand(
      mod('old', {
        availability: { from: '2025-01-01T00:00:00.000Z', to: '2025-12-31T00:00:00.000Z' },
      }),
    );
    expect(
      compile(envelope(), contract(), [expired], ULTRAROUTER_PROFILE).refusals[0],
    ).toMatchObject({ detail: 'expired' });
  });
});

describe('release binding and authoritative kinds', () => {
  const bound = profile({
    releaseBinding: { kinds: ['policy'], facet: 'release', releaseKey: 'policy' },
    authoritativeKinds: ['policy'],
  });

  it('a bound kind must carry a facet present in the envelope release', () => {
    const env = envelope({ releases: { policy: ['r-7', 'r-8'] } });
    const result = compile(
      env,
      contract(),
      [
        cand(
          mod('current', {
            kind: 'policy',
            trustClass: 'authoritative',
            facets: { release: 'r-8' },
          }),
        ),
        cand(
          mod('stale', { kind: 'policy', trustClass: 'authoritative', facets: { release: 'r-3' } }),
        ),
      ],
      bound,
    );
    expect(result.manifest?.entries.map((e) => e.moduleId)).toEqual(['current']);
    expect(result.refusals[0]).toMatchObject({
      moduleId: 'stale',
      reason: 'POLICY_RELEASE_MISMATCH',
    });
  });

  it('an authoritative kind refuses a non-authoritative module', () => {
    const env = envelope({ releases: { policy: 'r-1' } });
    const result = compile(
      env,
      contract(),
      [cand(mod('derived', { kind: 'policy', facets: { release: 'r-1' } }))],
      bound,
    );
    expect(result.refusals[0]).toMatchObject({ reason: 'AUTHORITATIVE_CONTEXT_UNTRUSTED' });
  });
});

describe('ordering rules', () => {
  const candidates = [
    cand(mod('episode', { memoryClass: 'episodic' })),
    cand(mod('procedure', { memoryClass: 'procedural' })),
    cand(mod('fact', { memoryClass: 'semantic' })),
  ];

  it('selection keeps the candidate order', () => {
    const result = compile(envelope(), contract(), candidates, profile({ orderRule: 'selection' }));
    expect(result.manifest?.entries.map((e) => e.moduleId)).toEqual([
      'episode',
      'procedure',
      'fact',
    ]);
  });

  it('volatility puts stable memory first and volatile memory last', () => {
    const result = compile(envelope(), contract(), candidates, ULTRAROUTER_PROFILE);
    expect(result.manifest?.entries.map((e) => e.moduleId)).toEqual([
      'procedure',
      'fact',
      'episode',
    ]);
    expect(result.manifest?.entries.map((e) => e.order)).toEqual([0, 1, 2]);
  });
});

describe('limits, ceilings and kind vocabularies', () => {
  it('a result ceiling refuses candidates past it', () => {
    const result = compile(
      envelope(),
      contract(),
      [cand(mod('a')), cand(mod('b')), cand(mod('c'))],
      profile({ resultCeiling: 2 }),
    );
    expect(result.refusals).toEqual([
      expect.objectContaining({
        moduleId: 'c',
        reason: 'LIMIT_EXCEEDED',
        detail: 'result_ceiling',
      }),
    ]);
  });

  it('a default kind cap applies when no explicit limit matches', () => {
    const result = compile(
      envelope(),
      contract(),
      [cand(mod('g1')), cand(mod('g2')), cand(mod('e1', { kind: 'example' }))],
      profile({ defaultKindLimit: 1 }),
    );
    expect(result.manifest?.entries.map((e) => e.moduleId).sort()).toEqual(['e1', 'g1']);
    expect(result.refusals[0]).toMatchObject({ moduleId: 'g2', detail: 'default_kind_limit' });
  });

  it('a per-facet contract limit counts matching modules', () => {
    const result = compile(
      envelope(),
      contract({
        limits: [{ facet: 'polarity', facetValue: 'negative', max: 1, label: 'negative examples' }],
      }),
      [
        cand(mod('n1', { kind: 'example', facets: { polarity: 'negative' } })),
        cand(mod('n2', { kind: 'example', facets: { polarity: 'negative' } })),
        cand(mod('p1', { kind: 'example', facets: { polarity: 'positive' } })),
      ],
      ULTRAROUTER_PROFILE,
    );
    expect(result.manifest?.entries.map((e) => e.moduleId).sort()).toEqual(['n1', 'p1']);
    expect(result.refusals[0]?.message).toContain('negative examples');
  });

  it('defineKinds collapses duplicates and preserves order', () => {
    const kinds = defineKinds(['guide', 'note', 'guide', 'example']);
    expect(kinds.kinds).toEqual(['guide', 'note', 'example']);
    expect(kinds.has('note')).toBe(true);
    expect(kinds.has('policy')).toBe(false);
  });
});

describe('custom manifest encoders', () => {
  const sortedEncoder: CompatibilityProfile['manifestEncoder'] = (manifest, ctx) => {
    const subject = {
      tenant: ctx.envelope.tenant,
      entries: manifest.entries.map((e) => [e.moduleId, e.contentHash]),
    };
    const bytes = JSON.stringify(subject);
    return { bytes, hash: `custom:${sha256Hex(bytes)}` };
  };

  it('the manifest hash is the encoder hash, and it is deterministic', () => {
    const p = profile({ manifestEncoder: sortedEncoder });
    const inputs = [envelope(), contract(), [cand(mod('a')), cand(mod('b'))], p] as const;
    const first = compile(...inputs);
    const second = compile(...inputs);
    expect(first.manifest?.manifestHash).toMatch(/^custom:[0-9a-f]{64}$/);
    expect(first.manifest?.manifestHash).toBe(second.manifest?.manifestHash);
    expect(first.manifest?.manifestHash).not.toBe(
      compile(envelope(), contract(), [cand(mod('a')), cand(mod('b'))], ULTRAROUTER_PROFILE)
        .manifest?.manifestHash,
    );
  });

  it('a custom envelope hash replaces the default one', () => {
    const p = profile({
      hashEnvelope: (env) => `env:${sha256Hex(canonicalJson({ id: env.id, tenant: env.tenant }))}`,
    });
    expect(compile(envelope(), contract(), [], p).manifest?.envelopeHash).toMatch(
      /^env:[0-9a-f]{64}$/,
    );
  });

  it('the scaffold hash ignores per-execution fields but tracks the admitted scaffold', () => {
    const a = compile(
      envelope({ id: 'run-1', seed: 'x' }),
      contract(),
      [cand(mod('a'))],
      ULTRAROUTER_PROFILE,
    ).manifest;
    const b = compile(
      envelope({ id: 'run-2', seed: 'y' }),
      contract(),
      [cand(mod('a'))],
      ULTRAROUTER_PROFILE,
    ).manifest;
    const c = compile(
      envelope({ id: 'run-3' }),
      contract(),
      [cand(mod('a')), cand(mod('b'))],
      ULTRAROUTER_PROFILE,
    ).manifest;
    expect(a?.scaffoldHash).toBe(b?.scaffoldHash);
    expect(a?.envelopeHash).not.toBe(b?.envelopeHash);
    expect(c?.scaffoldHash).not.toBe(a?.scaffoldHash);
  });
});
