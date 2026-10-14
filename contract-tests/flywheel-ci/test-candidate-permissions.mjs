// Who may write, what happens when they may not, and the one thing that never happens. Driven
// against the real built `ur` bin and the stub forge:
//
// A. scoped write GRANTED ⇒ "Open improvement PR": a branch is created, the file is committed and
// a DRAFT PR is opened — and NO merge request is ever made (the stub implements the merge
// route and answers 405, so an attempt would be both visible and unsuccessful).
// B. write DENIED ⇒ the downloadable patch, a FIRST-CLASS path: the same evidence contract, the
// same harness, the same comment + Check Run; the patch file exists and `git apply --check`
// accepts it against the real fixture repository.
// C. write UNREADABLE (the probe 500s) ⇒ the patch path too. An unknown permission is NEVER read
// as consent to write: the forge receives zero writes.
// D. `--apply` withheld ⇒ the diff and the destination branch are still SHOWN, and nothing at all
// is written (no branch, no put, no patch file).
// E. an EXISTING PR is attached to (a commit on its head branch), never a second PR.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
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

function config(dir) {
  const cfg = candidateConfig();
  cfg.workflows[0].testCommand = `node ${join(HARNESS_DIR, 'candidate-pass.mjs')}`;
  return writeConfig(dir, cfg);
}

async function run(fx, configPath, candidatePath, gh, gw, extra) {
  return runBin(
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
      '--github-api',
      gh.url,
      '--github-token',
      'trusted-publish-token',
      '--base-url',
      gw.url,
      '--api-key',
      'ur_sk_test_x',
      '--patch-out',
      fx.dir,
      '--json',
      ...extra,
    ],
    { cwd: fx.dir },
  );
}

function fixture() {
  return makeGitFixture({
    baseFiles: { 'context/refund/policy.md': 'v1\n' },
    headFiles: { 'context/refund/policy.md': 'v2\n' },
  });
}

async function main() {
  const { check, done } = makeChecker('write / no-write / unknown, and never a merge');

  // ── A. scoped write GRANTED ⇒ Open improvement PR, never a merge. ──
  {
    const fx = fixture();
    const gh = await startStubForge({ repositoryWrite: 'granted' });
    const gw = await startStubGateway({ rollout: (ref) => unlockedGate(ref) });
    try {
      const { path: candidatePath, candidateRef } = writeCandidate(fx.dir);
      const r = await run(fx, config(fx.dir), candidatePath, gh, gw, [
        '--mode',
        'open_pr',
        '--apply',
        '--no-publish',
      ]);
      check(
        'granted ⇒ a branch is created and the change is committed on it',
        gh.forge.branches.length === 1 &&
          gh.forge.branches[0] === `ultrarouter/candidate/${candidateRef}` &&
          gh.forge.puts.length === 1,
        `branches=${JSON.stringify(gh.forge.branches)} puts=${gh.forge.puts.length}`,
      );
      check(
        'granted ⇒ a DRAFT pull request is opened and reported',
        gh.forge.pullRequests.length === 1 &&
          gh.forge.pullRequests[0].draft === true &&
          r.json?.delivery?.mode === 'open_pr' &&
          r.json?.delivery?.applied === true &&
          typeof r.json?.delivery?.pull_request === 'number',
        `prs=${JSON.stringify(gh.forge.pullRequests.map((p) => [p.head, p.draft]))} delivery=${JSON.stringify(r.json?.delivery)}`,
      );
      check(
        'NO merge is ever attempted (the stub route exists and stayed untouched)',
        gh.forge.mergeAttempts.length === 0 &&
          gh.state.calls.every((c) => !/\/merge$/.test((c.url ?? '').split('?')[0])) &&
          r.json?.delivery?.merged === false,
        `mergeAttempts=${gh.forge.mergeAttempts.length}`,
      );
      check(
        'the rollout button is UNLOCKED but never pressed',
        r.json?.rollout?.unlocked === true && r.json?.rollout?.pressed === false,
        JSON.stringify(r.json?.rollout),
      );
      check(
        'no secret material reaches the committed file or the PR body',
        gh.forge.puts.every(
          (p) => !p.content.includes('trusted-publish-token') && !p.content.includes('ur_sk_'),
        ) && gh.forge.pullRequests.every((p) => !String(p.body).includes('ur_sk_')),
        'a secret leaked into a write',
      );
    } finally {
      fx.cleanup();
      gh.close();
      gw.close();
    }
  }

  // ── B. write DENIED ⇒ the downloadable patch + the IDENTICAL check workflow. ──
  {
    const fx = fixture();
    const gh = await startStubForge({ repositoryWrite: 'denied' });
    const gw = await startStubGateway({ rollout: (ref) => unlockedGate(ref) });
    try {
      const { path: candidatePath, candidateRef } = writeCandidate(fx.dir);
      const r = await run(fx, config(fx.dir), candidatePath, gh, gw, ['--apply', '--pr', '5']);
      const patchPath = r.json?.delivery?.patch_path;
      check(
        'denied ⇒ the patch path, named — not an error',
        r.json?.delivery?.mode === 'patch' &&
          r.json?.delivery?.reason === 'no_repo_write_permission' &&
          r.json?.delivery?.applied === true &&
          typeof patchPath === 'string',
        JSON.stringify(r.json?.delivery),
      );
      check(
        'denied ⇒ the forge received ZERO writes (no branch, no file, no PR)',
        gh.forge.branches.length === 0 &&
          gh.forge.puts.length === 0 &&
          gh.forge.pullRequests.length === 0,
        `branches=${gh.forge.branches.length} puts=${gh.forge.puts.length} prs=${gh.forge.pullRequests.length}`,
      );
      // The patch is a REAL patch: git accepts it against the fixture repository.
      const applyCheck = spawnSync('git', ['apply', '--check', patchPath], {
        cwd: fx.dir,
        encoding: 'utf8',
      });
      check(
        '`git apply --check` accepts the downloadable patch',
        (applyCheck.status ?? 1) === 0,
        `${applyCheck.stderr ?? ''}${applyCheck.stdout ?? ''}`.slice(0, 300),
      );
      check(
        'the SAME check workflow runs: the app-CI evidence + comment + Check Run are published',
        r.json?.app_ci?.workflows?.[0]?.evidence_hash?.length === 64 &&
          gh.state.comments.some((c) => c.body.includes('ur-app-ci:wf_refund')) &&
          gh.state.checkRuns.some((c) => c.name === 'ultrarouter app-ci / wf_refund'),
        `comments=${gh.state.comments.length} checks=${gh.state.checkRuns.length}`,
      );
      check(
        'the comment names the candidate, the patch delivery and the immutable reference',
        (() => {
          const body =
            gh.state.comments.find((c) => c.body.includes('ur-app-ci:wf_refund'))?.body ?? '';
          return (
            body.includes('**Flywheel candidate**') &&
            body.includes(candidateRef) &&
            body.includes('downloadable patch') &&
            body.includes('never auto-merged') &&
            body.includes('not measured improvement')
          );
        })(),
        'the candidate section is missing or incomplete',
      );
      check(
        'the patch carries no secret and no platform key',
        (() => {
          const patch = readFileSync(patchPath, 'utf8');
          return !patch.includes('trusted-publish-token') && !patch.includes('ur_sk_');
        })(),
        'a secret leaked into the patch',
      );
    } finally {
      fx.cleanup();
      gh.close();
      gw.close();
    }
  }

  // ── C. an UNREADABLE probe ⇒ the patch path (never optimistic). ──
  {
    const fx = fixture();
    const gh = await startStubForge({ repositoryWrite: 'error' });
    const gw = await startStubGateway({ rollout: (ref) => unlockedGate(ref) });
    try {
      const { path: candidatePath } = writeCandidate(fx.dir);
      const r = await run(fx, config(fx.dir), candidatePath, gh, gw, [
        '--mode',
        'open_pr',
        '--apply',
        '--no-publish',
      ]);
      check(
        'an unreadable write probe ⇒ patch (repo_write_unknown), and ZERO forge writes',
        r.json?.delivery?.mode === 'patch' &&
          r.json?.delivery?.reason === 'repo_write_unknown' &&
          r.json?.delivery?.repository_write === 'unknown' &&
          gh.forge.branches.length === 0 &&
          gh.forge.puts.length === 0,
        JSON.stringify(r.json?.delivery),
      );
    } finally {
      fx.cleanup();
      gh.close();
      gw.close();
    }
  }

  // ── D. no `--apply` ⇒ the diff + destination branch are SHOWN and nothing is written. ──
  {
    const fx = fixture();
    const gh = await startStubForge({ repositoryWrite: 'granted' });
    const gw = await startStubGateway({ rollout: (ref) => unlockedGate(ref) });
    try {
      const { path: candidatePath, candidateRef } = writeCandidate(fx.dir);
      const r = await run(fx, config(fx.dir), candidatePath, gh, gw, [
        '--mode',
        'open_pr',
        '--no-publish',
      ]);
      check(
        'plan-only ⇒ the diff AND the destination branch are shown BEFORE any write',
        r.stderr.includes('--- proposed diff ---') &&
          r.stderr.includes(`destination branch: ultrarouter/candidate/${candidateRef}`) &&
          r.stderr.includes('PLAN ONLY, nothing written'),
        r.stderr.split('\n').slice(0, 6).join(' | '),
      );
      check(
        'plan-only ⇒ nothing is written anywhere (no branch, no put, no PR, no patch file)',
        gh.forge.branches.length === 0 &&
          gh.forge.puts.length === 0 &&
          gh.forge.pullRequests.length === 0 &&
          r.json?.delivery?.applied === false &&
          r.json?.delivery?.reason === 'plan_only' &&
          !existsSync(join(fx.dir, `ultrarouter-candidate-${candidateRef}.patch`)),
        JSON.stringify(r.json?.delivery),
      );
    } finally {
      fx.cleanup();
      gh.close();
      gw.close();
    }
  }

  // ── E. attach to an EXISTING PR — a commit on its head branch, never a second PR. ──
  {
    const fx = fixture();
    const gh = await startStubForge({
      repositoryWrite: 'granted',
      pulls: { 42: 'feature/refunds' },
    });
    const gw = await startStubGateway({ rollout: (ref) => unlockedGate(ref) });
    try {
      const { path: candidatePath } = writeCandidate(fx.dir);
      const r = await run(fx, config(fx.dir), candidatePath, gh, gw, [
        '--mode',
        'attach',
        '--pr',
        '42',
        '--apply',
      ]);
      check(
        'attach ⇒ the commit lands on the EXISTING PR head branch and no new PR is opened',
        r.json?.delivery?.mode === 'attach' &&
          gh.forge.puts.length === 1 &&
          gh.forge.puts[0].branch === 'feature/refunds' &&
          gh.forge.pullRequests.length === 0 &&
          gh.forge.branches.length === 0,
        `puts=${JSON.stringify(gh.forge.puts.map((p) => p.branch))} prs=${gh.forge.pullRequests.length}`,
      );
      check(
        'attach ⇒ still no merge attempt',
        gh.forge.mergeAttempts.length === 0 && r.json?.delivery?.merged === false,
        `mergeAttempts=${gh.forge.mergeAttempts.length}`,
      );
      // `--mode attach` without a PR is a usage error, not a silent fallback to writing elsewhere.
      const noPr = await run(fx, config(fx.dir), candidatePath, gh, gw, [
        '--mode',
        'attach',
        '--apply',
        '--no-publish',
      ]);
      check(
        'attach without a PR is a USAGE error (exit 1), never a silent fallback',
        noPr.code === 1 && /attach_requires_pr/.test(noPr.stderr),
        `code=${noPr.code} stderr=${noPr.stderr.slice(0, 160)}`,
      );
    } finally {
      fx.cleanup();
      gh.close();
      gw.close();
    }
  }

  // ── F. the write client has NO merge capability at all (structural, not disciplinary). ──
  {
    const cliSource = readFileSync(new URL('../../dist/cli/index.cjs', import.meta.url), 'utf8');
    check(
      'the built CLI contains no merge call at all (`/merge` never appears in a request path)',
      !/pulls\/\$\{[^}]*\}\/merge/.test(cliSource) && !cliSource.includes('/merge'),
      'the CLI bundle references a merge endpoint',
    );
    const src = readFileSync(new URL('../../src/cli/flywheel-pr.ts', import.meta.url), 'utf8');
    const iface = src.slice(src.indexOf('export interface GitHubWriteClient'));
    const body = iface.slice(0, iface.indexOf('\n}\n'));
    // Member NAMES only (comments legitimately say "nothing merges it") — an actual merge member
    // would be a `merge…(` / `merge…:` declaration at member indentation.
    const members = body
      .split('\n')
      .filter((l) => /^ {2}[A-Za-z_]/.test(l))
      .map((l) => (l.trim().match(/^([A-Za-z_][A-Za-z0-9_]*)/) ?? [])[1])
      .filter((x) => x !== undefined);
    check(
      'the GitHubWriteClient interface declares no merge member',
      members.length >= 6 && members.every((m) => !/merge/i.test(m)),
      `members=${members.join(',')}`,
    );
  }

  done();
}

main().catch((e) => {
  console.error('fatal', e);
  process.exit(1);
});
