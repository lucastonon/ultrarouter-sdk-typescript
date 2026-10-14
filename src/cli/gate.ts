/// <reference types="node" />
/**
 * `ur bench run` — pure gate helpers. Exit-code + `--json` + summary-table logic
 * kept IO-free so it is unit-testable without a process/network. The gate contract:
 * exit 0 on `pass`, exit 2 on `fail`/`inconclusive` (`--allow-inconclusive` opts an inconclusive out
 * to 0), and fail CLOSED (exit 2) on any API/pipeline error — a broken gate is never silently green.
 *
 * Extends this module with the APPLICATION-CI evidence contract (content-addressed
 * pinning), staleness detection, and the fail-closed conclusion/headline MAPPING — the quality
 * verdict still comes from the SAME gate path above (no second verdict engine is invented). The
 * node:crypto hash is CLI-only (this module is imported ONLY by `run.ts` + `cli/index.ts`, never by
 * the edge-portable SDK core `src/index.ts`).
 */

import { createHash } from 'node:crypto';

import type { BenchCompareGate } from '../types.js';
import type { ApplicationSummary } from './app-harness.js';
import type { CoverageLabel, SurfaceKind } from './detect.js';

/** The CLI exit codes. */
export const EXIT = {
  /** The gate passed (both quality + cost cleared their bars, no ceiling breach). */
  PASS: 0,
  /** A usage/argument error (bad flags) — never a pass, but distinct from a gate failure. */
  USAGE: 1,
  /** A gate `fail`/`inconclusive`, OR any API/pipeline error (fail closed). */
  GATE: 2,
} as const;

/** The versioned `--json` schema tag (snapshot-tested; bump on any structural change). */
export const GATE_JSON_SCHEMA = 'ur.bench.gate.v1' as const;

/** A resolved `--baseline <ref>` — compare mode + an optional concrete baseline run id. */
export interface ResolvedBaseline {
  readonly compare: boolean;
  /** A concrete `br_*` baseline run id, or undefined ⇒ use the suite's pinned baseline. */
  readonly baselineRunId: string | undefined;
  /** The raw ref as passed (for the JSON/table provenance). */
  readonly ref: string | null;
}

/**
 * Resolve the `--baseline <ref>` argument. A ref that looks like a concrete run id
 * (`br_…`) compares against THAT run; any other ref (e.g. a symbolic `bench:main`) compares against
 * the suite's PINNED baseline (the ref is recorded as provenance). Absent ⇒ not a compare run.
 */
export function resolveBaseline(ref: string | undefined): ResolvedBaseline {
  if (ref === undefined || ref.trim() === '') {
    return { compare: false, baselineRunId: undefined, ref: null };
  }
  const trimmed = ref.trim();
  if (trimmed.startsWith('br_')) {
    return { compare: true, baselineRunId: trimmed, ref: trimmed };
  }
  return { compare: true, baselineRunId: undefined, ref: trimmed };
}

/** The tri-state a gate can carry, plus the CLI-only `error` state for a fail-closed pipeline error. */
export type GateVerdict = 'pass' | 'fail' | 'inconclusive' | 'error';

/** Map a gate verdict to an exit code. `inconclusive` exits 2 unless `--allow-inconclusive`. */
export function exitCodeFor(verdict: GateVerdict, allowInconclusive: boolean): number {
  if (verdict === 'pass') return EXIT.PASS;
  if (verdict === 'inconclusive' && allowInconclusive) return EXIT.PASS;
  return EXIT.GATE; // fail / inconclusive / error ⇒ fail closed
}

/** The versioned `--json` result (snapshot-tested via {@link buildGateJson}). */
export interface GateJson {
  readonly schema: typeof GATE_JSON_SCHEMA;
  readonly suite: string;
  readonly run_tag: string;
  readonly bench_run_id: string | null;
  readonly baseline_run_id: string | null;
  readonly baseline_ref: string | null;
  readonly compare: boolean;
  readonly verdict: GateVerdict;
  readonly exit_code: number;
  readonly allow_inconclusive: boolean;
  /** The full server gate object (null on a pipeline error before the gate was read). */
  readonly gate: BenchCompareGate | null;
  /** A machine-readable error message when `verdict === 'error'`, else null. */
  readonly error: string | null;
}

/** Build the versioned `--json` object. PURE — snapshot-tested. */
export function buildGateJson(input: {
  suite: string;
  runTag: string;
  benchRunId: string | null;
  baseline: ResolvedBaseline;
  verdict: GateVerdict;
  allowInconclusive: boolean;
  gate: BenchCompareGate | null;
  error?: string | null;
}): GateJson {
  return {
    schema: GATE_JSON_SCHEMA,
    suite: input.suite,
    run_tag: input.runTag,
    bench_run_id: input.benchRunId,
    baseline_run_id: input.gate?.baseline_run_id ?? input.baseline.baselineRunId ?? null,
    baseline_ref: input.baseline.ref,
    compare: input.baseline.compare,
    verdict: input.verdict,
    exit_code: exitCodeFor(input.verdict, input.allowInconclusive),
    allow_inconclusive: input.allowInconclusive,
    gate: input.gate,
    error: input.error ?? null,
  };
}

/** A verdict → glyph for the human-readable summary. */
function glyph(v: string): string {
  return v === 'pass' ? '✓' : v === 'fail' ? '✗' : v === 'error' ? '‼' : '≈';
}

/** Format a µUSD figure as a labeled USD string. */
function usd(microUsd: number | null): string {
  if (microUsd === null) return 'n/a';
  return `$${(microUsd / 1_000_000).toFixed(6)}`;
}

/**
 * Render the human-readable summary table for a gate. Inversion/degradation rows are
 * FIRST-CLASS: the pairing census (eligible / ineligible / unpaired) and any cost-ceiling breach are
 * always shown so a degraded-toward-inconclusive result is never mistaken for a clean pass. PURE.
 */
export function renderGateTable(json: GateJson): string {
  const L: string[] = [];
  L.push(`ultrarouter bench gate — suite '${json.suite}' @ ${json.run_tag}`);
  L.push(
    `  run ${json.bench_run_id ?? 'n/a'} vs baseline ${json.baseline_run_id ?? '(none)'}` +
      `${json.baseline_ref !== null && json.baseline_ref !== json.baseline_run_id ? ` [ref ${json.baseline_ref}]` : ''}`,
  );
  if (json.gate === null) {
    L.push(
      `  ${glyph(json.verdict)} ${json.verdict.toUpperCase()}${json.error ? ` — ${json.error}` : ''}`,
    );
    L.push(`  exit ${String(json.exit_code)}`);
    return L.join('\n');
  }
  for (const ct of json.gate.call_types) {
    L.push('');
    L.push(`  ${glyph(ct.verdict)} ${ct.call_type_id}: ${ct.verdict.toUpperCase()}`);
    L.push(
      `      quality ${ct.quality} [${ct.quality_interval.low.toFixed(4)}, ${ct.quality_interval.high.toFixed(4)}] ` +
        `vs bar ${ct.quality_interval.bar.toFixed(4)} (Δ ${ct.quality_margin_pp.toFixed(1)}pp; MDE ${ct.mde_pp.toFixed(2)}pp)`,
    );
    L.push(
      `      cost    ${ct.cost} [${ct.cost_interval.low.toFixed(4)}, ${ct.cost_interval.high.toFixed(4)}] ` +
        `vs bar ${ct.cost_interval.bar.toFixed(4)}`,
    );
    if (ct.cost_ceiling.enabled) {
      L.push(
        `      ceiling ${ct.cost_ceiling.breached ? 'BREACHED' : 'ok'}: observed ` +
          `${usd(ct.cost_ceiling.observed_mean_micro_usd)} vs ${usd(ct.cost_ceiling.ceiling_micro_usd)}`,
      );
    }
    L.push(
      `      pairs   ${String(ct.pairing.eligible_pairs)} eligible / ${String(ct.pairing.ineligible_missing_artifact)} missing-artifact / ` +
        `${String(ct.pairing.unpaired)} unpaired (${String(ct.pairing.eligible_clusters)} clusters)`,
    );
    if (ct.reasons.length > 0) L.push(`      reasons ${ct.reasons.join(', ')}`);
  }
  L.push('');
  L.push(
    `  ${glyph(json.verdict)} OVERALL ${json.verdict.toUpperCase()} — exit ${String(json.exit_code)}`,
  );
  return L.join('\n');
}

// ─── application-CI evidence contract, staleness, fail-closed mapping ───────────────

/**
 * The content-addressed EVIDENCE CONTRACT for one workflow. It pins every
 * BOUND input of an application-CI result: repository, base/head commit, dependency-lock digest,
 * app-harness + configuration hashes, dataset split, workflow, objective, evaluator version and
 * evidence epoch. Two results are comparable ONLY when their contract hashes match; any bound-input
 * change (including configuration changes OUTSIDE Git) yields a new hash ⇒ the prior check is stale.
 */
export interface EvidenceContract {
  readonly repository: string;
  readonly baseSha: string;
  readonly headSha: string;
  readonly lockDigest: string;
  readonly harnessHash: string;
  readonly configHash: string;
  readonly datasetSplit: string;
  readonly workflowId: string;
  readonly objective: string;
  readonly evaluatorVersion: string;
  readonly evidenceEpoch: string;
  /**
   * The IMMUTABLE flywheel-candidate reference bound into this evidence, when one is.
   * OPTIONAL by design — {@link canonicalJson} drops `undefined`, so a plain run (no
   * candidate) hashes BYTE-IDENTICALLY to a contract that never had the field. Binding a candidate is therefore a
   * new evidence object rather than a silent re-interpretation of an existing one, and the gateway
   * recomputes the same address from the same field set.
   */
  readonly candidateRef?: string | undefined;
}

/** Deterministic, key-sorted JSON for content addressing (stable across key insertion order). PURE. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
}

/** SHA-256 hex of a string (CLI-only). PURE (deterministic; no IO). */
export function sha256Hex(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

/** The content address (sha256 of canonical JSON) of an evidence contract. PURE. */
export function hashEvidenceContract(contract: EvidenceContract): string {
  return sha256Hex(canonicalJson(contract));
}

/**
 * Staleness: a result is STALE when the evidence it was SEALED against (`assertedHash`)
 * differs from the CURRENT contract hash. A stale result is re-marked `needs_evidence` — never left
 * green. `assertedHash === null` ⇒ nothing was pinned ⇒ not stale (a fresh run pins the current one).
 */
export function isStaleEvidence(assertedHash: string | null, currentHash: string): boolean {
  return assertedHash !== null && assertedHash !== currentHash;
}

/** The four application-CI display headlines (`needs_configuration` is the advisory one). */
export type Headline =
  'ready_for_rollout' | 'needs_evidence' | 'regression_found' | 'needs_configuration';

/** The human-readable headline text (the exact strings shown in the PR comment and Check Run). */
export const HEADLINE_TEXT: Readonly<Record<Headline, string>> = {
  ready_for_rollout: 'Ready for controlled rollout',
  needs_evidence: 'Needs evidence',
  regression_found: 'Regression found',
  needs_configuration: 'Needs configuration',
} as const;

/**
 * The Check Run conclusion vocabulary we use (fail-closed). We NEVER emit `neutral`:
 * GitHub treats a required check with conclusion `success`, `neutral` or `skipped` as PASSING for
 * branch protection, and `failure`/`action_required`/`cancelled`/`timed_out` as FAILING. So missing
 * evidence maps to `action_required` (a non-success that DOES block), never `neutral` (which would
 * silently satisfy branch protection), per GitHub's documented branch-protection behaviour.
 */
export type AppCheckConclusion = 'success' | 'failure' | 'action_required';

/** True iff a conclusion counts as PASSING a required branch-protection check (only `success`). */
export function conclusionPasses(conclusion: AppCheckConclusion): boolean {
  return conclusion === 'success';
}

/** The next-action copy per headline (the comment's "next action" line). */
const NEXT_ACTION: Readonly<Record<Headline, string>> = {
  ready_for_rollout:
    'Start a controlled rollout (permissions, consent, budget + frozen baseline apply).',
  regression_found: 'Fix the regression and push a new commit — the check re-runs on the new head.',
  needs_evidence:
    'Provide the missing evidence (see reasons) and re-run; missing evidence cannot satisfy branch protection.',
  needs_configuration:
    'Map the changed paths to a workflow surface in your ur app-ci config, then re-run.',
} as const;

/** The immutable per-workflow application-CI outcome (the publication + `--json` unit). */
export interface WorkflowOutcome {
  readonly workflowId: string;
  readonly headline: Headline;
  readonly conclusion: AppCheckConclusion;
  readonly coverage: CoverageLabel | null;
  readonly surfaces: readonly SurfaceKind[];
  /** AGGREGATE-only application summary (never raw/sealed cases) — safe for the comment/check. */
  readonly application: ApplicationSummary | null;
  readonly gate: BenchCompareGate | null;
  readonly gateVerdict: GateVerdict | null;
  readonly evidenceHash: string;
  readonly stale: boolean;
  readonly reasons: readonly string[];
  readonly nextAction: string;
  readonly evidenceUrl: string | null;
}

/** The inputs to the fail-closed decision (all already computed; this function does NO IO). */
export interface DecideWorkflowInput {
  readonly workflowId: string;
  readonly surfaces: readonly SurfaceKind[];
  readonly application: ApplicationSummary | null;
  readonly gate: BenchCompareGate | null;
  readonly evidenceHash: string;
  readonly stale: boolean;
  /** Fork-PR mode: the untrusted harness is NEVER executed here ⇒ detection + comment-only. */
  readonly fork: boolean;
  readonly allowInconclusive: boolean;
  readonly evidenceUrl?: string | null;
  /**
   * A NAMED offline-replay failure (e.g. `gate_error`, `missing_evaluator`) when a bound gate could
   * not be read/completed. Distinct from a `null` gate (no bound suite): a gate ERROR fails closed to
   * `needs_evidence`, it never counts as "no gate → ok".
   */
  readonly gateError?: string | null;
}

/**
 * Map an application-CI workflow to its headline + FAIL-CLOSED Check Run conclusion. The
 * order encodes the contract: `success` (Ready for controlled rollout) requires the FULL configured
 * contract — mapped surfaces, fresh (non-stale) evidence, executed application coverage, a passed
 * candidate application test AND (when a suite is bound) a `pass` quality gate. Everything else is a
 * NAMED non-success: a candidate application-test failure or a `fail` gate is `Regression found`
 * (`failure`); a missing/flaky/uncovered/stale/fork result is `Needs evidence` (`action_required`).
 * A `model_call_only` coverage can NEVER render the application-level success headline.
 */
export function decideWorkflowOutcome(input: DecideWorkflowInput): WorkflowOutcome {
  const gateVerdict: GateVerdict | null =
    input.gate === null ? null : (input.gate.verdict as GateVerdict);
  const base = {
    workflowId: input.workflowId,
    coverage: input.application?.coverage ?? null,
    surfaces: input.surfaces,
    application: input.application,
    gate: input.gate,
    gateVerdict,
    evidenceHash: input.evidenceHash,
    stale: input.stale,
    evidenceUrl: input.evidenceUrl ?? null,
  } as const;
  const decide = (
    headline: Headline,
    conclusion: AppCheckConclusion,
    reasons: readonly string[],
  ): WorkflowOutcome => ({
    ...base,
    headline,
    conclusion,
    reasons,
    nextAction: NEXT_ACTION[headline],
  });

  // 1. Stale evidence — any bound-input change invalidates a prior verdict (never left green).
  if (input.stale) return decide('needs_evidence', 'action_required', ['stale_evidence']);

  // 2. Fork PRs never execute their code with secrets here — detection + comment-only ⇒ Needs evidence.
  if (input.fork) return decide('needs_evidence', 'action_required', ['fork_no_execution']);

  // 3. No application evidence at all ⇒ Needs evidence (never success by omission).
  if (input.application === null)
    return decide('needs_evidence', 'action_required', ['no_application_evidence']);

  const app = input.application;
  const namedNonSuccess: readonly string[] = [
    'missing_secret',
    'missing_evaluator',
    'no_replay',
    'flaky',
    'error',
  ];

  // 4. A NAMED harness non-success on either revision ⇒ Needs evidence (never success by omission).
  if (namedNonSuccess.includes(app.candidateOutcome))
    return decide('needs_evidence', 'action_required', [`candidate_${app.candidateOutcome}`]);
  if (namedNonSuccess.includes(app.baselineOutcome))
    return decide('needs_evidence', 'action_required', [`baseline_${app.baselineOutcome}`]);

  // 5. A candidate application-test FAILURE (baseline established) ⇒ Regression found (blocks).
  if (app.candidateOutcome === 'failed')
    return decide('regression_found', 'failure', ['application_test_failed']);

  // 6a. A NAMED offline-replay failure (unreadable gate / missing evaluator) ⇒ Needs evidence.
  if (input.gateError !== undefined && input.gateError !== null)
    return decide('needs_evidence', 'action_required', [input.gateError]);

  // 6. A `fail` quality gate ⇒ Regression found; an inconclusive gate ⇒ Needs evidence (unless opted).
  if (gateVerdict === 'fail')
    return decide('regression_found', 'failure', [...(input.gate?.reasons ?? []), 'gate_fail']);
  if (gateVerdict === 'inconclusive' && !input.allowInconclusive)
    return decide('needs_evidence', 'action_required', ['gate_inconclusive']);

  // 7. A raw model-call comparison can never CLAIM application coverage ⇒ Needs evidence.
  if (app.coverage === 'model_call_only')
    return decide('needs_evidence', 'action_required', ['model_call_only_no_application_coverage']);

  // 8. The full configured contract passed ⇒ Ready for controlled rollout (the ONLY success).
  const gateOk =
    gateVerdict === null ||
    gateVerdict === 'pass' ||
    (gateVerdict === 'inconclusive' && input.allowInconclusive);
  if (app.candidateOutcome === 'passed' && app.coverage === 'application' && gateOk)
    return decide('ready_for_rollout', 'success', []);

  // 9. Anything else ⇒ fail-closed Needs evidence.
  return decide('needs_evidence', 'action_required', ['incomplete_contract']);
}

/**
 * The advisory `Needs configuration` outcome for the unmapped-changes detection surface.
 * It is a distinct non-success check (`action_required`) so an unknown/unmapped change can never
 * silently pass branch protection; its evidence hash addresses the unmapped path list.
 */
export function needsConfigurationOutcome(unmapped: readonly string[]): WorkflowOutcome {
  return {
    workflowId: '__config__',
    headline: 'needs_configuration',
    conclusion: 'action_required',
    coverage: null,
    surfaces: [],
    application: null,
    gate: null,
    gateVerdict: null,
    evidenceHash: sha256Hex(canonicalJson({ unmapped: [...unmapped].sort() })),
    stale: false,
    reasons: unmapped.map((p) => `unmapped:${p}`).slice(0, 10),
    nextAction: NEXT_ACTION.needs_configuration,
    evidenceUrl: null,
  };
}

/** The overall CLI exit code: 0 iff EVERY outcome is `success`, else 2 (fail closed). PURE. */
export function overallExitCode(outcomes: readonly WorkflowOutcome[]): number {
  return outcomes.every((o) => conclusionPasses(o.conclusion)) ? EXIT.PASS : EXIT.GATE;
}
