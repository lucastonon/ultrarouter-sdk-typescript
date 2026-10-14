/**
 * Preflight for a call made directly to a provider: get the recommended model and the learned
 * context, apply it at the cache-safe position, then record the outcome quoting the exposure grant.
 *
 * Run:
 *
 *   ULTRAROUTER_API_KEY=ur_sk_test_... npx tsx examples/preflight.ts
 *
 * See docs/preflight.md.
 */
import UltraRouter from '@ultrarouter/sdk';

const ur = new UltraRouter();

const messages = [
  { role: 'system' as const, content: 'Classify the invoice: duplicate, new or needs_review.' },
  { role: 'user' as const, content: 'Invoice 77 from Acme, 1,200 USD, same PO as invoice 75.' },
];

// Send the messages: a call type that learns per-request cases renders them for this input.
const session = await ur.useLearned({
  call_type: 'invoice-triage',
  artifact_key: 'invoice-77',
  messages,
});
console.log(`model: ${session.model ?? 'your default'}; arm: ${session.grant?.arm ?? 'none'}`);
console.log(
  session.knowledge === null
    ? `no learned context (${String(session.preflight.knowledge_reason)})`
    : 'learned context available',
);

// The messages to send to your provider, with the learned module after the system prefix.
const prompt = session.apply(messages);
for (const m of prompt) console.log(`  ${m.role}: ${m.content.slice(0, 60)}`);

// ... call your provider with `prompt` here ...

// Record what happened. The artifact is stamped with the grant so the call counts in its arm.
const receipt = await session.record({ channel: 'resolution', kind: 'resolved_true' });
console.log(`outcome ${receipt.status}`);
await ur.ur.outcomes.flush();
