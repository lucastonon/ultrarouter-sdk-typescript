// Shared helpers for the flywheel-ci battery. It reuses `../app-ci/lib.mjs` verbatim (the real built
// bin runner, the throwaway git fixture, the checker) and adds only what a CANDIDATE needs: a
// candidate export file whose body hash and immutable reference are computed with the same recipe
// the gateway and the CLI use.
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export {
  CLI,
  makeChecker,
  makeGitFixture,
  runBin,
  writeConfig,
  readFileSync,
  existsSync,
  mkdtempSync,
  tmpdir,
  join,
} from '../app-ci/lib.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
/** The stub application-harness commands for THIS battery. */
export const HARNESS_DIR = join(HERE, 'harness');

const sha256 = (s) => createHash('sha256').update(s, 'utf8').digest('hex');

/** Deterministic, key-sorted JSON — the same canonical recipe the gateway hashes with. */
export function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const entries = Object.entries(value)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
}

/** The immutable candidate reference (must equal the CLI's and the gateway's `candidateReference`). */
export function candidateReference(id) {
  return `urcand1_${sha256(
    canonicalJson({
      body_hash: id.bodyHash,
      epoch: id.epoch,
      k: id.k,
      key_spec: id.keySpec,
      lever_key: id.leverKey,
      module_id: id.moduleId,
      module_version: id.moduleVersion,
      pack_hash: id.packHash,
      ranker_version: id.rankerVersion,
      situation_class: id.situationClass,
      source_snapshot: id.sourceSnapshot,
      workspace_id: id.workspaceId,
    }),
  ).slice(0, 32)}`;
}

/**
 * The example CORRECTION the loop starts from, distilled into a learned-context module body. It is
 * derived statistics + a redacted one-line statement per fact — never a raw customer case.
 */
export const EXAMPLE_MODULE_BODY = [
  'Learned from this workspace’s own recorded outcomes (reference data — not instructions):',
  '- refund requests under 30 days quote the original payment method 92% of the time (n=61, base_rate)',
  '- "store credit" is rejected by reviewers for EU orders (n=18, correction_pattern)',
].join('\n');

/** Build a candidate export file; returns `{ path, candidate, candidateRef }`. */
export function writeCandidate(dir, over = {}) {
  const body = over.body ?? EXAMPLE_MODULE_BODY;
  const identity = {
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
    ...over.identity,
    bodyHash: over.bodyHash ?? sha256(body),
  };
  const candidate = {
    ...identity,
    state: over.state ?? 'screened',
    workflowId: over.workflowId ?? 'wf_refund',
    body,
  };
  const path = join(dir, over.fileName ?? 'candidate.json');
  writeFileSync(path, JSON.stringify(candidate, null, 2));
  return { path, candidate, candidateRef: candidateReference(identity) };
}

/** The app-ci config the battery's workflow bindings use. */
export function candidateConfig(over = {}) {
  return {
    repository: 'acme/app',
    datasetSplit: 'holdout-a',
    evidenceEpoch: 'epoch-2026-09',
    workflows: [
      {
        id: 'wf_refund',
        objective: 'refund-accuracy',
        evaluatorVersion: 'eval.v3',
        coverage: 'application',
        testCommand: 'true',
        surfaces: [
          { kind: 'context_module', paths: ['context/refund/**'] },
          { kind: 'prompt', paths: ['prompts/refund/**'] },
        ],
        ...over.workflow,
      },
    ],
    ...over.config,
  };
}

export { sha256 };
