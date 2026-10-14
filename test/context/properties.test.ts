/**
 * Property tests for the pure compiler: determinism, idempotent re-compile, and monotone shedding.
 * Same inputs produce the same manifest hash; re-compiling the admitted set is stable; tightening a
 * budget only ever removes survivors, never adds or reorders one.
 */
import { describe, expect, it } from 'vitest';

import {
  ULTRAROUTER_PROFILE,
  compile,
  type Contract,
  type ContextCandidate,
  type Envelope,
  type Module,
} from '../../src/context.js';

function makeModule(id: string, memoryClass: string, tokenEstimate: number): Module {
  return {
    id,
    version: '1',
    kind: 'note',
    memoryClass,
    trustClass: 'approved_derived',
    privacyClass: 'workspace_private',
    availability: { from: null, to: null },
    contentHash: `hash:${id}`,
    tokenEstimate,
    facets: {},
  };
}

const envelope: Envelope = {
  id: 'env-1',
  tenant: 'tenant-1',
  stage: 'stage-1',
  mode: 'live',
  asOf: '2026-04-01T00:00:00.000Z',
  cutoffs: {},
  budgets: {},
  seed: 'seed',
  pins: [],
  releases: {},
  permissionEpoch: 'epoch-1',
};

function contractWithBudget(tokens: number | undefined): Contract {
  return {
    stage: 'stage-1',
    requiredKinds: [],
    optionalKinds: ['note'],
    forbiddenKinds: [],
    budgets: tokens === undefined ? {} : { tokens },
    limits: [],
    pinPolicy: 'none',
    slots: ['instruction', 'reference', 'exemplar'],
  };
}

// A mix of memory classes and costs so the keep-priority order is non-trivial.
const modules: Module[] = [
  makeModule('proc', 'procedural', 30),
  makeModule('sem', 'semantic', 30),
  makeModule('work', 'working', 30),
  makeModule('epi', 'episodic', 30),
];
const candidates: ContextCandidate[] = modules.map((module) => ({ module }));

function admittedIds(tokens: number | undefined): string[] {
  const result = compile(envelope, contractWithBudget(tokens), candidates, ULTRAROUTER_PROFILE);
  return (result.manifest?.entries ?? []).map((entry) => entry.moduleId);
}

describe('determinism', () => {
  it('produces an identical manifest hash for identical inputs', () => {
    const a = compile(envelope, contractWithBudget(undefined), candidates, ULTRAROUTER_PROFILE);
    const b = compile(envelope, contractWithBudget(undefined), candidates, ULTRAROUTER_PROFILE);
    expect(a.manifest?.manifestHash).toBe(b.manifest?.manifestHash);
    expect(a.manifest?.entries.map((e) => e.moduleId)).toEqual(
      b.manifest?.entries.map((e) => e.moduleId),
    );
  });
});

describe('idempotent re-compile', () => {
  it('re-compiling the admitted set yields the same manifest hash', () => {
    const first = compile(envelope, contractWithBudget(undefined), candidates, ULTRAROUTER_PROFILE);
    const admitted = (first.manifest?.entries ?? []).map((entry) => {
      const module = modules.find((m) => m.id === entry.moduleId);
      if (module === undefined) throw new Error('missing module');
      return { module } satisfies ContextCandidate;
    });
    const second = compile(envelope, contractWithBudget(undefined), admitted, ULTRAROUTER_PROFILE);
    expect(second.manifest?.manifestHash).toBe(first.manifest?.manifestHash);
  });
});

describe('monotone shedding', () => {
  it('tightening the budget only removes survivors and never reorders them', () => {
    const loose = admittedIds(undefined); // all four
    expect(loose.length).toBe(4);
    let previous = loose;
    for (const budget of [120, 90, 60, 30, 0]) {
      const tighter = admittedIds(budget);
      // Survivors are a subset of the looser set …
      expect(tighter.every((id) => previous.includes(id))).toBe(true);
      // … and keep their relative order.
      const orderInPrevious = tighter.map((id) => previous.indexOf(id));
      expect(orderInPrevious).toEqual([...orderInPrevious].sort((a, b) => a - b));
      previous = tighter;
    }
  });

  it('the most stable module is shed last', () => {
    // With room for exactly one module, procedural (most stable) survives.
    expect(admittedIds(30)).toEqual(['proc']);
  });
});
