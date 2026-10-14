// Generated file: vendored context runtime. Do not edit by hand.
/**
 * Native-delivery PLANNER.
 *
 * `planNativeDelivery` takes a COMPILED manifest and a delivery target and decides,
 * ENTRY BY ENTRY, whether the provider's own context features can carry it — or whether
 * it takes the ONE documented fallback (rendered inline). It emits a PLAN: which module
 * goes through which channel, which gate headers the request must carry, and the
 * manifest re-recorded with `nativeDelivery`.
 *
 * What this module is NOT: it never calls a provider, never imports one, reads no clock,
 * no env, no RNG. It emits a plan; the adapter dispatches it ("consume
 * the labs' features; the runtime decides WHAT deserves the window, not how the window
 * is managed").
 *
 * The two properties it lives or dies on:
 *
 *   1. **The decision is a TABLE LOOKUP.** Support comes from `./table.ts` rows and
 *      `./features.ts` rows; a pair absent from the table takes the fallback. No branch
 *      here names a provider, a model or a feature.
 *   2. **Fallback parity.** Native delivery and the inline fallback deliver the SAME SET
 *      OF FACTS — same module ids, same content hashes, same classification, same body
 *      bytes — nothing dropped, nothing invented, nothing reclassified
 *      ({@link deliveredFacts}). Only the CHANNEL differs. A `disclosure: 'descriptor'`
 *      channel defers the material a descriptor NAMES (never a manifest module of its
 *      own), so it does not weaken that equality.
 *
 * `NATIVE_UNAVAILABLE` is emitted ONLY when the contract REQUIRED native delivery. A
 * contract that merely prefers it degrades silently-but-recorded.
 */

import {
  ManifestSchema,
  type Manifest,
  type ManifestEntry,
  type NativeDeliveryState,
} from '../manifest.js';
import {
  encodeUltrarouterManifest,
  type EncodedManifest,
  type ManifestEncoderInput,
} from '../profile.js';
import type { Refusal } from '../refusals.js';

import {
  NATIVE_FEATURES,
  placementSatisfied,
  selectorMatches,
  type NativeConversationTurn,
  type NativeDeliveryChannel,
  type NativeFeature,
  type NativeFeatureId,
} from './features.js';
import {
  findNativeCompatibility,
  gateSatisfied,
  type NativeCompatibilityRow,
  type NativeDeliveryTarget,
} from './table.js';

/** How strongly the stage contract wants native delivery. */
export const NATIVE_DELIVERY_REQUIREMENTS = ['required', 'preferred'] as const;
export type NativeDeliveryRequirement = (typeof NATIVE_DELIVERY_REQUIREMENTS)[number];

/**
 * The stage contract's native-delivery clause. Supplied explicitly by the caller/adapter
 * — never derived from a module's or envelope's `ext` (the core derives
 * no authority from `ext`).
 */
export interface NativeDeliveryContract {
  /** `required` ⇒ a denied native candidate is the fatal `NATIVE_UNAVAILABLE` refusal.
   * `preferred` (the default when the clause is absent) ⇒ degrade silently-but-recorded. */
  readonly requirement: NativeDeliveryRequirement;
  /** Features the APP explicitly opted into. A feature with `requiresOptIn` that is not
   * named here takes the fallback. */
  readonly optIns?: readonly NativeFeatureId[];
}

/** Why an entry took the inline fallback (a closed, reportable vocabulary). */
export const NATIVE_FALLBACK_REASONS = [
  /** No declared feature selects this entry — it was never a native candidate. */
  'no_matching_feature',
  /** The (provider, model, feature) triple has no row in the compatibility table. */
  'feature_not_in_table',
  /** The row declares a gate value the caller is not sending. */
  'gate_header_missing',
  /** The feature requires an app opt-in the contract did not name. */
  'opt_in_missing',
  /** A placement rule was not satisfied (see the `detail`). */
  'placement_refused',
] as const;
export type NativeFallbackReason = (typeof NATIVE_FALLBACK_REASONS)[number];

/** A feature that COULD have carried an entry but did not, and why. */
export interface NativeUnsupported {
  readonly feature: NativeFeatureId;
  readonly reason: Exclude<NativeFallbackReason, 'no_matching_feature'>;
  /** Disambiguates a reason covering several conditions (the placement rule that blew). */
  readonly detail?: string;
  readonly message: string;
}

/** Where ONE manifest entry is delivered, and (when inline) why. */
export interface NativePlacement {
  readonly moduleId: string;
  readonly contentHash: string;
  readonly channel: NativeDeliveryChannel;
  /** The feature carrying it; `null` for the inline fallback. */
  readonly feature: NativeFeatureId | null;
  /** The gate value the request must carry for this placement; `null` when ungated. */
  readonly betaHeader: string | null;
  /** Set only on an inline placement — why the native path did not take it. */
  readonly reason?: NativeFallbackReason;
  readonly detail?: string;
}

/** One module's delivery payload. The adapter renders these onto the provider wire. */
export interface NativeDeliveryBlock {
  readonly moduleId: string;
  readonly contentHash: string;
  readonly kind: string;
  readonly memoryClass: string;
  readonly trustClass: string;
  readonly slot: string;
  readonly mandatory: boolean;
  /** The manifest order this module was admitted in (delivery never reorders). */
  readonly order: number;
  /** The body text. On a `descriptor`-disclosure channel this is what the model sees up
   * front (the body itself loads on demand); elsewhere it is the full module body. */
  readonly text: string;
  /** The feature carrying it; `null` inline. */
  readonly feature: NativeFeatureId | null;
  /** The provider feature/tool token (`memory_20250818`, …); `null` inline. */
  readonly token: string | null;
}

/**
 * The provider-neutral request fragment. Grouped by channel, each group in manifest
 * order. The ADAPTER maps these onto the provider wire (this package never imports a
 * provider); every block appears in exactly one group.
 */
export interface NativeDeliveryFragment {
  /** The gate values the request must carry, deduplicated, in feature-table order. */
  readonly gateHeaders: readonly string[];
  /** `defer_loading: true` tools: `moduleId` is the tool name, `text` the description. */
  readonly deferredTools: readonly NativeDeliveryBlock[];
  /** Memory-tool records (procedural, opt-in only). */
  readonly memory: readonly NativeDeliveryBlock[];
  /** The compaction / context-editing window (episodic). */
  readonly compactionWindow: readonly NativeDeliveryBlock[];
  /** Mid-conversation `system` messages, appended after the last conversation turn. */
  readonly systemMessages: readonly NativeDeliveryBlock[];
  /** The ONE documented fallback: everything else, rendered inline by the caller. */
  readonly inline: readonly NativeDeliveryBlock[];
}

/** The delivery plan for one execution. */
export interface NativeDeliveryPlan {
  /** `native` when at least one entry took a native channel, else `unavailable`. */
  readonly nativeDelivery: NativeDeliveryState;
  /** The manifest with `nativeDelivery` recorded and `manifestHash` re-computed.
   * `scaffoldHash` is UNCHANGED — delivery is per-execution, call-type identity is not. */
  readonly manifest: Manifest;
  /** One placement per manifest entry, in manifest order. */
  readonly placements: readonly NativePlacement[];
  /** Every feature the target supports for this request (gate + opt-in satisfied). */
  readonly availableFeatures: readonly NativeFeatureId[];
  /** Every feature that selected an entry but could not carry it, deduplicated. */
  readonly unsupported: readonly NativeUnsupported[];
  readonly fragment: NativeDeliveryFragment;
}

/**
 * The result of planning. Mirrors `compile`: a FATAL refusal yields NO plan at all, so a
 * caller cannot accidentally dispatch a fallback the contract forbade.
 */
export interface NativeDeliveryResult {
  readonly ok: boolean;
  /** `null` iff the contract REQUIRED native delivery and it was denied. */
  readonly plan: NativeDeliveryPlan | null;
  readonly refusals: readonly Refusal[];
}

/** The input to {@link planNativeDelivery}. */
export interface NativeDeliveryInput {
  /** A compiled (or lifted) manifest — what this execution is allowed to see. */
  readonly manifest: Manifest;
  readonly target: NativeDeliveryTarget;
  /** The stage contract's clause. Absent ⇒ `preferred`, no opt-ins. */
  readonly contract?: NativeDeliveryContract;
  /**
   * The conversation the delivery is appended to (roles only). ABSENT ⇒ placement rules
   * cannot be satisfied (fail closed — missing evidence is never an implicit pass).
   */
  readonly conversation?: readonly NativeConversationTurn[];
  /** `moduleId` → body text. A missing body renders '' (never a throw), exactly like
   * the default render serializer. */
  readonly bodies?: ReadonlyMap<string, string>;
  /** Override the feature table (tests / a future profile). Default: the frozen v1 set. */
  readonly features?: readonly NativeFeature[];
  /** Override the compatibility table. Default: the frozen v1 table. */
  readonly table?: readonly NativeCompatibilityRow[];
  /** How the re-recorded manifest is content-addressed. Default: the ultrarouter
   * encoder; a parent profile passes `(m) => profile.manifestEncoder(m, ctx)`. */
  readonly manifestEncoder?: (manifest: ManifestEncoderInput) => EncodedManifest;
}

/** One delivered FACT: a module's identity + classification, free of delivery detail. */
export interface DeliveredFact {
  readonly moduleId: string;
  readonly contentHash: string;
  readonly kind: string;
  readonly memoryClass: string;
  readonly trustClass: string;
  readonly slot: string;
  readonly mandatory: boolean;
}

/** An entry's resolution: a native placement, or the denial that sent it inline. */
interface Resolution {
  readonly feature: NativeFeature | null;
  readonly betaHeader: string | null;
  readonly reason?: NativeFallbackReason;
  readonly detail?: string;
  readonly denials: readonly NativeUnsupported[];
}

/** Resolve ONE entry against the feature + compatibility tables. Pure, total, ordered:
 * the FIRST feature (in feature-table order) that selects the entry AND is supported
 * wins; if none is, the FIRST selecting feature's denial is the reported reason. */
function resolveEntry(
  entry: ManifestEntry,
  input: NativeDeliveryInput,
  features: readonly NativeFeature[],
): Resolution {
  const optIns = input.contract?.optIns ?? [];
  const denials: NativeUnsupported[] = [];

  for (const feature of features) {
    if (!selectorMatches(feature.selector, entry)) continue;

    const row = findNativeCompatibility(input.target, feature.id, input.table);
    if (row === null) {
      denials.push({
        feature: feature.id,
        reason: 'feature_not_in_table',
        message: `the compatibility table declares no ${feature.id} row for ${input.target.provider}/${input.target.model}`,
      });
      continue;
    }
    if (!gateSatisfied(row, input.target)) {
      denials.push({
        feature: feature.id,
        reason: 'gate_header_missing',
        ...(row.betaHeader !== null ? { detail: row.betaHeader } : {}),
        message: `${feature.id} is gated by "${String(row.betaHeader)}", which the request does not carry`,
      });
      continue;
    }
    if (feature.requiresOptIn && !optIns.includes(feature.id)) {
      denials.push({
        feature: feature.id,
        reason: 'opt_in_missing',
        message: `${feature.id} is used only where the app opted in; the contract names no such opt-in`,
      });
      continue;
    }
    const placement = placementSatisfied(feature.placement, input.conversation);
    if (!placement.ok) {
      denials.push({
        feature: feature.id,
        reason: 'placement_refused',
        detail: placement.detail,
        message: `${feature.id}: ${placement.message}`,
      });
      continue;
    }
    return { feature, betaHeader: row.betaHeader, denials };
  }

  // Every selecting feature either RETURNED above or pushed a denial, so an empty
  // denial list means no feature selected this entry at all. Deriving it from the
  // denials (rather than a flag) leaves no path on which an entry can fall inline
  // WITHOUT a reason — an unexplained fallback would be invisible to the REQUIRED check.
  const first = denials[0];
  if (first === undefined) {
    return { feature: null, betaHeader: null, reason: 'no_matching_feature', denials };
  }
  return {
    feature: null,
    betaHeader: null,
    reason: first.reason,
    ...(first.detail !== undefined ? { detail: first.detail } : {}),
    denials,
  };
}

/** Every feature the target supports for this request (gate + opt-in satisfied). Pure. */
function availableFeatureIds(
  input: NativeDeliveryInput,
  features: readonly NativeFeature[],
): readonly NativeFeatureId[] {
  const optIns = input.contract?.optIns ?? [];
  const out: NativeFeatureId[] = [];
  for (const feature of features) {
    const row = findNativeCompatibility(input.target, feature.id, input.table);
    if (row === null) continue;
    if (!gateSatisfied(row, input.target)) continue;
    if (feature.requiresOptIn && !optIns.includes(feature.id)) continue;
    out.push(feature.id);
  }
  return out;
}

/**
 * Plan how a compiled manifest is DELIVERED to one provider/model.
 *
 * Never throws on a delivery decision (refusals are data, like the compiler's); it does
 * validate the manifest with `ManifestSchema`, which throws on a malformed input exactly
 * as `compile` does.
 */
export function planNativeDelivery(input: NativeDeliveryInput): NativeDeliveryResult {
  const manifest = ManifestSchema.parse(input.manifest);
  const features = input.features ?? NATIVE_FEATURES;
  const requirement = input.contract?.requirement ?? 'preferred';
  const encoder = input.manifestEncoder ?? encodeUltrarouterManifest;

  const placements: NativePlacement[] = [];
  const blocks = new Map<NativeDeliveryChannel, NativeDeliveryBlock[]>();
  const unsupported: NativeUnsupported[] = [];
  const seenDenial = new Set<string>();
  const gateHeaders: string[] = [];

  for (const entry of manifest.entries) {
    const resolved = resolveEntry(entry, input, features);
    for (const denial of resolved.denials) {
      const key = `${denial.feature}|${denial.reason}|${denial.detail ?? ''}`;
      if (seenDenial.has(key)) continue;
      seenDenial.add(key);
      unsupported.push(denial);
    }

    const channel: NativeDeliveryChannel = resolved.feature?.channel ?? 'inline';
    placements.push({
      moduleId: entry.moduleId,
      contentHash: entry.contentHash,
      channel,
      feature: resolved.feature?.id ?? null,
      betaHeader: resolved.betaHeader,
      ...(resolved.reason !== undefined ? { reason: resolved.reason } : {}),
      ...(resolved.detail !== undefined ? { detail: resolved.detail } : {}),
    });

    const list = blocks.get(channel) ?? [];
    list.push({
      moduleId: entry.moduleId,
      contentHash: entry.contentHash,
      kind: entry.kind,
      memoryClass: entry.memoryClass,
      trustClass: entry.trustClass,
      slot: entry.slot,
      mandatory: entry.mandatory,
      order: entry.order,
      text: input.bodies?.get(entry.moduleId) ?? '',
      feature: resolved.feature?.id ?? null,
      token: resolved.feature?.token ?? null,
    });
    blocks.set(channel, list);

    if (resolved.betaHeader !== null && !gateHeaders.includes(resolved.betaHeader)) {
      gateHeaders.push(resolved.betaHeader);
    }
  }

  const nativeDelivery: NativeDeliveryState = placements.some(
    (placement) => placement.channel !== 'inline',
  )
    ? 'native'
    : 'unavailable';

  // A DENIAL is an entry a declared feature wanted but could not carry. An entry no
  // feature selects is not a denial — it was never a native candidate.
  const denied = placements.filter(
    (placement) => placement.reason !== undefined && placement.reason !== 'no_matching_feature',
  );

  if (requirement === 'required' && (nativeDelivery === 'unavailable' || denied.length > 0)) {
    return {
      ok: false,
      plan: null,
      refusals: [nativeUnavailableRefusal(nativeDelivery, denied, unsupported)],
    };
  }

  const recorded = recordNativeDelivery(manifest, nativeDelivery, encoder);
  return {
    ok: true,
    plan: {
      nativeDelivery,
      manifest: recorded,
      placements,
      availableFeatures: availableFeatureIds(input, features),
      unsupported,
      fragment: {
        gateHeaders,
        deferredTools: blocks.get('deferred_tool') ?? [],
        memory: blocks.get('memory') ?? [],
        compactionWindow: blocks.get('compaction_window') ?? [],
        systemMessages: blocks.get('mid_conversation_system') ?? [],
        inline: blocks.get('inline') ?? [],
      },
    },
    refusals: [],
  };
}

/** The ONE `NATIVE_UNAVAILABLE` refusal (required-native only). `code` equals `reason`:
 * no parent profile declares native delivery in v1, so there is no code mapping to
 * render through (a parent that adds one adds it here, as data). */
function nativeUnavailableRefusal(
  nativeDelivery: NativeDeliveryState,
  denied: readonly NativePlacement[],
  unsupported: readonly NativeUnsupported[],
): Refusal {
  const named = unsupported.map((item) => `${item.feature}:${item.reason}`).join(', ');
  const cause =
    denied.length > 0
      ? `${String(denied.length)} module(s) were denied a native channel`
      : 'no module could be delivered through a native channel';
  return {
    reason: 'NATIVE_UNAVAILABLE',
    code: 'NATIVE_UNAVAILABLE',
    message: `the contract requires native delivery but ${cause}${named === '' ? '' : ` (${named})`}`,
    detail: nativeDelivery,
    fatal: true,
  };
}

/** Re-record a manifest with its delivery decision and re-address it. `scaffoldHash`,
 * entries, refusals and budgets are untouched — delivery changes WHERE bytes go, never
 * WHAT was admitted. */
function recordNativeDelivery(
  manifest: Manifest,
  nativeDelivery: NativeDeliveryState,
  encoder: (input: ManifestEncoderInput) => EncodedManifest,
): Manifest {
  // Built FIELD BY FIELD (never a spread of the source manifest) so the encoder input
  // can never carry a stale `manifestHash` into the subject it is about to re-address.
  const encoderInput: ManifestEncoderInput = {
    envelopeId: manifest.envelopeId,
    stage: manifest.stage,
    entries: manifest.entries,
    refused: manifest.refused,
    budgets: manifest.budgets,
    envelopeHash: manifest.envelopeHash,
    scaffoldHash: manifest.scaffoldHash,
    nativeDelivery,
    ...(manifest.ext !== undefined ? { ext: manifest.ext } : {}),
  };
  const encoded = encoder(encoderInput);
  return ManifestSchema.parse({ ...encoderInput, manifestHash: encoded.hash });
}

/**
 * The SET OF FACTS a plan delivers: one entry per module, identity + classification
 * only, SORTED BY `moduleId` so two plans that group modules into different channels
 * compare directly.
 *
 * This is the subject of the fallback-parity property: native delivery and the
 * inline fallback must deliver the SAME facts — nothing dropped, nothing invented,
 * nothing reclassified. It deliberately excludes the body text: a
 * `disclosure: 'descriptor'` channel (tool search / deferred loading) sends fewer BYTES
 * up front by design while making the SAME module available to the execution.
 */
export function deliveredFacts(plan: NativeDeliveryPlan): readonly DeliveredFact[] {
  const facts: DeliveredFact[] = deliveryBlocks(plan.fragment).map((block) => ({
    moduleId: block.moduleId,
    contentHash: block.contentHash,
    kind: block.kind,
    memoryClass: block.memoryClass,
    trustClass: block.trustClass,
    slot: block.slot,
    mandatory: block.mandatory,
  }));
  return facts.sort((left, right) => left.moduleId.localeCompare(right.moduleId));
}

/** Every delivery block of a fragment, grouped by channel (one group per channel). */
export function channelsOf(
  fragment: NativeDeliveryFragment,
): readonly (readonly NativeDeliveryBlock[])[] {
  return [
    fragment.deferredTools,
    fragment.memory,
    fragment.compactionWindow,
    fragment.systemMessages,
    fragment.inline,
  ];
}

/** Every delivery block of a fragment, flattened. Pure. */
export function deliveryBlocks(fragment: NativeDeliveryFragment): readonly NativeDeliveryBlock[] {
  return channelsOf(fragment).flat();
}
