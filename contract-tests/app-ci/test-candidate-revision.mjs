// The evidence names the revision that was TESTED, never another one. The candidate harness runs in
// the current checkout while the evidence contract, the comment and the Check Run name `--head`; so,
// against the REAL built bin and a real git fixture:
//
// 1. checkout A + `--head B` ⇒ a NAMED failure (`candidate_revision_mismatch`), exit 2, no harness
//    run, nothing published and no evidence printed;
// 2. checkout B with an uncommitted change to a tracked file ⇒ `candidate_worktree_modified`, the same;
// 3. a `--head` the checkout does not contain ⇒ `candidate_revision_unavailable`, the same;
// 4. checkout B + `--head B` (by full or short SHA) ⇒ the run proceeds and publishes for B;
// 5. a change to the configured lockfile (bound into the evidence by digest) and an untracked file
//    do not block the run;
// 6. `--fork` executes nothing, so there is nothing to bind: detection-only still works.
import { spawnSync } from 'node:child_process';
import { existsSync, rmSync, writeFileSync } from 'node:fs';

import { HARNESS_DIR, join, makeChecker, makeGitFixture, runBin, writeConfig } from './lib.mjs';
import { startStubGitHub } from './stub-github.mjs';

function git(dir, ...args) {
  const r = spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
  if ((r.status ?? 1) !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`);
  return r.stdout.trim();
}

const CONFIG = {
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

async function main() {
  const { check, done } = makeChecker('the evidence names the tested revision');
  const gh = await startStubGitHub();
  const fx = makeGitFixture({
    baseFiles: { 'prompts/checkout/system.txt': 'v1', 'deps.lock': 'lockA', 'src/app.js': 'a' },
    headFiles: { 'prompts/checkout/system.txt': 'v2' },
  });
  const configPath = writeConfig(fx.dir, CONFIG);
  const marker = join(fx.dir, 'harness-ran.txt');
  const run = (head, extra = []) =>
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
        head,
        '--pr',
        '9',
        '--changed-file',
        'prompts/checkout/system.txt',
        '--github-api',
        gh.url,
        '--github-token',
        't',
        '--json',
        ...extra,
      ],
      { cwd: fx.dir, env: { UR_APP_CI_MARKER: marker } },
    );
  const nothingHappened = (label, r, reason) => {
    check(`${label} ⇒ exit 2`, r.code === 2, `code=${r.code}`);
    check(
      `${label} ⇒ the failure is named (${reason})`,
      r.stderr.includes(reason),
      r.stderr.trim(),
    );
    check(`${label} ⇒ no harness ran`, !existsSync(marker));
    check(
      `${label} ⇒ nothing was published (no comment, no Check Run)`,
      gh.state.comments.length === 0 && gh.state.checkRuns.length === 0,
      `comments=${gh.state.comments.length} checks=${gh.state.checkRuns.length}`,
    );
    check(
      `${label} ⇒ no evidence was printed`,
      r.json === undefined && !r.stdout.includes('evidence_hash'),
      r.stdout.slice(0, 200),
    );
  };

  try {
    // 1. checkout A, claim B.
    git(fx.dir, 'checkout', '-q', '--detach', fx.baseSha);
    nothingHappened('checkout A + --head B', await run(fx.headSha), 'candidate_revision_mismatch');

    // 2. checkout B with an uncommitted change to a tracked source file.
    git(fx.dir, 'checkout', '-q', '--detach', fx.headSha);
    writeFileSync(join(fx.dir, 'src', 'app.js'), 'a-modified');
    nothingHappened(
      'checkout B + an uncommitted tracked change',
      await run(fx.headSha),
      'candidate_worktree_modified',
    );
    // The same change STAGED is still not the head revision.
    git(fx.dir, 'add', 'src/app.js');
    nothingHappened(
      'checkout B + a staged tracked change',
      await run(fx.headSha),
      'candidate_worktree_modified',
    );
    git(fx.dir, 'reset', '-q', '--hard', fx.headSha);

    // 3. a head that is not in the checkout at all.
    nothingHappened(
      'an unknown --head',
      await run('0123456789abcdef0123456789abcdef01234567'),
      'candidate_revision_unavailable',
    );

    // 4 + 5. checkout B, claim B: the run proceeds; the lockfile (digest-bound) and an untracked
    // file do not block it.
    writeFileSync(join(fx.dir, 'deps.lock'), 'lockB');
    writeFileSync(join(fx.dir, 'build-output.txt'), 'untracked');
    const ok = await run(fx.headSha);
    const wf = ok.json?.workflows?.[0];
    check(
      'checkout B + --head B ⇒ the harness runs and the check passes (exit 0)',
      ok.code === 0 && wf?.conclusion === 'success' && existsSync(marker),
      `code=${ok.code} ${ok.stderr.trim()}`,
    );
    check(
      'the Check Run is published for B, the tested revision',
      gh.state.checkRuns.length === 1 && gh.state.checkRuns[0].head_sha === fx.headSha,
      JSON.stringify(gh.state.checkRuns.map((c) => c.head_sha)),
    );
    rmSync(marker, { force: true });
    const short = await run(fx.headSha.slice(0, 12), ['--no-publish']);
    check(
      'a short SHA of the checked-out commit is accepted too',
      short.code === 0 && existsSync(marker),
      `code=${short.code} ${short.stderr.trim()}`,
    );
    rmSync(marker, { force: true });

    // 6. fork mode runs nothing, so a mismatched head is not an error there.
    git(fx.dir, 'checkout', '-q', '--detach', fx.baseSha);
    const fork = await run(fx.headSha, ['--fork', '--no-publish']);
    check(
      '--fork (detection only) does not need the checkout to match: no harness, no failure',
      fork.json?.fork === true && !existsSync(marker) && !fork.stderr.includes('candidate_'),
      `code=${fork.code} ${fork.stderr.trim()}`,
    );
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
