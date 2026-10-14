#!/usr/bin/env node
/**
 * run-examples — execute every runnable example under `examples/` against the built package and
 * the local mock gateway. Each example must exit 0. Type-checking is done separately by
 * `npm run typecheck` (`examples/tsconfig.json`).
 *
 *   npm run build && node scripts/run-examples.mjs [--verbose] [examples/quickstart.ts]
 */
import { cpSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';

import { startMockGateway } from '../test/support/mock-gateway.mjs';
import {
  ROOT,
  assertBuilt,
  createWorkspace,
  removeWorkspace,
  runNode,
  transpile,
} from './lib/ts-runner.mjs';

/** Every runnable example (`*.ts` under `examples/`, excluding declaration files). */
export function exampleFiles() {
  const out = [];
  const walk = (dir) => {
    for (const name of readdirSync(join(ROOT, dir)).sort()) {
      const rel = join(dir, name);
      if (statSync(join(ROOT, rel)).isDirectory()) walk(rel);
      else if (name.endsWith('.ts') && !name.endsWith('.d.ts')) out.push(rel);
    }
  };
  walk('examples');
  return out;
}

async function main(argv) {
  const verbose = argv.includes('--verbose');
  const explicit = argv.filter((a) => !a.startsWith('--'));
  assertBuilt();
  const files = explicit.length > 0 ? explicit : exampleFiles();
  const gw = await startMockGateway();
  const dir = createWorkspace('ur-examples');
  const failures = [];
  try {
    for (const file of files) {
      const target = join(dir, file);
      cpSync(join(ROOT, file), target, { recursive: true });
      const entry = transpile(dirname(target), file.split('/').pop());
      const result = await runNode(dirname(target), entry, gw.url);
      if (result.code !== 0)
        failures.push({ file, detail: `${result.stderr}${result.stdout}`.trim().slice(0, 2000) });
      else if (verbose) process.stdout.write(`ok ${file}\n${result.stdout}\n`);
      else process.stdout.write(`ok ${file}\n`);
    }
  } finally {
    await gw.close();
    removeWorkspace(dir);
  }
  for (const f of failures) process.stderr.write(`\nFAIL ${f.file}\n${f.detail}\n`);
  process.stdout.write(
    `\nexamples: ${String(files.length - failures.length)}/${String(files.length)} passed\n`,
  );
  return failures.length === 0 ? 0 : 1;
}

if (
  process.argv[1] !== undefined &&
  relative(process.argv[1], new URL(import.meta.url).pathname) === ''
) {
  process.exitCode = await main(process.argv.slice(2));
}
