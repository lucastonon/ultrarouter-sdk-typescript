// Generated file: vendored context runtime. Do not edit by hand.
/**
 * SOP refusals. A CLOSED vocabulary of the reasons the SOP compiler, the
 * descriptor budget, the executability check and the phase-authorization port refuse.
 *
 * These are DISTINCT from the context-compile refusals (`../refusals.ts`,
 * `CONTEXT_REFUSAL_REASONS`) — that vocabulary is the module-admission algorithm's,
 * this one is the SOP layer's — so this module does NOT touch the base vocabulary.
 * Refusals are pure DATA (never a throw on the compile path), so
 * a compile result carries what it refused, which is the ledger the flywheel reads.
 * The review-gate, dangling/cycle/duplicate dependency, transition-cycle and
 * descriptor codes are extracted-in-spirit from an earlier compiler's error codes;
 * the transition + predicate + receipt codes are NEW with the transition
 * language.
 */

/** The closed set of SOP refusal codes. */
export const SOP_REFUSAL_CODES = [
  // Review gate (prose never executes).
  'SOP_NOT_REVIEWED',
  'SOP_REVIEW_STALE',
  'SOP_REVIEW_INSTANT_INVALID',
  // Structure.
  'SOP_IDENTITY_INVALID',
  'SOP_PHASE_INVALID',
  // Dependency closure (dangling / cycle / duplicate / malformed).
  'SOP_DEPENDENCY_MISSING',
  'SOP_DEPENDENCY_INVALID',
  'SOP_DEPENDENCY_DUPLICATE',
  'SOP_DEPENDENCY_CYCLE',
  // Transition language (NEW — the closed predicate set + transition-graph acyclicity).
  'SOP_TRANSITION_UNKNOWN_PHASE',
  'SOP_TRANSITION_CYCLE',
  'SOP_PREDICATE_UNKNOWN',
  // Lazy descriptor budget (NEW — never truncated).
  'DESCRIPTOR_OVER_BUDGET',
  // Executability (a stored/hand-edited spec is re-hashed).
  'SOP_COMPILED_HASH_MISMATCH',
  'SOP_NOT_EXECUTABLE',
  // Single-use phase authorization (NEW — enforced BY the receipt port, not claimed here).
  'SOP_RECEIPT_REUSED',
] as const;

export type SopRefusalCode = (typeof SOP_REFUSAL_CODES)[number];

const SOP_REFUSAL_CODE_SET: ReadonlySet<string> = new Set(SOP_REFUSAL_CODES);

/** Whether `value` is one of the closed SOP refusal codes. */
export function isSopRefusalCode(value: string): value is SopRefusalCode {
  return SOP_REFUSAL_CODE_SET.has(value);
}

/**
 * One SOP refusal. `code` is from the closed {@link SOP_REFUSAL_CODES}; `detail`
 * disambiguates a code that covers several conditions (the descriptor sub-limit that
 * blew the budget, the dependency defect kind); `path` names the offending field.
 * Every SOP-compile refusal is fatal (there is no partial spec), so there is no
 * `fatal` flag — a refused compile returns no spec at all.
 */
export interface SopRefusal {
  readonly code: SopRefusalCode;
  readonly message: string;
  readonly detail?: string;
  readonly path?: string;
}

/** Build a {@link SopRefusal}. Pure data — omits undefined optional fields so two
 * refusals with the same content are structurally (and canonically) equal. */
export function sopRefusal(
  code: SopRefusalCode,
  message: string,
  extra?: { readonly detail?: string; readonly path?: string },
): SopRefusal {
  return {
    code,
    message,
    ...(extra?.detail !== undefined ? { detail: extra.detail } : {}),
    ...(extra?.path !== undefined ? { path: extra.path } : {}),
  };
}
