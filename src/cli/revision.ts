/**
 * Candidate revision binding for `ur app-ci` / `ur flywheel-pr`. The candidate harness runs in the
 * current checkout, while the evidence contract, the PR comment and the Check Run name the claimed
 * head (`--head`, the Action's `head-sha`, `GITHUB_SHA`). Evidence must never attest to a revision
 * other than the one tested, so before any harness runs the checkout is verified to BE the claimed
 * head:
 *
 * - the claimed head resolves to a commit in this checkout, and `HEAD` is that commit;
 * - no tracked file differs from it (staged or not), except the files whose content is already bound
 *   into the evidence by digest — the app-ci config and the configured lockfile.
 *
 * Anything else fails closed with a NAMED reason, before anything runs or is published. Untracked
 * files (build output, a written patch) are not part of the comparison. Git is INJECTED so the logic
 * is unit-testable.
 */

import type { GitRunner } from './changes.js';

/** Why the checkout cannot stand for the claimed head. */
export type CandidateRevisionReason =
  | 'candidate_revision_unknown'
  | 'candidate_revision_unavailable'
  | 'candidate_checkout_unavailable'
  | 'candidate_revision_mismatch'
  | 'candidate_worktree_modified';

/** The checkout is not the revision the evidence would name; nothing may run or be published. */
export class CandidateRevisionError extends Error {
  /** The named reason. */
  readonly reason: CandidateRevisionReason;

  /** Create the error with its named reason. */
  constructor(reason: CandidateRevisionReason, message: string) {
    super(`${reason}: ${message}`);
    this.name = 'CandidateRevisionError';
    this.reason = reason;
  }
}

/** The inputs to {@link verifyCandidateCheckout}. */
export interface CandidateCheckoutInput {
  /** The claimed head revision (a SHA or any revision git resolves). */
  readonly headSha: string;
  /**
   * Paths (relative to the current directory, or absolute) whose content is bound into the evidence
   * by digest, so a local change to them is attested rather than hidden.
   */
  readonly boundPaths: readonly string[];
  readonly git: GitRunner;
}

const HINT =
  'check out the claimed revision before running (actions/checkout with `ref:` set to the same SHA as `head-sha`), or pass the SHA of the checked-out commit as --head';

/** Every path `git status` reports as changed, relative to the repository root. */
function changedTrackedPaths(git: GitRunner): string[] | null {
  const status = git(['status', '--porcelain=v1', '-z', '--untracked-files=no']);
  if (status.status !== 0) return null;
  const tokens = status.stdout.split('\0');
  const paths: string[] = [];
  for (let i = 0; i < tokens.length; i += 1) {
    const entry = tokens[i] ?? '';
    if (entry.length < 4) continue;
    const xy = entry.slice(0, 2);
    paths.push(entry.slice(3));
    // A rename or copy is followed by its original path.
    if (xy.includes('R') || xy.includes('C')) {
      const original = tokens[i + 1];
      if (original !== undefined && original !== '') paths.push(original);
      i += 1;
    }
  }
  return paths;
}

/** The repository-root-relative names of the bound paths that git tracks. */
function boundRepoPaths(git: GitRunner, boundPaths: readonly string[]): Set<string> {
  const out = new Set<string>();
  for (const p of boundPaths) {
    if (p === '') continue;
    const res = git(['ls-files', '--full-name', '-z', '--', p]);
    if (res.status !== 0) continue;
    for (const name of res.stdout.split('\0')) if (name !== '') out.add(name);
  }
  return out;
}

/**
 * Verify the current checkout is exactly the claimed head (see the module comment). Returns the
 * resolved commit SHA; throws {@link CandidateRevisionError} with a named reason otherwise.
 */
export function verifyCandidateCheckout(input: CandidateCheckoutInput): string {
  const { git, headSha } = input;
  if (headSha === '') {
    throw new CandidateRevisionError(
      'candidate_revision_unknown',
      `no head revision is known, so the evidence cannot name the revision under test — ${HINT}`,
    );
  }
  const claimed = git(['rev-parse', '--verify', '--quiet', `${headSha}^{commit}`]);
  if (claimed.status !== 0 || claimed.stdout.trim() === '') {
    throw new CandidateRevisionError(
      'candidate_revision_unavailable',
      `the head revision '${headSha}' is not a commit in this checkout — ${HINT}`,
    );
  }
  const head = git(['rev-parse', '--verify', '--quiet', 'HEAD^{commit}']);
  if (head.status !== 0 || head.stdout.trim() === '') {
    throw new CandidateRevisionError(
      'candidate_checkout_unavailable',
      `the current directory is not a git checkout with a commit, so the tested revision cannot be shown to be '${headSha}' — ${HINT}`,
    );
  }
  const claimedSha = claimed.stdout.trim();
  const headCommit = head.stdout.trim();
  if (claimedSha !== headCommit) {
    throw new CandidateRevisionError(
      'candidate_revision_mismatch',
      `the checkout is at ${headCommit}, but the evidence would name ${claimedSha} ('${headSha}'); the tests would run on one revision and attest to another — ${HINT}`,
    );
  }
  const changed = changedTrackedPaths(git);
  if (changed === null) {
    throw new CandidateRevisionError(
      'candidate_checkout_unavailable',
      'git status failed, so the checkout cannot be shown to equal the head revision',
    );
  }
  const bound = boundRepoPaths(git, input.boundPaths);
  const unbound = [...new Set(changed)].filter((p) => !bound.has(p)).sort();
  if (unbound.length > 0) {
    const shown = unbound.slice(0, 5).join(', ') + (unbound.length > 5 ? ', …' : '');
    throw new CandidateRevisionError(
      'candidate_worktree_modified',
      `${String(unbound.length)} tracked file(s) differ from ${claimedSha} (${shown}); the tests would run on uncommitted changes the evidence does not name — commit them, or discard them before running`,
    );
  }
  return claimedSha;
}
