// Generated file: vendored context runtime. Do not edit by hand.
/**
 * `Module`. A typed, versioned, content-hashed unit of
 * context. `kind`, `memoryClass` and `privacyClass` are opaque labels the compiler
 * carries but never branches on; `trustClass` is the ONE field with core meaning —
 * `untrusted` is admissible only in a reference/exemplar slot. `ext`
 * round-trips parent-only fields and is NEVER a source of authority.
 */

import { z } from 'zod';

/** Trust classes. `untrusted` never enters an instruction slot. */
export const TRUST_CLASSES = ['authoritative', 'approved_derived', 'untrusted'] as const;
export type TrustClass = (typeof TRUST_CLASSES)[number];

/** A facet value — a scalar or a set (used by parent adapters for scope matching). */
export const FacetValueSchema = z.union([z.string(), z.array(z.string())]);
export type FacetValue = z.infer<typeof FacetValueSchema>;

/**
 * When a module is available. `from`/`to` are ISO-8601 instants or null (unbounded).
 * A null `from` means "no availability of its own" — the compiler treats that as an
 * availability refusal unless the profile's mode tolerates it.
 */
export const AvailabilitySchema = z.object({
  from: z.string().min(1).nullable(),
  to: z.string().min(1).nullable(),
});
export type Availability = z.infer<typeof AvailabilitySchema>;

export const ModuleSchema = z.object({
  id: z.string().min(1),
  version: z.string().min(1),
  kind: z.string().min(1),
  memoryClass: z.string().min(1),
  trustClass: z.enum(TRUST_CLASSES),
  privacyClass: z.string().min(1),
  availability: AvailabilitySchema,
  contentHash: z.string().min(1),
  tokenEstimate: z.number().int().nonnegative(),
  facets: z.record(z.string(), FacetValueSchema),
  slotHint: z.string().min(1).optional(),
  ext: z.record(z.string(), z.unknown()).optional(),
});
export type Module = z.infer<typeof ModuleSchema>;
