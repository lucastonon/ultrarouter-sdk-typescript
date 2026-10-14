/**
 * `ur app-ci` — the customer APPLICATION harness runner. Runs the customer's
 * BASELINE and CANDIDATE application revisions through its OWN test/replay harness command
 * (tool/schema/context assembly included), in the customer's CI. IO is INJECTED (`prepareRevision`,
 * `runCommand`) so the flow is unit-/contract-testable against stub harness commands with no real
 * process/network; the CLI entry wires the real git-worktree + spawn with a SCRUBBED env.
 *
 * Trust boundary:
 * - The harness command + its stdout/structured output are UNTRUSTED input. This module NEVER
 * interpolates them into a shell (the entry passes the command to a shell exactly once, verbatim)
 * and NEVER echoes them into a comment beyond escaped, bounded, redacted excerpts.
 * - The harness runs WITHOUT platform publication secrets (the entry scrubs GITHUB_TOKEN etc.).
 * - Flaky tests, missing secrets, a missing evaluator or absent replay capability are NAMED
 * non-success outcomes — never success by omission.
 * - Sealed confirmation / holdout cases + labels are structurally EXCLUDED: {@link ApplicationSummary}
 * carries aggregates + capped redacted debug excerpts ONLY — there is no field for raw cases,
 * so they cannot leak into a comment or optimizer context (the verifier emits aggregates only).
 */

import type { CoverageLabel, WorkflowBinding } from './detect.js';
import { redactSecrets } from './redact.js';

/** A NAMED harness outcome — every non-success value is explicit (never success by omission). */
export type HarnessOutcome =
  'passed' | 'failed' | 'flaky' | 'missing_secret' | 'missing_evaluator' | 'no_replay' | 'error';

/** The customer harness's optional STRUCTURED output — parsed as UNTRUSTED, validated + capped. */
export interface HarnessStructuredOutput {
  /** An explicit named status (overrides the exit-code inference when valid). */
  readonly status?: HarnessOutcome;
  readonly coverage?: CoverageLabel;
  readonly sample?: number;
  readonly passed?: number;
  readonly failed?: number;
  readonly qualityPoint?: number;
  readonly qualityLow?: number;
  readonly qualityHigh?: number;
  readonly costUsd?: number;
  readonly latencyMs?: number;
  /** Free-text screening/debug failures — capped at 3 + redacted before they ever reach a comment. */
  readonly debugFailures?: readonly string[];
}

/** One revision's harness invocation result. */
export interface HarnessInvocation {
  readonly revision: 'baseline' | 'candidate';
  readonly sha: string | null;
  readonly exitCode: number | null;
  readonly outcome: HarnessOutcome;
  readonly parsed: HarnessStructuredOutput | null;
}

/**
 * The comment-/check-SAFE application summary (AGGREGATE ONLY). This is the ONLY application data
 * the publication path (`pr-comment.ts`) ever sees — it has NO field for raw cases or labels, so
 * sealed confirmation/holdout rows can never leak into a comment.
 */
export interface ApplicationSummary {
  readonly coverage: CoverageLabel;
  readonly baselineOutcome: HarnessOutcome;
  readonly candidateOutcome: HarnessOutcome;
  readonly sample: number | null;
  readonly passed: number | null;
  readonly failed: number | null;
  readonly qualityPoint: number | null;
  readonly qualityLow: number | null;
  readonly qualityHigh: number | null;
  readonly costUsd: number | null;
  readonly latencyMs: number | null;
  /** Up to 3 redacted, escaped screening/debug excerpts (never sealed cases). */
  readonly debugFailures: readonly string[];
}

/** Injected IO for {@link runWorkflowHarness} (the entry wires git-worktree + a scrubbed spawn). */
export interface AppHarnessDeps {
  /**
   * Materialise a revision's working tree (a `git worktree` for the baseline sha; the current tree
   * for the candidate) and return the cwd to run in. `null` ⇒ the revision cannot be prepared
   * (absent replay capability) ⇒ a NAMED `no_replay` outcome, never a silent pass.
   */
  readonly prepareRevision: (
    revision: 'baseline' | 'candidate',
    sha: string | null,
  ) => Promise<{ cwd: string } | null>;
  /**
   * Run the customer harness command with a SCRUBBED env (no platform publication secrets). The
   * command is passed verbatim to a shell exactly once; `env` is the intended vars only. Resolves
   * the exit code + the raw structured-output string (from `UR_APP_CI_OUTPUT` or stdout), UNTRUSTED.
   */
  readonly runCommand: (
    cmd: string,
    cwd: string,
    env: Record<string, string>,
  ) => Promise<{ exitCode: number; output: string | null }>;
  readonly log: (line: string) => void;
  readonly err: (line: string) => void;
}

/** Runtime conditions the orchestrator knows (fork ⇒ never exec; secrets ⇒ named missing_secret). */
export interface HarnessConditions {
  readonly baseSha: string | null;
  readonly headSha: string | null;
  /** False ⇒ the workspace/app secrets a harness needs are absent ⇒ NAMED `missing_secret`. */
  readonly secretsAvailable: boolean;
  /**
   * Extra env naming the BOUND flywheel candidate (its immutable reference + the
   * payload hash), so the customer's own harness can assemble the candidate context itself. It is
   * passed to the CANDIDATE revision ONLY — a baseline that could see the candidate would not be a
   * baseline, and that asymmetry is enforced here rather than left to the customer's command.
   */
  readonly candidateEnv?: Readonly<Record<string, string>>;
}

/** The per-workflow harness result (both revisions + the aggregate summary). */
export interface WorkflowHarnessResult {
  readonly workflowId: string;
  readonly baseline: HarnessInvocation;
  readonly candidate: HarnessInvocation;
  readonly summary: ApplicationSummary;
}

const DEBUG_FAILURE_CAP = 3;
const EXCERPT_MAX_CHARS = 200;

/**
 * Redact + bound one untrusted debug excerpt: remove every credential ({@link redactSecrets}: whole
 * `Authorization` / cookie / API-key values including their scheme, known token shapes, URL
 * passwords, emails), collapse whitespace, and truncate. Redaction runs BEFORE truncation, so a cut
 * can never expose the tail of a secret. HTML/markdown ESCAPING happens later in the renderer, which
 * also redacts the final comment body again.
 */
export function redactExcerpt(raw: string): string {
  const masked = redactSecrets(raw).replace(/\s+/g, ' ').trim();
  return masked.length > EXCERPT_MAX_CHARS ? `${masked.slice(0, EXCERPT_MAX_CHARS)}…` : masked;
}

/**
 * Parse the customer harness's structured output as UNTRUSTED. Accepts only known keys,
 * coerces numbers, caps `debugFailures` at 3 + redacts them, and validates `status`/`coverage`
 * against the closed vocabularies. Any parse error / non-object ⇒ `null` (fall back to the exit code).
 * There is deliberately NO path from raw per-case rows to the returned object.
 */
export function parseHarnessOutput(raw: string | null): HarnessStructuredOutput | null {
  if (raw === null) return null;
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  let obj: unknown;
  try {
    obj = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) return null;
  const o = obj as Record<string, unknown>;

  const num = (v: unknown): number | undefined =>
    typeof v === 'number' && Number.isFinite(v) ? v : undefined;
  const knownStatus: readonly HarnessOutcome[] = [
    'passed',
    'failed',
    'flaky',
    'missing_secret',
    'missing_evaluator',
    'no_replay',
    'error',
  ];
  const status =
    typeof o.status === 'string' && (knownStatus as readonly string[]).includes(o.status)
      ? (o.status as HarnessOutcome)
      : undefined;
  const coverage =
    o.coverage === 'application' || o.coverage === 'model_call_only'
      ? (o.coverage as CoverageLabel)
      : undefined;
  const debugFailures = Array.isArray(o.debugFailures)
    ? o.debugFailures
        .filter((x): x is string => typeof x === 'string')
        .slice(0, DEBUG_FAILURE_CAP)
        .map(redactExcerpt)
    : undefined;

  const sample = num(o.sample);
  const passed = num(o.passed);
  const failed = num(o.failed);
  const qualityPoint = num(o.qualityPoint);
  const qualityLow = num(o.qualityLow);
  const qualityHigh = num(o.qualityHigh);
  const costUsd = num(o.costUsd);
  const latencyMs = num(o.latencyMs);

  return {
    ...(status !== undefined ? { status } : {}),
    ...(coverage !== undefined ? { coverage } : {}),
    ...(sample !== undefined ? { sample } : {}),
    ...(passed !== undefined ? { passed } : {}),
    ...(failed !== undefined ? { failed } : {}),
    ...(qualityPoint !== undefined ? { qualityPoint } : {}),
    ...(qualityLow !== undefined ? { qualityLow } : {}),
    ...(qualityHigh !== undefined ? { qualityHigh } : {}),
    ...(costUsd !== undefined ? { costUsd } : {}),
    ...(latencyMs !== undefined ? { latencyMs } : {}),
    ...(debugFailures !== undefined ? { debugFailures } : {}),
  };
}

/** The POSIX numbers of the signals a harness is commonly terminated by (for `128 + n`). */
const SIGNAL_NUMBERS: Readonly<Record<string, number>> = {
  SIGHUP: 1,
  SIGINT: 2,
  SIGQUIT: 3,
  SIGILL: 4,
  SIGTRAP: 5,
  SIGABRT: 6,
  SIGBUS: 7,
  SIGFPE: 8,
  SIGKILL: 9,
  SIGUSR1: 10,
  SIGSEGV: 11,
  SIGUSR2: 12,
  SIGPIPE: 13,
  SIGALRM: 14,
  SIGTERM: 15,
  SIGXCPU: 24,
  SIGXFSZ: 25,
};

/**
 * The exit code of a finished child process. A process killed by a signal has no exit code; it
 * FAILED, and is reported the way a shell does (`128 + signal number`), never as `0`. A process
 * with neither (it could not be observed) is `1`. PURE.
 */
export function exitCodeOf(code: number | null, signal: string | null): number {
  if (code !== null) return code;
  if (signal !== null) return 128 + (SIGNAL_NUMBERS[signal] ?? 0);
  return 1;
}

/**
 * Infer a NAMED outcome from an exit code + the (validated) structured status. PURE.
 *
 * A self-reported status may NARROW a result (a clean exit that reports `flaky` or
 * `missing_evaluator` is that named outcome) but can never turn an unsuccessful process into a
 * pass: a non-zero exit (including a signal, see {@link exitCodeOf}) with a reported `passed` is
 * `failed` — tests that wrote a passing result before a later failure did not pass.
 */
export function outcomeFor(
  exitCode: number,
  parsed: HarnessStructuredOutput | null,
): HarnessOutcome {
  const reported = parsed?.status;
  if (exitCode !== 0) {
    return reported !== undefined && reported !== 'passed' ? reported : 'failed';
  }
  return reported ?? 'passed';
}

/**
 * Run one workflow's baseline + candidate through the customer harness. Fail-closed:
 * - fork/secretless run ⇒ the orchestrator does not call this (harness never exec'd);
 * - `!secretsAvailable` ⇒ a NAMED `missing_secret` invocation (no exec);
 * - `prepareRevision` null ⇒ a NAMED `no_replay` invocation (no exec).
 * Baseline + candidate share the SAME command + paired input cases + the registered evaluator.
 */
export async function runWorkflowHarness(
  deps: AppHarnessDeps,
  workflow: WorkflowBinding,
  conditions: HarnessConditions,
): Promise<WorkflowHarnessResult> {
  const named = (
    revision: 'baseline' | 'candidate',
    sha: string | null,
    outcome: HarnessOutcome,
  ): HarnessInvocation => ({ revision, sha, exitCode: null, outcome, parsed: null });

  if (!conditions.secretsAvailable) {
    deps.err(`ur app-ci: workflow '${workflow.id}' — required secrets absent (missing_secret).`);
    const baseline = named('baseline', conditions.baseSha, 'missing_secret');
    const candidate = named('candidate', conditions.headSha, 'missing_secret');
    return {
      workflowId: workflow.id,
      baseline,
      candidate,
      summary: summarise(workflow, baseline, candidate),
    };
  }

  const runOne = async (
    revision: 'baseline' | 'candidate',
    sha: string | null,
  ): Promise<HarnessInvocation> => {
    const prepared = await deps.prepareRevision(revision, sha);
    if (prepared === null) {
      deps.err(`ur app-ci: workflow '${workflow.id}' — cannot prepare ${revision} (no_replay).`);
      return named(revision, sha, 'no_replay');
    }
    deps.err(`ur app-ci: workflow '${workflow.id}' — running ${revision} harness…`);
    const { exitCode, output } = await deps.runCommand(workflow.testCommand, prepared.cwd, {
      UR_APP_CI_WORKFLOW: workflow.id,
      UR_APP_CI_REVISION: revision,
      // The bound candidate reaches the CANDIDATE revision only — never the baseline.
      ...(revision === 'candidate' ? (conditions.candidateEnv ?? {}) : {}),
    });
    const parsed = parseHarnessOutput(output);
    return { revision, sha, exitCode, outcome: outcomeFor(exitCode, parsed), parsed };
  };

  const baseline = await runOne('baseline', conditions.baseSha);
  const candidate = await runOne('candidate', conditions.headSha);
  return {
    workflowId: workflow.id,
    baseline,
    candidate,
    summary: summarise(workflow, baseline, candidate),
  };
}

/**
 * Fold both invocations into the AGGREGATE-only {@link ApplicationSummary}. Coverage is the
 * workflow's DECLARED coverage unless the harness explicitly (and validly) narrows it further to
 * `model_call_only` — a harness can never UP-claim `application` over a declared `model_call_only`.
 */
function summarise(
  workflow: WorkflowBinding,
  baseline: HarnessInvocation,
  candidate: HarnessInvocation,
): ApplicationSummary {
  const declared = workflow.coverage;
  const reported = candidate.parsed?.coverage ?? baseline.parsed?.coverage;
  // Narrowing only: a declared `application` may be reported down to `model_call_only`, never up.
  const coverage: CoverageLabel =
    declared === 'model_call_only' || reported === 'model_call_only'
      ? 'model_call_only'
      : 'application';
  const p = candidate.parsed;
  const pick = (v: number | undefined): number | null => (v === undefined ? null : v);
  const debug = (p?.debugFailures ?? baseline.parsed?.debugFailures ?? []).slice(
    0,
    DEBUG_FAILURE_CAP,
  );
  return {
    coverage,
    baselineOutcome: baseline.outcome,
    candidateOutcome: candidate.outcome,
    sample: pick(p?.sample),
    passed: pick(p?.passed),
    failed: pick(p?.failed),
    qualityPoint: pick(p?.qualityPoint),
    qualityLow: pick(p?.qualityLow),
    qualityHigh: pick(p?.qualityHigh),
    costUsd: pick(p?.costUsd),
    latencyMs: pick(p?.latencyMs),
    debugFailures: debug,
  };
}
