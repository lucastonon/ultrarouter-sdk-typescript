// Generated file: vendored context runtime. Do not edit by hand.
/**
 * Native-delivery barrel. Three modules, all PURE:
 *
 *   - `features.ts` — the frozen v1 feature vocabulary: which entries a feature can
 *     carry, through which channel, behind which token, with which placement rule.
 *   - `table.ts` — the model × feature × beta-header COMPATIBILITY TABLE (data) and
 *     its typed lookup. A pair absent from the table takes the fallback.
 *   - `plan.ts` — the planner: manifest + target ⇒ a delivery plan / request
 *     fragment, `native_delivery` recorded on the manifest, and `NATIVE_UNAVAILABLE`
 *     only when the contract REQUIRED native delivery.
 *
 * No provider is imported anywhere here; the package emits a plan and never dispatches.
 * Re-exported by `../index.ts` (the package's public surface).
 */

// ─── features (the frozen v1 mappings) ───
export {
  findNativeFeature,
  isNativeFeatureId,
  NATIVE_DELIVERY_CHANNELS,
  NATIVE_DESCRIPTOR_KINDS,
  NATIVE_DISCLOSURES,
  NATIVE_FEATURE_IDS,
  NATIVE_FEATURES,
  NATIVE_OPERATOR_SLOT,
  NATIVE_PLACEMENT_DETAILS,
  placementSatisfied,
  selectorMatches,
} from './features.js';
export type {
  NativeConversationTurn,
  NativeDeliveryChannel,
  NativeDisclosure,
  NativeFeature,
  NativeFeatureChannel,
  NativeFeatureId,
  NativeModuleSelector,
  NativePlacementDetail,
  NativePlacementRule,
  NativePlacementVerdict,
  NativeSelectableEntry,
} from './features.js';

// ─── compatibility table (model × feature × beta header, as DATA) ───
export {
  findNativeCompatibility,
  gateSatisfied,
  NATIVE_COMPATIBILITY,
  nativeModelId,
} from './table.js';
export type { NativeCompatibilityRow, NativeDeliveryTarget } from './table.js';

// ─── planner ───
export {
  channelsOf,
  deliveredFacts,
  deliveryBlocks,
  NATIVE_DELIVERY_REQUIREMENTS,
  NATIVE_FALLBACK_REASONS,
  planNativeDelivery,
} from './plan.js';
export type {
  DeliveredFact,
  NativeDeliveryBlock,
  NativeDeliveryContract,
  NativeDeliveryFragment,
  NativeDeliveryInput,
  NativeDeliveryPlan,
  NativeDeliveryRequirement,
  NativeDeliveryResult,
  NativeFallbackReason,
  NativePlacement,
  NativeUnsupported,
} from './plan.js';
