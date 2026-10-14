// Fork pull requests never execute their code with secrets, and untrusted test EXECUTION is
// separated from trusted check PUBLICATION. Proven end-to-end
// against the REAL built bin + a stub GitHub API:
// A. `--fork` ⇒ the customer harness is NEVER spawned (no marker file), the outcome is a named
// `needs_evidence` (fork_no_execution), yet the trusted comment + Check Run are still published.
// B. a NON-fork run DOES execute the harness (marker present) but with a SCRUBBED env — the
// publication token (GITHUB_TOKEN) + ultrarouter key (UR_API_KEY) never reach the harness — and
// publication happens over the trusted token the harness never saw.
import { mkdtempSync, existsSync, readFileSync, tmpdir, join } from './lib.mjs';
import { makeGitFixture, writeConfig, runBin, makeChecker, HARNESS_DIR } from './lib.mjs';
import { startStubGitHub } from './stub-github.mjs';

function config(dir, testCommand) {
  return writeConfig(dir, {
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
  });
}

async function main() {
  const { check, done } = makeChecker('no fork exec/secrets; publication separated');
  const gh = await startStubGitHub();

  // ── Part A: a FORK PR — detection + comment-only, NEVER executing fork code with secrets. ──
  {
    const dir = mkdtempSync(join(tmpdir(), 'ur-app-ci-fork-'));
    const marker = join(dir, 'fork-marker.txt');
    const configPath = config(dir, `node ${join(HARNESS_DIR, 'pass.mjs')}`);
    const r = await runBin(
      [
        'app-ci',
        '--config',
        configPath,
        '--repo',
        'acme/app',
        '--base',
        'aaaa',
        '--head',
        'bbbb',
        '--pr',
        '7',
        '--fork',
        '--changed-file',
        'prompts/checkout/system.txt',
        '--github-api',
        gh.url,
        '--github-token',
        'trusted-publish-token',
        '--json',
      ],
      {
        cwd: dir,
        env: {
          UR_APP_CI_MARKER: marker,
          GITHUB_TOKEN: 'trusted-publish-token',
          UR_API_KEY: 'ur_sk_test_forbidden',
        },
      },
    );
    const wf = r.json?.workflows?.[0];
    check(
      'fork ⇒ the customer harness is NEVER executed (no marker file written)',
      existsSync(marker) === false,
      `marker exists=${existsSync(marker)}`,
    );
    check(
      'fork ⇒ named needs_evidence (fork_no_execution) + exit 2 (non-success)',
      wf?.headline === 'needs_evidence' &&
        wf?.reasons?.includes('fork_no_execution') === true &&
        r.code === 2,
      `code=${r.code} headline=${wf?.headline} reasons=${JSON.stringify(wf?.reasons)}`,
    );
    check(
      'fork ⇒ the trusted comment + Check Run are still published from the trusted context',
      gh.state.comments.length >= 1 &&
        gh.state.checkRuns.some(
          (c) =>
            c.name === 'ultrarouter app-ci / wf_checkout' && c.conclusion === 'action_required',
        ),
      `comments=${gh.state.comments.length} checks=${JSON.stringify(gh.state.checkRuns.map((c) => c.conclusion))}`,
    );
    check(
      'fork ⇒ publication used the trusted token (Authorization header present on GitHub calls)',
      gh.state.calls.some((c) => (c.auth ?? '').includes('trusted-publish-token')),
      'no authorized GitHub call recorded',
    );
    // The forbidden ultrarouter key never appears in any published comment body.
    check(
      'fork ⇒ no secret material in any comment body',
      gh.state.comments.every(
        (c) =>
          !c.body.includes('ur_sk_test_forbidden') && !c.body.includes('trusted-publish-token'),
      ),
      'a secret leaked into a comment',
    );
  }

  // ── Part B: a NON-fork run executes the harness with a SCRUBBED env; publication is separated. ──
  {
    const fx = makeGitFixture({
      baseFiles: { 'prompts/checkout/system.txt': 'v1' },
      headFiles: { 'prompts/checkout/system.txt': 'v2' },
    });
    const marker = join(fx.dir, 'exec-marker.txt');
    const envDump = join(fx.dir, 'env-dump.json');
    const configPath = config(fx.dir, `node ${join(HARNESS_DIR, 'pass.mjs')}`);
    try {
      const r = await runBin(
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
          '--pr',
          '8',
          '--changed-file',
          'prompts/checkout/system.txt',
          '--github-api',
          gh.url,
          '--github-token',
          'trusted-publish-token',
          '--json',
        ],
        {
          cwd: fx.dir,
          env: {
            UR_APP_CI_MARKER: marker,
            UR_APP_CI_ENV_DUMP: envDump,
            GITHUB_TOKEN: 'trusted-publish-token',
            UR_API_KEY: 'ur_sk_test_forbidden',
          },
        },
      );
      const wf = r.json?.workflows?.[0];
      check(
        'non-fork ⇒ the harness DID execute (marker present for baseline + candidate)',
        existsSync(marker) === true && readFileSync(marker, 'utf8').trim().split('\n').length === 2,
        `marker=${existsSync(marker) ? readFileSync(marker, 'utf8').replace(/\n/g, ',') : 'absent'}`,
      );
      const dumped = existsSync(envDump) ? JSON.parse(readFileSync(envDump, 'utf8')) : [];
      check(
        'non-fork ⇒ the harness env is SCRUBBED (no GITHUB_TOKEN, no UR_API_KEY)',
        Array.isArray(dumped) && !dumped.includes('GITHUB_TOKEN') && !dumped.includes('UR_API_KEY'),
        `dumped secrets present: ${dumped.filter((k) => k === 'GITHUB_TOKEN' || k === 'UR_API_KEY').join(',')}`,
      );
      check(
        'non-fork ⇒ a passing application harness ⇒ Ready for controlled rollout + exit 0',
        wf?.headline === 'ready_for_rollout' && wf?.conclusion === 'success' && r.code === 0,
        `code=${r.code} headline=${wf?.headline}`,
      );
      check(
        'non-fork ⇒ the Check Run for this head was published (publication separated from exec)',
        gh.state.checkRuns.some((c) => c.head_sha === fx.headSha && c.conclusion === 'success'),
        `checks=${JSON.stringify(gh.state.checkRuns.map((c) => [c.head_sha, c.conclusion]))}`,
      );
    } finally {
      fx.cleanup();
    }
  }

  gh.close();
  done();
}

main().catch((e) => {
  console.error('fatal', e);
  process.exit(1);
});
