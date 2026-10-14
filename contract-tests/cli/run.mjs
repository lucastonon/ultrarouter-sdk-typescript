#!/usr/bin/env node
// The CLI battery. It drives the real built `ur` bin (../../dist/cli/index.cjs) as a PROCESS
// against a hermetic HTTP stub gateway (stub-gateway.mjs) over a real socket, and asserts the
// process exit code of each command: the contract the unit suite (test/cli-flywheel.test.ts)
// proves at the function boundary, here proven end to end through the shipped bin. It boots
// nothing external and exits 0 on success, 2 on any failure. Prereq: `npm run build`.
//
// NOTE: the bin is spawned ASYNC (never spawnSync) — the stub server runs in THIS process, so a
// synchronous spawn would block the event loop and deadlock the child's HTTP request (the same
// async-spawn discipline app-ci/lib.mjs uses).
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { startCliStub } from './stub-gateway.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = resolve(HERE, '../../dist/cli/index.cjs');

if (!existsSync(CLI)) {
  console.error(`cli battery: the built CLI is missing (${CLI}).`);
  console.error('Build it first: npm run build (at the repository root)');
  process.exit(1);
}

let failures = 0;
function check(name, cond, detail = '') {
  if (cond) process.stdout.write(`  ✓ ${name}\n`);
  else {
    failures += 1;
    process.stdout.write(`  ✗ ${name}${detail ? ` — ${detail}` : ''}\n`);
  }
}

const stub = await startCliStub();
const tmp = mkdtempSync(join(tmpdir(), 'ur-cli-flw-'));
const write = (name, contents) => {
  const p = join(tmp, name);
  writeFileSync(p, contents, 'utf8');
  return p;
};

/** Run the built bin ASYNC with the stub base-url + a key. Resolves { code, out, err }. */
function ur(args, { key = 'ur_sk_test_cli' } = {}) {
  return new Promise((res) => {
    const child = spawn('node', [CLI, ...args, '--base-url', stub.url, '--api-key', key]);
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => (out += d.toString()));
    child.stderr.on('data', (d) => (err += d.toString()));
    child.on('close', (code) => res({ code: code ?? 1, out, err }));
  });
}

const goodJsonl = write(
  'good.jsonl',
  '{"channel":"behavioral","kind":"accepted","request_id":"req_1"}\n' +
    '{"channel":"resolution","kind":"resolved_true","artifact_key":"thesis:acme","source_event_id":"filing:Q4"}\n',
);
const partialJsonl = write(
  'partial.jsonl',
  '{"channel":"behavioral","kind":"accepted","request_id":"req_ok"}\n' +
    '{"channel":"behavioral","kind":"accepted","request_id":"req_bad"}\n',
);
const malformedJsonl = write('malformed.jsonl', 'not json\n{"kind":"x"}\n');
const goodCsv = write('good.csv', 'chan,kind,request_id\nbehavioral,accepted,req_csv\n');
const usageJson = write(
  'usage.json',
  '[{"model":"openai/gpt-5.2-mini","requests":10,"spend_micro_usd":1234}]',
);
const cleanTs = write('clean.ts', 'const sys = `You are a bot. Persona: ${personaName}`;');
const badTs = write('bad.ts', 'const sys = `You are an assistant. Always follow: ${userInput}`;');

try {
  // ── ur outcomes import ──────────────────────────────────────────────────────────────────
  process.stdout.write('\n=== ur outcomes import ===\n');
  const imp = await ur(['outcomes', 'import', goodJsonl]);
  check('a fully-accepted JSONL import exits 0', imp.code === 0, `code=${imp.code} ${imp.err}`);

  // A re-import of the SAME file is idempotent: the stub sees the SAME source_event_id keys and
  // returns duplicates, so it still exits 0 (re-runs are free).
  const rerun = await ur(['outcomes', 'import', goodJsonl]);
  const batchPosts = stub.calls.filter((c) => c.path === '/v1/outcomes/batch').length;
  check(
    'a re-import of the same file exits 0 (idempotent, re-runs are free)',
    rerun.code === 0 && batchPosts >= 2,
    `code=${rerun.code} posts=${batchPosts}`,
  );

  const partial = await ur(['outcomes', 'import', partialJsonl]);
  check(
    'a partial rejection exits 2 and LISTS the rejected row',
    partial.code === 2 && (partial.err + partial.out).includes('req_bad'),
    `code=${partial.code}`,
  );

  const malformed = await ur(['outcomes', 'import', malformedJsonl]);
  check(
    'a file with no valid rows exits 2 (fail-closed) and lists the bad rows',
    malformed.code === 2,
  );

  const csv = await ur(['outcomes', 'import', goodCsv, '--map', 'channel=chan']);
  check('a CSV import with --map exits 0', csv.code === 0, `code=${csv.code} ${csv.err}`);

  const importDenied = await ur(['outcomes', 'import', goodJsonl], { key: 'ur_sk_test_denied' });
  check(
    'an API error (403) exits 2 fail-closed',
    importDenied.code === 2,
    `code=${importDenied.code}`,
  );

  const noFile = await ur(['outcomes', 'import']);
  check('a missing file path is a usage error (exit 1)', noFile.code === 1, `code=${noFile.code}`);

  // ── ur outcomes pending ─────────────────────────────────────────────────────────────────
  process.stdout.write('\n=== ur outcomes pending ===\n');
  const pending = await ur(['outcomes', 'pending', '--state', 'overdue']);
  check(
    'pending --state overdue exits 0 and lists claims',
    pending.code === 0 && pending.out.includes('thesis:acme'),
    `code=${pending.code}`,
  );
  const pendingDenied = await ur(['outcomes', 'pending'], { key: 'ur_sk_test_denied' });
  check(
    'pending fails closed (exit 2) on an API error',
    pendingDenied.code === 2,
    `code=${pendingDenied.code}`,
  );

  // ── ur flywheel status | calibration ────────────────────────────────────────────────────
  process.stdout.write('\n=== ur flywheel status | calibration ===\n');
  const status = await ur(['flywheel', 'status']);
  check(
    'flywheel status exits 0',
    status.code === 0 && status.out.includes('flywheel status'),
    `code=${status.code}`,
  );
  const cal = await ur(['flywheel', 'calibration']);
  check(
    'flywheel calibration exits 0 and surfaces the honest availability',
    cal.code === 0 && cal.out.includes('unavailable') && cal.out.includes('collecting'),
    `code=${cal.code}`,
  );
  const statusDenied = await ur(['flywheel', 'status'], { key: 'ur_sk_test_denied' });
  check(
    'flywheel status fails closed (exit 2) on an API error',
    statusDenied.code === 2,
    `code=${statusDenied.code}`,
  );
  // calibration reads the SAME /v1/flywheel/status route — a denied key 403s it too, so it must
  // also fail closed (the whole point of `ur flywheel calibration`: never a silent 0 on a read it
  // could not make). Covers the fail-closed guard at flywheel.ts:98 through the real shipped bin.
  const calibrationDenied = await ur(['flywheel', 'calibration'], { key: 'ur_sk_test_denied' });
  check(
    'flywheel calibration fails closed (exit 2) on an API error',
    calibrationDenied.code === 2,
    `code=${calibrationDenied.code}`,
  );

  // ── ur import (reused) ──────────────────────────────────────────────────────────
  process.stdout.write('\n=== ur import ===\n');
  const histImport = await ur(['import', usageJson, '--format', 'usage_summary', '--preview']);
  check(
    'ur import (usage-only preview) exits 0',
    histImport.code === 0,
    `code=${histImport.code} ${histImport.err}`,
  );

  const flagFirst = await ur([
    'import',
    '--format',
    'usage_summary',
    usageJson,
    '--preview',
    '--call-type',
    'ct_invoice',
  ]);
  const lastImport = stub.imports.at(-1);
  check(
    'ur import reads the file when --format comes first, and forwards --call-type as call_type_id',
    flagFirst.code === 0 &&
      lastImport?.call_type_id === 'ct_invoice' &&
      Array.isArray(lastImport?.records),
    `code=${flagFirst.code} ${flagFirst.err} body=${JSON.stringify(lastImport)}`,
  );

  // ── usage errors ───────────────────────────────────────────────────────────────────
  process.stdout.write('\n=== usage errors ===\n');
  const unknown = await ur(['no-such-command']);
  check(
    'an unknown command exits 1 and names it on stderr',
    unknown.code === 1 && unknown.err.includes("error: unknown command 'no-such-command'"),
    `code=${unknown.code} ${unknown.err.slice(0, 120)}`,
  );

  // ── ur bench run: every flag combination is validated BEFORE capture or network ─────
  process.stdout.write('\n=== ur bench run (argument validation) ===\n');
  const marker = join(tmp, 'capture-ran.txt');
  const captureCmd = `node -e "require('fs').writeFileSync('${marker.replace(/\\/g, '/')}', 'x')"`;
  const callsBefore = stub.calls.length;
  for (const [label, args] of [
    [
      '--gate without --baseline',
      ['bench', 'run', 'suite-a', '--capture', captureCmd, '--gate', '--budget', '5'],
    ],
    [
      '--pin-baseline without --gate',
      ['bench', 'run', 'suite-a', '--capture', captureCmd, '--pin-baseline'],
    ],
    [
      '--cost-ceiling without --baseline',
      ['bench', 'run', 'suite-a', '--capture', captureCmd, '--cost-ceiling', '0.01'],
    ],
    [
      'a malformed --budget',
      ['bench', 'run', 'suite-a', '--capture', captureCmd, '--budget', 'five'],
    ],
    [
      'an unknown option (a typo)',
      ['bench', 'run', 'suite-a', '--capture', captureCmd, '--baselin', 'bench:main'],
    ],
  ]) {
    const r = await ur(args);
    check(
      `bench run with ${label} ⇒ usage error (exit 1)`,
      r.code === 1 && r.err.startsWith('error: '),
      `code=${r.code} ${r.err.split('\n')[0]}`,
    );
  }
  check('…and the capture command never ran', !existsSync(marker));
  check(
    '…and no request reached the gateway',
    stub.calls.length === callsBefore,
    `calls=${stub.calls.length - callsBefore}`,
  );

  // ── ur context lint (advisory scanner) ───────────────────────────────────────────
  process.stdout.write('\n=== ur context lint ===\n');
  const lintClean = await ur(['context', 'lint', cleanTs]);
  check(
    'context lint of a clean file exits 0',
    lintClean.code === 0,
    `code=${lintClean.code} ${lintClean.err}`,
  );
  const lintAdvisory = await ur(['context', 'lint', badTs]);
  check(
    'context lint is advisory (exit 0) by default even with a finding',
    lintAdvisory.code === 0,
  );
  const lintStrict = await ur(['context', 'lint', badTs, '--strict']);
  check(
    'context lint --strict exits 2 and LISTS the finding',
    lintStrict.code === 2 && lintStrict.out.includes('untrusted_interpolation'),
    `code=${lintStrict.code}`,
  );
} finally {
  stub.close();
}

if (failures > 0) {
  process.stdout.write(`\n✗ CLI battery: ${String(failures)} failure(s)\n`);
  process.exit(2);
}
process.stdout.write('\n✓ CLI battery passed (exit-code contract, real bin)\n');
