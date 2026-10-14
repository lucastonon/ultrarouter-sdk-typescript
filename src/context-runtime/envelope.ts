// Generated file: vendored context runtime. Do not edit by hand.
/**
 * `Envelope`. The immutable, server-resolved identity of
 * ONE execution: tenant, stage, mode, cutoffs, budgets, seed, pins, release bindings,
 * permission epoch. Sealed (deep-frozen) and hashed so an envelope that was valid once
 * cannot silently become invalid between validation and use. `ext` round-trips
 * parent-only fields (release/locale lineage, a world snapshot) and
 * is NEVER a source of authority to the compiler.
 */

import { z } from 'zod';

import { hashContextValue } from './hash.js';

/** A mandatory pin: an exact module identity the envelope requires by id + kind + hash. */
export const PinSchema = z.object({
  id: z.string().min(1),
  kind: z.string().min(1),
  contentHash: z.string().min(1),
  purpose: z.string().trim().min(1).max(200),
});
export type Pin = z.infer<typeof PinSchema>;

/** The deterministic budgets one execution runs under. Every field is optional so a
 * profile that does not model a given budget kind simply omits it. */
export const EnvelopeBudgetsSchema = z.object({
  tokens: z.number().int().nonnegative().optional(),
  toolCalls: z.number().int().nonnegative().optional(),
  plannerDepth: z.number().int().nonnegative().optional(),
  plannerPass: z.number().int().nonnegative().optional(),
  timeMs: z.number().int().nonnegative().optional(),
  microUsd: z.number().int().nonnegative().optional(),
});
export type EnvelopeBudgets = z.infer<typeof EnvelopeBudgetsSchema>;

export const EnvelopeSchema = z.object({
  id: z.string().min(1),
  tenant: z.string().min(1),
  stage: z.string().min(1),
  mode: z.string().min(1),
  /** The knowledge cutoff — the `asOf` instant availability is judged against. */
  asOf: z.string().min(1),
  cutoffs: z.record(z.string(), z.string()),
  budgets: EnvelopeBudgetsSchema,
  seed: z.string(),
  pins: z.array(PinSchema),
  releases: z.record(z.string(), z.union([z.string(), z.array(z.string())])),
  permissionEpoch: z.string().min(1),
  ext: z.record(z.string(), z.unknown()).optional(),
});
export type Envelope = z.infer<typeof EnvelopeSchema>;

/** A parsed, deep-frozen envelope plus its default (ultrarouter) content digest. */
export interface SealedEnvelope {
  readonly envelope: Readonly<Envelope>;
  readonly envelopeHash: string;
}

/** The ultrarouter-default digest of an envelope's exact validated content. */
export function hashEnvelope(envelope: Envelope): string {
  return hashContextValue(EnvelopeSchema.parse(envelope));
}

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const nested of Object.values(value as Record<string, unknown>)) deepFreeze(nested);
  return value;
}

/** Parse, deep-freeze and hash an envelope. The frozen object cannot be mutated by a
 * later stage; the hash is what pins it into the manifest and survives the process. */
export function sealEnvelope(raw: Envelope): SealedEnvelope {
  const envelope = EnvelopeSchema.parse(raw);
  return Object.freeze({
    envelope: deepFreeze(envelope),
    envelopeHash: hashContextValue(envelope),
  });
}
