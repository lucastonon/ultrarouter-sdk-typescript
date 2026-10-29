#!/usr/bin/env node
/**
 * doctest — type-check and execute the code blocks in `README.md`, `AGENTS.md` and `docs/**\/*.md`
 * against the built package and a local mock gateway.
 *
 *   npm run build && node scripts/doctest.mjs [--verbose] [--file docs/streaming.md]
 *
 * - Fenced blocks tagged `ts`, `typescript`, `js`, `javascript`, `mjs` or `cjs` are complete programs.
 *   Each one is type-checked (TypeScript blocks, strict) and run with `ULTRAROUTER_API_KEY` and
 *   `ULTRAROUTER_BASE_URL` pointing at the mock; a non-zero exit fails the run.
 * - Fenced blocks tagged `bash`, `sh` or `shell` are run with `bash -e -o pipefail` in a fresh sandbox
 *   directory (a copy of `test/doctest/sandbox/`: a `package.json` with test scripts and the input
 *   files the CLI examples read) with the same mock environment. `ur` runs the BUILT CLI; `npx`
 *   is a shim that runs the built CLI for `npx ur …` and `npx --package=@ultrarouter/sdk@<version>
 *   ur …` and FAILS for any other package or version, so a documented `npx` line must name this
 *   package and this release. A block is expected to exit 0 unless the line(s) right above its fence
 *   say otherwise:
 *
 *     <!-- doctest: exit 2 — <reason> -->
 *
 * A block may opt out only with an HTML comment on the line(s) right above its fence:
 *
 *   <!-- doctest: skip — <reason> -->
 *
 * The reason is mandatory and every skip is listed in the summary (installing from the registry,
 * running another runtime, calling a pull request on GitHub, and similar). Blocks fenced as
 * `ts signature` (the declaration listings `scripts/gen-docs.mjs` writes into `docs/api/`) are
 * declarations, not programs, and are counted separately; the API reference's TSDoc examples are
 * ordinary `ts` blocks and do run. Untagged and `text` / `yaml` / `json` blocks are output or data
 * listings and are not executed.
 */
import { spawn } from 'node:child_process';
import {
  chmodSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';

import { startMockGateway } from '../test/support/mock-gateway.mjs';
import {
  ROOT,
  assertBuilt,
  createWorkspace,
  removeWorkspace,
  runNode,
  transpile,
  typecheck,
} from './lib/ts-runner.mjs';

const TS_LANGS = new Set(['ts', 'typescript']);
const JS_LANGS = new Set(['js', 'javascript', 'mjs', 'cjs']);
const SHELL_LANGS = new Set(['bash', 'sh', 'shell']);
const SKIP_RE = /<!--\s*doctest:\s*skip\s*[—–-]\s*(.+?)\s*-->/;
const EXIT_RE = /<!--\s*doctest:\s*exit\s+(\d+)\s*[—–-]\s*(.+?)\s*-->/;
const SANDBOX = join(ROOT, 'test', 'doctest', 'sandbox');
const CLI = join(ROOT, 'dist', 'cli', 'index.cjs');
const VERSION = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version;

/** Every Markdown file the doctest covers. */
export function docFiles() {
  const out = ['README.md', 'AGENTS.md'].filter((f) => {
    try {
      return statSync(join(ROOT, f)).isFile();
    } catch {
      return false;
    }
  });
  const walk = (dir) => {
    for (const name of readdirSync(join(ROOT, dir)).sort()) {
      const rel = join(dir, name);
      if (statSync(join(ROOT, rel)).isDirectory()) walk(rel);
      else if (name.endsWith('.md')) out.push(rel);
    }
  };
  walk('docs');
  return out;
}

/**
 * Extract the code blocks of one Markdown text.
 * @returns {{ lang: string, meta: string[], code: string, line: number, skip: string | null, exit: number }[]}
 */
export function extractBlocks(text) {
  const lines = text.split('\n');
  const blocks = [];
  for (let i = 0; i < lines.length; i += 1) {
    const open = /^(\s*)```([A-Za-z0-9_-]*)((?:[ \t]+[^`\s]+)*)\s*$/.exec(lines[i] ?? '');
    if (open === null) continue;
    const indent = open[1] ?? '';
    const lang = (open[2] ?? '').toLowerCase();
    const meta = (open[3] ?? '')
      .trim()
      .split(/\s+/)
      .filter((w) => w !== '');
    const body = [];
    let j = i + 1;
    while (j < lines.length && !new RegExp(`^${indent}\`\`\`\\s*$`).test(lines[j] ?? '')) {
      body.push((lines[j] ?? '').slice(indent.length));
      j += 1;
    }
    // A skip / exit marker must sit on one of the two non-blank lines right above the fence.
    let skip = null;
    let exit = 0;
    for (let k = i - 1, seen = 0; k >= 0 && seen < 2; k -= 1) {
      const l = (lines[k] ?? '').trim();
      if (l === '') continue;
      seen += 1;
      const m = SKIP_RE.exec(l);
      if (m !== null) skip = m[1] ?? null;
      const e = EXIT_RE.exec(l);
      if (e !== null) exit = Number(e[1]);
    }
    blocks.push({ lang, meta, code: body.join('\n'), line: i + 1, skip, exit });
    i = j;
  }
  return blocks;
}

/**
 * Write the `ur` and `npx` shims into `binDir`. `npx` accepts `npx [-y] ur …` and
 * `npx --package=@ultrarouter/sdk[@<this version>] ur …` and refuses anything else (exit 98/99), so
 * the docs can only name this package and this release.
 */
function writeShims(binDir) {
  mkdirSync(binDir, { recursive: true });
  const ur = join(binDir, 'ur');
  writeFileSync(ur, `#!/bin/sh\nexec "${process.execPath}" "${CLI}" "$@"\n`);
  chmodSync(ur, 0o755);
  // A CommonJS file run by a shell wrapper, so the workspace's package type cannot change its module kind.
  const npxImpl = join(binDir, 'npx-shim.cjs');
  writeFileSync(
    npxImpl,
    `const { spawnSync } = require('node:child_process');
const argv = process.argv.slice(2);
let i = 0;
let pkg = null;
while (i < argv.length && argv[i].startsWith('-')) {
  const a = argv[i];
  if (a.startsWith('--package=')) pkg = a.slice(10);
  else if (a === '--package' || a === '-p') { i += 1; pkg = argv[i]; }
  else if (a !== '-y' && a !== '--yes') { console.error('doctest npx shim: unsupported option ' + a); process.exit(97); }
  i += 1;
}
const ok = [${JSON.stringify('@ultrarouter/sdk')}, ${JSON.stringify(`@ultrarouter/sdk@${VERSION}`)}];
if (pkg !== null && !ok.includes(pkg)) {
  console.error('doctest npx shim: the docs name package ' + pkg + '; expected one of ' + ok.join(', '));
  process.exit(98);
}
if (argv[i] !== 'ur') { console.error('doctest npx shim: only the ur bin exists here (got ' + argv[i] + ')'); process.exit(99); }
const r = spawnSync(${JSON.stringify(process.execPath)}, [${JSON.stringify(CLI)}, ...argv.slice(i + 1)], { stdio: 'inherit' });
process.exit(r.status === null ? 1 : r.status);
`,
  );
  const npx = join(binDir, 'npx');
  writeFileSync(npx, `#!/bin/sh\nexec "${process.execPath}" "${npxImpl}" "$@"\n`);
  chmodSync(npx, 0o755);
}

/** Run one shell block in a fresh sandbox against the mock gateway. Resolves `{ code, out }`. */
async function runShell(code, baseURL, binDir, timeoutMs = 60_000) {
  const box = mkdtempSync(join(tmpdir(), 'ur-doctest-sh-'));
  try {
    cpSync(SANDBOX, box, { recursive: true });
    mkdirSync(join(box, 'knowledge'), { recursive: true });
    cpSync(
      join(ROOT, 'test', 'pack', 'release-checklist.ur.md'),
      join(box, 'knowledge', 'release-checklist.ur.md'),
    );
    writeFileSync(join(box, 'block.sh'), `${code}\n`);
    return await new Promise((resolveRun) => {
      const env = { ...process.env };
      for (const k of Object.keys(env)) {
        if (k.startsWith('ULTRAROUTER_') || k.startsWith('UR_') || k.startsWith('GITHUB_'))
          delete env[k];
      }
      const child = spawn('bash', ['-e', '-o', 'pipefail', 'block.sh'], {
        cwd: box,
        env: {
          ...env,
          PATH: `${binDir}:${env.PATH ?? ''}`,
          ULTRAROUTER_API_KEY: 'ur_sk_test_doctest',
          ULTRAROUTER_BASE_URL: baseURL,
          npm_config_update_notifier: 'false',
        },
      });
      let out = '';
      child.stdout.on('data', (d) => (out += d.toString()));
      child.stderr.on('data', (d) => (out += d.toString()));
      const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
      child.on('close', (exitCode, signal) => {
        clearTimeout(timer);
        resolveRun({ code: exitCode ?? (signal !== null ? 128 : 1), out });
      });
    });
  } finally {
    rmSync(box, { recursive: true, force: true });
  }
}

async function main(argv) {
  const verbose = argv.includes('--verbose');
  const fileFlag = argv.indexOf('--file');
  const only = fileFlag === -1 ? null : argv[fileFlag + 1];
  assertBuilt();
  const files = only === null ? docFiles() : [only];
  const gw = await startMockGateway();
  const dir = createWorkspace('ur-doctest');
  const failures = [];
  const skipped = [];
  let signatures = 0;
  let ran = 0;
  let shellRan = 0;
  try {
    const tsFiles = [];
    const runnable = [];
    const shells = [];
    for (const file of files) {
      const blocks = extractBlocks(readFileSync(join(ROOT, file), 'utf8'));
      blocks.forEach((b, index) => {
        const isTs = TS_LANGS.has(b.lang);
        const isJs = JS_LANGS.has(b.lang);
        const isShell = SHELL_LANGS.has(b.lang);
        if (!isTs && !isJs && !isShell) return;
        const label = `${file}:${String(b.line)}`;
        if (isShell) {
          if (b.skip !== null) skipped.push({ label, reason: b.skip });
          else shells.push({ label, code: b.code, exit: b.exit });
          return;
        }
        // A `ts signature` block is a declaration listing generated into the API reference (for
        // example `class UltraRouter`), not a program; its source is type-checked by `npm run typecheck`.
        if (b.meta.includes('signature')) {
          signatures += 1;
          return;
        }
        if (b.skip !== null) {
          skipped.push({ label, reason: b.skip });
          return;
        }
        const base = `${file.replace(/[^A-Za-z0-9]+/g, '_')}_${String(index)}`;
        const cjs = b.lang === 'cjs' || (isJs && /\brequire\(/.test(b.code));
        const name = isTs ? `${base}.mts` : `${base}.${cjs ? 'cjs' : 'mjs'}`;
        writeFileSync(join(dir, name), `${b.code}\n${isTs ? 'export {};\n' : ''}`);
        if (isTs) tsFiles.push(name);
        runnable.push({ label, name, isTs });
      });
    }

    const diagnostics = tsFiles.length > 0 ? typecheck(dir, tsFiles) : '';
    if (diagnostics.trim() !== '') {
      failures.push({ label: 'type-check', detail: diagnostics });
    }

    for (const r of runnable) {
      const entry = r.isTs ? transpile(dir, r.name) : r.name;
      const requestStart = gw.requests.length;
      const result = await runNode(dir, entry, gw.url);
      const requests = gw.requests.slice(requestStart);
      const wrongId = requests.find((req) =>
        /^\/v1\/call-types\/(?!ct_)[^/]+\/learning(?:\/|$)/.test(req.path),
      );
      const unassigned =
        r.label.startsWith('docs/plug-and-play-learning.md:') &&
        requests.some(
          (req) => req.path === '/v1/chat/completions' && req.body?.call_type !== 'support-reply',
        );
      if (wrongId || unassigned)
        failures.push({
          label: r.label,
          detail: wrongId
            ? 'learning controls must use the ct_... ID'
            : 'learning traffic must declare its call-type slug',
        });
      ran += 1;
      if (result.code !== 0) {
        failures.push({
          label: r.label,
          detail: `${result.stderr}${result.stdout}`.trim().slice(0, 2000),
        });
      } else if (verbose) {
        process.stdout.write(`ok ${r.label}\n${result.stdout}`);
      }
    }

    const binDir = join(dir, 'bin');
    writeShims(binDir);
    for (const sh of shells) {
      const result = await runShell(sh.code, gw.url, binDir);
      ran += 1;
      shellRan += 1;
      if (result.code !== sh.exit) {
        failures.push({
          label: sh.label,
          detail: `shell block exited ${String(result.code)} (expected ${String(sh.exit)})\n${result.out.trim().slice(0, 2000)}`,
        });
      } else if (verbose) {
        process.stdout.write(`ok ${sh.label} (exit ${String(result.code)})\n${result.out}`);
      }
    }
  } finally {
    await gw.close();
    removeWorkspace(dir);
  }

  for (const f of failures) process.stderr.write(`\nFAIL ${f.label}\n${f.detail}\n`);
  process.stdout.write(
    `\ndoctest: ${String(ran)} block(s) executed (${String(shellRan)} shell) across ${String(files.length)} file(s), ${String(skipped.length)} skipped, ${String(signatures)} API signature listing(s) not executed, ${String(failures.length)} failure(s)\n`,
  );
  for (const s of skipped) process.stdout.write(`  skipped ${s.label} — ${s.reason}\n`);
  return failures.length === 0 ? 0 : 1;
}

if (
  process.argv[1] !== undefined &&
  relative(process.argv[1], new URL(import.meta.url).pathname) === ''
) {
  process.exitCode = await main(process.argv.slice(2));
}
