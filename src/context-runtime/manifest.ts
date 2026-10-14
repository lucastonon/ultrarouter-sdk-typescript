// Generated file: vendored context runtime. Do not edit by hand.
/**
 * `Manifest` — the hashable record of exactly what one
 * execution was allowed to see: ordered admitted entries, the refused set, budgets,
 * the envelope hash, the manifest hash, and the `scaffoldHash` (kinds/slots/ids only,
 * stable across executions — the call-type identity the witness stamps, never the
 * per-execution hash).
 *
 * `range?` carries the wire coordinates (`ur.segments` system: UTF-16 code units) for
 * a lifted entry; a module-compiled entry has none. `toWire` renders the wire
 * shape (the gateway consumes it; this package only produces it — the gateway is a witness).
 */

import { z } from 'zod';

import { RefusalSchema } from './refusals.js';

/** A wire range in the `ur.segments` coordinate system (UTF-16 code units). */
export const ContextRangeSchema = z.object({
  messageIndex: z.number().int().nonnegative(),
  partIndex: z.number().int().nonnegative().optional(),
  start: z.number().int().nonnegative(),
  end: z.number().int().nonnegative(),
});
export type ContextRange = z.infer<typeof ContextRangeSchema>;

export const ManifestEntrySchema = z.object({
  moduleId: z.string().min(1),
  version: z.string().min(1),
  kind: z.string().min(1),
  memoryClass: z.string().min(1),
  trustClass: z.string().min(1),
  privacyClass: z.string().min(1),
  contentHash: z.string().min(1),
  order: z.number().int().nonnegative(),
  mandatory: z.boolean(),
  tokenEstimate: z.number().int().nonnegative(),
  slot: z.string().min(1),
  range: ContextRangeSchema.optional(),
  ext: z.record(z.string(), z.unknown()).optional(),
});
export type ManifestEntry = z.infer<typeof ManifestEntrySchema>;

/**
 * Native delivery, as recorded on the manifest. `native` = at least one entry was
 * delivered through a provider's own context feature; `unavailable` = the ONE documented
 * fallback ran (the catalog was rendered inline).
 *
 * The field is OPTIONAL and means three different things by presence: ABSENT = this
 * execution never asked about native delivery (a plain `compile` output), `unavailable` =
 * it asked and the fallback ran, `native` = it asked and a native channel carried it.
 * "Did not ask" is deliberately distinguishable from "asked and could not".
 */
export const NATIVE_DELIVERY_STATES = ['native', 'unavailable'] as const;
export type NativeDeliveryState = (typeof NATIVE_DELIVERY_STATES)[number];

/** Admission accounting for one manifest. */
export const ManifestBudgetsSchema = z.object({
  tokensAdmitted: z.number().int().nonnegative(),
  tokenLimit: z.number().int().nonnegative().nullable(),
  admitted: z.number().int().nonnegative(),
  refused: z.number().int().nonnegative(),
});
export type ManifestBudgets = z.infer<typeof ManifestBudgetsSchema>;

export const ManifestSchema = z.object({
  envelopeId: z.string().min(1),
  stage: z.string().min(1),
  entries: z.array(ManifestEntrySchema),
  refused: z.array(RefusalSchema),
  budgets: ManifestBudgetsSchema,
  envelopeHash: z.string().min(1),
  manifestHash: z.string().min(1),
  scaffoldHash: z.string().min(1),
  /** How this execution was DELIVERED (see {@link NATIVE_DELIVERY_STATES}).
   * Bound into `manifestHash` when present; never part of `scaffoldHash` (delivery is
   * per-execution, call-type identity is not). */
  nativeDelivery: z.enum(NATIVE_DELIVERY_STATES).optional(),
  ext: z.record(z.string(), z.unknown()).optional(),
});
export type Manifest = z.infer<typeof ManifestSchema>;

/** The subject `scaffoldHash` is taken over — kinds/slots/ids + structural order only,
 * so it is stable across executions that select the same modules (versions, content
 * hashes and token estimates deliberately excluded). Used for call-type identity. */
export interface ScaffoldSubjectEntry {
  readonly moduleId: string;
  readonly kind: string;
  readonly slot: string;
  readonly mandatory: boolean;
  readonly order: number;
}

/** The ordered scaffold subject for a set of entries. Pure; hashed by the caller. */
export function scaffoldSubject(
  entries: readonly Pick<ManifestEntry, 'moduleId' | 'kind' | 'slot' | 'mandatory' | 'order'>[],
): readonly ScaffoldSubjectEntry[] {
  return entries.map((entry) => ({
    moduleId: entry.moduleId,
    kind: entry.kind,
    slot: entry.slot,
    mandatory: entry.mandatory,
    order: entry.order,
  }));
}

/** One entry on the wire (`ur.manifest`). Snake-cased for the OpenAPI surface. */
export interface UrManifestWireEntry {
  readonly kind: string;
  readonly slot: string;
  readonly trust_class: string;
  readonly memory_class: string;
  readonly content_hash: string;
  readonly mandatory: boolean;
  readonly order: number;
  readonly range?: {
    readonly message_index: number;
    readonly part_index?: number;
    readonly start: number;
    readonly end: number;
  };
}

/** The `ur.manifest` wire shape. No bodies — hashes/ranges/labels only. */
export interface UrManifestWire {
  readonly scaffold_hash: string;
  readonly manifest_hash: string;
  readonly envelope_hash: string;
  readonly entries: readonly UrManifestWireEntry[];
}

/** Render a manifest to the wire shape. Pure; carries no bodies. */
export function toWire(manifest: Manifest): UrManifestWire {
  return {
    scaffold_hash: manifest.scaffoldHash,
    manifest_hash: manifest.manifestHash,
    envelope_hash: manifest.envelopeHash,
    entries: manifest.entries.map((entry) => ({
      kind: entry.kind,
      slot: entry.slot,
      trust_class: entry.trustClass,
      memory_class: entry.memoryClass,
      content_hash: entry.contentHash,
      mandatory: entry.mandatory,
      order: entry.order,
      ...(entry.range
        ? {
            range: {
              message_index: entry.range.messageIndex,
              ...(entry.range.partIndex !== undefined ? { part_index: entry.range.partIndex } : {}),
              start: entry.range.start,
              end: entry.range.end,
            },
          }
        : {}),
    })),
  };
}
