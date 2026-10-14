// Generated file: vendored context runtime. Do not edit by hand.
/**
 * Refusals. A refusal is the compiler's typed record of why a
 * candidate was not admitted (or why the whole run is inadmissible). Refusals are
 * pure data — no throw on the admission path — so a manifest can carry both what it
 * admitted AND what it refused, which is the ledger the flywheel and the witness read.
 *
 * The BASE SET below must exist verbatim. Each entry is BOTH a
 * generic reason the compiler emits AND the code the ultrarouter-default profile
 * renders. A parent profile maps the same reasons onto its OWN code vocabulary via
 * {@link defineRefusals} — a `CONTEXT_*`/`*_MISMATCH` family, or
 * availability refusals — so parity is "same reason, the parent's code string",
 * never a fork of the algorithm.
 */

import { z } from 'zod';

/**
 * The base refusal reasons (the closed generic vocabulary the compiler
 * emits). A profile's `encode` maps each onto the concrete code string it renders.
 */
export const CONTEXT_REFUSAL_REASONS = [
  'STAGE_CONTRACT_MISMATCH',
  'PLANNER_BOUND_EXCEEDED',
  'PINNED_CONTEXT_NOT_REQUESTED',
  'REQUIRED_CONTEXT_NOT_PINNED',
  'PINNED_CONTEXT_MISMATCH',
  'REQUIRED_CONTEXT_MISSING',
  'AUTHORITATIVE_CONTEXT_UNTRUSTED',
  'POLICY_RELEASE_MISMATCH',
  'FORBIDDEN_KIND',
  'BUDGET_EXCEEDED',
  'UNTRUSTED_IN_INSTRUCTION_SLOT',
  'AVAILABILITY_REFUSED',
  'LIMIT_EXCEEDED',
] as const;

export type ContextRefusalReason = (typeof CONTEXT_REFUSAL_REASONS)[number];

const REFUSAL_REASON_SET: ReadonlySet<string> = new Set(CONTEXT_REFUSAL_REASONS);

/** Whether `value` is one of the base refusal reasons. */
export function isContextRefusalReason(value: string): value is ContextRefusalReason {
  return REFUSAL_REASON_SET.has(value);
}

/**
 * DELIVERY refusals — emitted by the native-delivery layer (`./native/plan.ts`),
 * NEVER by `compile`.
 *
 * They are kept OUT of {@link CONTEXT_REFUSAL_REASONS} on purpose: that set is the
 * specification table verbatim (the admission algorithm's closed vocabulary, whose completeness
 * the compile test suite asserts by exercising every member). A delivery reason no compiler
 * path can emit does not belong in it. Both vocabularies share the ONE {@link Refusal}
 * shape, so a delivery refusal records on a manifest exactly like an admission one.
 *
 * `NATIVE_UNAVAILABLE` is emitted ONLY when the contract REQUIRED native delivery. A
 * contract that merely PREFERS it degrades silently — the record is
 * `manifest.nativeDelivery = 'unavailable'` plus the plan's `unsupported` list, never a
 * refusal code.
 */
export const CONTEXT_DELIVERY_REFUSAL_REASONS = ['NATIVE_UNAVAILABLE'] as const;

export type ContextDeliveryRefusalReason = (typeof CONTEXT_DELIVERY_REFUSAL_REASONS)[number];

const DELIVERY_REFUSAL_REASON_SET: ReadonlySet<string> = new Set(CONTEXT_DELIVERY_REFUSAL_REASONS);

/** Whether `value` is one of the delivery refusal reasons. */
export function isContextDeliveryRefusalReason(
  value: string,
): value is ContextDeliveryRefusalReason {
  return DELIVERY_REFUSAL_REASON_SET.has(value);
}

/**
 * A single refusal. `code` is the string the active profile renders — identical to the
 * base reason under the ultrarouter default, the parent's verbatim code under a parent
 * profile (the parity seam). `reason` is the generic classification: for a refusal the
 * COMPILER emits it is always one of {@link CONTEXT_REFUSAL_REASONS}; for a refusal an
 * ADAPTER pre-computes (parent authority — cross-tenant, dedupe, lease, locale) it is
 * the parent's own reason string, which the base vocabulary does not enumerate. `detail`
 * disambiguates reasons a parent splits into several codes (availability: `after_cutoff`
 * vs `unknown`).
 */
export const RefusalSchema = z.object({
  reason: z.string().min(1),
  code: z.string().min(1),
  message: z.string().min(1),
  path: z.string().optional(),
  moduleId: z.string().optional(),
  kind: z.string().optional(),
  detail: z.string().optional(),
  /** True when this refusal makes the WHOLE run inadmissible (no manifest emitted). */
  fatal: z.boolean(),
});
export type Refusal = z.infer<typeof RefusalSchema>;

/**
 * How a profile renders base reasons as concrete codes.
 *
 * `codes` is the profile's full code vocabulary (base ∪ parent). `encode` maps a
 * base reason (plus optional detail) to the code the profile emits — the parity
 * seam: under a parent profile a `BUDGET_EXCEEDED` refusal must render the parent's
 * own string, not the base one.
 */
export interface RefusalRegistry {
  readonly codes: readonly string[];
  encode(reason: ContextRefusalReason, detail?: string): string;
}

/**
 * Build a refusal registry.
 *
 * With no arguments this is the ultrarouter default: the base reasons ARE the codes.
 * A parent profile passes `extraCodes` (its own vocabulary, which must be emitted
 * verbatim) and a `map` from (reason, detail) → code; anything the map does not
 * cover falls back to the base reason string, which keeps the registry total.
 */
export function defineRefusals(config?: {
  readonly extraCodes?: readonly string[];
  readonly map?: (reason: ContextRefusalReason, detail?: string) => string | undefined;
}): RefusalRegistry {
  const map = config?.map;
  const extra = config?.extraCodes ?? [];
  const codes = Object.freeze([...CONTEXT_REFUSAL_REASONS, ...extra]);
  return {
    codes,
    encode(reason, detail) {
      const mapped = map?.(reason, detail);
      return mapped ?? reason;
    },
  };
}
