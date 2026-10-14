#!/usr/bin/env node
/**
 * leak-scan — fail when anything this repository publishes contains a secret, an absolute local
 * path, or a committed secret file.
 *
 * Three sources are scanned, all on by default:
 *
 * - **tree**: every file git would ship (tracked files plus untracked, non-ignored files);
 * - **history**: every commit reachable from any ref (`--reflog` adds reflog-only commits): its
 *   message; every path it adds, changes or deletes, read from git's own `--raw -z` output (against
 *   each parent, so merges are covered; binary, empty, renamed and deleted files included), checked
 *   against the secret-file names; and the full content of every text blob it introduced (each
 *   distinct blob read once), so a secret deleted or edited away in a later commit is still found;
 * - **pack**: every file in the `npm pack` tarball (what `npm publish` would upload).
 *
 * The built-in rules are generic: credential formats (API keys and tokens of common providers,
 * private-key blocks), absolute local paths (macOS, Linux and Windows home directories, macOS
 * temporary directories) and committed secret files (`.env`, private keys, registry credentials).
 * Rule sources are written so this file never matches itself (for example `sk-(?:ant)-`).
 *
 * Organisation-specific rules are not part of this repository. Supply them as a JSON file with
 * `--patterns-file <path>` or the `ULTRAROUTER_LEAK_PATTERNS_FILE` environment variable: a JSON
 * array of `{ "id": string, "regex": string, "flags"?: string, "description": string }` objects.
 * `flags` may contain `i` (ignore case), `m` (multi-line), `s` (dot matches newline) and `u`
 * (accepted and ignored, so one file serves every language's scanner); regexes should use the
 * syntax JavaScript and Python share. A configured file that is missing or invalid is an error
 * (exit 2), never a silent fallback. With `--redact-external` (for public CI logs), findings of
 * those rules print only their location.
 *
 *   node scripts/leak-scan.mjs                         # tree + history + pack
 *   node scripts/leak-scan.mjs --no-pack               # skip the tarball (no build needed)
 *   node scripts/leak-scan.mjs --no-tree --no-history  # the tarball only
 *   node scripts/leak-scan.mjs --pack-file x.tgz       # scan this tarball instead of packing
 *   node scripts/leak-scan.mjs --files a b c           # explicit files (relative to the root)
 *   node scripts/leak-scan.mjs --patterns-file p.json  # add extra rules
 *   node scripts/leak-scan.mjs --root <dir> --json     # another checkout; machine-readable report
 *
 * Exceptions live in `.leak-scan-allow.json` (exempt from the scan and never published): each
 * entry names the exact file, the exact matched text and a reason. An entry that an active rule
 * matches but that no finding used is an error, so the allowlist cannot silently rot; an entry no
 * active rule matches (it serves a rule from an extra patterns file) is ignored.
 *
 * Exit codes: 0 clean, 1 findings (or a stale allowlist entry), 2 usage or configuration error.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ALLOWLIST_NAME = '.leak-scan-allow.json';

/** The environment variable naming an extra patterns file. */
export const PATTERNS_ENV_VAR = 'ULTRAROUTER_LEAK_PATTERNS_FILE';

/** @typedef {{ id: string, re: RegExp, description: string, external?: boolean }} Rule */

/** @returns {Rule} */
const rule = (id, re, description) => ({ id, re, description, external: false });

/**
 * The generic, built-in rules. `re` is global and matched line by line.
 * @type {ReadonlyArray<Rule>}
 */
export const BUILTIN_RULES = [
  // ── credentials ──
  rule('anthropic-api-key', /sk-(?:ant)-/g, 'Anthropic API key prefix'),
  rule(
    'openai-api-key',
    /\bsk-(?!ant-)(?:proj-|svcacct-|admin-)?[A-Za-z0-9_-]{32,}/g,
    'OpenAI API key (sk-, sk-proj-, sk-svcacct-, sk-admin-)',
  ),
  rule('ultrarouter-api-key', /ur_sk_(?:live|test)_[A-Za-z0-9]{24,}/g, 'ultrarouter API key'),
  rule('github-token', /\bgh[pousr]_[A-Za-z0-9]{30,}/g, 'GitHub classic or app token'),
  rule(
    'github-fine-grained-token',
    /\bgithub_pat_[A-Za-z0-9_]{40,}/g,
    'GitHub fine-grained personal access token',
  ),
  rule('npm-token', /\bnpm_[A-Za-z0-9]{36}\b/g, 'npm access token'),
  rule('pypi-token', /\bpypi-AgEIcHlwaS5vcmc[A-Za-z0-9_-]{16,}/g, 'PyPI API token'),
  rule('slack-token', /\bxox[abposr]-/g, 'Slack token'),
  rule('slack-app-token', /\bxapp-[0-9]+-[A-Za-z0-9-]+/g, 'Slack app-level token'),
  rule(
    'slack-webhook',
    /hooks\.slack\.com\/services\/T[A-Z0-9]+\/B[A-Z0-9]+\/[A-Za-z0-9]+/g,
    'Slack incoming-webhook URL',
  ),
  rule(
    'aws-access-key-id',
    /\b(?:AKIA|ASIA|AGPA|AIDA|AROA|AIPA|ANPA|ANVA)[0-9A-Z]{16}\b/g,
    'AWS access key id',
  ),
  rule(
    'aws-secret-access-key',
    /aws_?secret_?access_?key["']?\s*[:=]\s*["']?[A-Za-z0-9/+]{40}\b/gi,
    'AWS secret access key assignment',
  ),
  rule('google-api-key', /\bAIza[0-9A-Za-z_-]{35}\b/g, 'Google API key'),
  rule('stripe-live-key', /\b(?:sk|rk)_live_[0-9A-Za-z]{24,}/g, 'Stripe live secret key'),
  rule('huggingface-token', /\bhf_[A-Za-z0-9]{34,}/g, 'Hugging Face access token'),
  rule(
    'private-key-block',
    /-----BEGIN [A-Z ]*PRIVATE KEY(?: BLOCK)?-----/g,
    'PEM / OpenSSH / PGP private key block',
  ),
  // ── absolute local paths ──
  rule('macos-home-path', /\/(?:Users)\//g, 'absolute macOS home path'),
  rule('linux-home-path', /\/home\/[a-z_][a-z0-9_.-]*\//g, 'absolute Linux home path'),
  rule('windows-home-path', /\b[A-Za-z]:\\{1,2}Users\\{1,2}/g, 'absolute Windows home path'),
  rule('macos-temp-path', /\/private\/(?:var\/folders|tmp)\//g, 'macOS temporary directory'),
];

/** Committed files that must never ship, matched against the basename (case-insensitive). */
export const FORBIDDEN_FILES = [
  ['.env', 'environment file'],
  ['.env.*', 'environment file'],
  ['*.pem', 'PEM file'],
  ['*.key', 'private key file'],
  ['*.p12', 'PKCS #12 bundle'],
  ['*.pfx', 'PKCS #12 bundle'],
  ['id_rsa', 'SSH private key'],
  ['id_dsa', 'SSH private key'],
  ['id_ecdsa', 'SSH private key'],
  ['id_ed25519', 'SSH private key'],
  ['.npmrc', 'npm credentials file'],
  ['.pypirc', 'PyPI credentials file'],
];
const FORBIDDEN_FILE_EXCEPTIONS = new Set(['.env.example', '.env.sample', '.env.template']);

/** The extra patterns file is missing, unreadable or invalid. */
export class PatternsFileError extends Error {
  constructor(message) {
    super(message);
    this.name = 'PatternsFileError';
  }
}

const ALLOWED_FLAGS = new Set(['i', 'm', 's', 'u']);
const PATTERN_KEYS = new Set(['id', 'regex', 'flags', 'description']);

/**
 * Load extra rules from a JSON patterns file (see the module comment for the format).
 * @param {string} path
 * @returns {Rule[]}
 */
export function loadPatternsFile(path) {
  let data;
  try {
    data = JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    const code = err && typeof err === 'object' && 'code' in err ? err.code : undefined;
    if (code === 'ENOENT') throw new PatternsFileError(`patterns file not found: ${path}`);
    throw new PatternsFileError(
      `cannot read patterns file ${path}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (!Array.isArray(data)) {
    throw new PatternsFileError(`${path}: expected a JSON array of pattern objects`);
  }
  const seen = new Set();
  return data.map((item, index) => {
    const where = `${path}: entry ${String(index)}`;
    if (item === null || typeof item !== 'object' || Array.isArray(item)) {
      throw new PatternsFileError(`${where}: expected an object`);
    }
    const unknown = Object.keys(item).filter((k) => !PATTERN_KEYS.has(k));
    if (unknown.length > 0) {
      throw new PatternsFileError(`${where}: unknown key(s) ${JSON.stringify(unknown.sort())}`);
    }
    const { id, regex, description } = item;
    const flags = item.flags ?? '';
    if (typeof id !== 'string' || id === '') {
      throw new PatternsFileError(`${where}: 'id' must be a non-empty string`);
    }
    if (seen.has(id)) throw new PatternsFileError(`${where}: duplicate id ${JSON.stringify(id)}`);
    if (typeof regex !== 'string' || regex === '') {
      throw new PatternsFileError(`${where} (${id}): 'regex' must be a non-empty string`);
    }
    if (typeof description !== 'string' || description === '') {
      throw new PatternsFileError(`${where} (${id}): 'description' must be a non-empty string`);
    }
    if (typeof flags !== 'string' || [...flags].some((f) => !ALLOWED_FLAGS.has(f))) {
      throw new PatternsFileError(`${where} (${id}): 'flags' may contain only i, m, s, u`);
    }
    let re;
    try {
      // `u` is accepted for parity with other scanners and deliberately not applied.
      re = new RegExp(regex, `g${[...new Set(flags)].filter((f) => f !== 'u').join('')}`);
    } catch (err) {
      throw new PatternsFileError(
        `${where} (${id}): invalid regex: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    seen.add(id);
    return { id, re, description, external: true };
  });
}

/**
 * The configured patterns file: the CLI value first, then the environment variable, else null.
 * @param {string | undefined} cliValue
 * @param {Record<string, string | undefined>} [env]
 */
export function resolvePatternsFile(cliValue, env = process.env) {
  const value = cliValue !== undefined && cliValue !== '' ? cliValue : env[PATTERNS_ENV_VAR];
  return value !== undefined && value !== '' ? resolve(value) : null;
}

/**
 * Scan one text. Returns every match with its 1-based line number.
 * @param {string} text
 * @param {ReadonlyArray<Rule>} [rules]
 * @returns {{ rule: string, line: number, match: string, excerpt: string, external: boolean }[]}
 */
export function scanText(text, rules = BUILTIN_RULES) {
  const hits = [];
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? '';
    for (const { id, re, external } of rules) {
      re.lastIndex = 0;
      for (const m of line.matchAll(re)) {
        hits.push({
          rule: id,
          line: i + 1,
          match: m[0],
          excerpt: line.trim().slice(0, 160),
          external: external === true,
        });
      }
    }
  }
  return hits;
}

/** A glob with `*` only, matched against a basename, case-insensitively. */
function globMatch(glob, name) {
  const re = new RegExp(
    `^${glob.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`,
    'i',
  );
  return re.test(name);
}

/**
 * Why a path must never be committed or published, or null when it may.
 * @param {string} path
 */
export function forbiddenFile(path) {
  const name = basename(path);
  if (FORBIDDEN_FILE_EXCEPTIONS.has(name.toLowerCase())) return null;
  for (const [glob, description] of FORBIDDEN_FILES) {
    if (globMatch(glob, name)) return description;
  }
  return null;
}

/** Load the allowlist: `[{ file, match, reason }]`. */
export function loadAllowlist(root) {
  const file = join(root, ALLOWLIST_NAME);
  if (!existsSync(file)) return [];
  const parsed = JSON.parse(readFileSync(file, 'utf8'));
  const entries = Array.isArray(parsed) ? parsed : parsed.entries;
  if (!Array.isArray(entries)) throw new PatternsFileError(`${ALLOWLIST_NAME}: expected an array`);
  for (const e of entries) {
    if (
      typeof e.file !== 'string' ||
      typeof e.match !== 'string' ||
      typeof e.reason !== 'string' ||
      e.reason.trim() === ''
    ) {
      throw new PatternsFileError(
        `${ALLOWLIST_NAME}: malformed entry ${JSON.stringify(e)} (needs file, match, reason)`,
      );
    }
  }
  return entries;
}

/** Whether a buffer looks binary (a NUL byte in its first 8 KiB). */
function isBinary(buf) {
  return buf.subarray(0, 8192).includes(0);
}

function git(root, args, options = {}) {
  return execFileSync('git', ['-c', 'core.quotePath=false', ...args], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options,
  });
}

/** Every file git would ship (tracked, plus untracked-but-not-ignored), relative to `root`. */
function treeFiles(root) {
  const out = git(root, ['ls-files', '-z', '--cached', '--others', '--exclude-standard']);
  return [...new Set(out.split('\0'))].filter((p) => p !== '' && existsSync(join(root, p)));
}

const COMMIT_MARK = '\u0000\u0001commit ';
const MESSAGE_END = '\u0000\u0002';
const NULL_SHA = /^0+$/;

/**
 * Parse `git log --raw -z --no-abbrev --format=%x01%H` output into one record per changed path.
 * Records are NUL-separated: a `\x01<commit>` header, then for every change a `:<src mode> <dst mode>
 * <src blob> <dst blob> <status>` field followed by its path (two paths for a copy or rename).
 * Paths are taken verbatim, so any byte a file name may hold — a space, a newline, a `\x01` — is
 * kept. `blob` is the content after the change (`null` for a deletion); `mode` is its file mode
 * (for a deletion, the mode the file had).
 * @param {string} raw
 * @returns {{ commit: string, status: string, path: string, blob: string | null, mode: string }[]}
 */
export function parseRawLog(raw) {
  const tokens = raw.split('\0');
  const changes = [];
  let commit = null;
  for (let i = 0; i < tokens.length; i += 1) {
    const token = (tokens[i] ?? '').replace(/^\n/, '');
    if (token.startsWith('\u0001')) {
      commit = token.slice(1);
      continue;
    }
    if (!token.startsWith(':') || commit === null) continue;
    const [srcMode, dstMode, , dstBlob, status] = token.slice(1).split(' ');
    if (status === undefined || dstMode === undefined || dstBlob === undefined) continue;
    const paths = /^[RC]/.test(status) ? [tokens[i + 1], tokens[i + 2]] : [tokens[i + 1]];
    i += paths.length;
    const deleted = NULL_SHA.test(dstBlob);
    for (const path of paths) {
      if (path === undefined || path === '') continue;
      changes.push({
        commit,
        status: status.charAt(0),
        path,
        blob: deleted ? null : dstBlob,
        mode: deleted ? (srcMode ?? dstMode) : dstMode,
      });
    }
  }
  return changes;
}

/**
 * Read blobs by id with one `git cat-file --batch` call (in chunks). Returns id → content.
 * @param {string} root
 * @param {string[]} ids
 * @returns {Map<string, Buffer>}
 */
function readBlobs(root, ids) {
  const out = new Map();
  const CHUNK = 2000;
  for (let start = 0; start < ids.length; start += CHUNK) {
    const batch = ids.slice(start, start + CHUNK);
    const buf = execFileSync('git', ['cat-file', '--batch'], {
      cwd: root,
      input: `${batch.join('\n')}\n`,
      maxBuffer: 1024 * 1024 * 1024,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let at = 0;
    while (at < buf.length) {
      const nl = buf.indexOf(0x0a, at);
      if (nl === -1) break;
      const header = buf.subarray(at, nl).toString('utf8').split(' ');
      at = nl + 1;
      if (header[1] === 'missing' || header.length < 3) continue;
      const size = Number(header[2]);
      out.set(header[0], buf.subarray(at, at + size));
      at += size + 1; // the content is followed by a newline
    }
  }
  return out;
}

/**
 * Every commit reachable from any ref (and the reflog when asked): its message, every path it
 * touches (git's own `--raw` output: binary, empty, renamed and deleted files included), and the
 * content of every text blob it introduced, each distinct (blob, path) pair once, attributed to the
 * oldest commit that introduced it. Merges are diffed against each parent (`-m`), root commits
 * against the empty tree (`--root`).
 * @returns {{ commits: number, shallow: boolean, items: { commit: string, kind: 'message' | 'blob', path: string | null, text: string }[], paths: { commit: string, path: string }[] }}
 */
export function historyItems(root, { reflog = false } = {}) {
  let hasCommits = true;
  try {
    git(root, ['rev-parse', '--verify', '--quiet', 'HEAD']);
  } catch {
    hasCommits = git(root, ['for-each-ref', '--format=%(refname)']).trim() !== '';
  }
  const shallow = git(root, ['rev-parse', '--is-shallow-repository']).trim() === 'true';
  if (!hasCommits) return { commits: 0, shallow, items: [], paths: [] };
  const revs = ['--all', ...(reflog ? ['--reflog'] : []), '--reverse'];

  // 1. Messages. The markers are NUL-led, so no commit message can forge one.
  const items = [];
  const commits = new Set();
  const messages = git(root, [
    'log',
    ...revs,
    '--no-color',
    '--format=%x00%x01commit %H%n%B%x00%x02',
  ]);
  for (const chunk of messages.split(COMMIT_MARK)) {
    if (chunk === '') continue;
    const nl = chunk.indexOf('\n');
    const commit = chunk.slice(0, nl).trim();
    const end = chunk.indexOf(MESSAGE_END, nl);
    if (commits.has(commit)) continue;
    commits.add(commit);
    items.push({
      commit,
      kind: 'message',
      path: null,
      text: end === -1 ? chunk.slice(nl + 1) : chunk.slice(nl + 1, end),
    });
  }

  // 2. Every changed path, from git's own path output (never from patch text, which a binary or an
  // empty file does not have).
  const raw = git(root, [
    'log',
    ...revs,
    '--root',
    '-m',
    '--raw',
    '-z',
    '--no-abbrev',
    '--no-renames',
    '--no-color',
    '--format=%x01%H',
  ]);
  const paths = [];
  const seenPath = new Set();
  /** `${blob}\0${path}` → the oldest commit that introduced that content at that path. */
  const blobAt = new Map();
  for (const change of parseRawLog(raw)) {
    const key = `${change.commit}\0${change.path}`;
    if (!seenPath.has(key)) {
      seenPath.add(key);
      paths.push({ commit: change.commit, path: change.path });
    }
    // A gitlink (submodule) names a commit, not a blob.
    if (change.blob === null || change.mode === '160000') continue;
    const at = `${change.blob}\0${change.path}`;
    if (!blobAt.has(at)) blobAt.set(at, change.commit);
  }

  // 3. The content of every introduced text blob, each distinct blob read once.
  const ids = [...new Set([...blobAt.keys()].map((k) => k.slice(0, k.indexOf('\0'))))];
  const contents = readBlobs(root, ids);
  for (const [at, commit] of blobAt) {
    const sep = at.indexOf('\0');
    const buf = contents.get(at.slice(0, sep));
    if (buf === undefined || isBinary(buf)) continue;
    items.push({ commit, kind: 'blob', path: at.slice(sep + 1), text: buf.toString('utf8') });
  }
  return { commits: commits.size, shallow, items, paths };
}

/** Pack the package at `root` into a temp dir; returns the unpacked package directory. */
function packTarball(root, tarball) {
  const dir = mkdtempSync(join(tmpdir(), 'leak-scan-pack-'));
  let file = tarball;
  if (file === undefined) {
    const raw = execFileSync(
      'npm',
      ['pack', '--json', '--ignore-scripts', '--pack-destination', dir],
      { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    );
    file = join(dir, JSON.parse(raw)[0].filename);
  }
  const unpack = join(dir, 'unpacked');
  execFileSync('mkdir', ['-p', unpack]);
  execFileSync('tar', ['-xzf', file, '-C', unpack]);
  const base = join(unpack, 'package');
  const files = [];
  const walk = (d) => {
    for (const name of readdirSync(d).sort()) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else files.push(relative(base, p).split('\\').join('/'));
    }
  };
  walk(base);
  return { dir, base, files };
}

/**
 * Scan the selected sources of a checkout. Pure of process state: returns a report.
 * @param {{ root?: string, rules?: ReadonlyArray<Rule>, tree?: boolean, history?: boolean,
 *   pack?: boolean, packFile?: string, files?: string[], reflog?: boolean }} [options]
 */
export function scanRepository(options = {}) {
  const root = resolve(options.root ?? DEFAULT_ROOT);
  const rules = options.rules ?? BUILTIN_RULES;
  const allow = loadAllowlist(root);
  const used = new Set();
  const findings = [];
  const notes = [];
  let scanned = 0;

  const allowed = (file, match) => {
    const idx = allow.findIndex((a) => a.file === file && a.match === match);
    if (idx === -1) return false;
    used.add(idx);
    return true;
  };
  const scanContent = (source, file, text) => {
    for (const hit of scanText(text, rules)) {
      if (file !== null && allowed(file, hit.match)) continue;
      findings.push({ source, file: file ?? '(commit message)', ...hit });
    }
  };
  const checkName = (source, file) => {
    const why = forbiddenFile(file);
    if (why !== null) {
      findings.push({
        source,
        file,
        rule: 'forbidden-file',
        line: 0,
        match: basename(file),
        excerpt: why,
        external: false,
      });
    }
  };
  const scanFileOnDisk = (source, base, rel) => {
    checkName(source, rel);
    // The allowlist necessarily quotes the text it allows; it is never published.
    if (rel === ALLOWLIST_NAME) return;
    const buf = readFileSync(join(base, rel));
    if (isBinary(buf)) return;
    scanContent(source, rel, buf.toString('utf8'));
  };

  if (options.files !== undefined) {
    for (const rel of options.files) scanFileOnDisk('files', root, rel);
    scanned += options.files.length;
  } else {
    if (options.tree !== false) {
      const files = treeFiles(root);
      for (const rel of files) scanFileOnDisk('tree', root, rel);
      scanned += files.length;
    }
    if (options.history !== false) {
      const history = historyItems(root, { reflog: options.reflog === true });
      if (history.shallow) {
        notes.push('shallow clone: the history scan covers only the fetched commits');
      }
      // One finding per (rule, file, match): the same secret in several versions of a file, or a
      // secret file touched by several commits, is reported once, at the oldest commit.
      const reported = new Set();
      const before = findings.length;
      for (const { commit, path } of history.paths)
        checkName(`history:${commit.slice(0, 12)}`, path);
      for (const item of history.items) {
        if (item.path === ALLOWLIST_NAME) continue;
        scanContent(`history:${item.commit.slice(0, 12)}`, item.path, item.text);
      }
      const fresh = findings.splice(before).filter((f) => {
        const key = `${f.rule}\0${f.file}\0${f.match}`;
        if (reported.has(key)) return false;
        reported.add(key);
        return true;
      });
      findings.push(...fresh);
      scanned += history.items.length;
      notes.push(`${String(history.commits)} commit(s) in history`);
    }
    if (options.pack !== false) {
      const packed = packTarball(root, options.packFile);
      try {
        for (const rel of packed.files) scanFileOnDisk('pack', packed.base, rel);
        scanned += packed.files.length;
      } finally {
        rmSync(packed.dir, { recursive: true, force: true });
      }
    }
  }

  const full =
    options.files === undefined &&
    options.tree !== false &&
    options.history !== false &&
    options.pack !== false;
  // Stale = an active rule matches the entry's text, yet no finding used it.
  const stale = full
    ? allow.filter(
        (entry, i) => !used.has(i) && scanText(entry.match, rules).some((h) => h.match !== ''),
      )
    : [];
  return { scanned, findings, staleAllowlist: stale, notes };
}

function flagValue(argv, name) {
  const i = argv.indexOf(`--${name}`);
  if (i !== -1) return argv[i + 1];
  const eq = argv.find((a) => a.startsWith(`--${name}=`));
  return eq === undefined ? undefined : eq.slice(name.length + 3);
}

const KNOWN_FLAGS = new Set([
  '--json',
  '--no-tree',
  '--no-history',
  '--no-pack',
  '--reflog',
  '--redact-external',
  '--files',
  '--patterns-file',
  '--root',
  '--pack-file',
  '--help',
  '-h',
]);
const VALUED_FLAGS = new Set(['--patterns-file', '--root', '--pack-file']);

/** The CLI. Returns the exit code. */
export function main(argv, io = { out: process.stdout, err: process.stderr, env: process.env }) {
  if (argv.includes('--help') || argv.includes('-h')) {
    io.out.write(
      'usage: node scripts/leak-scan.mjs [--no-tree] [--no-history] [--no-pack] [--reflog]\n' +
        '         [--pack-file <tgz>] [--files <path>...] [--patterns-file <json>]\n' +
        '         [--redact-external] [--root <dir>] [--json]\n',
    );
    return 0;
  }
  const filesAt = argv.indexOf('--files');
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i] ?? '';
    if (filesAt !== -1 && i > filesAt) break;
    if (!a.startsWith('-')) continue;
    const name = a.includes('=') ? a.slice(0, a.indexOf('=')) : a;
    if (!KNOWN_FLAGS.has(name)) {
      io.err.write(`leak-scan: unknown option ${a}\n`);
      return 2;
    }
    if (VALUED_FLAGS.has(name) && !a.includes('=')) i += 1;
  }
  const json = argv.includes('--json');
  const redactExternal = argv.includes('--redact-external');
  let rules;
  let patternsFile = null;
  try {
    patternsFile = resolvePatternsFile(flagValue(argv, 'patterns-file'), io.env);
    rules =
      patternsFile === null ? BUILTIN_RULES : [...BUILTIN_RULES, ...loadPatternsFile(patternsFile)];
  } catch (err) {
    io.err.write(`leak-scan: ${err instanceof Error ? err.message : String(err)}\n`);
    return 2;
  }
  const extra = rules.length - BUILTIN_RULES.length;
  let report;
  try {
    report = scanRepository({
      root: flagValue(argv, 'root'),
      rules,
      tree: !argv.includes('--no-tree'),
      history: !argv.includes('--no-history'),
      pack: !argv.includes('--no-pack'),
      reflog: argv.includes('--reflog'),
      ...(flagValue(argv, 'pack-file') !== undefined
        ? { packFile: resolve(flagValue(argv, 'pack-file')) }
        : {}),
      ...(filesAt !== -1
        ? { files: argv.slice(filesAt + 1).filter((a) => !a.startsWith('--')) }
        : {}),
    });
  } catch (err) {
    io.err.write(`leak-scan: ${err instanceof Error ? err.message : String(err)}\n`);
    return 2;
  }
  const shown = report.findings.map((f) =>
    f.external && redactExternal ? { ...f, match: '', excerpt: '', rule: 'external rule' } : f,
  );
  if (json) {
    io.out.write(
      `${JSON.stringify(
        {
          scanned: report.scanned,
          builtinRules: BUILTIN_RULES.length,
          extraRules: extra,
          findings: shown,
          staleAllowlist: report.staleAllowlist,
          notes: report.notes,
        },
        null,
        2,
      )}\n`,
    );
  } else {
    for (const f of shown) {
      io.err.write(
        f.external && redactExternal
          ? `${f.source}:${f.file}:${String(f.line)}: [external rule]\n`
          : `${f.source}:${f.file}:${String(f.line)}: [${f.rule}] ${JSON.stringify(f.match)} — ${f.excerpt}\n`,
      );
    }
    for (const s of report.staleAllowlist) {
      io.err.write(
        `allowlist: stale entry (an active rule matches it, nothing used it) ${JSON.stringify(s)}\n`,
      );
    }
    for (const n of report.notes) io.out.write(`leak-scan: note: ${n}\n`);
    const source =
      patternsFile === null
        ? 'built-in rules only (no extra patterns file)'
        : `${String(extra)} extra rule(s) from the patterns file`;
    const summary = `leak-scan: ${String(report.scanned)} item(s) scanned with ${String(BUILTIN_RULES.length)} built-in rule(s), ${source}: ${String(report.findings.length)} finding(s), ${String(report.staleAllowlist.length)} stale allowlist entr${report.staleAllowlist.length === 1 ? 'y' : 'ies'}`;
    (report.findings.length > 0 || report.staleAllowlist.length > 0 ? io.err : io.out).write(
      `${summary}\n`,
    );
  }
  return report.findings.length > 0 || report.staleAllowlist.length > 0 ? 1 : 0;
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
