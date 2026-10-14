// Generated file: vendored context runtime. Do not edit by hand.
/**
 * Kinds. A module `kind` is an opaque string the
 * compiler never branches on — parent-specific kinds live here + in `ext`. A profile
 * declares the kind vocabulary it recognises via {@link defineKinds}; the compiler
 * uses it only to validate membership and to read a contract's required/optional/
 * forbidden lists, never to derive behaviour.
 */

/** A resolved set of kinds a profile recognises. */
export interface KindSet {
  readonly kinds: readonly string[];
  has(value: string): boolean;
}

/**
 * Build a kind set from a parent's (or the default's) kind vocabulary. Duplicates
 * are collapsed; order is preserved for stable serialization.
 */
export function defineKinds(kinds: readonly string[]): KindSet {
  const unique: string[] = [];
  for (const value of kinds) {
    if (!unique.includes(value)) unique.push(value);
  }
  const frozen = Object.freeze(unique);
  const set = new Set(frozen);
  return { kinds: frozen, has: (value) => set.has(value) };
}
