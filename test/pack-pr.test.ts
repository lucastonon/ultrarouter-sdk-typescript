import { describe, expect, it } from 'vitest';

import { unifiedDiff } from '../src/cli/flywheel-pr.js';
import {
  loadPack,
  packContentHash,
  packProvenanceHash,
  renderPack,
  type PackDocument,
} from '../src/pack.js';

/**
 * a PACK UPDATE becomes a REVIEWABLE PR DIFF. A learned-context pack is
 * a code-owned module file (`*.ur.md`) whose content is derived statistics only, so a new pack VERSION
 * rides the EXISTING delivery primitive (`unifiedDiff`, the same one `ur flywheel-pr` renders): a
 * git-apply-able diff between two SIGNED, `loadPack`-valid pack versions. This stages the PR path for
 * packs without a second diff engine.
 */

function sign(base: PackDocument): PackDocument {
  const contentHash = packContentHash({ ...base, contentHash: '', provenanceHash: '' });
  const withContent = { ...base, contentHash };
  return {
    ...withContent,
    provenanceHash: packProvenanceHash({ ...withContent, provenanceHash: '' }),
  };
}

function packAt(version: number, rate: number): PackDocument {
  return sign({
    urFormat: 'ur.knowledge/1',
    id: 'pack_denials',
    version,
    kind: 'learned_pack',
    memoryClass: 'semantic',
    trustClass: 'approved_derived',
    slot: 'learned',
    descriptor: 'Denial priors for outpatient coding',
    appliesWhen: { type: 'situation_is', situationClass: 'sit1_outpatient' },
    phase: ['plan'],
    singleUse: false,
    nativeDelivery: 'anthropic',
    tokenEstimate: 120,
    validity: { from: null, to: null, epochBinding: 'e1', invalidationTriggers: ['model_family'] },
    evidence: {
      n: 240,
      clusters: 8,
      interval: [rate - 0.03, rate + 0.03],
      evidenceTier: 'measured',
      armSources: ['treated'],
      window: { start: null, end: null },
    },
    lineage: { factIds: ['kf_b1'], rollupDigest: 'r', rankerVersion: 'ranker_1' },
    consent: { workspace: 'ws_alpha', exportConsent: true, redactionVersion: 'redact1' },
    contentHash: '',
    provenanceHash: '',
    body: {
      checklist: [{ factId: 'kf_c1', text: 'Verify the payer id before submission' }],
      exemplars: [],
      baseRates: [
        {
          factId: 'kf_b1',
          subject: 'denial_rate',
          rate,
          n: 240,
          interval: [rate - 0.03, rate + 0.03],
        },
      ],
      refuted: [],
    },
  });
}

describe('a pack update is a reviewable PR diff', () => {
  const v1 = renderPack(packAt(1, 0.12));
  const v2 = renderPack(packAt(2, 0.18));
  const path = 'context/packs/denials.ur.md';

  it('renders a git-apply-able unified diff between two signed pack versions', () => {
    const diff = unifiedDiff([{ path, before: v1, after: v2 }]);
    expect(diff).toContain(`--- a/${path}`);
    expect(diff).toContain(`+++ b/${path}`);
    expect(diff).toContain('@@');
    // the review sees the content moving: the bumped version, the new rate, and a new content_hash line
    expect(diff).toContain('+version: 2');
    expect(diff).toContain('-version: 1');
  });

  it('both diffed versions are SIGNED, loadPack-valid packs (a diff of valid knowledge)', () => {
    const a = loadPack(v1, { workspace: 'ws_alpha', requireExportConsent: true });
    const b = loadPack(v2, { workspace: 'ws_alpha', requireExportConsent: true });
    expect(a.document.contentHash).not.toBe(b.document.contentHash); // the join key moved with the content
    expect(a.module.id).toBe(b.module.id);
  });

  it('a no-op re-render produces an empty diff (idempotent — no churn PR)', () => {
    expect(unifiedDiff([{ path, before: v2, after: v2 }])).toBe('');
  });
});
