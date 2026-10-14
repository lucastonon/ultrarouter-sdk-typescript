// Generated file: vendored context runtime. Do not edit by hand.
/**
 * Fallbacks — typed refusals with a NEXT STEP, emitted as MANIFEST ENTRIES so
 * they are visible in the ledger and learnable ("every fallback is
 * a manifest entry"). Two are specified:
 *
 *   - `PLANNER_BOUND_EXCEEDED` → drop to the MANDATORY-ONLY manifest and continue
 *     ({@link mandatoryOnlyManifest} — only the phases marked `mandatory`).
 *   - `REQUIRED_CONTEXT_MISSING` → the phase cannot run; emit a NAMED gap artifact —
 *     "what this run could not observe", a value a gate can read
 *     ({@link gapArtifact}).
 *
 * The two codes are REUSED verbatim from the base context vocabulary
 * (`../refusals.ts#CONTEXT_REFUSAL_REASONS`), typed by {@link Extract} so a typo
 * cannot invent a code — never a fork. Pure data; no clock, no IO.
 */

import type { ContextRefusalReason } from '../refusals.js';

import type { ExecutableSopSpec } from './spec.js';

/** The mandatory-only fallback: when the planner bound is exceeded, run only the
 * phases that must always run. A manifest entry with a base-vocabulary code. */
export interface MandatoryOnlyManifest {
  readonly code: Extract<ContextRefusalReason, 'PLANNER_BOUND_EXCEEDED'>;
  readonly kind: 'mandatory_only';
  readonly sopId: string;
  readonly specHash: string;
  /** The mandatory phase ids, in execution order. */
  readonly phases: readonly string[];
  readonly reason: string;
}

/** The named gap artifact: a phase could not run because a required input was absent.
 * A manifest entry with a base-vocabulary code that a downstream gate can read. */
export interface GapArtifact {
  readonly code: Extract<ContextRefusalReason, 'REQUIRED_CONTEXT_MISSING'>;
  readonly kind: 'gap';
  readonly sopId: string;
  readonly specHash: string;
  /** The phase that could not run. */
  readonly phase: string;
  /** The required artifact/policy that was missing. */
  readonly missing: string;
  readonly reason: string;
}

/** Build the mandatory-only fallback manifest entry for a spec whose planner bound was
 * exceeded. Pure; keeps only the `mandatory` phases, in execution order. */
export function mandatoryOnlyManifest(
  spec: ExecutableSopSpec,
  reason = 'planner bound exceeded; dropped to the mandatory-only manifest',
): MandatoryOnlyManifest {
  return {
    code: 'PLANNER_BOUND_EXCEEDED',
    kind: 'mandatory_only',
    sopId: spec.id,
    specHash: spec.compiledHash,
    phases: spec.phases.filter((phase) => phase.mandatory).map((phase) => phase.id),
    reason,
  };
}

/** Build a named gap artifact for a phase that could not run because `missing` was
 * absent. Pure. */
export function gapArtifact(
  spec: ExecutableSopSpec,
  phase: string,
  missing: string,
  reason = `phase "${phase}" could not run: required "${missing}" was not observed`,
): GapArtifact {
  return {
    code: 'REQUIRED_CONTEXT_MISSING',
    kind: 'gap',
    sopId: spec.id,
    specHash: spec.compiledHash,
    phase,
    missing,
    reason,
  };
}
