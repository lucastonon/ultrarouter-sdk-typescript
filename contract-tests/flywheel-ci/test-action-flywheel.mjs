//
// The fail-closed dispatch guard must keep holding once a THIRD mode exists. This suite
// parses `action.yml`, EXECUTES the real no-`if` validation bash for the new mode, and asserts:
// (a) `mode: flywheel-pr` dispatches a gate step AND passes the guard when its prerequisites are
// present — so the new mode cannot be a step that silently never runs;
// (b) `mode: flywheel-pr` WITHOUT a candidate fails the guard (a missing prerequisite is never a
// green required check with zero evidence);
// (c) unknown/legacy modes still fail, i.e. adding a mode did not widen the guard;
// (d) the action never grants `contents: write` implicitly — the write is an opt-in input.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { makeChecker } from './lib.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ACTION_YML = resolve(HERE, '../../action.yml');
const req = createRequire(pathToFileURL(resolve(HERE, '../../package.json')));
const yaml = req('js-yaml');

function gateModes(steps) {
  const modes = new Set();
  for (const s of steps) {
    const cond = typeof s.if === 'string' ? s.if : '';
    for (const frag of cond.match(/inputs\.mode\s*==\s*'([^']+)'/g) ?? []) {
      const v = frag.match(/'([^']+)'/);
      if (v) modes.add(v[1]);
    }
  }
  return modes;
}

function guardSteps(steps) {
  return steps.filter(
    (s) => s.if === undefined && typeof s.run === 'string' && s.run.includes('UR_MODE'),
  );
}

function runGuard(runScript, env) {
  const dir = mkdtempSync(join(tmpdir(), 'ur-action-flw-'));
  const file = join(dir, 'guard.sh');
  writeFileSync(file, runScript);
  const res = spawnSync('bash', [file], { encoding: 'utf8', env: { ...process.env, ...env } });
  return { code: res.status ?? 1, stderr: `${res.stderr ?? ''}${res.stdout ?? ''}` };
}

async function main() {
  const { check, done } = makeChecker(
    'action.yml — the flywheel-pr mode dispatches and fails closed',
  );
  const raw = readFileSync(ACTION_YML, 'utf8');
  const doc = yaml.load(raw);
  const steps = doc.runs?.steps ?? [];
  const gates = gateModes(steps);
  const guards = guardSteps(steps);
  const anyGuardFails = (env) => guards.some((g) => runGuard(g.run, env).code !== 0);
  const guardOut = (env) => guards.map((g) => runGuard(g.run, env).stderr).join('\n');

  check(
    'a gate step dispatches on mode flywheel-pr',
    gates.has('flywheel-pr'),
    [...gates].join(','),
  );
  check(
    'the three modes all dispatch (bench, app-ci, flywheel-pr)',
    gates.has('bench') && gates.has('app-ci') && gates.has('flywheel-pr'),
    [...gates].join(','),
  );
  check(
    'mode=flywheel-pr with a config + candidate passes the guard',
    !anyGuardFails({
      UR_MODE: 'flywheel-pr',
      UR_CONFIG: 'ur-app-ci.config.json',
      UR_CANDIDATE: 'candidate.json',
    }),
    guardOut({ UR_MODE: 'flywheel-pr', UR_CONFIG: 'c', UR_CANDIDATE: 'x' }).slice(0, 200),
  );
  check(
    'mode=flywheel-pr WITHOUT a candidate fails the guard, naming the missing input',
    anyGuardFails({
      UR_MODE: 'flywheel-pr',
      UR_CONFIG: 'ur-app-ci.config.json',
      UR_CANDIDATE: '',
    }) && /candidate/.test(guardOut({ UR_MODE: 'flywheel-pr', UR_CONFIG: 'c', UR_CANDIDATE: '' })),
    guardOut({ UR_MODE: 'flywheel-pr', UR_CONFIG: 'c', UR_CANDIDATE: '' }).slice(0, 200),
  );
  for (const bad of ['bogus', '', 'flywheel', 'flywheel_pr', 'FLYWHEEL-PR']) {
    check(
      `unknown mode '${bad || '(empty)'}' still cannot run zero gates AND succeed`,
      !gates.has(bad) && anyGuardFails({ UR_MODE: bad }),
      `gateRuns=${gates.has(bad)}`,
    );
  }
  check(
    'the action documents contents:write as a SEPARATE opt-in, never granted by default',
    /contents: write.*SEPARATE opt-in|SEPARATE opt-in.*contents: write/s.test(raw) &&
      /apply-changes/.test(raw),
    'the least-privilege note or the explicit apply opt-in is missing',
  );
  check(
    'writing is OPT-IN at the action level (the apply input defaults to false)',
    doc.inputs?.['apply-changes']?.default === 'false' ||
      doc.inputs?.['apply-changes']?.default === false,
    JSON.stringify(doc.inputs?.['apply-changes']),
  );

  done();
}

main().catch((e) => {
  console.error('action dispatch guard: fatal', e);
  process.exit(1);
});
