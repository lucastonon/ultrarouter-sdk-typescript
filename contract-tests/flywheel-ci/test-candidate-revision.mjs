// `ur flywheel-pr` binds the candidate's evidence to the revision under test. The check runs in the
// current checkout, so, against the REAL built bin, the stub forge and a real git fixture:
//
// 1. checkout A + `--head B` (open_pr, --apply, write granted) ⇒ `candidate_revision_mismatch`, exit
//    2, BEFORE anything is planned or written: no branch, no commit, no PR, no comment, no Check Run,
//    no harness run, no rollout request;
// 2. the same in patch mode ⇒ no patch file is written;
// 3. checkout B + `--head B` ⇒ the identical command proceeds (control).
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  HARNESS_DIR,
  candidateConfig,
  makeChecker,
  makeGitFixture,
  runBin,
  writeCandidate,
  writeConfig,
} from './lib.mjs';
import { startStubForge } from './stub-forge.mjs';
import { startStubGateway, unlockedGate } from './stub-gateway.mjs';

function git(dir, ...args) {
  const r = spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
  if ((r.status ?? 1) !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`);
  return r.stdout.trim();
}

async function main() {
  const { check, done } = makeChecker('flywheel-pr evidence names the tested revision');
  const fx = makeGitFixture({
    baseFiles: { 'context/refund/policy.md': 'v1\n' },
    headFiles: { 'context/refund/policy.md': 'v2\n' },
  });
  const gh = await startStubForge({ repositoryWrite: 'granted' });
  const gw = await startStubGateway({ rollout: (ref) => unlockedGate(ref) });
  const cfg = candidateConfig();
  cfg.workflows[0].testCommand = `node ${join(HARNESS_DIR, 'candidate-pass.mjs')}`;
  const configPath = writeConfig(fx.dir, cfg);
  const { path: candidatePath } = writeCandidate(fx.dir);
  const marker = join(fx.dir, 'harness-ran.txt');
  const patchDir = mkdtempSync(join(tmpdir(), 'ur-flw-rev-patch-'));

  const run = (mode) =>
    runBin(
      [
        'flywheel-pr',
        '--config',
        configPath,
        '--candidate',
        candidatePath,
        '--repo',
        'acme/app',
        '--base',
        fx.baseSha,
        '--head',
        fx.headSha,
        '--changed-file',
        'context/refund/policy.md',
        '--pr',
        '31',
        '--mode',
        mode,
        '--apply',
        '--patch-out',
        patchDir,
        '--github-api',
        gh.url,
        '--github-token',
        'trusted-publish-token',
        '--base-url',
        gw.url,
        '--api-key',
        'ur_sk_test_x',
        '--json',
      ],
      { cwd: fx.dir, env: { UR_APP_CI_MARKER: marker } },
    );

  try {
    git(fx.dir, 'checkout', '-q', '--detach', fx.baseSha);
    for (const mode of ['open_pr', 'patch']) {
      const r = await run(mode);
      check(`checkout A + --head B (${mode}) ⇒ exit 2`, r.code === 2, `code=${r.code}`);
      check(
        `checkout A + --head B (${mode}) ⇒ the failure is named`,
        r.stderr.includes('candidate_revision_mismatch'),
        r.stderr.trim().slice(0, 300),
      );
      check(
        `checkout A + --head B (${mode}) ⇒ nothing was planned, written or published`,
        !r.stderr.includes('--- proposed diff ---') &&
          gh.forge.branches.length === 0 &&
          gh.forge.puts.length === 0 &&
          gh.forge.pullRequests.length === 0 &&
          gh.state.comments.length === 0 &&
          gh.state.checkRuns.length === 0 &&
          gw.state.rolloutRequests.length === 0 &&
          readdirSync(patchDir).length === 0 &&
          !existsSync(marker),
        `branches=${gh.forge.branches.length} puts=${gh.forge.puts.length} prs=${gh.forge.pullRequests.length} comments=${gh.state.comments.length} checks=${gh.state.checkRuns.length} patches=${readdirSync(patchDir).length} harness=${existsSync(marker)}`,
      );
      check(`checkout A + --head B (${mode}) ⇒ no evidence printed`, r.json === undefined);
    }

    // Control: the same command on the claimed revision proceeds and binds B.
    git(fx.dir, 'checkout', '-q', '--detach', fx.headSha);
    const ok = await run('open_pr');
    check(
      'checkout B + --head B ⇒ the candidate is delivered, checked and published for B',
      ok.code === 0 &&
        ok.json?.app_ci?.head_sha === fx.headSha &&
        gh.forge.pullRequests.length === 1 &&
        gh.state.checkRuns.some((c) => c.head_sha === fx.headSha) &&
        existsSync(marker),
      `code=${ok.code} ${ok.stderr.trim().slice(-300)}`,
    );
  } finally {
    fx.cleanup();
    gh.close();
    gw.close();
  }
  done();
}

main().catch((e) => {
  console.error('fatal', e);
  process.exit(1);
});
