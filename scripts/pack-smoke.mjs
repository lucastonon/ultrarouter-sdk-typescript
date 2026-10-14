#!/usr/bin/env node
/**
 * pack-smoke — prove the published artifact works for a real consumer.
 *
 *   npm run build && node scripts/pack-smoke.mjs [--keep]
 *
 * 1. `npm pack` the package and check the tarball contents (required files present, nothing else).
 * 2. Check the type resolution of every entry point with `@arethetypeswrong/cli` (node16 + bundler).
 * 3. Create a consumer project OUTSIDE the repository (in `UR_SMOKE_DIR`, default the OS temp dir),
 *    install the tarball plus `typescript`, `@types/node` and `openai` from the npm registry.
 * 4. Against a local mock gateway: run an ESM consumer (default + named imports, the context entry,
 *    chat + stream + embeddings + typed errors + `asOpenAI(OpenAI)`), a CommonJS consumer, a strict
 *    `tsc` type-check of ESM and CommonJS consumer files, the `ur` CLI (`--help`, `--version`,
 *    `flywheel status --json`, `pack validate`), `npx` (inside the project, and `--package=` from an
 *    empty directory), and the ESM consumer under Deno when `deno` is installed
 *    (`UR_SMOKE_REQUIRE_DENO=1`, as CI sets it, makes a missing Deno a failure).
 */
import { execFileSync, spawn } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';

import { startMockGateway } from '../test/support/mock-gateway.mjs';
import { ROOT, assertBuilt } from './lib/ts-runner.mjs';

const PKG = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const NODE_MAJOR = Number(process.versions.node.split('.')[0]);

/** Files the tarball must contain. */
const REQUIRED = [
  'package.json',
  'README.md',
  'LICENSE',
  'CHANGELOG.md',
  'AGENTS.md',
  'llms.txt',
  'llms-full.txt',
  'docs/README.md',
  'docs/api/sdk.md',
  'docs/api/context.md',
  'dist/index.js',
  'dist/index.cjs',
  'dist/index.d.ts',
  'dist/index.d.cts',
  'dist/context.js',
  'dist/context.cjs',
  'dist/context.d.ts',
  'dist/context.d.cts',
  'dist/cli/index.cjs',
];
/** Top-level paths the tarball may contain. */
const ALLOWED_TOP = new Set([
  'package.json',
  'README.md',
  'LICENSE',
  'CHANGELOG.md',
  'AGENTS.md',
  'llms.txt',
  'llms-full.txt',
  'docs',
  'dist',
]);

let failures = 0;
function check(ok, label, detail = '') {
  process.stdout.write(
    `${ok ? '  ok  ' : '  FAIL'} ${label}${!ok && detail !== '' ? `\n${detail}` : ''}\n`,
  );
  if (!ok) failures += 1;
}

/**
 * Run a command ASYNCHRONOUSLY (the mock gateway lives in this process, so a synchronous spawn would
 * block its event loop and deadlock the consumer). Resolves `{ code, out }`.
 */
function run(cmd, args, opts = {}) {
  return new Promise((resolveRun) => {
    const child = spawn(cmd, args, { ...opts, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (out += d));
    child.on('error', (e) => resolveRun({ code: 1, out: `${out}${String(e)}` }));
    child.on('close', (code) => resolveRun({ code: code ?? 1, out }));
  });
}

async function main(argv) {
  const keep = argv.includes('--keep');
  assertBuilt();
  const base = process.env.UR_SMOKE_DIR ?? tmpdir();
  mkdirSync(base, { recursive: true });
  const dir = mkdtempSync(join(base, 'ur-sdk-smoke-'));
  const gw = await startMockGateway();
  try {
    // 1. pack
    process.stdout.write(`pack-smoke: packing into ${dir}\n`);
    const packed = JSON.parse(
      execFileSync('npm', ['pack', '--json', '--pack-destination', dir], {
        cwd: ROOT,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      }),
    )[0];
    const tarball = join(dir, packed.filename);
    const files = packed.files.map((f) => f.path).sort();
    process.stdout.write(
      `tarball ${packed.filename}: ${String(files.length)} files, ${String(packed.size)} bytes packed, ${String(packed.unpackedSize)} unpacked\n`,
    );
    for (const f of REQUIRED) check(files.includes(f), `tarball contains ${f}`);
    const unexpected = files.filter((f) => !ALLOWED_TOP.has(f.split('/')[0]));
    check(
      unexpected.length === 0,
      'tarball contains nothing outside the files allowlist',
      unexpected.join('\n'),
    );
    check(
      !files.some((f) => f.endsWith('.map') && f.includes('generated')),
      'no generated sources shipped',
    );
    writeFileSync(join(dir, 'tarball-files.txt'), `${files.join('\n')}\n`);

    // 2. type resolution of every entry point
    const attw = await run(
      join(ROOT, 'node_modules', '.bin', 'attw'),
      [tarball, '--profile', 'node16', '--format', 'ascii'],
      { cwd: ROOT },
    );
    check(
      attw.code === 0,
      'arethetypeswrong: every entry resolves under node16 (CJS + ESM) and bundler',
      attw.out,
    );

    // 3. consumer project
    const app = join(dir, 'consumer');
    mkdirSync(app);
    writeFileSync(
      join(app, 'package.json'),
      JSON.stringify({ name: 'smoke-consumer', private: true, type: 'module' }, null, 2),
    );
    const openaiSpec = NODE_MAJOR >= 22 ? 'openai@^7' : 'openai@^6';
    const install = await run(
      'npm',
      [
        'install',
        '--no-audit',
        '--no-fund',
        '--loglevel=error',
        tarball,
        'typescript@5.9.3',
        '@types/node@^20',
        openaiSpec,
      ],
      { cwd: app },
    );
    check(
      install.code === 0,
      `npm install the tarball + typescript + @types/node + ${openaiSpec}`,
      install.out,
    );
    if (install.code !== 0) return;

    const env = {
      PATH: process.env.PATH ?? '',
      HOME: process.env.HOME ?? '',
      ULTRAROUTER_API_KEY: 'ur_sk_test_smoke',
      ULTRAROUTER_BASE_URL: gw.url,
    };

    // 4a. ESM consumer
    writeFileSync(
      join(app, 'esm.mjs'),
      `import UltraRouter, { UltraRouter as Named, ModelUnpricedError, VERSION, GATEWAY_ERROR_CODES } from '@ultrarouter/sdk';
import { fromMessages, toMessages, compile, ULTRAROUTER_PROFILE, loadPack } from '@ultrarouter/sdk/context';
import OpenAI from 'openai';
import assert from 'node:assert/strict';

assert.equal(UltraRouter, Named);
assert.equal(VERSION, ${JSON.stringify(PKG.version)});
assert.ok(GATEWAY_ERROR_CODES.includes('model_unpriced'));
const ur = new UltraRouter({ defaultModel: 'openai/gpt-5.2-mini' });
const chat = await ur.chat.completions.create({ messages: [{ role: 'user', content: 'smoke' }] });
assert.match(chat.choices[0].message.content, /smoke/);
assert.match(chat.ur.request_id, /^req_/);
let streamed = '';
let finalUr;
for await (const chunk of await ur.chat.completions.create({ stream: true, messages: [{ role: 'user', content: 'stream smoke' }] })) {
  streamed += chunk.choices[0]?.delta.content ?? '';
  if (chunk.ur) finalUr = chunk.ur;
}
assert.match(streamed, /stream smoke/);
assert.ok(finalUr);
const emb = await ur.embeddings.create({ model: 'openai/text-embedding-3-small', input: ['a', 'b'] });
assert.equal(emb.data.length, 2);
await assert.rejects(ur.chat.completions.create({ model: 'example/unpriced-model', messages: [{ role: 'user', content: 'x' }] }), ModelUnpricedError);
const openai = ur.asOpenAI(OpenAI);
const viaOpenAI = await openai.chat.completions.create({ model: 'openai/gpt-5.2-mini', messages: [{ role: 'user', content: 'openai smoke' }] });
assert.match(viaOpenAI.choices[0].message.content, /openai smoke/);
const messages = [{ role: 'system', content: 'sys' }, { role: 'user', content: 'hi' }];
assert.deepEqual(toMessages(fromMessages(messages).manifest), messages);
assert.equal(typeof compile, 'function');
assert.equal(ULTRAROUTER_PROFILE.name, 'ultrarouter');
assert.equal(typeof loadPack, 'function');
console.log('esm ok');
`,
    );
    const esm = await run(process.execPath, ['esm.mjs'], { cwd: app, env });
    check(
      esm.code === 0 && esm.out.includes('esm ok'),
      'ESM import: chat + stream + embeddings + typed error + asOpenAI(OpenAI) + context entry',
      esm.out,
    );

    // 4b. CommonJS consumer
    writeFileSync(
      join(app, 'cjs.cjs'),
      `const sdk = require('@ultrarouter/sdk');
const ctx = require('@ultrarouter/sdk/context');
const assert = require('node:assert/strict');
assert.equal(typeof sdk.UltraRouter, 'function');
assert.equal(sdk.default, sdk.UltraRouter);
assert.equal(typeof ctx.fromMessages, 'function');
const ur = new sdk.UltraRouter({ defaultModel: 'openai/gpt-5.2-mini' });
ur.chat.completions.create({ messages: [{ role: 'user', content: 'cjs smoke' }] }).then((res) => {
  assert.match(res.choices[0].message.content, /cjs smoke/);
  return ur.models.list();
}).then((models) => {
  assert.ok(models.data.length > 0);
  console.log('cjs ok');
}).catch((err) => { console.error(err); process.exitCode = 1; });
`,
    );
    const cjs = await run(process.execPath, ['cjs.cjs'], { cwd: app, env });
    check(
      cjs.code === 0 && cjs.out.includes('cjs ok'),
      'CommonJS require: client + context entry + a chat call',
      cjs.out,
    );

    // 4c. tsc type-check of ESM and CommonJS consumers
    writeFileSync(
      join(app, 'consumer.mts'),
      `import UltraRouter, { type ChatCompletion, type ChatCompletionChunk, UltraRouterError, isUltraRouterError } from '@ultrarouter/sdk';
import { compile, type Envelope, type Module } from '@ultrarouter/sdk/context';

const ur = new UltraRouter({ apiKey: 'ur_sk_test_types', defaultModel: 'openai/gpt-5.2-mini' });
export async function main(): Promise<string | null | undefined> {
  const res: ChatCompletion = await ur.chat.completions.create({ messages: [{ role: 'user', content: 'hi' }] });
  const stream = await ur.chat.completions.create({ stream: true, messages: [{ role: 'user', content: 'hi' }] });
  for await (const chunk of stream) {
    const c: ChatCompletionChunk = chunk;
    void c;
  }
  const model = await ur.models.retrieve('openai/gpt-5.2-mini');
  const plans = await ur.request('get', '/v1/flywheel/plans');
  void model.offers;
  void plans;
  try {
    await ur.ur.callTypes.get('support');
  } catch (err) {
    if (isUltraRouterError(err) && err instanceof UltraRouterError) return err.code;
  }
  return res.choices[0]?.message.content;
}
// @ts-expect-error -- \`messages\` must be an array: proves chat.completions.create is typed, not \`any\`.
void ur.chat.completions.create({ messages: 'not-an-array' });
// @ts-expect-error -- a Module needs its fields: proves the context types resolve (zod types bundled).
export const badModule: Module = { id: 1 };
export const envelopeOk: (e: Envelope, m: Module) => unknown = (e, m) => compile(e, { stage: e.stage, requiredKinds: [], optionalKinds: [m.kind], forbiddenKinds: [], budgets: {}, limits: [], pinPolicy: 'none', slots: ['instruction'] }, [{ module: m }], (null as never));
`,
    );
    writeFileSync(
      join(app, 'consumer.cts'),
      `import sdk = require('@ultrarouter/sdk');
import ctx = require('@ultrarouter/sdk/context');
const ur = new sdk.UltraRouter({ apiKey: 'ur_sk_test_types' });
export const p: Promise<sdk.ModelsListResponse> = ur.models.list();
export const lifted: ctx.LiftedManifest = ctx.fromMessages([{ role: 'user', content: 'hi' }]);
`,
    );
    writeFileSync(
      join(app, 'tsconfig.json'),
      JSON.stringify(
        {
          compilerOptions: {
            target: 'ES2022',
            module: 'NodeNext',
            moduleResolution: 'NodeNext',
            strict: true,
            noEmit: true,
            types: ['node'],
            skipLibCheck: false,
          },
          files: ['consumer.mts', 'consumer.cts'],
        },
        null,
        2,
      ),
    );
    const tsc = await run(
      process.execPath,
      [join(app, 'node_modules', 'typescript', 'bin', 'tsc'), '-p', 'tsconfig.json'],
      { cwd: app },
    );
    check(
      tsc.code === 0,
      'tsc --strict type-check of an ESM (.mts) and a CommonJS (.cts) consumer (skipLibCheck: false)',
      tsc.out,
    );

    // 4d. the ur CLI from the installed package
    const ur = join(app, 'node_modules', '.bin', 'ur');
    const help = await run(ur, ['--help'], { cwd: app, env });
    check(
      help.code === 0 && help.out.includes('usage:') && help.out.includes('ur bench run'),
      'ur --help (exit 0, usage printed)',
      help.out,
    );
    const version = await run(ur, ['--version'], { cwd: app, env });
    check(
      version.code === 0 && version.out.trim() === PKG.version,
      `ur --version prints ${PKG.version}`,
      version.out,
    );
    const status = await run(ur, ['flywheel', 'status', '--json'], { cwd: app, env });
    let parsed = false;
    try {
      parsed = typeof JSON.parse(status.out) === 'object';
    } catch {
      parsed = false;
    }
    check(
      status.code === 0 && parsed,
      'ur flywheel status --json against the mock gateway (exit 0, JSON)',
      status.out,
    );
    cpSync(
      join(ROOT, 'test', 'pack', 'release-checklist.ur.md'),
      join(app, 'release-checklist.ur.md'),
    );
    const pack = await run(
      ur,
      ['pack', 'validate', 'release-checklist.ur.md', '--workspace', 'ws_fixture'],
      { cwd: app, env },
    );
    check(
      pack.code === 0 && pack.out.includes('valid:'),
      'ur pack validate on a signed pack (exit 0)',
      pack.out,
    );
    const bad = await run(ur, ['flywheel', 'status'], {
      cwd: app,
      env: { ...env, ULTRAROUTER_API_KEY: 'ur_sk_test_invalid' },
    });
    check(bad.code === 2, 'ur fails closed (exit 2) on an authentication error', bad.out);

    // 4e. npx: inside the consumer (resolves the installed bin), and with an explicit --package
    // from an EMPTY directory — the form the docs give for running without installing (here the
    // package spec is the tarball, since this release is not on the registry yet).
    // npm may interleave progress control sequences and notices with the CLI's output; quiet them,
    // and compare lines with escape sequences stripped.
    const npmQuiet = {
      npm_config_update_notifier: 'false',
      npm_config_progress: 'false',
      npm_config_loglevel: 'error',
    };
    const printsVersion = (out) =>
      out
        .replace(/\u001b\[[0-9;?]*[A-Za-z]/g, '')
        .split(/\r?\n/)
        .some((l) => l.trim() === PKG.version);
    const npxLocal = await run('npx', ['--no-install', 'ur', '--version'], {
      cwd: app,
      env: { ...env, ...npmQuiet },
    });
    check(
      npxLocal.code === 0 && printsVersion(npxLocal.out),
      'npx ur --version inside a project that depends on the package',
      `exit ${String(npxLocal.code)}\n${npxLocal.out}`,
    );
    const empty = join(dir, 'empty');
    mkdirSync(empty);
    const npxPackage = await run('npx', ['--yes', `--package=${tarball}`, 'ur', '--version'], {
      cwd: empty,
      env: { ...env, ...npmQuiet, npm_config_cache: join(dir, 'npm-cache') },
    });
    check(
      npxPackage.code === 0 && printsVersion(npxPackage.out),
      'npx --package=<the package> ur --version from an empty directory',
      `exit ${String(npxPackage.code)}\n${JSON.stringify(npxPackage.out)}`,
    );

    // 4f. Deno: the same ESM consumer under Deno (byonm: the consumer's package.json + node_modules).
    const deno = await run('deno', ['--version'], { cwd: app });
    if (deno.code !== 0) {
      const required = process.env.UR_SMOKE_REQUIRE_DENO === '1';
      check(!required, 'Deno is installed (UR_SMOKE_REQUIRE_DENO=1)', deno.out);
      if (!required) process.stdout.write('  skip Deno smoke (deno is not installed)\n');
    } else {
      writeFileSync(
        join(app, 'deno.mjs'),
        `import UltraRouter, { VERSION, UltraRouterError } from '@ultrarouter/sdk';
import { fromMessages, toMessages, canonicalJson, hashContextValue } from '@ultrarouter/sdk/context';

const assert = (ok, label) => { if (!ok) throw new Error('assertion failed: ' + label); };
assert(VERSION === ${JSON.stringify(PKG.version)}, 'version');
const ur = new UltraRouter({ defaultModel: 'openai/gpt-5.2-mini' });
const chat = await ur.chat.completions.create({ messages: [{ role: 'user', content: 'deno smoke' }] });
assert(/deno smoke/.test(chat.choices[0].message.content), 'chat');
let streamed = '';
for await (const chunk of await ur.chat.completions.create({ stream: true, messages: [{ role: 'user', content: 'deno stream' }] })) {
  streamed += chunk.choices[0]?.delta.content ?? '';
}
assert(/deno stream/.test(streamed), 'stream');
const emb = await ur.embeddings.create({ model: 'openai/text-embedding-3-small', input: ['a'] });
assert(emb.data.length === 1, 'embeddings');
let typed = false;
try { await ur.chat.completions.create({ model: 'example/unpriced-model', messages: [{ role: 'user', content: 'x' }] }); }
catch (err) { typed = err instanceof UltraRouterError && err.code === 'model_unpriced'; }
assert(typed, 'typed error');
const messages = [{ role: 'system', content: 'sys' }, { role: 'user', content: 'hi' }];
assert(JSON.stringify(toMessages(fromMessages(messages).manifest)) === JSON.stringify(messages), 'lift exit');
assert(canonicalJson(JSON.parse('{"b":1,"__proto__":{"a":2}}')) === '{"__proto__":{"a":2},"b":1}', 'canonical json');
assert(/^[0-9a-f]{64}$/.test(hashContextValue({ a: 1 })), 'sha256 via node:crypto');
console.log('deno ok');
`,
      );
      const denoRun = await run(
        'deno',
        [
          'run',
          '--node-modules-dir=manual',
          '--allow-env',
          '--allow-read',
          '--allow-net=127.0.0.1',
          'deno.mjs',
        ],
        { cwd: app, env: { ...env, DENO_NO_UPDATE_CHECK: '1' } },
      );
      check(
        denoRun.code === 0 && denoRun.out.includes('deno ok'),
        `Deno (${deno.out.split('\n')[0] ?? 'deno'}): chat + stream + embeddings + typed error + context entry`,
        denoRun.out,
      );
    }
  } finally {
    await gw.close();
    if (keep) process.stdout.write(`kept ${dir}\n`);
    else rmSync(dir, { recursive: true, force: true });
  }
}

const argv = process.argv.slice(2);
if (
  process.argv[1] !== undefined &&
  relative(process.argv[1], new URL(import.meta.url).pathname) === ''
) {
  await main(argv);
  process.stdout.write(
    `\npack-smoke: ${failures === 0 ? 'all checks passed' : `${String(failures)} check(s) FAILED`}\n`,
  );
  process.exitCode = failures === 0 ? 0 : 1;
}
