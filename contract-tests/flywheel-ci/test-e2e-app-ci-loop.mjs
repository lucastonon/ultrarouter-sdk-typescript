// The headline acceptance, end to end against the real built `ur` bin, a stub forge and a stub
// gateway, driving a real git fixture through a real customer harness.
// ONE example correction flows through:
//
// 1. a REVIEWABLE candidate — a screened learned-context module distilled from a repeated
// correction becomes a diff + destination branch, SHOWN before anything is written;
// 2. the ACTUAL customer-app harness — baseline and candidate both run the customer's own command;
// 3. a FAILED CHECK — the candidate regresses an application schema check ⇒ `Regression found`,
// Check Run `failure`, exit 2; the rollout stays LOCKED;
// 4. the REPAIR — the customer pushes a fix, the check re-runs on the NEW head;
// 5. NEW BOUND EVIDENCE — a different immutable evidence object, because the head moved;
// 6. CONTROLLED ROLLOUT — unlocked, and NOT pressed. Stops here; confirms live.
// 7. the REJECTING customer — a human `reject` with actor + reason is recorded through an
// AUTHENTICATED callback, and a REPLAY of it is a visible no-op (`duplicate`), not a second
// decision. After the rejection the server locks the rollout again with its own named reason.
//
// It also proves the two honesty rules: the dashboard and the PR quote the SAME immutable evidence
// object, and the comment never claims a merged PR is measured improvement.
import { spawnSync } from 'node:child_process';
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

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
import { blockedGate, startStubGateway, unlockedGate } from './stub-gateway.mjs';

/**
 * Commit `paths` (only those: the run's own files, such as the harness marker the harness appends to,
 * stay untracked, as they would in a fresh CI checkout) and return the new head sha.
 */
function commitFixture(dir, message, paths) {
  const git = (...args) => {
    const r = spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
    if ((r.status ?? 1) !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`);
    return r.stdout.trim();
  };
  git('add', '--', ...paths);
  git('commit', '-q', '-m', message);
  return git('rev-parse', 'HEAD');
}

async function main() {
  const { check, done } = makeChecker(
    'correction → candidate → PR → failed check → repair → bound evidence → unlocked rollout',
  );

  const fx = makeGitFixture({
    baseFiles: { 'context/refund/policy.md': 'v1\n', 'deps.lock': 'lockA\n' },
    headFiles: { 'context/refund/policy.md': 'v2\n' },
  });
  const gh = await startStubForge({ repositoryWrite: 'granted' });
  // The rollout decision follows the run: locked while the check fails, unlocked once it passes, and
  // locked again (with its own reason) after the customer rejects the candidate.
  const server = { phase: 'failing', rejected: false };
  const gw = await startStubGateway({
    apiKey: 'ur_sk_test_x',
    rollout: (ref, request) => {
      if (server.rejected) return blockedGate(ref, ['candidate_not_qualified']);
      if (request.application_headline !== 'ready_for_rollout') {
        return blockedGate(ref, ['application_check_not_passed']);
      }
      return unlockedGate(ref, '');
    },
  });

  const { path: candidatePath, candidateRef } = writeCandidate(fx.dir);
  const cfg = candidateConfig();
  cfg.lockfile = 'deps.lock';
  cfg.workflows[0].testCommand = `node ${join(HARNESS_DIR, 'candidate-repair.mjs')}`;
  const configPath = writeConfig(fx.dir, cfg);
  const marker = join(fx.dir, 'revisions.txt');

  const runLoop = (head, extra = []) =>
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
        head,
        '--changed-file',
        'context/refund/policy.md',
        '--pr',
        '77',
        '--shape',
        'gateway_owned',
        '--mode',
        'open_pr',
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
      { cwd: fx.dir, env: { UR_APP_CI_MARKER: marker, UR_API_KEY: 'ur_sk_test_forbidden' } },
    );

  try {
    // ── 1-3. the candidate is proposed, written, and the application check FAILS. ──
    const r1 = await runLoop(fx.headSha, ['--apply']);
    const wf1 = r1.json?.app_ci?.workflows?.find((w) => w.workflow_id === 'wf_refund');
    const evidence1 = wf1?.evidence_hash;

    check(
      'the diff and the destination branch are SHOWN before the write',
      r1.stderr.includes('--- proposed diff ---') &&
        r1.stderr.includes(`destination branch: ultrarouter/candidate/${candidateRef}`),
      r1.stderr.split('\n').slice(0, 5).join(' | '),
    );
    check(
      'the reviewable change is delivered as a DRAFT PR (never merged)',
      gh.forge.pullRequests.length === 1 &&
        gh.forge.pullRequests[0].draft === true &&
        gh.forge.mergeAttempts.length === 0 &&
        r1.json?.delivery?.merged === false,
      `prs=${gh.forge.pullRequests.length} merges=${gh.forge.mergeAttempts.length}`,
    );
    check(
      'the ACTUAL customer harness ran both revisions, candidate-only bound',
      (() => {
        const lines = readFileSync(marker, 'utf8').trim().split('\n');
        return (
          lines.length === 2 &&
          lines[0] === 'baseline none' &&
          lines[1] === `candidate ${candidateRef}`
        );
      })(),
      readFileSync(marker, 'utf8').replace(/\n/g, ' | '),
    );
    check(
      'the failing application check BLOCKS: Regression found + Check Run failure + exit 2',
      wf1?.headline === 'regression_found' &&
        wf1?.conclusion === 'failure' &&
        wf1?.reasons?.includes('application_test_failed') === true &&
        r1.code === 2 &&
        gh.state.checkRuns.some(
          (c) => c.name === 'ultrarouter app-ci / wf_refund' && c.conclusion === 'failure',
        ),
      `code=${r1.code} headline=${wf1?.headline} checks=${JSON.stringify(gh.state.checkRuns.map((c) => c.conclusion))}`,
    );
    check(
      'a failing check keeps the rollout LOCKED with a named reason',
      r1.json?.rollout?.unlocked === false &&
        r1.json?.rollout?.blockers?.[0]?.reason === 'application_check_not_passed',
      JSON.stringify(r1.json?.rollout),
    );
    check(
      'the failure comment REDACTS the leaked key from the debug excerpt',
      (() => {
        const body =
          gh.state.comments.find((c) => c.body.includes('ur-app-ci:wf_refund'))?.body ?? '';
        return (
          body.includes('[redacted]') &&
          !body.includes('ur_sk_live_ABCDEF0123456789abcd') &&
          !body.includes('ur_sk_test_forbidden') &&
          !body.includes('trusted-publish-token')
        );
      })(),
      'a secret survived into the comment',
    );

    // ── 4. the REPAIR: the customer fixes the application and pushes a new head. ──
    const repaired = join(fx.dir, 'context', 'refund', 'REPAIRED');
    mkdirSync(dirname(repaired), { recursive: true });
    writeFileSync(repaired, 'fixed\n');
    const head2 = commitFixture(fx.dir, 'repair the refund schema for the learned exemplar', [
      repaired,
    ]);

    const r2 = await runLoop(head2, ['--apply']);
    const wf2 = r2.json?.app_ci?.workflows?.find((w) => w.workflow_id === 'wf_refund');
    const evidence2 = wf2?.evidence_hash;

    check(
      'the repaired head PASSES the application check (Ready for controlled rollout, exit 0)',
      wf2?.headline === 'ready_for_rollout' && wf2?.conclusion === 'success' && r2.code === 0,
      `code=${r2.code} headline=${wf2?.headline} reasons=${JSON.stringify(wf2?.reasons)}`,
    );
    check(
      'the repair produces NEW BOUND EVIDENCE (a different immutable object, same candidate)',
      typeof evidence1 === 'string' &&
        typeof evidence2 === 'string' &&
        evidence1 !== evidence2 &&
        r2.json?.candidate?.candidate_ref === candidateRef,
      `e1=${String(evidence1).slice(0, 12)} e2=${String(evidence2).slice(0, 12)}`,
    );
    check(
      'the rollout button is now UNLOCKED — and does not press it',
      r2.json?.rollout?.unlocked === true &&
        r2.json?.rollout?.pressed === false &&
        r2.json?.rollout?.blockers?.length === 0,
      JSON.stringify(r2.json?.rollout),
    );
    check(
      'the PR comment and the JSON quote the SAME immutable evidence object',
      (() => {
        const body =
          gh.state.comments.find((c) => c.body.includes('ur-app-ci:wf_refund'))?.body ?? '';
        return body.includes(String(evidence2).slice(0, 16)) && body.includes(candidateRef);
      })(),
      `evidence2=${String(evidence2).slice(0, 16)}`,
    );
    check(
      'the comment states the rollout is unlocked, and NEVER that a merged PR is improvement',
      (() => {
        const body =
          gh.state.comments.find((c) => c.body.includes('ur-app-ci:wf_refund'))?.body ?? '';
        return (
          body.includes('**Start controlled rollout** is UNLOCKED') &&
          body.includes('CI does not press it') &&
          body.includes('merging it is not measured improvement') &&
          !/merged.{0,40}improvement (was|is) (measured|proven)/i.test(body)
        );
      })(),
      'the rollout copy is missing or over-claims',
    );
    check(
      'ONE comment and ONE Check Run per workflow survive both runs (idempotent, current head)',
      gh.state.comments.filter((c) => c.body.includes('ur-app-ci:wf_refund')).length === 1 &&
        gh.state.checkRuns.filter((c) => c.name === 'ultrarouter app-ci / wf_refund').length ===
          2 &&
        gh.state.checkRuns.filter((c) => c.head_sha === head2).length === 1 &&
        gh.state.checkRuns.filter((c) => c.head_sha === fx.headSha).length === 1,
      `comments=${gh.state.comments.length} checks=${gh.state.checkRuns.length}`,
    );
    check(
      'no second PR is opened on the re-run (the branch already exists — idempotent)',
      gh.forge.pullRequests.length === 1 && gh.forge.mergeAttempts.length === 0,
      `prs=${gh.forge.pullRequests.length}`,
    );

    // ── 7. the REJECTING customer: an authenticated, replay-safe decision with actor + reason. ──
    const decisionArgs = [
      'flywheel-pr',
      'decision',
      '--candidate',
      candidatePath,
      '--decision',
      'reject',
      '--actor',
      'usr_alice',
      '--reason',
      'the exemplars contradict our EU refund SOP',
      '--surface',
      'pull_request',
      '--evidence-hash',
      String(evidence2),
      '--base-url',
      gw.url,
      '--api-key',
      'ur_sk_test_x',
      '--decided-at',
      '2026-09-14T10:00:00.000Z',
    ];
    const d1 = await runBin(decisionArgs, { cwd: fx.dir });
    check(
      'a human REJECT is recorded with actor + reason over an AUTHENTICATED callback',
      d1.code === 0 &&
        d1.json?.status === 'accepted' &&
        gw.state.decisions.length === 1 &&
        gw.state.decisions[0].decision === 'reject' &&
        gw.state.decisions[0].actor_id === 'usr_alice' &&
        gw.state.decisions[0].reason === 'the exemplars contradict our EU refund SOP' &&
        gw.state.decisions[0].evidence_hash === evidence2 &&
        gw.state.rejected.length === 0,
      `code=${d1.code} ${JSON.stringify(d1.json)} rejected=${JSON.stringify(gw.state.rejected)}`,
    );
    const d2 = await runBin(decisionArgs, { cwd: fx.dir });
    check(
      'a REPLAY of the same decision is a VISIBLE no-op (duplicate), not a second decision',
      d2.code === 0 &&
        d2.json?.status === 'duplicate' &&
        d2.json?.callback_id === d1.json?.callback_id &&
        gw.state.decisions.length === 1,
      `code=${d2.code} status=${d2.json?.status} decisions=${gw.state.decisions.length}`,
    );
    const dBad = await runBin(
      [...decisionArgs.slice(0, -6), '--base-url', gw.url, '--api-key', 'ur_sk_test_WRONG'],
      {
        cwd: fx.dir,
      },
    );
    check(
      'a callback signed with the wrong key is REFUSED (the stub recomputes the MAC itself)',
      dBad.code === 2 &&
        gw.state.rejected.includes('invalid_signature') &&
        gw.state.decisions.length === 1,
      `code=${dBad.code} rejected=${JSON.stringify(gw.state.rejected)}`,
    );
    const dNoReason = await runBin(
      [
        'flywheel-pr',
        'decision',
        '--candidate',
        candidatePath,
        '--decision',
        'reject',
        '--actor',
        'usr_alice',
        '--reason',
        '   ',
        '--base-url',
        gw.url,
        '--api-key',
        'ur_sk_test_x',
      ],
      { cwd: fx.dir },
    );
    check(
      'a decision with a blank reason is REFUSED (actor + reason are mandatory, not nullable)',
      dNoReason.code === 2 && /reason_required/.test(dNoReason.stderr),
      `code=${dNoReason.code} ${dNoReason.stderr.slice(0, 160)}`,
    );

    // ── after the rejection the server locks the rollout again, with its own named reason. ──
    server.rejected = true;
    const r3 = await runLoop(head2, []);
    check(
      'after a customer REJECTS, the rollout is locked again with its own named reason',
      r3.json?.rollout?.unlocked === false &&
        r3.json?.rollout?.pressed === false &&
        r3.json?.rollout?.blockers?.[0]?.reason === 'candidate_not_qualified',
      JSON.stringify(r3.json?.rollout),
    );
    check(
      'nothing in the whole loop ever merged, adopted, or pressed a rollout',
      gh.forge.mergeAttempts.length === 0 &&
        [r1, r2, r3].every((r) => r.json?.rollout?.pressed === false) &&
        [r1, r2, r3].every((r) => r.json?.delivery?.merged === false),
      `merges=${gh.forge.mergeAttempts.length}`,
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
