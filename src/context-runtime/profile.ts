// Generated file: vendored context runtime. Do not edit by hand.
/**
 * Compatibility profiles. A profile parameterises the ONE compiler
 * for a given adopter: the `orderRule` (`selection` keeps candidate order; `volatility`
 * sorts stable→volatile — the cache-friendly ultrarouter default and a model-visible
 * change), the memory-class / kind vocabularies, the refusal-code
 * registry, the profile-level limits, the budget strategy, the render `serializer`, and
 * the `manifestEncoder` (the parent's own serialization + hash subject — the parity
 * seam). Parent-specific invariants are enforced by each parent's
 * ADAPTER before compile; a profile never derives authority.
 */

import type { Contract, Limit } from './contract.js';
import type { Envelope } from './envelope.js';
import { canonicalJson, sha256Hex } from './hash.js';
import type { KindSet } from './kinds.js';
import { defineKinds } from './kinds.js';
import type { Manifest, ManifestEntry } from './manifest.js';
import { defineMemoryClasses, type MemoryClassSet } from './memory.js';
import { defaultRenderSerializer, type RenderSerializer } from './messages.js';
import { defineRefusals, type RefusalRegistry } from './refusals.js';

/** The manifest data the encoder serializes — everything except the hash it produces. */
export type ManifestEncoderInput = Omit<Manifest, 'manifestHash'>;

/** The context an encoder may read (the source envelope + contract, for parent fields). */
export interface ManifestEncoderContext {
  readonly envelope: Envelope;
  readonly contract: Contract;
}

/** A profile's manifest serialization: parent bytes + the hash taken over them. */
export interface EncodedManifest {
  readonly bytes: string;
  readonly hash: string;
}

/** The parity seam: reconstruct the parent's manifest bytes + hash from a core manifest. */
export type ManifestEncoder = (
  manifest: ManifestEncoderInput,
  ctx: ManifestEncoderContext,
) => EncodedManifest;

/**
 * How the profile admits within budget (shed whole modules,
 * never truncate). `tokens`: a token ceiling with a keep-priority (shed lowest-keep
 * first — for example a history→evidence→strategy ladder). `count`: a maximum pin count
 * checked inline in selection order (a selection budget). A `null` limit is
 * unbounded.
 */
export type BudgetStrategy =
  | {
      readonly kind: 'tokens';
      limit(envelope: Envelope, contract: Contract): number | null;
      /** Higher = kept longer (shed last). Mandatory entries are never shed. */
      keepPriority(entry: ManifestEntry): number;
      /**
       * How the shed walks the keep-order. `prefix` (default) keeps a prefix and sheds
       * the first over-budget module AND everything after it — this makes shedding
       * MONOTONE (tightening the budget only ever removes survivors, never adds one). `greedy`
       * skips an over-budget module and keeps trying smaller ones (a ladder's
       * behaviour); it is NOT monotone and is used only for parity.
       */
      readonly shedMode?: 'prefix' | 'greedy';
    }
  | {
      readonly kind: 'count';
      limit(envelope: Envelope, contract: Contract): number | null;
    };

export interface CompatibilityProfile {
  readonly name: string;
  readonly orderRule: 'selection' | 'volatility';
  readonly memoryClasses: MemoryClassSet;
  readonly kinds: KindSet;
  readonly refusals: RefusalRegistry;
  /** Profile-level limits, merged with the contract's own (both apply). */
  readonly limits: readonly Limit[];
  readonly budget: BudgetStrategy;
  readonly serializer: RenderSerializer;
  readonly manifestEncoder: ManifestEncoder;
  /** Optional parent envelope hash (defaults to the ultrarouter `hashEnvelope`). */
  readonly hashEnvelope?: (envelope: Envelope) => string;
  /** Ascending = more stable (ordered first) under the `volatility` rule. */
  readonly volatilityRank?: (entry: ManifestEntry) => number;
  /** Kinds whose pinned module MUST be `authoritative` (else
   * `AUTHORITATIVE_CONTEXT_UNTRUSTED`). For example: policy / business_fact / charter /
   * output_contract. Default: none. */
  readonly authoritativeKinds?: readonly string[];
  /** A release binding: a candidate of `kinds` must carry `facets[facet]` present in
   * `envelope.releases[releaseKey]`, else `POLICY_RELEASE_MISMATCH`. Default: none. */
  readonly releaseBinding?: {
    readonly kinds: readonly string[];
    readonly facet: string;
    readonly releaseKey: string;
  };
  /** Availability policy. `refuseUndated`: a module with a null `from` is refused;
   * `strictModes`: modes in which that refusal is FATAL. Default: undated is
   * admissible (a module with no window is always available). */
  readonly availability?: {
    readonly refuseUndated?: boolean;
    readonly strictModes?: readonly string[];
  };
  /** Cap for an optional kind with no explicit limit (for example 10). Default: unbounded. */
  readonly defaultKindLimit?: number | null;
  /** Cap on how many optional candidates are considered at all (for example 60). Default:
   * unbounded. Candidates past the ceiling are refused `LIMIT_EXCEEDED`. */
  readonly resultCeiling?: number | null;
}

/** The ultrarouter default volatility ranking: stable (procedural) first, volatile
 * (episodic) last. Unknown classes rank in the middle so they are never mistaken for
 * the most stable prefix. */
export function defaultVolatilityRank(entry: ManifestEntry): number {
  switch (entry.memoryClass) {
    case 'procedural':
      return 0;
    case 'semantic':
      return 1;
    case 'working':
      return 2;
    case 'episodic':
      return 3;
    default:
      return 2;
  }
}

/** Keep-priority for the default token budget: shed the most volatile first (episodic),
 * keep the most stable last (procedural). Higher = kept longer. */
function defaultKeepPriority(entry: ManifestEntry): number {
  return 3 - defaultVolatilityRank(entry);
}

/** The ultrarouter-default manifest bytes: the canonical JSON over a stable,
 * bodies-free subject. Two structurally-equal manifests encode identically. Takes no
 * `ctx` (the default reads only the core manifest) so the lift path can reuse it.
 *
 * `nativeDelivery` is bound into the subject ONLY WHEN PRESENT (not as
 * `?? null` like `range`/`ext`). That is deliberate: the field distinguishes "this
 * execution never asked about native delivery" from "it asked and the fallback ran", so
 * a manifest that never asked must keep its previous bytes — content addresses already
 * stored cannot be invalidated by a delivery feature
 * the execution never used. A manifest that DID record a delivery decision hashes
 * differently from one that recorded the other decision, which is the point. */
export function encodeUltrarouterManifest(manifest: ManifestEncoderInput): EncodedManifest {
  const subject = {
    envelopeId: manifest.envelopeId,
    stage: manifest.stage,
    envelopeHash: manifest.envelopeHash,
    scaffoldHash: manifest.scaffoldHash,
    ...(manifest.nativeDelivery !== undefined ? { nativeDelivery: manifest.nativeDelivery } : {}),
    budgets: manifest.budgets,
    entries: manifest.entries.map((entry) => ({
      moduleId: entry.moduleId,
      version: entry.version,
      kind: entry.kind,
      memoryClass: entry.memoryClass,
      trustClass: entry.trustClass,
      privacyClass: entry.privacyClass,
      contentHash: entry.contentHash,
      order: entry.order,
      mandatory: entry.mandatory,
      tokenEstimate: entry.tokenEstimate,
      slot: entry.slot,
      range: entry.range ?? null,
      ext: entry.ext ?? null,
    })),
    refused: manifest.refused.map((refusal) => ({
      reason: refusal.reason,
      code: refusal.code,
      moduleId: refusal.moduleId ?? null,
      kind: refusal.kind ?? null,
      detail: refusal.detail ?? null,
      path: refusal.path ?? null,
      fatal: refusal.fatal,
    })),
    ext: manifest.ext ?? null,
  };
  const bytes = canonicalJson(subject);
  return { bytes, hash: sha256Hex(bytes) };
}

/** The ultrarouter-default manifest encoder (profile form). */
export const ultrarouterManifestEncoder: ManifestEncoder = (manifest) =>
  encodeUltrarouterManifest(manifest);

/** The default profile for NEW ultrarouter adopters (`volatility` order). */
export const ULTRAROUTER_PROFILE: CompatibilityProfile = {
  name: 'ultrarouter',
  orderRule: 'volatility',
  memoryClasses: defineMemoryClasses(),
  // An open kind vocabulary: the default profile validates no kind membership (kinds
  // are opaque to the compiler); adapters/tests use `defineKinds` for a closed set.
  kinds: defineKinds([]),
  refusals: defineRefusals(),
  limits: [],
  budget: {
    kind: 'tokens',
    limit: (envelope, contract) => contract.budgets.tokens ?? envelope.budgets.tokens ?? null,
    keepPriority: defaultKeepPriority,
  },
  serializer: defaultRenderSerializer,
  manifestEncoder: ultrarouterManifestEncoder,
  volatilityRank: defaultVolatilityRank,
};
