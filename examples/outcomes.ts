/**
 * Outcomes: declare what success means, bind requests to an artifact, record outcomes durably and
 * record the approved final without sending any text.
 *
 * Run (the key needs `outcomes:write`):
 *
 *   ULTRAROUTER_API_KEY=ur_sk_test_... npx tsx examples/outcomes.ts
 *
 * See docs/outcomes.md.
 */
import UltraRouter, { diffStats } from '@ultrarouter/sdk';

const ur = new UltraRouter({ defaultModel: 'openai/gpt-5.2-mini' });

// 1. Declare the objective once (an unchanged upsert is a no-op).
const type = await ur.ur.artifactTypes.upsert({
  name: 'support-reply',
  archetype: 'draft',
  objective: {
    metric: 'acceptance_rate',
    direction: 'higher_is_better',
    unit: 'ratio',
    source: 'support agent review',
    window: 'P7D',
    resolution_criteria: 'The agent sends the draft with no more than light edits.',
  },
});
console.log(`artifact type ${type.name} at objective version ${String(type.version)}`);

// 2. Draft a reply inside an artifact scope: the request is bound to the artifact and queued
//    outcomes are flushed when the scope ends.
const draft = await ur.withArtifact('ticket-4821-reply', async (scope) => {
  const res = await scope.chat.completions.create({
    messages: [{ role: 'user', content: 'Draft a reply: the parcel arrived damaged.' }],
  });
  await scope.record({ channel: 'mechanical', kind: 'schema_valid' });
  return 'choices' in res ? (res.choices[0]?.message.content ?? '') : '';
});
console.log(`draft: ${draft}`);

// 3. The agent edited and sent it. Without corrections consent, send statistics only.
const artifact = await ur.ur.artifacts.create({ key: 'ticket-4821-reply', archetype: 'draft' });
const final = `${draft} We will ship a replacement today, free of charge.`;
const stats = diffStats(draft, final);
const version = await ur.ur.artifacts.final(artifact.id, {
  diff_stats: stats,
  final_hash: stats.final_hash,
});
console.log(`final recorded as ${version.stored}; edit ratio ${stats.edit_ratio.toFixed(3)}`);

// 4. The human verdict, recorded through the durable queue (persisted before it is sent).
const receipt = await ur.ur.outcomes.record(artifact.id, { channel: 'correction', kind: 'edited' });
console.log(`outcome ${receipt.status}`);

// 5. Drain anything still queued before exiting.
const report = await ur.ur.outcomes.flush();
console.log(`flush: delivered=${String(report.delivered)} pending=${String(report.pending)}`);
