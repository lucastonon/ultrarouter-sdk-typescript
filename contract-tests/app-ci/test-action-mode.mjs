// The action.yml dispatch guard. The action selects a gate on `inputs.mode`; without a guard an
// unknown or legacy mode would run NEITHER gate and the job would exit 0, turning a required check
// green with zero evidence. This test parses action.yml, EXECUTES
// the real no-`if` validation step's bash for each mode, and asserts:
// (a) an unknown mode can NEVER reach "zero gate steps run AND the job succeeds" — when no gate
// `if` matches, some always-run guard step MUST exit non-zero;
// (b) the legacy paired-runner values (request/task) fail with the explicit `paired-mode` rename
// message.
// It is DELETION-SENSITIVE: remove the validation step and (a) collapses (no guard fails) ⇒ FAIL.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { makeChecker } from './lib.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ACTION_YML = resolve(HERE, '../../action.yml');
// js-yaml is a dev dependency of the package — resolve it from the repository root.
const req = createRequire(pathToFileURL(resolve(HERE, '../../package.json')));
const yaml = req('js-yaml');

/** Steps whose `if` gates on a specific mode value → the set of modes that make each gate run. */
function gateModes(steps) {
  const modes = new Set();
  for (const s of steps) {
    const cond = typeof s.if === 'string' ? s.if : '';
    const m = cond.match(/inputs\.mode\s*==\s*'([^']+)'/g) ?? [];
    for (const frag of m) {
      const v = frag.match(/'([^']+)'/);
      if (v) modes.add(v[1]);
    }
  }
  return modes;
}

/** The always-run (no `if`) steps whose bash reads `$UR_MODE` — the fail-closed dispatch guards. */
function guardSteps(steps) {
  return steps.filter(
    (s) => s.if === undefined && typeof s.run === 'string' && s.run.includes('UR_MODE'),
  );
}

/** Execute a guard step's bash with the given env; return { code, stderr }. */
function runGuard(runScript, env) {
  const dir = mkdtempSync(join(tmpdir(), 'ur-action-mode-'));
  const file = join(dir, 'guard.sh');
  writeFileSync(file, runScript);
  const res = spawnSync('bash', [file], { encoding: 'utf8', env: { ...process.env, ...env } });
  return { code: res.status ?? 1, stderr: `${res.stderr ?? ''}${res.stdout ?? ''}` };
}

async function main() {
  const { check, done } = makeChecker(
    'action.yml dispatch guard — no silent pass on an unknown mode',
  );
  const doc = yaml.load(readFileSync(ACTION_YML, 'utf8'));
  const steps = doc.runs?.steps ?? [];
  const gates = gateModes(steps);
  const guards = guardSteps(steps);

  check(
    'the two gate steps still dispatch on mode bench + app-ci',
    gates.has('bench') && gates.has('app-ci'),
    [...gates].join(','),
  );
  check(
    'there is at least one ALWAYS-RUN (no-if) mode-validation guard step',
    guards.length >= 1,
    `guards=${guards.length}`,
  );

  // Any guard failing for a given (mode,suite,config) env.
  const anyGuardFails = (env) => guards.some((g) => runGuard(g.run, env).code !== 0);
  const guardStderr = (env) => guards.map((g) => runGuard(g.run, env).stderr).join('\n');

  // Valid modes with their prerequisites present ⇒ the guard passes AND a gate would run.
  check(
    'mode=bench (with suite) passes the guard and a gate runs',
    !anyGuardFails({ UR_MODE: 'bench', UR_SUITE: 'checkout' }) && gates.has('bench'),
  );
  check(
    'mode=app-ci (with config) passes the guard and a gate runs',
    !anyGuardFails({ UR_MODE: 'app-ci', UR_CONFIG: 'ur-app-ci.config.json' }) &&
      gates.has('app-ci'),
  );

  // (a) The core defect: for a mode NO gate step matches, some always-run guard MUST fail.
  for (const bad of ['bogus', '', 'BENCH', 'app_ci', 'gate']) {
    const gateRuns = gates.has(bad);
    check(
      `unknown mode '${bad || '(empty)'}' cannot run zero gates AND succeed (a guard fails)`,
      !gateRuns && anyGuardFails({ UR_MODE: bad }),
      `gateRuns=${gateRuns}`,
    );
  }

  // (b) The legacy rename is legible, not a bare "unknown mode".
  for (const legacy of ['request', 'task']) {
    const out = guardStderr({ UR_MODE: legacy });
    check(
      `legacy mode '${legacy}' fails with the explicit paired-mode rename message`,
      !gates.has(legacy) && anyGuardFails({ UR_MODE: legacy }) && /paired-mode/.test(out),
      out.replace(/\n/g, ' ').slice(0, 160),
    );
  }

  // Prerequisite guard: mode=bench with an empty suite fails (missing-prerequisite, objective).
  check(
    'mode=bench with an EMPTY suite fails the guard',
    anyGuardFails({ UR_MODE: 'bench', UR_SUITE: '' }),
  );

  done();
}

main().catch((e) => {
  console.error('action.yml dispatch guard: fatal', e);
  process.exit(1);
});
