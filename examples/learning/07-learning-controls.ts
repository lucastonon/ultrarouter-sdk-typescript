/**
 * Plug-and-play learning 7/8: learning controls for one call type. Read the status (state, active
 * version, candidate, evaluation, evidence), pause and resume, look at the version history, roll the
 * active pointer back to an exact earlier version, and disable learning (the kill switch). A refusal
 * you can act on (missing consent, no learning provider, quota, budget, not found, forbidden) is a
 * LearningError carrying the reason and what to do.
 *
 * Needs a key with config:write (config:read for reads). Use a call type you can experiment with:
 * this example ends with learning disabled for it.
 *
 * Run: ULTRAROUTER_API_KEY=ur_sk_test_... ULTRAROUTER_BASE_URL=http://localhost:8080 \
 *      ULTRAROUTER_CALL_TYPE=ct_... ULTRAROUTER_REFLECTION_MODEL=openai/gpt-5.2 \
 *      npx tsx examples/learning/07-learning-controls.ts
 * Expected output:
 *   status: active · active lv_… · candidate lv_… (evaluating) · evidence 31 verified / 23 incorporated
 *   paused → active again
 *   history: lv_… evaluating, lv_… active, lv_… retired
 *   rolled back: active is now lv_…
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
  if (status.state === 'not_enabled' || status.state === 'disabled') {
    status = await learning.enable(callType, {
      reflection_model: reflectionModel,
      promotion: { mode: 'evaluate', objective: 'success' },
    });
  }
  console.log(
    `status: ${status.state} · active ${status.active?.id ?? 'none'} · candidate ${status.candidate ? `${status.candidate.id} (${status.candidate.state})` : 'none'} · evidence ${String(status.evidence?.verified ?? 0)} verified / ${String(status.evidence?.incorporated ?? 0)} incorporated`,
  );

  const paused = await learning.pause(callType);
  const resumed = await learning.resume(callType);
  console.log(`${paused.state} → ${resumed.state} again`);

  const history = await learning.versions(callType);
  console.log(`history: ${history.data.map((v) => `${v.id} ${v.state}`).join(', ') || 'empty'}`);

  // Roll back to the newest version that served before the current one.
  const earlier = history.data.find((v) => v.state === 'retired');
  if (earlier !== undefined) {
    const rolled = await learning.rollback(callType, {
      version_id: earlier.id,
      reason: 'example rollback',
    });
    console.log(`rolled back: active is now ${rolled.active?.id ?? 'none'}`);
  } else {
    console.log('rolled back: nothing earlier to roll back to yet');
  }

  const evaluations = await learning.evaluations(callType);
  const latest = evaluations.data[0];
  if (latest !== undefined) {
    const arm = (a?: { passed: number; verified: number }) =>
      a === undefined ? '-' : `${String(a.passed)}/${String(a.verified)}`;
    console.log(
      `evaluation ${latest.id}: ${latest.decision} (candidate ${arm(latest.candidate)} vs incumbent ${arm(latest.incumbent)})`,
    );
  } else {
    console.log('evaluation: none yet');
  }

  const disabled = await learning.disable(callType);
  console.log(
    disabled.state === 'disabled' ? 'disabled: no learned version is served' : disabled.state,
  );
  if (disabled.state !== 'disabled') process.exitCode = 1;
} catch (err) {
  if (err instanceof LearningError) {
    console.error(`learning refused (${err.reason}): ${err.action}`);
    process.exitCode = 1;
  } else {
    throw err;
  }
}
