// Fail-closed edges of `ur app-ci`, against the REAL built bin:
// 1. change discovery that cannot complete (a nonexistent base revision, as in a shallow clone)
//    exits 2 BEFORE any harness runs or anything is published — never "no changes ⇒ pass";
// 2. a harness that writes `status: passed` and then exits non-zero is a FAILURE;
// 3. a harness killed by a signal (no exit code) is a FAILURE, never exit 0.
import { existsSync } from 'node:fs';

import { HARNESS_DIR, join, makeChecker, makeGitFixture, runBin, writeConfig } from './lib.mjs';
import { startStubGitHub } from './stub-github.mjs';

function config(testCommand) {
  return {
    repository: 'acme/app',
    datasetSplit: 'holdout-a',
    evidenceEpoch: 'epoch-2026-09',
    workflows: [
      {
        id: 'wf_checkout',
        objective: 'checkout-accuracy',
        evaluatorVersion: 'eval.v3',
        coverage: 'application',
        testCommand,
        surfaces: [{ kind: 'prompt', paths: ['prompts/checkout/**'] }],
      },
    ],
  };
}

async function main() {
  const { check, done } = makeChecker('app-ci fails closed');
  const gh = await startStubGitHub();
  const fx = makeGitFixture({
    baseFiles: { 'prompts/checkout/system.txt': 'v1' },
    headFiles: { 'prompts/checkout/system.txt': 'v2' },
  });
  const marker = join(fx.dir, 'harness-ran.txt');
  const common = ['--repo', 'acme/app', '--pr', '7', '--github-api', gh.url, '--github-token', 't'];
  try {
    // 1. Unavailable change discovery.
    const cfg1 = writeConfig(fx.dir, config(`node ${join(HARNESS_DIR, 'pass.mjs')}`));
    const r1 = await runBin(
      [
        'app-ci',
        '--config',
        cfg1,
        '--base',
        'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
        '--head',
        fx.headSha,
        ...common,
        '--json',
      ],
      { cwd: fx.dir, env: { UR_APP_CI_MARKER: marker } },
    );
    check('a nonexistent base revision exits 2 (fail closed)', r1.code === 2, `code=${r1.code}`);
    check(
      'the error names the unavailable revision instead of passing an empty scope',
      /cannot determine the changed files/.test(r1.stderr) && /deadbeef/.test(r1.stderr),
      r1.stderr.trim(),
    );
    check('no harness ran', !existsSync(marker));
    check(
      'nothing was published',
      gh.state.comments.length === 0 && gh.state.checkRuns.length === 0,
    );

    // The same repo with real revisions and no surface change is a genuine pass (control).
    const r1b = await runBin(
      [
        'app-ci',
        '--config',
        cfg1,
        '--base',
        fx.headSha,
        '--head',
        fx.headSha,
        '--no-publish',
        '--json',
      ],
      { cwd: fx.dir },
    );
    check(
      'two real revisions with no changes is a genuine pass (exit 0)',
      r1b.code === 0,
      `code=${r1b.code} ${r1b.stderr}`,
    );

    // 2 + 3. A passing self-report never overrides an unsuccessful process.
    for (const [label, harness] of [
      ['writes `passed`, then exits 1', 'pass-then-fail.mjs'],
      ['writes `passed`, then is killed by SIGKILL', 'killed.mjs'],
    ]) {
      const cfg = writeConfig(fx.dir, config(`node ${join(HARNESS_DIR, harness)}`));
      const r = await runBin(
        [
          'app-ci',
          '--config',
          cfg,
          '--base',
          fx.baseSha,
          '--head',
          fx.headSha,
          '--changed-file',
          'prompts/checkout/system.txt',
          '--no-publish',
          '--json',
        ],
        { cwd: fx.dir },
      );
      const wf = r.json?.workflows?.find((w) => w.workflow_id === 'wf_checkout');
      check(
        `a harness that ${label} ⇒ a failing check (exit 2), never a pass`,
        r.code === 2 && wf?.conclusion !== 'success' && wf?.headline !== 'ready_for_rollout',
        `code=${r.code} headline=${wf?.headline} conclusion=${wf?.conclusion}`,
      );
    }
  } finally {
    fx.cleanup();
    gh.close();
  }
  done();
}

main().catch((e) => {
  console.error('fatal', e);
  process.exit(1);
});
