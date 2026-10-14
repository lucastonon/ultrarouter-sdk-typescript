import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { PACK_EXIT, runPackValidate, type PackCliDeps } from '../src/cli/pack.js';
import { packContentHash, packProvenanceHash, renderPack, type PackDocument } from '../src/pack.js';

/**
 * The `ur pack validate` core (injected IO, exit codes): a valid pack exits 0; a cross-tenant, tampered,
 * consent-revoked or malformed pack is refused with named reasons (exit 2, fail closed); an unreadable
 * file exits 2.
 */

const golden = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'pack', 'release-checklist.ur.md'),
  'utf8',
);

function sign(base: PackDocument): PackDocument {
  const contentHash = packContentHash({ ...base, contentHash: '', provenanceHash: '' });
  const withContent = { ...base, contentHash };
  return {
    ...withContent,
    provenanceHash: packProvenanceHash({ ...withContent, provenanceHash: '' }),
  };
}

function validLearnedPackText(
  consent = { workspace: 'ws_alpha', exportConsent: true, redactionVersion: 'redact1' },
): string {
  return renderPack(
    sign({
      urFormat: 'ur.knowledge/1',
      id: 'pack_denials',
      version: 1,
      kind: 'learned_pack',
      memoryClass: 'semantic',
      trustClass: 'approved_derived',
      slot: 'learned',
      descriptor: 'Denial priors',
      appliesWhen: { type: 'always' },
      phase: ['plan'],
      singleUse: false,
      nativeDelivery: 'anthropic',
      tokenEstimate: 100,
      validity: { from: null, to: null, epochBinding: 'e1', invalidationTriggers: [] },
      evidence: {
        n: 200,
        clusters: 8,
        interval: [0.1, 0.2],
        evidenceTier: 'measured',
        armSources: ['treated'],
        window: { start: null, end: null },
      },
      lineage: { factIds: ['kf_b1'], rollupDigest: 'r' },
      consent,
      contentHash: '',
      provenanceHash: '',
      body: {
        checklist: [],
        exemplars: [],
        baseRates: [{ factId: 'kf_b1', subject: 's', rate: 0.15, n: 200, interval: [0.1, 0.2] }],
        refuted: [],
      },
    }),
  );
}

interface Harness {
  deps: PackCliDeps;
  out: string[];
  errs: string[];
}

function harness(files: Record<string, string>): Harness {
  const out: string[] = [];
  const errs: string[] = [];
  const deps: PackCliDeps = {
    readFile: (p) => {
      const f = files[p];
      if (f === undefined) throw new Error(`ENOENT: ${p}`);
      return f;
    },
    log: (l) => out.push(l),
    err: (l) => errs.push(l),
  };
  return { deps, out, errs };
}

describe('ur pack validate', () => {
  it('accepts a good pack and exits 0', () => {
    const h = harness({ 'p.ur.md': validLearnedPackText() });
    const res = runPackValidate(h.deps, {
      file: 'p.ur.md',
      workspace: 'ws_alpha',
      requireExportConsent: true,
      json: false,
    });
    expect(res.exitCode).toBe(PACK_EXIT.OK);
    expect(h.out.join('\n')).toContain('valid: pack_denials');
  });

  it('accepts the gateway-rendered golden for its own workspace (JSON output)', () => {
    const h = harness({ 'g.ur.md': golden });
    const res = runPackValidate(h.deps, {
      file: 'g.ur.md',
      workspace: 'ws_fixture',
      requireExportConsent: true,
      json: true,
    });
    expect(res.exitCode).toBe(PACK_EXIT.OK);
    expect(JSON.parse(h.out[0] ?? '{}')).toMatchObject({
      ok: true,
      id: 'pack_release_checklist',
      kind: 'sop',
    });
  });

  it('refuses a cross-tenant pack with a named reason (exit 2)', () => {
    const h = harness({ 'p.ur.md': validLearnedPackText() });
    const res = runPackValidate(h.deps, {
      file: 'p.ur.md',
      workspace: 'ws_intruder',
      requireExportConsent: false,
      json: true,
    });
    expect(res.exitCode).toBe(PACK_EXIT.FAIL);
    expect(h.errs.join('\n')).toContain('TENANT_MISMATCH');
  });

  it('refuses a consent-revoked pack only when export consent is required', () => {
    const text = validLearnedPackText({
      workspace: 'ws_alpha',
      exportConsent: false,
      redactionVersion: 'redact1',
    });
    const strict = harness({ 'p.ur.md': text });
    expect(
      runPackValidate(strict.deps, { file: 'p.ur.md', requireExportConsent: true, json: true })
        .exitCode,
    ).toBe(PACK_EXIT.FAIL);
    expect(strict.errs.join('\n')).toContain('EXPORT_CONSENT_REVOKED');
    const lenient = harness({ 'p.ur.md': text });
    expect(
      runPackValidate(lenient.deps, { file: 'p.ur.md', requireExportConsent: false, json: false })
        .exitCode,
    ).toBe(PACK_EXIT.OK);
  });

  it('refuses a tampered pack (CONTENT_HASH_MISMATCH, exit 2)', () => {
    const h = harness({
      'p.ur.md': validLearnedPackText().replace('token_estimate: 100', 'token_estimate: 777'),
    });
    const res = runPackValidate(h.deps, {
      file: 'p.ur.md',
      requireExportConsent: false,
      json: true,
    });
    expect(res.exitCode).toBe(PACK_EXIT.FAIL);
    expect(h.errs.join('\n')).toContain('CONTENT_HASH_MISMATCH');
  });

  it('refuses an unsupported format token (exit 2)', () => {
    const h = harness({ 'p.ur.md': golden.replace('ur.knowledge/1', 'ur.knowledge/9') });
    const res = runPackValidate(h.deps, {
      file: 'p.ur.md',
      requireExportConsent: false,
      json: false,
    });
    expect(res.exitCode).toBe(PACK_EXIT.FAIL);
    expect(h.errs.join('\n')).toContain('UNSUPPORTED_FORMAT');
  });

  it('fails closed (exit 2) on an unreadable file', () => {
    const h = harness({});
    const res = runPackValidate(h.deps, {
      file: 'missing.ur.md',
      requireExportConsent: false,
      json: false,
    });
    expect(res.exitCode).toBe(PACK_EXIT.FAIL);
    expect(h.errs.join('\n')).toContain('cannot read missing.ur.md');
  });
});
