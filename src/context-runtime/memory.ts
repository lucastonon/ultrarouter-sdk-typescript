// Generated file: vendored context runtime. Do not edit by hand.
/**
 * Memory classes. The core four are a closed vocabulary; a
 * parent extends them via {@link defineMemoryClasses} (for example four domain
 * classes are declared this way and ride on the module unchanged). The compiler never branches on a memory class — it only
 * validates membership and carries it onto the manifest entry.
 */

/** The core four memory classes (`Module.memoryClass`). */
export const CORE_MEMORY_CLASSES = ['working', 'episodic', 'semantic', 'procedural'] as const;

export type CoreMemoryClass = (typeof CORE_MEMORY_CLASSES)[number];

/** A resolved set of admissible memory classes for one profile. */
export interface MemoryClassSet {
  readonly classes: readonly string[];
  has(value: string): boolean;
}

/**
 * Build a memory-class set. The core four are always present; `extra` appends a
 * parent's own classes (deduplicated, order preserved). The compiler treats every
 * member as an opaque label.
 */
export function defineMemoryClasses(extra: readonly string[] = []): MemoryClassSet {
  const classes: string[] = [...CORE_MEMORY_CLASSES];
  for (const value of extra) {
    if (!classes.includes(value)) classes.push(value);
  }
  const frozen = Object.freeze(classes);
  const set = new Set(frozen);
  return { classes: frozen, has: (value) => set.has(value) };
}
