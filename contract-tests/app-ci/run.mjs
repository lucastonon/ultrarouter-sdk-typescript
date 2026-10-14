#!/usr/bin/env node
// The `ur app-ci` battery: seven hermetic suites (a stub GitHub API, a stub gateway, stub harness
// commands and temp git fixtures) against the real built `ur` bin. It boots nothing external and
// exits non-zero on any suite failure, so CI runs it on every pull request after the build.
//
// Prereq: `npm run build` at the repository root.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = resolve(HERE, '../../dist/cli/index.cjs');

if (!existsSync(CLI)) {
  console.error(`app-ci battery: the built CLI is missing (${CLI}).`);
  console.error('Build it first: npm run build (at the repository root)');
  process.exit(1);
}

const suites = [
  ['change binding + needs configuration', 'test-app-binding.mjs'],
  ['stale evidence invalidates a check', 'test-stale-head.mjs'],
  ['fork isolation + scrubbed harness env', 'test-fork-isolation.mjs'],
  ['end to end: an application failure blocks', 'test-e2e-app-ci.mjs'],
  ['fail closed: discovery, exit codes, signals', 'test-fail-closed.mjs'],
  ['the evidence names the tested revision', 'test-candidate-revision.mjs'],
  ['action.yml dispatch guard', 'test-action-mode.mjs'],
];

for (const [name, file] of suites) {
  process.stdout.write(`\n=== ${name} ===\n`);
  const res = spawnSync('node', [resolve(HERE, file)], { stdio: 'inherit', cwd: HERE });
  if ((res.status ?? 1) !== 0) {
    process.stderr.write(
      `\napp-ci battery: suite "${name}" FAILED (exit ${res.status ?? 'signal'})\n`,
    );
    process.exit(res.status ?? 1);
  }
}

process.stdout.write(`\n✓ app-ci battery passed (${String(suites.length)} suites)\n`);
