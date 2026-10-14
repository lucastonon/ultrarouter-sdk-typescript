// A previously green check is INVALIDATED by any bound-input change, including a configuration
// change outside Git. The evidence contract is content-addressed;
// `--asserted-evidence-hash` is the SEALED pin a prior run published. The verifier RECOMPUTES the
// current contract and, on drift, re-marks the check `needs_evidence` (never left green). Uses a
// real git fixture so the baseline worktree + application harness actually run on the fresh runs.
import { writeFileSync } from 'node:fs';
import { makeGitFixture, writeConfig, runBin, makeChecker, HARNESS_DIR, join } from './lib.mjs';

async function main() {
  const { check, done } = makeChecker('bound-input change invalidates a check');
  const fx = makeGitFixture({
    baseFiles: { 'prompts/checkout/system.txt': 'v1', 'deps.lock': 'lockA' },
    headFiles: { 'prompts/checkout/system.txt': 'v2' },
  });
  const config = {
    repository: 'acme/app',
    datasetSplit: 'holdout-a',
    evidenceEpoch: 'epoch-2026-09',
    lockfile: 'deps.lock',
    workflows: [
      {
        id: 'wf_checkout',
        objective: 'checkout-accuracy',
        evaluatorVersion: 'eval.v3',
        coverage: 'application',
        testCommand: `node ${join(HARNESS_DIR, 'pass.mjs')}`,
        surfaces: [{ kind: 'prompt', paths: ['prompts/checkout/**'] }],
      },
    ],
  };
  const configPath = writeConfig(fx.dir, config);

  const run = (extra) =>
    runBin(
      [
        'app-ci',
        '--config',
        configPath,
        '--repo',
        'acme/app',
        '--base',
        fx.baseSha,
        '--head',
        fx.headSha,
        '--changed-file',
        'prompts/checkout/system.txt',
        '--no-publish',
        '--json',
        ...extra,
      ],
      { cwd: fx.dir },
    );

  try {
    // 1. A fresh run pins the current evidence + passes (Ready for controlled rollout).
    const r1 = await run([]);
    const wf1 = r1.json?.workflows?.[0];
    const h1 = wf1?.evidence_hash;
    check(
      'a fresh run passes green + emits a content-addressed evidence hash',
      wf1?.headline === 'ready_for_rollout' &&
        wf1?.conclusion === 'success' &&
        r1.code === 0 &&
        typeof h1 === 'string',
      `code=${r1.code} headline=${wf1?.headline}`,
    );

    // 2. Re-running with the MATCHING sealed pin stays green (nothing changed).
    const r2 = await run(['--asserted-evidence-hash', h1]);
    const wf2 = r2.json?.workflows?.[0];
    check(
      'a matching sealed pin stays green (no bound input changed)',
      wf2?.stale === false && wf2?.conclusion === 'success' && r2.code === 0,
      `code=${r2.code} stale=${wf2?.stale}`,
    );

    // 3. Change a bound input OUTSIDE Git (the dependency lock) ⇒ the sealed pin is now STALE.
    writeFileSync(join(fx.dir, 'deps.lock'), 'lockB');
    const r3 = await run(['--asserted-evidence-hash', h1]);
    const wf3 = r3.json?.workflows?.[0];
    check(
      'a changed lock digest (config outside Git) ⇒ stale ⇒ needs_evidence, never green + exit 2',
      wf3?.stale === true &&
        wf3?.headline === 'needs_evidence' &&
        wf3?.conclusion === 'action_required' &&
        wf3?.reasons?.includes('stale_evidence') === true &&
        r3.code === 2,
      `code=${r3.code} stale=${wf3?.stale} headline=${wf3?.headline}`,
    );

    // 4. A DIFFERENT head commit ⇒ a different contract hash ⇒ the old pin is stale too.
    const r4 = await runBin(
      [
        'app-ci',
        '--config',
        configPath,
        '--repo',
        'acme/app',
        '--base',
        fx.baseSha,
        '--head',
        fx.baseSha, // pretend head moved
        '--changed-file',
        'prompts/checkout/system.txt',
        '--no-publish',
        '--json',
        '--asserted-evidence-hash',
        h1,
      ],
      { cwd: fx.dir },
    );
    const wf4 = r4.json?.workflows?.[0];
    check(
      'a changed head sha ⇒ stale vs the old pin ⇒ needs_evidence + exit 2',
      wf4?.stale === true && wf4?.conclusion === 'action_required' && r4.code === 2,
      `code=${r4.code} stale=${wf4?.stale}`,
    );
  } finally {
    fx.cleanup();
  }
  done();
}

main().catch((e) => {
  console.error('fatal', e);
  process.exit(1);
});
