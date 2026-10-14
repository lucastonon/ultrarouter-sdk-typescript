// Shared helpers for the app-ci battery: run the real built `ur` bin, build throwaway git fixture
// repositories in temp dirs, and a tiny assertion harness (plain Node.js; exits non-zero on any
// failure, like every battery under contract-tests/).
import { spawnSync, spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const HARNESS_DIR = join(HERE, 'harness');
export const CLI = resolve(HERE, '../../dist/cli/index.cjs');

/** Run the built `ur` bin; resolves `{ code, stdout, stderr, json }` (`json` parsed when present). */
export function runBin(args, { cwd, env } = {}) {
  return new Promise((res) => {
    const child = spawn('node', [CLI, ...args], {
      cwd: cwd ?? process.cwd(),
      env: { ...process.env, ...env },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d.toString()));
    child.stderr.on('data', (d) => (stderr += d.toString()));
    child.on('close', (code) => {
      let json;
      try {
        json = JSON.parse(stdout);
      } catch {
        json = undefined;
      }
      res({ code: code ?? 0, stdout, stderr, json });
    });
  });
}

/** git wrapper (fails loudly). */
function git(cwd, ...args) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if ((r.status ?? 1) !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`);
  return r.stdout.trim();
}

/**
 * Build a throwaway git repo with a BASE commit and a HEAD commit. `baseFiles`/`headFiles` are
 * `{ path: contents }` maps; head is applied on top of base. Returns `{ dir, baseSha, headSha, cleanup }`.
 */
export function makeGitFixture({ baseFiles = {}, headFiles = {} } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'ur-app-ci-fixture-'));
  const write = (files) => {
    for (const [p, contents] of Object.entries(files)) {
      const abs = join(dir, p);
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, contents);
    }
  };
  git(dir, 'init', '-q');
  git(dir, 'config', 'user.email', 'dev@example.com');
  git(dir, 'config', 'user.name', 'dev');
  git(dir, 'config', 'commit.gpgsign', 'false');
  write(baseFiles);
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'base');
  const baseSha = git(dir, 'rev-parse', 'HEAD');
  write(headFiles);
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '--allow-empty', '-m', 'head');
  const headSha = git(dir, 'rev-parse', 'HEAD');
  return {
    dir,
    baseSha,
    headSha,
    cleanup: () => {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        /* best-effort */
      }
    },
  };
}

/** Write a JSON app-ci config to a temp file and return its path. */
export function writeConfig(dir, config) {
  const p = join(dir, 'ur-app-ci.config.json');
  writeFileSync(p, JSON.stringify(config, null, 2));
  return p;
}

export { readFileSync, existsSync, join, mkdtempSync, tmpdir };

/** A minimal assertion harness (mirrors scripts/action-smoke.mjs). */
export function makeChecker(title) {
  let failures = 0;
  console.log(title);
  const check = (name, cond, detail) => {
    if (cond) {
      console.log(`  ✓ ${name}`);
    } else {
      failures += 1;
      console.log(`  ✗ ${name}${detail !== undefined ? ` — ${detail}` : ''}`);
    }
  };
  const done = () => {
    if (failures > 0) {
      console.error(`\n${title}: ${failures} check(s) FAILED`);
      process.exit(1);
    }
    console.log(`\n${title}: all checks passed`);
  };
  return { check, done };
}
