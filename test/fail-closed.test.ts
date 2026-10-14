// The CLI gates fail CLOSED: an unavailable change discovery is never "no changes" (an empty scope
// would pass), a harness that exits non-zero never passes because it also wrote `status: passed`,
// and a harness killed by a signal is a failure, not exit code 0.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { exitCodeOf, outcomeFor, parseHarnessOutput } from '../src/cli/app-harness.js';
import { ChangeDiscoveryError, discoverChangedPaths, type GitRunner } from '../src/cli/changes.js';

/** A real git runner bound to a directory. */
function gitIn(dir: string): GitRunner {
  return (args) => {
    try {
      const stdout = execFileSync('git', [...args], {
        cwd: dir,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      return { status: 0, stdout, stderr: '' };
    } catch (err) {
      const e = err as { status?: number; stdout?: string; stderr?: string };
      return { status: e.status ?? 1, stdout: e.stdout ?? '', stderr: e.stderr ?? '' };
    }
  };
}

function repo(): { dir: string; base: string; head: string } {
  const dir = mkdtempSync(join(tmpdir(), 'ur-changes-'));
  const git = (...args: string[]): string =>
    execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim();
  git('init', '-q');
  git('config', 'user.email', 'dev@example.com');
  git('config', 'user.name', 'dev');
  git('config', 'commit.gpgsign', 'false');
  writeFileSync(join(dir, 'a.txt'), 'v1');
  git('add', '-A');
  git('commit', '-q', '-m', 'base');
  const base = git('rev-parse', 'HEAD');
  writeFileSync(join(dir, 'b.txt'), 'new');
  git('add', '-A');
  git('commit', '-q', '-m', 'head');
  return { dir, base, head: git('rev-parse', 'HEAD') };
}

describe('discoverChangedPaths', () => {
  it('a successful diff lists the changed paths', () => {
    const r = repo();
    const d = discoverChangedPaths({
      explicit: [],
      baseSha: r.base,
      headSha: r.head,
      git: gitIn(r.dir),
    });
    expect(d).toEqual({ source: 'git-diff', paths: ['b.txt'] });
  });

  it('an empty diff between two real revisions is a genuine "no changes"', () => {
    const r = repo();
    const d = discoverChangedPaths({
      explicit: [],
      baseSha: r.head,
      headSha: r.head,
      git: gitIn(r.dir),
    });
    expect(d.paths).toEqual([]);
  });

  it('a NONEXISTENT base revision fails closed (never an empty, passing scope)', () => {
    const r = repo();
    expect(() =>
      discoverChangedPaths({
        explicit: [],
        baseSha: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
        headSha: r.head,
        git: gitIn(r.dir),
      }),
    ).toThrow(ChangeDiscoveryError);
  });

  it('an unknown base (no --base, no event, no parent) fails closed', () => {
    const r = repo();
    expect(() =>
      discoverChangedPaths({ explicit: [], baseSha: '', headSha: r.head, git: gitIn(r.dir) }),
    ).toThrow(/no base revision/);
  });

  it('a git failure fails closed, naming the error', () => {
    const git: GitRunner = (args) =>
      args[0] === 'diff'
        ? { status: 128, stdout: '', stderr: 'fatal: bad object' }
        : { status: 0, stdout: 'x', stderr: '' };
    expect(() => discoverChangedPaths({ explicit: [], baseSha: 'a', headSha: 'b', git })).toThrow(
      /git diff failed \(fatal: bad object\)/,
    );
  });

  it('an explicit list wins and needs no git; an empty --changed-from file is an explicit "none"', () => {
    const git: GitRunner = () => {
      throw new Error('git must not run');
    };
    expect(discoverChangedPaths({ explicit: ['x'], baseSha: '', headSha: '', git }).paths).toEqual([
      'x',
    ]);
    expect(
      discoverChangedPaths({ explicit: [], changedFrom: '\n  \n', baseSha: '', headSha: '', git }),
    ).toEqual({ source: 'changed-from', paths: [] });
  });
});

describe('outcomeFor — a reported pass never overrides an unsuccessful process', () => {
  const passed = parseHarnessOutput(JSON.stringify({ status: 'passed' }));
  it('exit 1 + reported `passed` ⇒ failed', () => {
    expect(outcomeFor(1, passed)).toBe('failed');
  });
  it('signal-killed (exit 137) + reported `passed` ⇒ failed', () => {
    expect(outcomeFor(exitCodeOf(null, 'SIGKILL'), passed)).toBe('failed');
  });
  it('a non-zero exit keeps a more specific named non-pass status', () => {
    expect(outcomeFor(1, parseHarnessOutput('{"status":"flaky"}'))).toBe('flaky');
    expect(outcomeFor(2, parseHarnessOutput('{"status":"missing_evaluator"}'))).toBe(
      'missing_evaluator',
    );
  });
  it('exit 0 honours a reported status (it may narrow a pass), else passes', () => {
    expect(outcomeFor(0, passed)).toBe('passed');
    expect(outcomeFor(0, parseHarnessOutput('{"status":"failed"}'))).toBe('failed');
    expect(outcomeFor(0, null)).toBe('passed');
    expect(outcomeFor(3, null)).toBe('failed');
  });
});

describe('exitCodeOf — a signal is a failure', () => {
  it('maps signals like a shell (128 + n) and never to 0', () => {
    expect(exitCodeOf(0, null)).toBe(0);
    expect(exitCodeOf(4, null)).toBe(4);
    expect(exitCodeOf(null, 'SIGKILL')).toBe(137);
    expect(exitCodeOf(null, 'SIGTERM')).toBe(143);
    expect(exitCodeOf(null, 'SIGWINCH')).toBe(128);
    expect(exitCodeOf(null, null)).toBe(1);
  });
});
