/**
 * Starter verifier helpers: turn a check you can compute (a test suite, a command's exit code, a
 * function over the final state) into a `pass` / `fail` / `unknown` verdict plus an evidence hash.
 * Only the hash is ever sent; the evidence stays in your process.
 */

import { canonicalJson } from '../context-runtime/_core/canonical-json.js';
import { sha256Hex } from '../diff-stats.js';
import type { OutcomeVerdict } from '../outcome-report.js';

/** A verdict with the hash of its evidence and the local reasons behind it. */
export interface VerifierVerdict {
  /** The verdict. */
  verdict: OutcomeVerdict;
  /** `sha256:<hex>` over the canonical JSON of the evidence, or `null` when there is none. */
  evidenceHash: string | null;
  /** Why, in short machine-readable phrases (kept local; never sent). */
  reasons: string[];
}

/** What a check function may return: a boolean, or a result with evidence and reasons. */
export interface CheckResult {
  /** Whether the task passed. */
  pass: boolean;
  /** The evidence behind it (hashed, never sent). */
  evidence?: unknown;
  /** Why, in short phrases. */
  reasons?: string[] | undefined;
}

/** Options for {@link runVerifier}. */
export interface RunVerifierOptions {
  /**
   * The verdict when the check itself throws: `unknown` (default; a crashed verifier is not
   * evidence the task failed, so nothing is reported) or `fail` (for test suites whose failing
   * assertions throw).
   */
  onError?: 'unknown' | 'fail' | undefined;
}

/** `sha256:` + the hex SHA-256 of the canonical JSON of `value` (keys sorted recursively). */
export function evidenceHash(value: unknown): string {
  return `sha256:${sha256Hex(canonicalJson(value))}`;
}

/**
 * Run a check and turn its answer into a {@link VerifierVerdict}. The check returns `true` /
 * `false`, or a {@link CheckResult} with the evidence to hash. A thrown error yields `unknown`
 * (or `fail` with `onError: 'fail'`).
 */
export async function runVerifier(
  check: () => boolean | CheckResult | Promise<boolean | CheckResult>,
  options: RunVerifierOptions = {},
): Promise<VerifierVerdict> {
  let answer: boolean | CheckResult;
  try {
    answer = await check();
  } catch (err) {
    const name = err instanceof Error ? err.name : 'error';
    if (options.onError === 'fail') {
      return {
        verdict: 'fail',
        evidenceHash: evidenceHash({ error: name }),
        reasons: ['check_threw'],
      };
    }
    return { verdict: 'unknown', evidenceHash: null, reasons: ['verifier_error'] };
  }
  if (typeof answer === 'boolean') {
    return { verdict: answer ? 'pass' : 'fail', evidenceHash: null, reasons: [] };
  }
  if (typeof answer !== 'object' || answer === null || typeof answer.pass !== 'boolean') {
    return { verdict: 'unknown', evidenceHash: null, reasons: ['check_returned_no_verdict'] };
  }
  return {
    verdict: answer.pass ? 'pass' : 'fail',
    evidenceHash: answer.evidence === undefined ? null : evidenceHash(answer.evidence),
    reasons: [...(answer.reasons ?? [])],
  };
}

/** The result of a command you ran (for example a test suite through `child_process`). */
export interface CommandResult {
  /** The exit code, or `null` when the process was killed by a signal. */
  exitCode: number | null;
  /** The signal that killed it, if any. */
  signal?: string | null | undefined;
  /** Its standard output (hashed, never sent). */
  stdout?: string | undefined;
  /** Its standard error (hashed, never sent). */
  stderr?: string | undefined;
}

/**
 * A command's verdict: exit code `0` passes, any other exit code fails, and a process killed by a
 * signal (no exit code) is `unknown`. The evidence hash covers the exit code and both outputs.
 */
export function verdictFromCommand(result: CommandResult): VerifierVerdict {
  const evidence = {
    exit_code: result.exitCode,
    signal: result.signal ?? null,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
  if (result.exitCode === null) {
    return {
      verdict: 'unknown',
      evidenceHash: evidenceHash(evidence),
      reasons: [`killed_by_${result.signal ?? 'signal'}`],
    };
  }
  return {
    verdict: result.exitCode === 0 ? 'pass' : 'fail',
    evidenceHash: evidenceHash(evidence),
    reasons: result.exitCode === 0 ? [] : [`exit_code_${String(result.exitCode)}`],
  };
}
