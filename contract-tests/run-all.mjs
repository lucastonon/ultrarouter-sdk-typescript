#!/usr/bin/env node
// Run every hermetic battery under contract-tests/ plus the bench gate smoke, in sequence, against
// the BUILT package (`dist/`). Each battery boots its own stubs on 127.0.0.1 and needs no network,
// no credentials and no running gateway. Exits non-zero when any battery fails and prints a
// summary either way.
//
// Prereq: `npm run build` at the repository root. Run: `npm run contract`.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');

for (const built of ['dist/index.js', 'dist/context.js', 'dist/cli/index.cjs']) {
  if (!existsSync(resolve(ROOT, built))) {
    console.error(`contract: ${built} is missing. Build first: npm run build`);
    process.exit(1);
  }
}

/** [label, script] — every battery entrypoint, in a stable order. */
const BATTERIES = [
  ['app-ci (ur app-ci + action dispatch guard)', 'contract-tests/app-ci/run.mjs'],
  ['flywheel-ci (ur flywheel-pr)', 'contract-tests/flywheel-ci/run.mjs'],
  ['cli (exit-code contract)', 'contract-tests/cli/run.mjs'],
  ['preflight (preflight + useLearned)', 'contract-tests/preflight/run.mjs'],
  ['reviewer (signed reviewer adapter)', 'contract-tests/reviewer/run.mjs'],
  ['flywheel (outcome ledger)', 'contract-tests/flywheel/run.mjs'],
  ['context (built context subpath)', 'contract-tests/context/run.mjs'],
  ['bench gate smoke (ur bench run --gate)', 'scripts/action-smoke.mjs'],
];

const results = [];
for (const [label, script] of BATTERIES) {
  process.stdout.write(`\n━━━ ${label} ━━━\n`);
  const started = Date.now();
  const res = spawnSync(process.execPath, [resolve(ROOT, script)], { stdio: 'inherit', cwd: ROOT });
  results.push({ label, code: res.status ?? 1, ms: Date.now() - started });
}

process.stdout.write('\ncontract summary:\n');
for (const r of results) {
  process.stdout.write(`  ${r.code === 0 ? '✓' : '✗'} ${r.label} (${String(r.ms)} ms)\n`);
}
const failed = results.filter((r) => r.code !== 0);
if (failed.length > 0) {
  process.stderr.write(
    `\ncontract: ${String(failed.length)} of ${String(results.length)} batteries FAILED\n`,
  );
  process.exit(1);
}
process.stdout.write(`\ncontract: all ${String(results.length)} batteries passed\n`);
