/**
 * Changed-path discovery for `ur app-ci` / `ur flywheel-pr`. The gate scopes evaluation to the
 * workflows a change touches, so "no changed paths" PASSES — which makes a FAILED discovery
 * dangerous: an unavailable base commit (a shallow clone), a mistyped revision or a git error must
 * never look like "nothing changed". This module distinguishes the two and fails closed. Git is
 * INJECTED so the logic is unit-testable.
 */

/** Discovery could not be completed; the gate must fail closed rather than evaluate nothing. */
export class ChangeDiscoveryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ChangeDiscoveryError';
  }
}

/** The injected git runner: run `git <args>` and report its exit status and output. */
export type GitRunner = (args: readonly string[]) => {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
};

/** The inputs to {@link discoverChangedPaths}. */
export interface ChangeDiscoveryInput {
  /** `--changed-file` values (an explicit list wins). */
  readonly explicit: readonly string[];
  /** The `--changed-from` file contents, when that flag was given (an explicit list, maybe empty). */
  readonly changedFrom?: string | undefined;
  /** The base and head revisions (`''` when unknown). */
  readonly baseSha: string;
  readonly headSha: string;
  readonly git: GitRunner;
}

/** Where the changed paths came from, and the paths. */
export interface ChangeDiscovery {
  readonly source: 'changed-file' | 'changed-from' | 'git-diff';
  readonly paths: readonly string[];
}

const HINT =
  'pass --changed-file/--changed-from, or make both revisions available (actions/checkout with fetch-depth: 0)';

function lines(text: string): string[] {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l !== '');
}

/**
 * Resolve the changed paths. An explicit list (`--changed-file`, or a `--changed-from` file, which
 * may legitimately be empty) is used as given. Otherwise both revisions must exist in this checkout
 * and `git diff --name-only base..head` must succeed — an empty diff then really means "no changes".
 * A missing revision, an unavailable commit or a git failure throws {@link ChangeDiscoveryError}.
 */
export function discoverChangedPaths(input: ChangeDiscoveryInput): ChangeDiscovery {
  if (input.explicit.length > 0) return { source: 'changed-file', paths: [...input.explicit] };
  if (input.changedFrom !== undefined) {
    return { source: 'changed-from', paths: lines(input.changedFrom) };
  }
  for (const [label, sha] of [
    ['base', input.baseSha],
    ['head', input.headSha],
  ] as const) {
    if (sha === '') {
      throw new ChangeDiscoveryError(
        `cannot determine the changed files: no ${label} revision is known — ${HINT}`,
      );
    }
    const verify = input.git(['rev-parse', '--verify', '--quiet', `${sha}^{commit}`]);
    if (verify.status !== 0) {
      throw new ChangeDiscoveryError(
        `cannot determine the changed files: the ${label} revision '${sha}' is not available in this checkout (a shallow clone or a wrong revision) — ${HINT}`,
      );
    }
  }
  const diff = input.git(['diff', '--name-only', `${input.baseSha}..${input.headSha}`]);
  if (diff.status !== 0) {
    throw new ChangeDiscoveryError(
      `cannot determine the changed files: git diff failed (${diff.stderr.trim() || `exit ${String(diff.status)}`}) — ${HINT}`,
    );
  }
  return { source: 'git-diff', paths: lines(diff.stdout) };
}
