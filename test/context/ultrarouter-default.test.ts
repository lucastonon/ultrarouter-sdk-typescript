/**
 * The default `ULTRAROUTER_PROFILE` (the profile the gateway witnesses through `ur.manifest`),
 * reproduced byte-for-byte against a golden: the full manifest bytes, hash, item refs and refusal
 * codes in `fixtures/ultrarouter/default.json` (generated from this implementation by
 * `gen-ultrarouter-golden.mjs`). A shape check alone would miss a reversed canonical-JSON key order
 * (a 64-hex hash is still 64 hex); the input covers key order and nesting at four depths (the
 * top-level subject, `budgets`, each entry's nested `ext.meta`, and the `refused[]` array), so a
 * serializer regression fails here. Other-language SDKs can consume the same file to prove parity.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  compile,
  ULTRAROUTER_PROFILE,
  type Contract,
  type ContextCandidate,
  type Envelope,
  type Manifest,
} from '../../src/context.js';

interface Golden {
  readonly ok: boolean;
  readonly hash: string;
  readonly bytes: string;
  readonly itemRefs: readonly string[];
  readonly refusalCodes: readonly string[];
}

interface Fixture {
  readonly _provenance: { readonly description: string };
  readonly input: {
    readonly envelope: Envelope;
    readonly contract: Contract;
    readonly candidates: readonly ContextCandidate[];
  };
  readonly golden: Golden;
}

const here = dirname(fileURLToPath(import.meta.url));

function loadFixture(): Fixture {
  const path = join(here, 'fixtures', 'ultrarouter', 'default.json');
  return JSON.parse(readFileSync(path, 'utf8')) as Fixture;
}

function requireManifest(manifest: Manifest | null): Manifest {
  if (manifest === null) throw new Error('expected a manifest');
  return manifest;
}

function itemRefs(manifest: Manifest): string[] {
  return manifest.entries.map((entry) => {
    const ref = (entry.ext as { ref?: string } | undefined)?.ref;
    return ref ?? entry.moduleId;
  });
}

describe('ULTRAROUTER_PROFILE — the default profile, byte-identical to the shared golden', () => {
  const fixture = loadFixture();

  it(`default: ${fixture._provenance.description}`, () => {
    const { envelope, contract, candidates } = fixture.input;
    const result = compile(envelope, contract, candidates, ULTRAROUTER_PROFILE);
    expect(result.ok).toBe(fixture.golden.ok);
    expect(result.ok).toBe(true);
    const manifest = requireManifest(result.manifest);

    // Re-encode without the produced hash, through the profile's own encoder.
    const { manifestHash: _hash, ...withoutHash } = manifest;
    const encoded = ULTRAROUTER_PROFILE.manifestEncoder(withoutHash, { envelope, contract });

    expect(encoded.bytes).toBe(fixture.golden.bytes);
    expect(encoded.hash).toBe(fixture.golden.hash);
    expect(manifest.manifestHash).toBe(fixture.golden.hash);
    expect(itemRefs(manifest)).toEqual(fixture.golden.itemRefs);
    expect(
      manifest.refused.filter((refusal) => !refusal.fatal).map((refusal) => refusal.code),
    ).toEqual(fixture.golden.refusalCodes);
  });

  it('the golden is a NON-TRIVIAL subject — refused[] and a nested entry ext bite key order', () => {
    // A golden whose subject has one key per level would leave the key-order hole open; assert
    // the shape the mutation proof depends on so a future edit cannot quietly hollow it out.
    expect(fixture.golden.refusalCodes.length).toBeGreaterThanOrEqual(2);
    const parsedBytes = JSON.parse(fixture.golden.bytes) as {
      refused: readonly unknown[];
      entries: readonly { ext: { meta?: Record<string, unknown> } | null }[];
    };
    expect(parsedBytes.refused.length).toBeGreaterThanOrEqual(2);
    const firstEntry = parsedBytes.entries[0];
    expect(firstEntry).toBeDefined();
    // a nested ext.meta object with >1 key — nesting must bite at least four levels deep.
    expect(Object.keys(firstEntry?.ext?.meta ?? {}).length).toBeGreaterThanOrEqual(2);
  });
});
