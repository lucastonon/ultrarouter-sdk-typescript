// Generated file: vendored context runtime. Do not edit by hand.
/**
 * Transition language — **NEW in ultrarouter, not extracted from an earlier engine.**
 *
 * The earlier SOP compiler deliberately has NO transition member: its executable spec has
 * no home for one, and folding a transition rule into `stopConditions` would
 * misrepresent it as a budget. This module fills exactly that
 * gap with a typed, closed predicate language so branching is DATA, not prose — the
 * "dozens of SOPs that load themselves in branches" architecture.
 *
 * The predicate set is CLOSED: `artifact_present(contract)`,
 * `stop_condition(id)`, `budget_remaining(kind) > n`, and the `all(…)`/`any(…)`
 * combinators. An unknown predicate is a compile REFUSAL, never a pass-through
 * ({@link parsePredicate} fails ⇒ `SOP_PREDICATE_UNKNOWN`). Evaluation and rendering
 * are pure and deterministic — no clock, no RNG, no IO.
 */

import { z } from 'zod';

/**
 * A transition/applicability predicate. A CLOSED discriminated union — the ONLY
 * shapes the compiler admits. `all([])` is vacuously true (a SOP that always
 * applies); `any([])` is vacuously false.
 */
export type SopPredicate =
  | { readonly type: 'artifact_present'; readonly contract: string }
  | { readonly type: 'stop_condition'; readonly id: string }
  | { readonly type: 'budget_remaining'; readonly kind: string; readonly gt: number }
  | { readonly type: 'all'; readonly of: readonly SopPredicate[] }
  | { readonly type: 'any'; readonly of: readonly SopPredicate[] };

/** The closed set of predicate `type` discriminators (for docs + introspection). */
export const SOP_PREDICATE_TYPES = [
  'artifact_present',
  'stop_condition',
  'budget_remaining',
  'all',
  'any',
] as const;
export type SopPredicateType = (typeof SOP_PREDICATE_TYPES)[number];

const leafSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('artifact_present'), contract: z.string().min(1) }),
  z.object({ type: z.literal('stop_condition'), id: z.string().min(1) }),
  z.object({
    type: z.literal('budget_remaining'),
    kind: z.string().min(1),
    gt: z.number().int().nonnegative(),
  }),
]);

/**
 * The recursive zod schema for the closed predicate set. `z.lazy` carries the
 * recursion for `all`/`any`; anything outside the set fails to parse (⇒ the
 * `SOP_PREDICATE_UNKNOWN` refusal at compile time). Exported so a caller can
 * validate authoring input before it reaches {@link import('./compile.js').compileSop}.
 */
export const SopPredicateSchema: z.ZodType<SopPredicate> = z.lazy(() =>
  z.union([
    leafSchema,
    z.object({ type: z.literal('all'), of: z.array(SopPredicateSchema) }),
    z.object({ type: z.literal('any'), of: z.array(SopPredicateSchema) }),
  ]),
);

/** The result of validating one authoring predicate against the closed set. */
export type ParsePredicateResult =
  { readonly ok: true; readonly predicate: SopPredicate } | { readonly ok: false };

/** Validate an untrusted authoring value against the closed predicate set. Pure —
 * a value outside the set yields `{ ok: false }` (mapped to `SOP_PREDICATE_UNKNOWN`
 * by the compiler), NEVER a throw and NEVER a silent pass-through. */
export function parsePredicate(value: unknown): ParsePredicateResult {
  const parsed = SopPredicateSchema.safeParse(value);
  return parsed.success ? { ok: true, predicate: parsed.data } : { ok: false };
}

/** The runtime state a predicate is evaluated against (pure `eligible` input). */
export interface SopRuntimeState {
  /** Artifact contracts already produced this run. */
  readonly artifacts: readonly string[];
  /** Stop conditions already reached this run. */
  readonly stopConditions: readonly string[];
  /** Remaining budget by kind (a missing kind is treated as 0 remaining). */
  readonly budgetsRemaining: Readonly<Record<string, number>>;
}

/** Evaluate a predicate against runtime state. Pure + total: `all([])` is true,
 * `any([])` is false, a missing budget kind is 0 remaining. */
export function evaluatePredicate(predicate: SopPredicate, state: SopRuntimeState): boolean {
  switch (predicate.type) {
    case 'artifact_present':
      return state.artifacts.includes(predicate.contract);
    case 'stop_condition':
      return state.stopConditions.includes(predicate.id);
    case 'budget_remaining':
      return (state.budgetsRemaining[predicate.kind] ?? 0) > predicate.gt;
    case 'all':
      return predicate.of.every((child) => evaluatePredicate(child, state));
    case 'any':
      return predicate.of.some((child) => evaluatePredicate(child, state));
  }
}

/** Render a predicate to the surface syntax — the exact strings the plan
 * names (`artifact_present(contract)`, `stop_condition(id)`, `budget_remaining(kind) > n`,
 * `all(…)`, `any(…)`). Deterministic; used by the descriptor's rendered `when`. */
export function renderPredicate(predicate: SopPredicate): string {
  switch (predicate.type) {
    case 'artifact_present':
      return `artifact_present(${predicate.contract})`;
    case 'stop_condition':
      return `stop_condition(${predicate.id})`;
    case 'budget_remaining':
      return `budget_remaining(${predicate.kind}) > ${String(predicate.gt)}`;
    case 'all':
      return `all(${predicate.of.map(renderPredicate).join(', ')})`;
    case 'any':
      return `any(${predicate.of.map(renderPredicate).join(', ')})`;
  }
}
