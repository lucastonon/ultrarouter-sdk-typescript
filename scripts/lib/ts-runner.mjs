/**
 * Shared machinery for running TypeScript snippets against the BUILT package and the local mock
 * gateway: a throwaway workspace whose `node_modules/@ultrarouter/sdk` points at this repository (so
 * imports resolve through the real `package.json` exports, exactly as for a user), a type-check of
 * every snippet under strict settings, and an esbuild transpile + `node` run per snippet.
 */
import { spawn } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** The API key the snippets run with (a fake test key; the mock accepts any non-empty key). */
export const SNIPPET_API_KEY = 'ur_sk_test_snippet';

/** Fail early with a clear message when the package has not been built. */
export function assertBuilt() {
  for (const f of [
    'dist/index.js',
    'dist/index.d.ts',
    'dist/context.js',
    'dist/learning.js',
    'dist/cli/index.cjs',
  ]) {
    if (!existsSync(join(ROOT, f))) {
      throw new Error(`missing ${f}: run \`npm run build\` first`);
    }
  }
}

/**
 * Create a workspace directory with `node_modules` links to this package and its dev dependencies
 * that snippets may import (`openai`, `@types/node`), plus the fixture files snippets read.
 */
export function createWorkspace(prefix) {
  const dir = mkdtempSync(join(process.env.UR_SNIPPET_TMPDIR ?? tmpdir(), `${prefix}-`));
  const nm = join(dir, 'node_modules');
  mkdirSync(join(nm, '@ultrarouter'), { recursive: true });
  mkdirSync(join(nm, '@types'), { recursive: true });
  symlinkSync(ROOT, join(nm, '@ultrarouter', 'sdk'), 'dir');
  symlinkSync(join(ROOT, 'node_modules', 'openai'), join(nm, 'openai'), 'dir');
  symlinkSync(join(ROOT, 'node_modules', '@types', 'node'), join(nm, '@types', 'node'), 'dir');
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({ name: 'snippets', private: true, type: 'module' }),
  );
  // Fixture files snippets may read (a knowledge pack).
  mkdirSync(join(dir, 'knowledge'), { recursive: true });
  cpSync(
    join(ROOT, 'test', 'pack', 'release-checklist.ur.md'),
    join(dir, 'knowledge', 'release-checklist.ur.md'),
  );
  return dir;
}

/** Remove a workspace. */
export function removeWorkspace(dir) {
  rmSync(dir, { recursive: true, force: true });
}

/**
 * Type-check files in `dir` with strict settings and Node + DOM types. Returns the diagnostics as
 * text (empty when clean).
 */
export function typecheck(dir, files) {
  const ts = require('typescript');
  const program = ts.createProgram(
    files.map((f) => join(dir, f)),
    {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.NodeNext,
      moduleResolution: ts.ModuleResolutionKind.NodeNext,
      strict: true,
      noEmit: true,
      skipLibCheck: true,
      esModuleInterop: true,
      types: ['node'],
      lib: ['lib.es2022.d.ts', 'lib.dom.d.ts'],
      typeRoots: [join(dir, 'node_modules', '@types')],
    },
  );
  const diagnostics = ts.getPreEmitDiagnostics(program);
  return ts.formatDiagnostics(diagnostics, {
    getCanonicalFileName: (f) => f,
    getCurrentDirectory: () => dir,
    getNewLine: () => '\n',
  });
}

/** Transpile a TypeScript file to an ESM `.mjs` next to it (esbuild, no bundling). */
export function transpile(dir, file) {
  const esbuild = require('esbuild');
  const out = file.replace(/\.(ts|mts)$/, '.mjs');
  esbuild.buildSync({
    entryPoints: [join(dir, file)],
    outfile: join(dir, out),
    format: 'esm',
    platform: 'node',
    target: 'node20',
    bundle: false,
    logLevel: 'silent',
  });
  return out;
}

/**
 * Run `node <file>` in `dir` with the snippet environment pointed at `baseURL`. Resolves
 * `{ code, stdout, stderr }`; kills the process after `timeoutMs`.
 */
export function runNode(dir, file, baseURL, timeoutMs = 30_000, extraEnv = {}) {
  return new Promise((resolveRun) => {
    const env = {
      PATH: process.env.PATH ?? '',
      HOME: process.env.HOME ?? '',
      ULTRAROUTER_API_KEY: SNIPPET_API_KEY,
      ULTRAROUTER_BASE_URL: baseURL,
      OPENAI_API_KEY: SNIPPET_API_KEY,
      OPENAI_BASE_URL: `${baseURL}/v1`,
      // The mock gateway issues this signing secret to pull-transport oracles.
      UR_ORACLE_ID: 'orc_mock_1',
      UR_ORACLE_SECRET: 'mock-oracle-secret',
      // The shared secret the delayed-webhook example signs and verifies with (a test value).
      ULTRAROUTER_WEBHOOK_SECRET: 'example-webhook-secret',
      ...extraEnv,
    };
    const child = spawn(process.execPath, [file], {
      cwd: dir,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.on('close', (code) => {
      clearTimeout(timer);
      resolveRun({ code: code ?? 1, stdout, stderr });
    });
  });
}
