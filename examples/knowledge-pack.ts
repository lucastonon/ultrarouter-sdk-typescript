/**
 * Knowledge packs: build and sign a portable `*.ur.md` pack, load it back as a context module, and
 * see a tampered copy refused. Pure: no network.
 *
 * Run:
 *
 *   npx tsx examples/knowledge-pack.ts
 *
 * See docs/context-runtime.md#knowledge-packs. In CI, `ur pack validate <file>` runs the same checks.
 */
import {
  LoadPackError,
  loadPack,
  packContentHash,
  packProvenanceHash,
  renderPack,
  UR_KNOWLEDGE_FORMAT,
  type PackDocument,
} from '@ultrarouter/sdk/context';

/** Fill both hashes with the SDK's own functions (the content hash first; the provenance hash covers it). */
function sign(doc: PackDocument): PackDocument {
  const contentHash = packContentHash({ ...doc, contentHash: '', provenanceHash: '' });
  const withContent = { ...doc, contentHash };
  return {
    ...withContent,
    provenanceHash: packProvenanceHash({ ...withContent, provenanceHash: '' }),
  };
}

const pack = sign({
  urFormat: UR_KNOWLEDGE_FORMAT,
  id: 'pack_refund_checks',
  version: 1,
  kind: 'checklist',
  memoryClass: 'procedural',
  trustClass: 'authoritative',
  slot: 'instruction',
  descriptor: 'Refund reply checklist',
  appliesWhen: { type: 'call_type_is', callTypeId: 'support-reply' },
  phase: ['draft'],
  singleUse: false,
  nativeDelivery: 'inline',
  tokenEstimate: 60,
  validity: { from: null, to: null, epochBinding: 'v1', invalidationTriggers: [] },
  evidence: {
    n: 0,
    clusters: 0,
    interval: [0, 0],
    evidenceTier: 'authored',
    armSources: [],
    window: { start: null, end: null },
  },
  lineage: { factIds: ['fact_refund_window', 'fact_refund_proof'], rollupDigest: 'authored' },
  consent: { workspace: 'ws_acme', exportConsent: true, redactionVersion: 'redact1' },
  contentHash: '',
  provenanceHash: '',
  body: {
    checklist: [
      { factId: 'fact_refund_window', text: 'State the 30-day refund window.' },
      { factId: 'fact_refund_proof', text: 'Ask for the order number, never for card details.' },
    ],
    exemplars: [],
    baseRates: [],
    refuted: [],
  },
});

const text = renderPack(pack);
console.log(text.split('\n').slice(0, 6).join('\n'));

const { document, module } = loadPack(text, { workspace: 'ws_acme', requireExportConsent: true });
console.log(
  `loaded ${document.id}: ${String(document.body.checklist.length)} checklist item(s); module ${module.id} (${module.trustClass})`,
);

try {
  loadPack(text.replace('State the 30-day', 'State the 60-day'));
} catch (err) {
  if (err instanceof LoadPackError)
    console.log(`tampered copy refused: ${err.refusals.join(', ')}`);
  else throw err;
}
