/**
 * Call types: create one, update its configuration, trigger an eval and read the results.
 *
 * Run (the key needs `config:write`):
 *
 *   ULTRAROUTER_API_KEY=ur_sk_test_... npx tsx examples/call-types.ts
 *
 * See docs/call-types.md.
 */
import UltraRouter from '@ultrarouter/sdk';

const ur = new UltraRouter({ defaultModel: 'openai/gpt-5.2-mini' });

// 1. Create the call type with an initial configuration.
const created = await ur.ur.callTypes.create({
  slug: 'support-reply',
  config: { model_pin: 'openai/gpt-5.2-mini', fallbacks: ['anthropic/claude-sonnet-4.6'] },
});
console.log(
  `created ${created.slug} (${created.id}), config version ${String(created.current_config_version)}`,
);

// 2. Requests tagged with the slug are attributed to it.
const reply = await ur.chat.completions.create({
  call_type: 'support-reply',
  messages: [{ role: 'user', content: 'My parcel arrived damaged. What now?' }],
});
console.log(`served by ${reply.ur.model_served} for call type ${String(reply.ur.call_type)}`);

// 3. A partial update appends a new immutable config version.
const updated = await ur.ur.callTypes.update('support-reply', {
  compression_mode: 'semantic_safe',
  self_improve_mode: 'assist',
});
console.log(`now at config version ${String(updated.current_config_version)}`);

// 4. Trigger an eval run and follow it.
const trigger = await ur.ur.callTypes.enqueueEval('support-reply');
if (trigger.enqueued) {
  console.log(
    `eval run ${trigger.run_id} enqueued with ${String(trigger.candidate_count)} candidate(s)`,
  );
} else {
  console.log(`no new eval run: ${trigger.reason}`);
}

const runs = await ur.ur.callTypes.listEvals('support-reply');
for (const run of runs.data) {
  console.log(`  run ${run.id}: ${run.status}, ${String(run.candidates.length)} candidate(s)`);
}

// 5. The Autopilot readiness rollup is read-only.
const readiness = await ur.ur.autopilot.status();
console.log(
  `workspace state: ${readiness.state}, ${String(readiness.call_types.length)} observed call type(s)`,
);
