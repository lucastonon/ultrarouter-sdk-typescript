#!/usr/bin/env node
/**
 * run-examples — execute every runnable example under `examples/` against the built package and
 * the local mock gateway. Each example must exit 0. Type-checking is done separately by
 * `npm run typecheck` (`examples/tsconfig.json`).
 *
 *   npm run build && node scripts/run-examples.mjs [--verbose] [examples/quickstart.ts]
 */
import assert from 'node:assert/strict';
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
      const controls = file.endsWith('/07-learning-controls.ts');
      if (controls) {
        for (const id of [undefined, '', 'order-desk']) {
          const before = gw.requests.length;
          const rejected = await runNode(dirname(target), entry, gw.url, 30_000, {
            ...(id === undefined ? {} : { ULTRAROUTER_CALL_TYPE_ID: id }),
          });
          assert.notEqual(rejected.code, 0, 'a missing ID or slug must fail before requests');
          assert.match(rejected.stderr, /ULTRAROUTER_CALL_TYPE_ID/);
          assert.equal(gw.requests.length, before, 'invalid setup must send no requests');
        }
      }
      const start = gw.requests.length;
      const result = await runNode(dirname(target), entry, gw.url, 30_000, {
        ULTRAROUTER_CALL_TYPE_ID: 'ct_example_controls',
      });
      if (result.code === 0 && file.startsWith('examples/learning/')) {
        const requests = gw.requests.slice(start);
        if (controls) {
          assert.ok(requests.length > 0);
          assert.ok(
            requests.every((r) => r.path.startsWith('/v1/call-types/ct_example_controls/learning')),
            'every control must use the explicit ct_... ID',
          );
        } else {
          const traffic = requests.filter((r) => r.path === '/v1/chat/completions');
          assert.ok(traffic.length > 0, 'traffic example must actually send inference');
          assert.ok(
            traffic.every((r) => r.body.call_type === 'order-desk'),
            'every inference step must declare the resolved call-type slug',
          );
          const resolved = requests.findIndex(
            (r) => r.method === 'GET' && r.path === '/v1/call-types',
          );
          assert.ok(
            resolved >= 0 && resolved < requests.indexOf(traffic[0]),
            'resolve the call type before sending traffic',
          );
        }
      }
      if (file.endsWith('/06-ack-loss-retry.ts')) {
        for (const sayOkReply of ['NOT OK', '']) {
          const wrong = await startMockGateway({ sayOkReply });
          try {
            const run = await runNode(dirname(target), entry, wrong.url);
            assert.equal(run.code, 0, run.stderr);
            const reports = wrong.requests.filter((r) => r.path.endsWith('/outcomes'));
            assert.ok(reports.length > 0);
            assert.ok(
              reports.every((r) => r.body.kind === 'oracle_fail'),
              'wrong or empty text must report failure despite HTTP success',
            );
          } finally {
            await wrong.close();
          }
        }
      }
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
