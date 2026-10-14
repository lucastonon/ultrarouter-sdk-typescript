#!/usr/bin/env node
// Generates the default-profile golden `fixtures/ultrarouter/default.json`: it compiles a
// deliberately rich input through the built `@ultrarouter/sdk/context` entry with
// `ULTRAROUTER_PROFILE` and freezes the encoded manifest bytes and sha256, so any implementation of
// the default profile (in any language) must reproduce them byte-for-byte. Never hand-edit the
// golden; regenerate it:
//
//   npm run build && node test/context/gen-ultrarouter-golden.mjs
//
// The input exercises key order and nesting at four depths: the top-level subject, `budgets`, each
// `entries[]` entry with a nested `ext.meta` object, and the `refused[]` array (two non-fatal
// refusals), so reversing the serializer's key order changes the bytes at every level.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SUBPATH = resolve(HERE, '../../dist/context.js');
const { compile, ULTRAROUTER_PROFILE } = await import(SUBPATH);

const envelope = {
  id: 'env-ur-1',
  tenant: 'tenant-ur',
  stage: 'assistant',
  mode: 'live',
  asOf: '2026-04-01T00:00:00.000Z',
  cutoffs: { policy: '2026-01-01T00:00:00.000Z' },
  budgets: { tokens: 40 },
  seed: 'seed-ur',
  pins: [],
  releases: {},
  permissionEpoch: 'epoch-ur-1',
  ext: { worldSnapshotId: 'snap-9', lineage: { release: 'r-42', locale: 'en-US' } },
};

const mod = (id, kind, memoryClass, trustClass, ref, revision) => ({
  id,
  version: '1',
  kind,
  memoryClass,
  trustClass,
  privacyClass: 'workspace_private',
  availability: { from: null, to: null },
  contentHash: `hash:${id}`,
  tokenEstimate: 10,
  facets: {},
  ext: { ref, meta: { source: `${kind}-lib`, revision } },
});

// procedure (procedural, most stable) + fact (semantic) are admitted; history (episodic, most
// volatile) is shed by the token budget (25 < 30) — a non-fatal BUDGET_EXCEEDED; the scratchpad
// kind is not optional for this stage — a non-fatal FORBIDDEN_KIND. Two entries, two refusals,
// reordered stable→volatile by the ultrarouter `volatility` rule.
const candidates = [
  { module: mod('procedures', 'procedure', 'procedural', 'approved_derived', 'proc://runbook', 3) },
  { module: mod('facts', 'fact', 'semantic', 'authoritative', 'fact://pricing', 7) },
  { module: mod('history', 'history', 'episodic', 'approved_derived', 'hist://thread-1', 1) },
  { module: mod('scratch', 'scratchpad', 'working', 'approved_derived', 'scratch://x', 0) },
];

const contract = {
  stage: 'assistant',
  requiredKinds: [],
  optionalKinds: ['procedure', 'fact', 'history'],
  forbiddenKinds: [],
  budgets: { tokens: 25 },
  limits: [],
  pinPolicy: 'none',
  slots: ['instruction', 'reference', 'exemplar'],
};

const result = compile(envelope, contract, candidates, ULTRAROUTER_PROFILE);
if (!result.ok || result.manifest === null) {
  throw new Error('expected an admissible manifest');
}
const manifest = result.manifest;
const { manifestHash, ...withoutHash } = manifest;
const encoded = ULTRAROUTER_PROFILE.manifestEncoder(withoutHash, { envelope, contract });
if (encoded.hash !== manifestHash) {
  throw new Error('encoder hash disagrees with the compiled manifest hash');
}
const itemRefs = manifest.entries.map((entry) => entry.ext?.ref ?? entry.moduleId);
const refusalCodes = manifest.refused
  .filter((refusal) => !refusal.fatal)
  .map((refusal) => refusal.code);

const fixture = {
  _provenance: {
    profile: 'ULTRAROUTER_PROFILE',
    generatedBy:
      'test/context/gen-ultrarouter-golden.mjs — compile + ULTRAROUTER_PROFILE.manifestEncoder over the built @ultrarouter/sdk/context',
    description:
      'the ultrarouter default profile: two admitted modules (volatility-reordered) with a nested ext, one token-shed and one non-optional refusal — key order and nesting bite at every depth',
  },
  input: { envelope, contract, candidates },
  golden: {
    ok: true,
    hash: manifestHash,
    bytes: encoded.bytes,
    itemRefs,
    refusalCodes,
  },
};

const out = resolve(HERE, 'fixtures', 'ultrarouter', 'default.json');
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, `${JSON.stringify(fixture, null, 2)}\n`, 'utf8');
process.stdout.write(
  `wrote ${out}\n  hash=${manifestHash}\n  itemRefs=${JSON.stringify(itemRefs)}\n  refusalCodes=${JSON.stringify(refusalCodes)}\n`,
);
