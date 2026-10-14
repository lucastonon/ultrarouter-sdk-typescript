// The public leak scanner: GENERIC built-in rules (credential formats, absolute local paths,
// committed secret files) over the tree, the FULL git history and the npm tarball, plus extra rules
// loaded from a patterns file (`--patterns-file` / ULTRAROUTER_LEAK_PATTERNS_FILE). Every secret and
// pattern below is SYNTHETIC and assembled at runtime, so this file never matches a scanner itself.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

// @ts-expect-error -- a plain ESM script without declarations
import * as scanner from '../scripts/leak-scan.mjs';

interface Rule {
  id: string;
  re: RegExp;
  description: string;
  external?: boolean;
}
interface Hit {
  rule: string;
  match: string;
  line: number;
  external: boolean;
}
interface Finding extends Hit {
  source: string;
  file: string;
  excerpt: string;
}
interface Report {
  scanned: number;
  findings: Finding[];
  staleAllowlist: { file: string; match: string }[];
  notes: string[];
}
const {
  BUILTIN_RULES,
  PatternsFileError,
  forbiddenFile,
  loadPatternsFile,
  main,
  parseRawLog,
  resolvePatternsFile,
  scanRepository,
  scanText,
} = scanner as {
  BUILTIN_RULES: readonly Rule[];
  PatternsFileError: new (m: string) => Error;
  forbiddenFile: (p: string) => string | null;
  loadPatternsFile: (p: string) => Rule[];
  main: (argv: string[], io: { out: Sink; err: Sink; env: Record<string, string> }) => number;
  parseRawLog: (raw: string) => RawChange[];
  resolvePatternsFile: (cli: string | undefined, env: Record<string, string>) => string | null;
  scanRepository: (o: Record<string, unknown>) => Report;
  scanText: (t: string, rules?: readonly Rule[]) => Hit[];
};
interface Sink {
  write: (s: string) => boolean;
}
interface RawChange {
  commit: string;
  status: string;
  path: string;
  blob: string | null;
  mode: string;
}

const j = (...parts: string[]): string => parts.join('');
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
function tempDir(): string {
  const d = mkdtempSync(join(tmpdir(), 'ur-leak-'));
  dirs.push(d);
  return d;
}
function sink(): Sink & { text: () => string } {
  let buf = '';
  return {
    write: (s: string) => {
      buf += s;
      return true;
    },
    text: () => buf,
  };
}

/** One synthetic example per built-in credential / path rule. */
const POSITIVES: [string, string][] = [
  ['anthropic-api-key', j('sk-', 'ant-', 'api03-', 'a'.repeat(30))],
  ['openai-api-key', j('sk-', 'b'.repeat(48))],
  ['openai-api-key', j('sk-', 'proj-', 'C'.repeat(40))],
  ['openai-api-key', j('sk-', 'svcacct-', 'D'.repeat(40))],
  ['ultrarouter-api-key', j('ur_sk_', 'live_', 'E'.repeat(32))],
  ['github-token', j('gh', 'p_', 'F'.repeat(36))],
  ['github-token', j('gh', 's_', 'G'.repeat(36))],
  ['github-fine-grained-token', j('github_', 'pat_', '11', 'H'.repeat(80))],
  ['npm-token', j('np', 'm_', 'I'.repeat(36))],
  ['pypi-token', j('pypi-', 'AgEIcHlwaS5vcmc', 'J'.repeat(40))],
  ['slack-token', j('xo', 'xb-', '1234567890-abcdef')],
  ['slack-app-token', j('xa', 'pp-1-', 'A0123-456-abcdef')],
  ['slack-webhook', j('hooks.', 'slack.com/services/', 'T00000000/', 'B00000000/', 'K'.repeat(24))],
  ['aws-access-key-id', j('AK', 'IA', 'LMNOPQRSTUVWXYZ2')],
  ['aws-secret-access-key', j('aws_secret_', 'access_key = ', 'M'.repeat(40))],
  ['google-api-key', j('AI', 'za', 'N'.repeat(35))],
  ['stripe-live-key', j('sk_', 'live_', 'O'.repeat(24))],
  ['huggingface-token', j('hf_', 'P'.repeat(34))],
  ['private-key-block', j('-----BEGIN ', 'RSA PRIVATE KEY', '-----')],
  ['private-key-block', j('-----BEGIN ', 'OPENSSH PRIVATE KEY', '-----')],
  ['macos-home-path', j('/', 'Users', '/', 'alice/project')],
  ['linux-home-path', j('/', 'home', '/', 'alice/project')],
  ['windows-home-path', j('C:', '\\', 'Users', '\\', 'alice')],
  ['macos-temp-path', j('/', 'private', '/var/folders/', 'xy/T/')],
];

describe('built-in rules', () => {
  it.each(POSITIVES)('%s catches a synthetic example', (rule, secret) => {
    const hits = scanText(`const value = "${secret}";`);
    expect(hits.map((h) => h.rule)).toContain(rule);
  });

  it('stays quiet on ordinary text and documentation placeholders', () => {
    const text = [
      'export ULTRAROUTER_API_KEY=ur_sk_test_...',
      'the task-runner reads ask-me and disk-usage',
      'model openai/gpt-5.2-mini; sha256 of the body; sk- prefix (short)',
      'https://example.com/home/page and ~/projects/x',
    ].join('\n');
    expect(scanText(text)).toEqual([]);
  });

  it('every rule is generic: no built-in rule names anything organisation-specific', () => {
    for (const r of BUILTIN_RULES) expect(r.external).toBe(false);
    expect(BUILTIN_RULES.map((r) => r.id)).toEqual(
      expect.arrayContaining([
        'openai-api-key',
        'github-fine-grained-token',
        'npm-token',
        'private-key-block',
      ]),
    );
  });

  it('flags committed secret files, but not .env.example', () => {
    expect(forbiddenFile('.env')).toBe('environment file');
    expect(forbiddenFile('config/.env.production')).toBe('environment file');
    expect(forbiddenFile('certs/server.pem')).toBe('PEM file');
    expect(forbiddenFile('.npmrc')).toBe('npm credentials file');
    expect(forbiddenFile('.env.example')).toBeNull();
    expect(forbiddenFile('src/env.ts')).toBeNull();
  });
});

describe('extra patterns file', () => {
  const synthetic = (dir: string, rules: unknown): string => {
    const p = join(dir, 'patterns.json');
    writeFileSync(p, JSON.stringify(rules));
    return p;
  };

  it('loads { id, regex, flags?, description } rules, marks them external, applies i and ignores u', () => {
    const dir = tempDir();
    const rules = loadPatternsFile(
      synthetic(dir, [
        { id: 'codename', regex: 'zebra-[0-9]+', description: 'a synthetic codename' },
        { id: 'host', regex: 'quokka', flags: 'iu', description: 'a synthetic host name' },
      ]),
    );
    expect(rules.map((r) => [r.id, r.external])).toEqual([
      ['codename', true],
      ['host', true],
    ]);
    expect(scanText('see zebra-42 on QUOKKA', rules).map((h) => h.rule)).toEqual([
      'codename',
      'host',
    ]);
  });

  it.each([
    [{ not: 'an array' }, /expected a JSON array/],
    [[{ id: 'a', regex: 'x' }], /'description'/],
    [[{ id: 'a', regex: 'x', description: 'd', extra: 1 }], /unknown key/],
    [
      [
        { id: 'a', regex: 'x', description: 'd' },
        { id: 'a', regex: 'y', description: 'd' },
      ],
      /duplicate id/,
    ],
    [[{ id: 'a', regex: 'x', flags: 'g', description: 'd' }], /'flags' may contain only/],
    [[{ id: 'a', regex: '(', description: 'd' }], /invalid regex/],
  ])('rejects an invalid file (%j)', (content, message) => {
    const dir = tempDir();
    expect(() => loadPatternsFile(synthetic(dir, content))).toThrow(PatternsFileError);
    expect(() => loadPatternsFile(synthetic(dir, content))).toThrow(message);
  });

  it('a configured file that is missing is an error (exit 2), never a silent generic-only run', () => {
    const dir = tempDir();
    const err = sink();
    const code = main(['--no-history', '--no-pack', '--root', dir], {
      out: sink(),
      err,
      env: { ULTRAROUTER_LEAK_PATTERNS_FILE: join(dir, 'missing.json') },
    });
    expect(code).toBe(2);
    expect(err.text()).toMatch(/patterns file not found/);
  });

  it('the CLI flag wins over the environment variable', () => {
    expect(resolvePatternsFile('/a.json', { ULTRAROUTER_LEAK_PATTERNS_FILE: '/b.json' })).toBe(
      '/a.json',
    );
    expect(resolvePatternsFile(undefined, { ULTRAROUTER_LEAK_PATTERNS_FILE: '/b.json' })).toBe(
      '/b.json',
    );
    expect(resolvePatternsFile(undefined, {})).toBeNull();
  });
});

/** A throwaway git repo. */
function gitRepo(): {
  dir: string;
  git: (...a: string[]) => string;
  write: (p: string, c: string) => void;
} {
  const dir = tempDir();
  const git = (...args: string[]): string =>
    execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim();
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'dev@example.com');
  git('config', 'user.name', 'dev');
  git('config', 'commit.gpgsign', 'false');
  const write = (p: string, c: string): void => {
    mkdirSync(join(dir, p, '..'), { recursive: true });
    writeFileSync(join(dir, p), c);
  };
  return { dir, git, write };
}

describe('history', () => {
  it('finds a secret and an extra-rule hit that a later commit deleted, plus commit messages', () => {
    const { dir, git, write } = gitRepo();
    const token = j('gh', 'p_', 'Q'.repeat(36));
    write('README.md', 'clean\n');
    git('add', '-A');
    git('commit', '-q', '-m', 'initial');
    write('notes.txt', `token ${token}\nproject zebra-7\n`);
    git('add', '-A');
    git('commit', '-q', '-m', 'add notes for zebra-9');
    git('rm', '-q', 'notes.txt');
    git('commit', '-q', '-m', 'remove notes');

    const patterns = join(tempDir(), 'patterns.json');
    writeFileSync(
      patterns,
      JSON.stringify([{ id: 'codename', regex: 'zebra-[0-9]+', description: 'd' }]),
    );
    const rules = [...BUILTIN_RULES, ...loadPatternsFile(patterns)];

    const tree = scanRepository({ root: dir, rules, history: false, pack: false });
    expect(tree.findings).toEqual([]);

    const history = scanRepository({ root: dir, rules, tree: false, pack: false });
    const found = history.findings.map((f) => [f.rule, f.file, f.match]);
    expect(found).toEqual(
      expect.arrayContaining([
        ['github-token', 'notes.txt', token],
        ['codename', 'notes.txt', 'zebra-7'],
        ['codename', '(commit message)', 'zebra-9'],
      ]),
    );
    expect(history.findings.every((f) => f.source.startsWith('history:'))).toBe(true);
  });

  it('covers merge commits and commits on every ref, and a deleted secret file', () => {
    const { dir, git, write } = gitRepo();
    write('a.txt', 'base\n');
    git('add', '-A');
    git('commit', '-q', '-m', 'base');
    git('checkout', '-q', '-b', 'side');
    write('.env', j('API_', 'KEY=', 'x'.repeat(10), '\n'));
    git('add', '-A');
    git('commit', '-q', '-m', 'side env');
    git('rm', '-q', '.env');
    git('commit', '-q', '-m', 'drop env');
    git('checkout', '-q', 'main');
    write('b.txt', 'main\n');
    git('add', '-A');
    git('commit', '-q', '-m', 'main work');
    git('merge', '-q', '--no-ff', '--no-commit', 'side');
    write('merge.txt', `${j('/', 'home', '/', 'bob/', 'x')}\n`);
    git('add', '-A');
    git('commit', '-q', '-m', 'merge side');
    git('branch', 'unmerged', 'HEAD~1');

    const report = scanRepository({ root: dir, tree: false, pack: false });
    const rules = report.findings.map((f) => `${f.rule}:${f.file}`);
    expect(rules).toContain('forbidden-file:.env');
    expect(rules).toContain('linux-home-path:merge.txt');
  });
});

describe('allowlist', () => {
  it('suppresses an exact (file, match) pair; an unused entry an active rule matches is stale', () => {
    const { dir, git, write } = gitRepo();
    const prefix = j('/', 'Users', '/');
    write(
      'package.json',
      JSON.stringify({ name: 'allow-fixture', version: '1.0.0', files: ['doc.md'] }),
    );
    write('doc.md', `see ${prefix}example/\n`);
    write(
      '.leak-scan-allow.json',
      JSON.stringify([
        { file: 'doc.md', match: prefix, reason: 'a documented example path (tree + history)' },
        { file: 'package/doc.md', match: prefix, reason: 'never used: stale' },
        { file: 'x.md', match: 'only-an-extra-rule-matches-this', reason: 'serves an extra rule' },
      ]),
    );
    git('add', '-A');
    git('commit', '-q', '-m', 'docs');
    const report = scanRepository({ root: dir });
    // The packed copy (doc.md at the package root) and the tree + history copies are all allowed.
    expect(report.findings).toEqual([]);
    // Stale = an ACTIVE rule matches the entry and nothing used it; an entry no active rule matches
    // (it serves a rule from an extra patterns file) is not stale.
    expect(report.staleAllowlist.map((e) => e.file)).toEqual(['package/doc.md']);
  });
});

describe('npm tarball', () => {
  it('scans the packed files (and a given --pack-file)', () => {
    const { dir, git, write } = gitRepo();
    write(
      'package.json',
      JSON.stringify({ name: 'leak-scan-fixture', version: '1.0.0', files: ['lib'] }),
    );
    write('lib/index.js', `module.exports = ${JSON.stringify(j('np', 'm_', 'R'.repeat(36)))};\n`);
    git('add', '-A');
    git('commit', '-q', '-m', 'pkg');
    const report = scanRepository({ root: dir, tree: false, history: false });
    expect(report.findings.map((f) => [f.source, f.file, f.rule])).toEqual([
      ['pack', 'lib/index.js', 'npm-token'],
    ]);
  });
});

describe('--redact-external', () => {
  it('prints only the location of an extra-rule hit', () => {
    const { dir, git, write } = gitRepo();
    write('a.txt', 'zebra-1\n');
    git('add', '-A');
    git('commit', '-q', '-m', 'x');
    const patterns = join(dir, 'p.json');
    writeFileSync(
      patterns,
      JSON.stringify([{ id: 'codename', regex: 'zebra-[0-9]+', description: 'd' }]),
    );
    git('add', '-A');
    git('commit', '-q', '-m', 'patterns');
    const err = sink();
    const code = main(
      [
        '--root',
        dir,
        '--no-pack',
        '--no-history',
        '--patterns-file',
        patterns,
        '--redact-external',
      ],
      { out: sink(), err, env: {} },
    );
    expect(code).toBe(1);
    expect(err.text()).toMatch(/tree:a\.txt:1: \[external rule\]/);
    expect(err.text()).not.toMatch(/zebra-1/);
  });
});

describe('history: changed paths come from git itself, not from patch text', () => {
  it('a binary .p12 and an empty .key, committed then deleted, are reported', () => {
    const { dir, git, write } = gitRepo();
    write('README.md', 'clean\n');
    git('add', '-A');
    git('commit', '-q', '-m', 'initial');
    // A binary file has no `+++` line in a patch; an empty file has no hunk at all.
    writeFileSync(join(dir, 'cert.p12'), Buffer.from([0x30, 0x82, 0x00, 0x00, 0x00, 0x01, 0xff]));
    writeFileSync(join(dir, 'signing.key'), '');
    mkdirSync(join(dir, 'deep', 'dir'), { recursive: true });
    writeFileSync(join(dir, 'deep', 'dir', 'with space.pfx'), Buffer.from([0, 1, 2, 3]));
    git('add', '-A');
    git('commit', '-q', '-m', 'add credentials');
    git('rm', '-q', 'cert.p12', 'signing.key', 'deep/dir/with space.pfx');
    git('commit', '-q', '-m', 'remove credentials');

    const tree = scanRepository({ root: dir, history: false, pack: false });
    expect(tree.findings).toEqual([]);
    const history = scanRepository({ root: dir, tree: false, pack: false });
    const found = history.findings.map((f) => `${f.rule}:${f.file}`);
    expect(found).toEqual(
      expect.arrayContaining([
        'forbidden-file:cert.p12',
        'forbidden-file:signing.key',
        'forbidden-file:deep/dir/with space.pfx',
      ]),
    );
    expect(history.findings.every((f) => f.source.startsWith('history:'))).toBe(true);
  });

  it('the content of every historical blob is scanned, including a secret a later edit removed', () => {
    const { dir, git, write } = gitRepo();
    const token = j('np', 'm_', 'S'.repeat(36));
    write('config.txt', `registry token ${token}\nother\n`);
    git('add', '-A');
    git('commit', '-q', '-m', 'add config');
    write('config.txt', 'other\n');
    git('commit', '-q', '-am', 'scrub config');
    const history = scanRepository({ root: dir, tree: false, pack: false });
    expect(history.findings.map((f) => [f.rule, f.file, f.match])).toEqual([
      ['npm-token', 'config.txt', token],
    ]);
  });

  it('a secret in a file that was later renamed and then deleted is still found under its name', () => {
    const { dir, git, write } = gitRepo();
    const key = j('AK', 'IA', 'Z'.repeat(16));
    write('a.txt', `id ${key}\n`);
    git('add', '-A');
    git('commit', '-q', '-m', 'a');
    git('mv', 'a.txt', 'b.txt');
    git('commit', '-q', '-m', 'rename');
    git('rm', '-q', 'b.txt');
    git('commit', '-q', '-m', 'drop');
    const history = scanRepository({ root: dir, tree: false, pack: false });
    expect(history.findings.map((f) => `${f.rule}:${f.file}`)).toEqual(
      expect.arrayContaining(['aws-access-key-id:a.txt', 'aws-access-key-id:b.txt']),
    );
  });

  it('parses `git log --raw -z` records: additions, deletions, modes, merges and odd names', () => {
    const c1 = '1'.repeat(40);
    const c2 = '2'.repeat(40);
    const zero = '0'.repeat(40);
    const blob = 'b'.repeat(40);
    const raw = [
      `\u0001${c1}\u0000\n:000000 100644 ${zero} ${blob} A\u0000cert.p12\u0000`,
      `:000000 100644 ${zero} ${blob} A\u0000name with\nnewline.pem\u0000`,
      `:000000 160000 ${zero} ${'c'.repeat(40)} A\u0000vendor/sub\u0000`,
      `\u0001${c2}\u0000\n:100644 000000 ${blob} ${zero} D\u0000cert.p12\u0000`,
      `\u0001${c2}\u0000\n:100644 100644 ${blob} ${'d'.repeat(40)} M\u0000\u0001odd\u0000`,
      `\u0001${c1}\u0000`,
    ].join('');
    expect(parseRawLog(raw)).toEqual([
      { commit: c1, status: 'A', path: 'cert.p12', blob, mode: '100644' },
      { commit: c1, status: 'A', path: 'name with\nnewline.pem', blob, mode: '100644' },
      { commit: c1, status: 'A', path: 'vendor/sub', blob: 'c'.repeat(40), mode: '160000' },
      { commit: c2, status: 'D', path: 'cert.p12', blob: null, mode: '100644' },
      { commit: c2, status: 'M', path: '\u0001odd', blob: 'd'.repeat(40), mode: '100644' },
    ]);
  });
});
