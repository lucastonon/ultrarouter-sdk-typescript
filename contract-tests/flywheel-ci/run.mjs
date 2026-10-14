#!/usr/bin/env node
// The `ur flywheel-pr` battery: six hermetic suites (a stub forge, a stub gateway, stub customer
// harnesses and temp git fixtures) against the real built `ur` bin. It boots nothing external and
// exits non-zero on any suite failure.
//
// Prereq: `npm run build` at the repository root.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = resolve(HERE, '../../dist/cli/index.cjs');

if (!existsSync(CLI)) {
  console.error(`flywheel-ci battery: the built CLI is missing (${CLI}).`);
  console.error('Build it first: npm run build (at the repository root)');
  process.exit(1);
}

const suites = [
  ['repository-write permissions + never merge', 'test-candidate-permissions.mjs'],
  ['change shapes + immutable candidate identity', 'test-candidate-shapes.mjs'],
  ['rollout unlocked but never pressed', 'test-candidate-rollout.mjs'],
  ['end to end: candidate → check → repair → decision', 'test-e2e-app-ci-loop.mjs'],
  ['the evidence names the tested revision', 'test-candidate-revision.mjs'],
  ['action.yml flywheel-pr dispatch guard', 'test-action-flywheel.mjs'],
];

for (const [name, file] of suites) {
  process.stdout.write(`\n=== ${name} ===\n`);
  const res = spawnSync('node', [resolve(HERE, file)], { stdio: 'inherit', cwd: HERE });
  if ((res.status ?? 1) !== 0) {
    process.stderr.write(
      `\nflywheel-ci battery: suite "${name}" FAILED (exit ${res.status ?? 'signal'})\n`,
    );
    process.exit(res.status ?? 1);
  }
}

process.stdout.write(`\n✓ flywheel-ci battery passed (${String(suites.length)} suites)\n`);
