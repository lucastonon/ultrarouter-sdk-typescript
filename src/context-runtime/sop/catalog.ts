// Generated file: vendored context runtime. Do not edit by hand.
/**
 * Catalog + the pure `eligible` selector. The catalog is the compact plane the
 * model plans against: every compiled SOP contributes only its ≈60-token descriptor,
 * never its body. `eligible(specs, state)` is the pure branch
 * selector — it evaluates each SOP's applicability predicate against runtime state and
 * returns the admissible ids; the model then CHOOSES among the admissible descriptors,
 * it never invents a branch (branching is data, not prose).
 */

import { describe, describeTokenEstimate } from './descriptor.js';
import { evaluatePredicate, type SopRuntimeState } from './predicates.js';
import type { ExecutableSopSpec } from './spec.js';

/** One catalog entry: a SOP's id + its rendered descriptor + the descriptor's token
 * estimate (chars/4). No body. */
export interface SopCatalogEntry {
  readonly id: string;
  readonly descriptor: string;
  readonly tokenEstimate: number;
}

/** The compact planning catalog for a set of compiled SOPs. */
export interface SopCatalog {
  readonly entries: readonly SopCatalogEntry[];
  /** Sum of the entries' chars/4 token estimates — the ≤ 2,000-token planning budget. */
  readonly totalTokenEstimate: number;
}

/** Build the compact descriptor catalog for a set of compiled specs. Pure; loads NO
 * bodies (the descriptor is rendered from the spec's structure alone). */
export function catalog(specs: readonly ExecutableSopSpec[]): SopCatalog {
  const entries = specs.map((spec) => ({
    id: spec.id,
    descriptor: describe(spec),
    tokenEstimate: describeTokenEstimate(spec),
  }));
  const totalTokenEstimate = entries.reduce((sum, entry) => sum + entry.tokenEstimate, 0);
  return { entries, totalTokenEstimate };
}

/** The admissible SOP ids for the current runtime state — each spec whose
 * applicability predicate holds. Pure + deterministic; returns ids in `specs` order.
 * Loads NO bodies (planning reads descriptors/predicates only). */
export function eligible(
  specs: readonly ExecutableSopSpec[],
  state: SopRuntimeState,
): readonly string[] {
  return specs
    .filter((spec) => evaluatePredicate(spec.applicability, state))
    .map((spec) => spec.id);
}
