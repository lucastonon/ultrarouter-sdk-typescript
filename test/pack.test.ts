import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  DESCRIPTOR_MAX_LENGTH,
  LoadPackError,
  UR_KNOWLEDGE_FORMAT,
  loadPack,
  packContentHash,
  packProvenanceHash,
  parsePack,
  renderPack,
  validatePack,
  type PackDocument,
} from '../src/pack.js';

/**
 * `loadPack` and the portable `*.ur.md` format. The fixture `release-checklist.ur.md` is a synthetic
 * pack rendered and signed by the gateway's own renderer (a drift gate on the gateway side keeps it
 * current). This SDK cannot import that code, so it must independently recompute the same digests
 * (`loadPack` succeeds) and re-render the same bytes (`renderPack(parsePack(x)) === x`).
 */

const fixDir = join(dirname(fileURLToPath(import.meta.url)), 'pack');
const golden = readFileSync(join(fixDir, 'release-checklist.ur.md'), 'utf8');

describe('loadPack: lockstep with the gateway renderer', () => {
  it('loads the core-rendered golden and projects it to a context Module', () => {
    const { document, module } = loadPack(golden);
    expect(document.urFormat).toBe(UR_KNOWLEDGE_FORMAT);
    // the SDK recomputed the SAME content_hash the core declared (else validatePack would refuse)
    expect(packContentHash({ ...document, contentHash: '', provenanceHash: '' })).toBe(
      document.contentHash,
    );
    // the Module contentHash IS the join key
    expect(module.contentHash).toBe(document.contentHash);
    expect(module.id).toBe('pack_release_checklist');
    expect(module.trustClass).toBe('authoritative');
    expect(module.slotHint).toBe('instruction');
    // the SOP payload round-trips on ext (parent-only fields)
    expect((module.ext?.ur_knowledge as Record<string, unknown>).provenance_hash).toBe(
      document.provenanceHash,
    );
  });

  it('re-renders the core-generated golden BYTE-for-byte (render lockstep)', () => {
    expect(renderPack(parsePack(golden))).toBe(golden);
  });

  it('validates the golden against a tenant + a required export consent', () => {
    const doc = parsePack(golden);
    expect(validatePack(doc, { workspace: 'ws_fixture', requireExportConsent: true }).ok).toBe(
      true,
    );
    const wrong = validatePack(doc, { workspace: 'ws_other' });
    expect(wrong.ok).toBe(false);
    if (!wrong.ok) expect(wrong.refusals).toContain('TENANT_MISMATCH');
  });
});

describe('SDK loadPack — fails closed on untrusted input', () => {
  it('refuses a tampered content_hash (LoadPackError with CONTENT_HASH_MISMATCH)', () => {
    const tampered = golden.replace('token_estimate: 180', 'token_estimate: 999');
    expect(() => loadPack(tampered)).toThrow(LoadPackError);
    try {
      loadPack(tampered);
    } catch (e) {
      expect((e as LoadPackError).refusals).toContain('CONTENT_HASH_MISMATCH');
    }
  });

  it('refuses an unsupported format token at parse time', () => {
    expect(() => parsePack(golden.replace('ur.knowledge/1', 'ur.knowledge/9'))).toThrow(
      /UNSUPPORTED_FORMAT/,
    );
  });

  it('refuses an approved_derived module in an instruction slot', () => {
    // Build a minimal valid learned_pack, then move it to an instruction slot.
    const { sop: _omitSop, ...rest } = parsePack(golden);
    void _omitSop;
    const learned: PackDocument = {
      ...rest,
      kind: 'learned_pack',
      trustClass: 'approved_derived',
      slot: 'instruction',
    };
    const res = validatePack(learned);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.refusals).toContain('UNTRUSTED_IN_INSTRUCTION_SLOT');
  });
});

/** Sign a document (fill both hashes with the SDK's own functions) then render it. */
function sign(base: PackDocument): PackDocument {
  const contentHash = packContentHash({ ...base, contentHash: '', provenanceHash: '' });
  const withContent = { ...base, contentHash };
  const provenanceHash = packProvenanceHash({ ...withContent, provenanceHash: '' });
  return { ...withContent, provenanceHash };
}

describe('SDK — a hand-built learned pack round-trips deterministically', () => {
  const learned: PackDocument = sign({
    urFormat: UR_KNOWLEDGE_FORMAT,
    id: 'pack_denials',
    version: 2,
    kind: 'learned_pack',
    memoryClass: 'semantic',
    trustClass: 'approved_derived',
    slot: 'learned',
    descriptor: 'Denial priors',
    appliesWhen: { type: 'situation_is', situationClass: 'sit1_outpatient' },
    phase: ['plan'],
    singleUse: false,
    nativeDelivery: 'anthropic',
    tokenEstimate: 120,
    validity: {
      from: null,
      to: null,
      epochBinding: 'epoch_1',
      invalidationTriggers: ['model_family'],
    },
    evidence: {
      n: 240,
      clusters: 8,
      interval: [0.09, 0.15],
      evidenceTier: 'measured',
      armSources: ['treated'],
      window: { start: null, end: null },
    },
    lineage: { factIds: ['kf_b1'], rollupDigest: 'r' },
    consent: { workspace: 'ws_alpha', exportConsent: true, redactionVersion: 'redact1' },
    contentHash: '',
    provenanceHash: '',
    body: {
      checklist: [{ factId: 'kf_c1', text: 'Verify: modifier present' }],
      exemplars: [],
      baseRates: [
        { factId: 'kf_b1', subject: 'denial_rate', rate: 0.12, n: 240, interval: [0.09, 0.15] },
      ],
      refuted: [],
    },
  });

  it('is byte-stable across render → parse → render and loads with a tenant + consent', () => {
    const text = renderPack(learned);
    expect(renderPack(parsePack(text))).toBe(text);
    expect(text.length).toBeLessThan(DESCRIPTOR_MAX_LENGTH * 100); // sanity guard on the fixture size
    const loaded = loadPack(text, { workspace: 'ws_alpha', requireExportConsent: true });
    expect(loaded.document.id).toBe('pack_denials');
    expect(loaded.module.memoryClass).toBe('semantic');
  });

  it('exposes the synthetic golden SOP payload unchanged', () => {
    const doc = parsePack(golden);
    expect(doc.sop?.phases.map((p) => p.id)).toEqual(['plan', 'build', 'verify', 'ship']);
    expect(doc.sop?.dependencies.map((d) => d.kind)).toEqual(['PACKET', 'POLICY', 'RUBRIC']);
    expect(doc.body.checklist).toHaveLength(3);
    expect(doc.body.exemplars).toHaveLength(2);
    expect(doc.body.baseRates).toHaveLength(1);
    expect(doc.body.refuted).toHaveLength(1);
  });
});
