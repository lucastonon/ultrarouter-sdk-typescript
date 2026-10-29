#!/usr/bin/env node
/**
 * Size-budget assertion. Two SEPARATE entry points are measured:
 *
 * - `@ultrarouter/sdk` (core, `src/index.ts`): the fetch-based client, ZERO runtime
 * deps. Minified + gzipped it must stay under 19 kB (raised from 15 kB when the
 * plug-and-play learning surface landed: request/episode correlation, verdict reports,
 * receipts and learning controls). This is the load-bearing proof that adding the
 * context subpath did NOT bloat the client — importing the client never pulls the
 * context runtime (separate entry, tree-shaken).
 * - `@ultrarouter/sdk/context` (`src/context.ts`): the pure context runtime with `zod`
 * BUNDLED (so the published SDK keeps zero runtime deps). `node:crypto` (the
 * deterministic default hasher) stays an external builtin. It has a generous budget
 * that only trips on accidental bloat.
 *
 * We bundle each entry with esbuild (minify + treeshake), gzip it, and assert the byte
 * count. Nothing is external for core (zero runtime deps); the context entry externalizes
 * only the `node:crypto` builtin.
 */
import { gzipSync } from 'node:zlib';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { build } from 'esbuild';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(HERE, '../src');

/** @type {{ name: string, entry: string, budget: number, external: string[] }[]} */
const ENTRIES = [
  { name: '@ultrarouter/sdk core', entry: 'index.ts', budget: 19 * 1024, external: [] },
  {
    name: '@ultrarouter/sdk/context',
    entry: 'context.ts',
    budget: 50 * 1024,
    external: ['node:crypto'],
  },
];

let failed = false;

for (const { name, entry, budget, external } of ENTRIES) {
  const result = await build({
    entryPoints: [resolve(SRC, entry)],
    bundle: true,
    minify: true,
    treeShaking: true,
    format: 'esm',
    target: 'es2022',
    platform: 'neutral',
    external,
    write: false,
  });

  const output = result.outputFiles[0];
  if (output === undefined) {
    console.error(`size-check: esbuild produced no output for ${entry}`);
    process.exit(1);
  }
  const min = output.contents;
  const gz = gzipSync(Buffer.from(min));
  const minKb = (min.byteLength / 1024).toFixed(2);
  const gzKb = (gz.byteLength / 1024).toFixed(2);
  const budgetKb = (budget / 1024).toFixed(0);

  console.log(`${name}: ${minKb} kB min / ${gzKb} kB min+gz (budget ${budgetKb} kB)`);

  if (gz.byteLength > budget) {
    console.error(
      `size-check FAILED: ${name} ${gzKb} kB min+gz exceeds the ${budgetKb} kB budget (${String(gz.byteLength)} > ${String(budget)} bytes)`,
    );
    failed = true;
  } else {
    console.log(`  OK: ${String(gz.byteLength)} bytes min+gz ≤ ${String(budget)} bytes`);
  }
}

if (failed) process.exit(1);
