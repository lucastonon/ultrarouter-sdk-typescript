// The candidate checkout must BE the revision the evidence names (`--head`): HEAD resolves to the
// claimed commit and no tracked file differs from it, except the digest-bound config and lockfile.
// Every failure is NAMED and thrown before anything runs. Proven with an injected git runner (each
// reason, rename parsing, git failures) and against a real temporary repository.
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { GitRunner } from '../src/cli/changes.js';
import { CandidateRevisionError, verifyCandidateCheckout } from '../src/cli/revision.js';

const A = 'a'.repeat(40);
const B = 'b'.repeat(40);

/** A scripted git: `rev-parse <x>^{commit}` resolves through `commits`, status/ls-files are given. */
function fakeGit(opts: {
  commits: Record<string, string>;
  head: string | null;
  status?: string;
  statusFails?: boolean;
  tracked?: Record<string, string>;
}): GitRunner {
  return (args) => {
    if (args[0] === 'rev-parse') {
      const rev = String(args[args.length - 1]).replace(/\^\{commit\}$/, '');
      const sha = rev === 'HEAD' ? opts.head : (opts.commits[rev] ?? null);
      return sha === null
        ? { status: 1, stdout: '', stderr: '' }
        : { status: 0, stdout: `${sha}\n`, stderr: '' };
    }
    if (args[0] === 'status') {
      return opts.statusFails === true
        ? { status: 128, stdout: '', stderr: 'fatal' }
        : { status: 0, stdout: opts.status ?? '', stderr: '' };
    }
    if (args[0] === 'ls-files') {
      const name = opts.tracked?.[String(args[args.length - 1])];
      return { status: 0, stdout: name === undefined ? '' : `${name}\0`, stderr: '' };
    }
    throw new Error(`unexpected git ${args.join(' ')}`);
  };
}

function reasonOf(fn: () => unknown): string | null {
  try {
    fn();
    return null;
  } catch (e) {
    expect(e).toBeInstanceOf(CandidateRevisionError);
    return (e as CandidateRevisionError).reason;
  }
}

describe('verifyCandidateCheckout (injected git)', () => {
  it('returns the resolved commit when HEAD is the claimed head and the tree is clean', () => {
    const git = fakeGit({ commits: { [B]: B, bbbbbbb: B }, head: B });
    expect(verifyCandidateCheckout({ headSha: B, boundPaths: [], git })).toBe(B);
    expect(verifyCandidateCheckout({ headSha: 'bbbbbbb', boundPaths: [], git })).toBe(B);
  });

  it.each([
    ['candidate_revision_unknown', { headSha: '', head: B }],
    ['candidate_revision_unavailable', { headSha: 'f'.repeat(40), head: B }],
    ['candidate_checkout_unavailable', { headSha: B, head: null }],
    ['candidate_revision_mismatch', { headSha: B, head: A }],
  ] as const)('%s', (reason, { headSha, head }) => {
    const git = fakeGit({ commits: { [A]: A, [B]: B }, head });
    expect(reasonOf(() => verifyCandidateCheckout({ headSha, boundPaths: [], git }))).toBe(reason);
  });

  it('the mismatch message names both revisions', () => {
    const git = fakeGit({ commits: { [A]: A, [B]: B }, head: A });
    expect(() => verifyCandidateCheckout({ headSha: B, boundPaths: [], git })).toThrow(
      new RegExp(
        `candidate_revision_mismatch: the checkout is at ${A}, but the evidence would name ${B}`,
      ),
    );
  });

  it('a modified, staged, deleted or renamed tracked file is candidate_worktree_modified', () => {
    for (const status of [
      ' M src/app.js\0',
      'M  src/app.js\0',
      ' D src/app.js\0',
      'R  src/new.js\0src/app.js\0',
    ]) {
      const git = fakeGit({ commits: { [B]: B }, head: B, status });
      expect(reasonOf(() => verifyCandidateCheckout({ headSha: B, boundPaths: [], git }))).toBe(
        'candidate_worktree_modified',
      );
    }
  });

  it('changes to the digest-bound config and lockfile are allowed; anything else is not', () => {
    const tracked = { 'cfg.json': 'ci/cfg.json', 'deps.lock': 'deps.lock' };
    const ok = fakeGit({
      commits: { [B]: B },
      head: B,
      status: ' M ci/cfg.json\0 M deps.lock\0',
      tracked,
    });
    expect(
      verifyCandidateCheckout({ headSha: B, boundPaths: ['cfg.json', 'deps.lock'], git: ok }),
    ).toBe(B);
    const bad = fakeGit({
      commits: { [B]: B },
      head: B,
      status: ' M deps.lock\0 M src/app.js\0',
      tracked,
    });
    expect(
      reasonOf(() =>
        verifyCandidateCheckout({ headSha: B, boundPaths: ['cfg.json', 'deps.lock'], git: bad }),
      ),
    ).toBe('candidate_worktree_modified');
  });

  it('a failing git status fails closed', () => {
    const git = fakeGit({ commits: { [B]: B }, head: B, statusFails: true });
    expect(reasonOf(() => verifyCandidateCheckout({ headSha: B, boundPaths: [], git }))).toBe(
      'candidate_checkout_unavailable',
    );
  });
});

describe('verifyCandidateCheckout (a real repository)', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  function repo(): { dir: string; git: (...a: string[]) => string; run: GitRunner } {
    const dir = mkdtempSync(join(tmpdir(), 'ur-rev-'));
    dirs.push(dir);
    const git = (...args: string[]): string =>
      execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim();
    const run: GitRunner = (args) => {
      const r = spawnSync('git', [...args], { cwd: dir, encoding: 'utf8' });
      return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
    };
    git('init', '-q');
    git('config', 'user.email', 'dev@example.com');
    git('config', 'user.name', 'dev');
    git('config', 'commit.gpgsign', 'false');
    return { dir, git, run };
  }

  it('checkout A + claimed B is a named mismatch; checkout B passes; a dirty B does not', () => {
    const { dir, git, run } = repo();
    mkdirSync(join(dir, 'src'));
    writeFileSync(join(dir, 'src', 'app.js'), 'a');
    writeFileSync(join(dir, 'deps.lock'), 'lockA');
    git('add', '-A');
    git('commit', '-q', '-m', 'A');
    const a = git('rev-parse', 'HEAD');
    writeFileSync(join(dir, 'src', 'app.js'), 'b');
    git('commit', '-q', '-am', 'B');
    const b = git('rev-parse', 'HEAD');

    git('checkout', '-q', '--detach', a);
    expect(reasonOf(() => verifyCandidateCheckout({ headSha: b, boundPaths: [], git: run }))).toBe(
      'candidate_revision_mismatch',
    );

    git('checkout', '-q', '--detach', b);
    expect(verifyCandidateCheckout({ headSha: b.slice(0, 10), boundPaths: [], git: run })).toBe(b);

    writeFileSync(join(dir, 'untracked.txt'), 'build output');
    writeFileSync(join(dir, 'deps.lock'), 'lockB');
    expect(verifyCandidateCheckout({ headSha: b, boundPaths: ['deps.lock'], git: run })).toBe(b);
    expect(reasonOf(() => verifyCandidateCheckout({ headSha: b, boundPaths: [], git: run }))).toBe(
      'candidate_worktree_modified',
    );

    git('checkout', '-q', '--', 'deps.lock');
    writeFileSync(join(dir, 'src', 'app.js'), 'local edit');
    expect(
      reasonOf(() => verifyCandidateCheckout({ headSha: b, boundPaths: ['deps.lock'], git: run })),
    ).toBe('candidate_worktree_modified');
  });
});
