/**
 * The exit guarantee, proven through the shipped `@ultrarouter/sdk/context` entry with no service
 * running:
 *
 *   1. compile → render → export the manifest and bodies as plain JSON → re-parse → `toMessages`
 *      reconstructs the same provider messages, offline.
 *   2. `toMessages(fromMessages(m))` is byte-identical to `m` even after the manifest has crossed a
 *      JSON boundary.
 *   3. Entry separation: the runtime lives only on the `context` entry; the client entry
 *      (`@ultrarouter/sdk`) exports none of it (the built-bundle proof is `scripts/size-check.mjs`).
 */
import { describe, expect, it } from 'vitest';

import * as coreSdk from '../../src/index.js';
import {
  compile,
  fromMessages,
  render,
  toMessages,
  ULTRAROUTER_PROFILE,
  type Contract,
  type ContextCandidate,
  type Envelope,
  type Module,
} from '../../src/context.js';

function makeModule(
  id: string,
  kind: string,
  slot: string,
  overrides: Partial<Module> = {},
): Module {
  return {
    id,
    version: '1',
    kind,
    memoryClass: 'semantic',
    trustClass: 'approved_derived',
    privacyClass: 'workspace_private',
    availability: { from: null, to: null },
    contentHash: `hash:${id}`,
    tokenEstimate: 10,
    facets: {},
    slotHint: slot,
    ...overrides,
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

const contract: Contract = {
  stage: 'stage-1',
  requiredKinds: [],
  optionalKinds: ['sop', 'doc'],
  forbiddenKinds: [],
  budgets: {},
  limits: [],
  pinPolicy: 'none',
  slots: ['instruction', 'reference', 'exemplar'],
};

const candidates: ContextCandidate[] = [
  { module: makeModule('sop', 'sop', 'instruction'), slot: 'instruction' },
  { module: makeModule('doc', 'doc', 'reference'), slot: 'reference' },
];

/** Round-trip a JSON value the way a customer "leaving in one file" would (no service). */
function throughJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

describe('exit guarantee — compile → render → JSON → toMessages, offline', () => {
  it('renders a compiled manifest and re-derives the same messages after a JSON round-trip', () => {
    const result = compile(envelope, contract, candidates, ULTRAROUTER_PROFILE);
    expect(result.ok).toBe(true);
    const manifest = result.manifest;
    expect(manifest).not.toBeNull();
    if (manifest === null) return;

    const bodies = new Map<string, string>([
      ['sop', 'Follow the refund policy exactly.'],
      ['doc', 'Order #4021 was placed on 2026-03-30.'],
    ]);

    // Live render (in-process).
    const rendered = render(manifest, bodies);
    expect(rendered.map((message) => message.role)).toEqual(['system', 'user']);

    // Export the manifest + bodies as plain JSON and re-parse — as if resumed in another
    // process with nothing but the SDK. `toMessages` must reconstruct the same messages.
    const exported = throughJson({ manifest, bodies: [...bodies] });
    const importedBodies = new Map(exported.bodies);
    const exited = toMessages(exported.manifest, importedBodies);

    expect(exited).toEqual(rendered);
    expect(JSON.stringify(exited)).toBe(JSON.stringify(rendered));
  });

  it('is deterministic: the same inputs export the same manifest hash', () => {
    const a = compile(envelope, contract, candidates, ULTRAROUTER_PROFILE);
    const b = compile(envelope, contract, candidates, ULTRAROUTER_PROFILE);
    expect(a.manifest?.manifestHash).toBe(b.manifest?.manifestHash);
  });
});

describe('exit guarantee — fromMessages → JSON → toMessages is byte-identical', () => {
  it('reconstructs the exact original messages after the manifest crosses a JSON boundary', () => {
    const messages = [
      { role: 'system', content: 'You are LumaShop support.' },
      { role: 'user', content: 'Where is my order #4021?' },
    ];
    const lifted = fromMessages(messages);
    const manifest = throughJson(lifted.manifest); // serialize → parse, no service
    const exited = toMessages(manifest);
    expect(exited).toEqual(messages);
    expect(JSON.stringify(exited)).toBe(JSON.stringify(messages));
  });
});

describe('exit guarantee — entry separation', () => {
  it('the core @ultrarouter/sdk entry does not export the context runtime', () => {
    for (const symbol of ['compile', 'fromMessages', 'toMessages', 'render']) {
      expect(symbol in coreSdk, `core SDK unexpectedly exports ${symbol}`).toBe(false);
    }
  });

  it('the context subpath exports the four exit helpers', () => {
    expect(typeof compile).toBe('function');
    expect(typeof fromMessages).toBe('function');
    expect(typeof render).toBe('function');
    expect(typeof toMessages).toBe('function');
  });
});
