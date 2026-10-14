// Generated file: vendored context runtime. Do not edit by hand.
/**
 * Canonical JSON: a deterministic serialization in which object keys are sorted
 * recursively and a `Date` renders as its ISO-8601 string. Two structurally-equal
 * values always serialize to the identical string, so a hash taken over the result is
 * stable regardless of key insertion order.
 *
 * Every key is kept, including a key named `__proto__`: sorted objects are built with
 * no prototype, so such a key becomes an ordinary own property instead of re-parenting
 * the object (`JSON.parse('{"__proto__":{}}')` yields an own `__proto__` key, and its
 * canonical form must still carry it). Number and string formatting is
 * `JSON.stringify`'s.
 *
 * Pure and IO-free. This module is shipped verbatim in the public SDK: keep its
 * comments free of internal references.
 */

/** Serialize `value` as canonical JSON (keys sorted recursively, `Date` as ISO). */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(sortValue);
  const obj = value as Record<string, unknown>;
  // A null-prototype target: assigning `__proto__` defines an own property here
  // instead of invoking the inherited `Object.prototype.__proto__` setter.
  const sorted = Object.create(null) as Record<string, unknown>;
  for (const key of Object.keys(obj).sort()) {
    sorted[key] = sortValue(obj[key]);
  }
  return sorted;
}
