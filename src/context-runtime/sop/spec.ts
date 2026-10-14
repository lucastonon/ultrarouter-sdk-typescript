// Generated file: vendored context runtime. Do not edit by hand.
/**
 * `ExecutableSopSpec` — the typed, immutable executable specification a
 * reviewed SOP compiles to. Extracted from an earlier SOP compiler (the
 * two-digest design, the content-only `compiledHash` idempotent across re-reviews,
 * the review-identity `provenanceHash`), generalized in two ways declared as NEW:
 *
 *   1. dependency kinds gain `SOP` (a SOP may pin another SOP) — the
 *      `{POLICY|PACKET|RUBRIC|SOP}` set;
 *   2. the spec carries the NEW transition language (`applicability` + `transitions`,
 *      `./predicates.ts`) and a per-phase `mandatory` flag (for the mandatory-only
 *      fallback) — neither exists in the earlier source.
 *
 * Hashing reuses the context package's ONE content digest (`../hash.js#hashContextValue`
 * = the canonical JSON + sha256), never a forked serializer.
 */

import { hashContextValue } from '../hash.js';

import type { SopPredicate } from './predicates.js';

/** Contract token stamped into every digest subject (spec identity). */
export const EXECUTABLE_SOP_SPEC_CONTRACT = 'ultrarouter/executable-sop-spec/v1';

/** SOP dependency kinds. `SOP` is NEW in this runtime (a SOP may pin another SOP). */
export const SOP_DEPENDENCY_KINDS = ['POLICY', 'PACKET', 'RUBRIC', 'SOP'] as const;
export type SopDependencyKind = (typeof SOP_DEPENDENCY_KINDS)[number];

/** One resolved dependency of a compiled SOP. */
export interface SopDependency {
  readonly id: string;
  readonly kind: SopDependencyKind;
  /** Lower-case hex SHA-256 of the dependency's pinned content. */
  readonly contentHash: string;
  /** Ids this dependency itself pins (its own closure edges). */
  readonly dependsOn: readonly string[];
}

/** One phase of a compiled SOP. Phase ORDER is the execution sequence; everything
 * WITHIN a phase is a sorted set so authorings differing only by list order compile
 * to the same digest. */
export interface ExecutableSopPhase {
  readonly id: string;
  /** True ⇒ the phase runs regardless of the planner budget (the mandatory-only
   * fallback keeps these). NEW in this runtime. */
  readonly mandatory: boolean;
  /** Canonical action names, sorted. Nothing else may be called in this phase. */
  readonly allowedActionNames: readonly string[];
  /** Policy ids the phase requires, sorted. Each must be in the dependency closure. */
  readonly requiredPolicyIds: readonly string[];
  /** Numeric budgets, by key. */
  readonly budgets: Readonly<Record<string, number>>;
  /** Deterministic stop conditions, sorted. */
  readonly stopConditions: readonly string[];
  /** Artifact contracts the phase must emit, sorted. */
  readonly artifactContracts: readonly string[];
}

/** One typed transition edge of the NEW transition language: `from` phase → `to`
 * phase, taken `when` the (closed-set) predicate holds. */
export interface SopTransition {
  readonly from: string;
  readonly to: string;
  readonly when: SopPredicate;
}

/** The compiled, immutable spec. Only {@link import('./compile.js').compileSop}
 * constructs one. */
export interface ExecutableSopSpec {
  readonly contract: typeof EXECUTABLE_SOP_SPEC_CONTRACT;
  readonly id: string;
  readonly version: string;
  readonly inputSchemaHash: string;
  readonly outputSchemaHash: string;
  /** When this SOP is admissible (the descriptor's rendered `when`; the `eligible`
   * selector reads it). Part of the compiled content. */
  readonly applicability: SopPredicate;
  readonly phases: readonly ExecutableSopPhase[];
  /** The typed transition graph (checked acyclic at compile, separately from the
   * dependency graph). */
  readonly transitions: readonly SopTransition[];
  /** The full dependency closure, sorted by id. */
  readonly dependencies: readonly SopDependency[];
  /** Digest of the natural-language prose this compiled from. */
  readonly proseHash: string;
  readonly compiledHash: string;
  readonly reviewedBy: string;
  readonly reviewedAt: string;
  /** Digest of {@link ExecutableSopSpec.compiledHash} plus the review identity. */
  readonly provenanceHash: string;
}

/** The content-only projection `compiledHash` is taken over — identity, schema
 * hashes, the applicability predicate, the ordered phases, the sorted transitions and
 * the sorted dependency closure. Excludes `reviewedBy`/`reviewedAt`, so recompiling
 * the same reviewed prose is idempotent. */
export interface CompiledContent {
  readonly id: string;
  readonly version: string;
  readonly inputSchemaHash: string;
  readonly outputSchemaHash: string;
  readonly proseHash: string;
  readonly applicability: SopPredicate;
  readonly phases: readonly ExecutableSopPhase[];
  readonly transitions: readonly SopTransition[];
  readonly dependencies: readonly SopDependency[];
}

function compiledDigestSubject(content: CompiledContent): unknown {
  return {
    contract: EXECUTABLE_SOP_SPEC_CONTRACT,
    id: content.id,
    version: content.version,
    inputSchemaHash: content.inputSchemaHash,
    outputSchemaHash: content.outputSchemaHash,
    proseHash: content.proseHash,
    applicability: content.applicability,
    phases: content.phases.map((phase) => ({
      id: phase.id,
      mandatory: phase.mandatory,
      allowedActionNames: [...phase.allowedActionNames],
      requiredPolicyIds: [...phase.requiredPolicyIds],
      budgets: { ...phase.budgets },
      stopConditions: [...phase.stopConditions],
      artifactContracts: [...phase.artifactContracts],
    })),
    transitions: content.transitions.map((transition) => ({
      from: transition.from,
      to: transition.to,
      when: transition.when,
    })),
    dependencies: content.dependencies.map((dependency) => ({
      id: dependency.id,
      kind: dependency.kind,
      contentHash: dependency.contentHash,
      dependsOn: [...dependency.dependsOn],
    })),
  };
}

/** Digest of the content only. Idempotent across re-reviews of the same prose. */
export function computeCompiledHash(content: CompiledContent): string {
  return hashContextValue(compiledDigestSubject(content));
}

/** Digest of the content digest plus the review identity ("who approved these exact
 * bytes, and when" — itself content-addressed). */
export function computeProvenanceHash(init: {
  readonly compiledHash: string;
  readonly reviewedBy: string;
  readonly reviewedAt: string;
}): string {
  return hashContextValue({
    contract: `${EXECUTABLE_SOP_SPEC_CONTRACT}#provenance`,
    compiledHash: init.compiledHash,
    reviewedBy: init.reviewedBy,
    reviewedAt: init.reviewedAt,
  });
}
