/**
 * Plug-and-play learning 7/8: learning controls for one call type. Read the status (state, active
 * version, latest candidate, evaluation, evidence, outcome receipts), pause and resume, look at the
 * version history, roll the active pointer back to an earlier version, and disable learning (the
 * kill switch). Every control answers what happened plus the resulting status. A refusal you can
 * act on (missing consent, no workspace-owned reflection provider, learning not enabled, an invalid
 * promotion policy, a version conflict, not found, forbidden) is a LearningError carrying the
 * reason, the gateway's named refusal and what to do.
 *
 * Needs a key with config:write (config:read for reads), the workspace's corrections consent on,
 * and a reflection model the workspace owns (a custom provider, or a provider it stored its own key
 * for). Use a call type you can experiment with: this example ends with learning disabled for it.
 *
 * Run: ULTRAROUTER_API_KEY=ur_sk_test_... ULTRAROUTER_BASE_URL=http://localhost:8080 \
 *      ULTRAROUTER_CALL_TYPE=ct_... ULTRAROUTER_REFLECTION_MODEL=openai/gpt-5.2 \
 *      npx tsx examples/learning/07-learning-controls.ts
 * Expected output (the numbers depend on your traffic):
 *   status: learning · active epb_… · candidate epb_… (evaluating) · evidence 31 verified / 23 incorporated
 *   receipts: 30 applied, 1 pending, 1 expired
 *   pause → paused, resume → learning
 *   history: epb_… evaluating, epb_… active, epb_… retired
 *   rolled back: active is now epb_…
 *   evaluation lev_…: running (candidate 9/12 vs incumbent 7/11)
 *   disabled: no learned version is served
 */
import UltraRouter, { LearningError } from '@ultrarouter/sdk';

const ur = new UltraRouter();
const callType = process.env.ULTRAROUTER_CALL_TYPE ?? 'learning-controls-demo';
const reflectionModel = process.env.ULTRAROUTER_REFLECTION_MODEL ?? 'openai/gpt-5.2';
const learning = ur.ur.learning;

try {
  let status = await learning.status(callType);
  if (status.state === 'off' || status.state === 'disabled') {
    const enabled = await learning.enable(callType, {
      reflection_model: reflectionModel,
      promotion: { mode: 'evaluate', objective: 'success' },
    });
    status = enabled.learning;
  }
  const candidate = status.latest_candidate;
  console.log(
    `status: ${status.state} · active ${status.active_version?.id ?? 'none'} · candidate ${candidate === null ? 'none' : `${candidate.id} (${candidate.state})`} · evidence ${String(status.evidence.verified)} verified / ${String(status.evidence.incorporated_active)} incorporated`,
  );
  const receipts = status.outcome_receipts;
  console.log(
    `receipts: ${String(receipts.applied)} applied, ${String(receipts.pending)} pending, ${String(receipts.expired)} expired`,
  );

  const paused = await learning.pause(callType);
  const resumed = await learning.resume(callType);
  console.log(`pause → ${paused.learning.state}, resume → ${resumed.learning.state}`);

  const history = await learning.versions(callType);
  console.log(`history: ${history.data.map((v) => `${v.id} ${v.state}`).join(', ') || 'empty'}`);

  // Roll back to the version that was active before the current one (or pass { version_id }).
  if (history.data.some((v) => v.state === 'retired')) {
    const rolled = await learning.rollback(callType);
    console.log(`rolled back: active is now ${rolled.learning.active_version?.id ?? 'none'}`);
  } else {
    console.log('rolled back: nothing earlier to roll back to yet');
  }

  const [latest] = (await learning.evaluations(callType)).data;
  if (latest !== undefined) {
    const arm = (a: { pass: number; verified: number }) =>
      `${String(a.pass)}/${String(a.verified)}`;
    console.log(
      `evaluation ${latest.id}: ${latest.decision} (candidate ${arm(latest.arms.candidate)} vs incumbent ${arm(latest.arms.incumbent)})`,
    );
  } else {
    console.log('evaluation: none yet');
  }

  const disabled = await learning.disable(callType);
  console.log(
    disabled.learning.state === 'disabled'
      ? 'disabled: no learned version is served'
      : disabled.learning.state,
  );
  if (disabled.learning.state !== 'disabled') process.exitCode = 1;
} catch (err) {
  if (err instanceof LearningError) {
    const detail = err.detail === null ? '' : ` (${err.detail})`;
    console.error(`learning refused: ${err.reason} [${err.refusal}${detail}]: ${err.action}`);
    process.exitCode = 1;
  } else {
    throw err;
  }
}
