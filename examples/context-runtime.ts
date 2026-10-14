/**
 * The context runtime: lift existing messages, compile modules against a contract, render them, and
 * send a declared manifest with a request.
 *
 * Run:
 *
 *   ULTRAROUTER_API_KEY=ur_sk_test_... npx tsx examples/context-runtime.ts
 *
 * Everything except the final request is pure and runs offline. See docs/context-runtime.md.
 */
import UltraRouter from '@ultrarouter/sdk';
import {
  compile,
  fromMessages,
  render,
  toMessages,
  toWire,
  ULTRAROUTER_PROFILE,
  type Contract,
  type Envelope,
  type Module,
} from '@ultrarouter/sdk/context';

// ── 1. Lift: label existing messages and prove the exit is exact ───────────────────────────────
const messages = [
  { role: 'system' as const, content: 'You are a support assistant for Acme.' },
  { role: 'user' as const, content: 'Context: refunds are accepted within 30 days of delivery.' },
  { role: 'user' as const, content: 'Can I return a kettle I bought 3 weeks ago?' },
];
const lifted = fromMessages(messages);
console.log('labels:', lifted.labels.map((l) => l.kind).join(', '));
console.log(
  'exit is byte-identical:',
  JSON.stringify(toMessages(lifted.manifest)) === JSON.stringify(messages),
);

// ── 2. Compile: modules + a contract → an ordered manifest with named refusals ──────────────────
const envelope: Envelope = {
  id: 'run-1',
  tenant: 'acme',
  stage: 'answer',
  mode: 'live',
  asOf: '2026-06-01T00:00:00.000Z',
  cutoffs: {},
  budgets: { tokens: 300 },
  seed: 'run-1',
  pins: [
    {
      id: 'refund-policy',
      kind: 'policy',
      contentHash: 'sha256:refund-policy-v1',
      purpose: 'refund rules',
    },
  ],
  releases: {},
  permissionEpoch: 'epoch-1',
};
const contract: Contract = {
  stage: 'answer',
  requiredKinds: ['policy'],
  optionalKinds: ['faq', 'history'],
  forbiddenKinds: [],
  budgets: { tokens: 300 },
  limits: [],
  pinPolicy: 'strict',
  slots: ['instruction', 'reference'],
};
const mod = (id: string, kind: string, memoryClass: string, tokens: number): Module => ({
  id,
  version: '1',
  kind,
  memoryClass,
  trustClass: kind === 'history' ? 'untrusted' : 'authoritative',
  privacyClass: 'internal',
  availability: { from: '2026-01-01T00:00:00.000Z', to: null },
  contentHash: `sha256:${id}-v1`,
  tokenEstimate: tokens,
  facets: {},
});

const result = compile(
  envelope,
  contract,
  [
    { module: mod('refund-policy', 'policy', 'procedural', 120) },
    { module: mod('shipping-faq', 'faq', 'semantic', 90), slot: 'reference' },
    { module: mod('old-thread', 'history', 'episodic', 200) },
  ],
  ULTRAROUTER_PROFILE,
);
console.log('compiled:', result.ok);
for (const r of result.refusals) console.log(`  refused ${r.moduleId ?? '-'}: ${r.reason}`);

// ── 3. Render with the bodies you hold ──────────────────────────────────────────────────────────
if (result.manifest !== null) {
  const bodies = new Map([
    ['refund-policy', 'Refunds are accepted within 30 days of delivery.'],
    ['shipping-faq', 'Standard shipping takes 3 to 5 business days.'],
  ]);
  for (const m of render(result.manifest, bodies)) console.log(`  ${m.role}: ${String(m.content)}`);
}

// ── 4. Send a declared manifest with a request (hashes and ranges only, never bodies) ────────────
const ur = new UltraRouter({ defaultModel: 'openai/gpt-5.2-mini' });
const res = await ur.chat.completions.create({
  messages,
  ur: { manifest: toWire(lifted.manifest) },
});
console.log('answer:', res.choices[0]?.message.content);
