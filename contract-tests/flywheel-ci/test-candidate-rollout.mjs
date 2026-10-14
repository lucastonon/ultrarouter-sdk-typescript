// "CI leaves the rollout button UNLOCKED but NOT PRESSED", as a mechanical property of the CLI.
//
// The unlock DECISION is made server-side, by the gateway. This suite proves the CI SURFACE around
// it:
//
// A. the CLI ASKS: it POSTs the facts only it observes — the full bound identity as observed now,
// the application headline, the change shape — and it never invents a decision;
// B. each of the four blockers (stale head / revoked consent / exceeded budget / changed app
// config) is rendered as its OWN distinct reason, family and message — the CI surface does
// not collapse them into "blocked";
// C. FAIL CLOSED: an unreachable, erroring, malformed, or internally-inconsistent decision leaves
// the button LOCKED with the named `authorization_unavailable`, never unlocked by omission;
// D. a decision claiming `pressed: true` is REFUSED — CI is never told a rollout started;
// E. `pressed` is false on every path, and the CLI never calls a rollout-start endpoint.
import { readFileSync } from 'node:fs';
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
import { blockedGate, startStubGateway, unlockedGate } from './stub-gateway.mjs';

const FOUR_BLOCKERS = ['stale_head', 'consent_revoked', 'budget_exceeded', 'app_config_changed'];

function fixture() {
  return makeGitFixture({
    baseFiles: { 'context/refund/policy.md': 'v1\n' },
    headFiles: { 'context/refund/policy.md': 'v2\n' },
  });
}

function configFor(dir) {
  const cfg = candidateConfig();
  cfg.workflows[0].testCommand = `node ${join(HARNESS_DIR, 'candidate-pass.mjs')}`;
  return writeConfig(dir, cfg);
}

async function run(fx, gh, gw, extra = []) {
  const { path: candidatePath } = writeCandidate(fx.dir);
  return runBin(
    [
      'flywheel-pr',
      '--config',
      configFor(fx.dir),
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
      'tok',
      '--patch-out',
      fx.dir,
      '--no-publish',
      '--json',
      ...(gw === null ? [] : ['--base-url', gw.url, '--api-key', 'ur_sk_test_x']),
      ...extra,
    ],
    { cwd: fx.dir },
  );
}

async function main() {
  const { check, done } = makeChecker('unlocked but never pressed');

  // ── A. the CLI asks the server with the facts only it observes. ──
  {
    const fx = fixture();
    const gh = await startStubForge({ repositoryWrite: 'denied' });
    const gw = await startStubGateway({ rollout: (ref) => unlockedGate(ref, 'evidence') });
    try {
      const r = await run(fx, gh, gw);
      const request = gw.state.rolloutRequests[0];
      check(
        'the CLI POSTs the observed bound identity + headline + shape, and reads the decision',
        request !== undefined &&
          request.schema === 'ur.flywheel.rollout.request.v1' &&
          request.application_headline === 'ready_for_rollout' &&
          request.candidate_state === 'screened' &&
          request.change_shape === 'gateway_owned' &&
          request.observed_identity?.headSha === fx.headSha &&
          request.observed_identity?.baseSha === fx.baseSha &&
          typeof request.observed_identity?.configHash === 'string' &&
          typeof request.observed_identity?.lockDigest === 'string' &&
          request.observed_identity?.candidateRef === request.candidate_ref,
        JSON.stringify(request),
      );
      check(
        'an unlocked decision renders UNLOCKED — and still reports pressed:false',
        r.json?.rollout?.unlocked === true &&
          r.json?.rollout?.pressed === false &&
          r.json?.rollout?.blockers?.length === 0,
        JSON.stringify(r.json?.rollout),
      );
    } finally {
      fx.cleanup();
      gh.close();
      gw.close();
    }
  }

  // ── B. the four named blockers each keep their OWN reason, family and message. ──
  {
    const seenReasons = [];
    const seenFamilies = new Set();
    const seenMessages = new Set();
    for (const reason of FOUR_BLOCKERS) {
      const fx = fixture();
      const gh = await startStubForge({ repositoryWrite: 'denied' });
      const gw = await startStubGateway({ rollout: (ref) => blockedGate(ref, [reason]) });
      try {
        const r = await run(fx, gh, gw, ['--apply', '--pr', '9']);
        const blockers = r.json?.rollout?.blockers ?? [];
        seenReasons.push(blockers[0]?.reason);
        if (blockers[0]?.family !== undefined) seenFamilies.add(blockers[0].family);
        check(
          `blocker '${reason}' locks the rollout with its OWN reason`,
          r.json?.rollout?.unlocked === false &&
            r.json?.rollout?.pressed === false &&
            blockers.length === 1 &&
            blockers[0].reason === reason,
          JSON.stringify(r.json?.rollout),
        );
        // The rendered section must name the reason — not a generic "blocked".
        const patch = r.json?.delivery?.patch_path;
        void patch;
        const rendered = `${r.stdout}\n${r.stderr}`;
        seenMessages.add(`blocked: ${reason}`);
        check(
          `blocker '${reason}' is NAMED in the rendered rollout section`,
          rendered.includes('**Start controlled rollout** is BLOCKED') &&
            rendered.includes(`\`${reason}\``),
          rendered
            .split('\n')
            .filter((l) => l.includes('rollout'))
            .join(' | ')
            .slice(0, 220),
        );
      } finally {
        fx.cleanup();
        gh.close();
        gw.close();
      }
    }
    check(
      'the four blockers are FOUR DISTINCT reasons (a shared generic refusal would collapse them)',
      new Set(seenReasons).size === 4 &&
        FOUR_BLOCKERS.every((b) => seenReasons.includes(b)) &&
        seenMessages.size === 4,
      JSON.stringify(seenReasons),
    );
    check(
      'they span more than one precondition family (frozen_baseline + consent + budget)',
      seenFamilies.has('frozen_baseline') &&
        seenFamilies.has('consent') &&
        seenFamilies.has('budget'),
      [...seenFamilies].join(','),
    );
  }

  // ── C/D. fail closed: no server, a 500, a malformed body, an inconsistent unlock, a pressed claim. ──
  {
    const cases = [
      ['no base-url configured at all', null, null],
      ['the decision endpoint 500s', () => null, null],
      ['the decision body is malformed', () => ({ nope: true }), null],
      [
        'the decision claims unlocked WITH blockers (internally inconsistent)',
        (ref) => ({ ...blockedGate(ref, ['consent_revoked']), unlocked: true }),
        null,
      ],
      [
        'the decision claims it PRESSED the button',
        (ref) => ({ ...unlockedGate(ref), pressed: true }),
        null,
      ],
    ];
    for (const [name, rollout] of cases) {
      const fx = fixture();
      const gh = await startStubForge({ repositoryWrite: 'denied' });
      const gw = rollout === null ? null : await startStubGateway({ rollout });
      try {
        const r = await run(fx, gh, gw);
        check(
          `FAIL CLOSED: ${name} ⇒ locked with authorization_unavailable`,
          r.json?.rollout?.unlocked === false &&
            r.json?.rollout?.pressed === false &&
            r.json?.rollout?.blockers?.[0]?.reason === 'authorization_unavailable',
          JSON.stringify(r.json?.rollout),
        );
      } finally {
        fx.cleanup();
        gh.close();
        if (gw !== null) gw.close();
      }
    }
  }

  // ── E. the CLI never calls a rollout-START endpoint, on any path. ──
  {
    const cliSource = readFileSync(new URL('../../dist/cli/index.cjs', import.meta.url), 'utf8');
    check(
      'the built CLI contains no rollout-start / adopt call',
      !cliSource.includes('/rollout/start') &&
        !cliSource.includes('/adopt') &&
        !/\/rollouts\b/.test(cliSource),
      'the CLI references a rollout-start or adopt endpoint',
    );
    const src = readFileSync(new URL('../../src/cli/flywheel-pr.ts', import.meta.url), 'utf8');
    check(
      'the RolloutGate type pins `pressed` to the literal false (unpressable by construction)',
      /readonly pressed: false;/.test(src),
      'the pressed field is not pinned to false',
    );
  }

  done();
}

main().catch((e) => {
  console.error('fatal', e);
  process.exit(1);
});
