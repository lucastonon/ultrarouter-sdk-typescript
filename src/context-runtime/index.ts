// Generated file: vendored context runtime. Do not edit by hand.
/**
 * The context runtime — the PURE context-runtime
 * compiler extracted from two earlier context engines. No clock, no env,
 * no RNG, no IO; `zod` is the only external dependency and the segmenter is consumed
 * from the core library (one code path, never a copy). This barrel is the public
 * surface that SDKs and parent adoption build on.
 */

// ─── hashing (reused from the core library) ───
export { canonicalJson, hashContextValue, sha256Hex } from './hash.js';

// ─── refusals ───
export {
  CONTEXT_DELIVERY_REFUSAL_REASONS,
  CONTEXT_REFUSAL_REASONS,
  defineRefusals,
  isContextDeliveryRefusalReason,
  isContextRefusalReason,
  RefusalSchema,
} from './refusals.js';
export type {
  ContextDeliveryRefusalReason,
  ContextRefusalReason,
  Refusal,
  RefusalRegistry,
} from './refusals.js';

// ─── memory classes ───
export { CORE_MEMORY_CLASSES, defineMemoryClasses } from './memory.js';
export type { CoreMemoryClass, MemoryClassSet } from './memory.js';

// ─── kinds ───
export { defineKinds } from './kinds.js';
export type { KindSet } from './kinds.js';

// ─── module ───
export { AvailabilitySchema, FacetValueSchema, ModuleSchema, TRUST_CLASSES } from './module.js';
export type { Availability, FacetValue, Module, TrustClass } from './module.js';

// ─── contract ───
export { ContractSchema, LimitSchema, PIN_POLICIES } from './contract.js';
export type { Contract, Limit, PinPolicy } from './contract.js';

// ─── envelope ───
export {
  EnvelopeBudgetsSchema,
  EnvelopeSchema,
  hashEnvelope,
  PinSchema,
  sealEnvelope,
} from './envelope.js';
export type { Envelope, EnvelopeBudgets, Pin, SealedEnvelope } from './envelope.js';

// ─── manifest + wire ───
export {
  ContextRangeSchema,
  ManifestBudgetsSchema,
  ManifestEntrySchema,
  ManifestSchema,
  NATIVE_DELIVERY_STATES,
  scaffoldSubject,
  toWire,
} from './manifest.js';
export type {
  ContextRange,
  Manifest,
  ManifestBudgets,
  ManifestEntry,
  NativeDeliveryState,
  ScaffoldSubjectEntry,
  UrManifestWire,
  UrManifestWireEntry,
} from './manifest.js';

// ─── messages + render serializer ───
export { defaultRenderSerializer, INSTRUCTION_SLOT, REFERENCE_SLOTS } from './messages.js';
export type { ChatMessage, RenderSerializer } from './messages.js';

// ─── compatibility profiles ───
export {
  defaultVolatilityRank,
  encodeUltrarouterManifest,
  ULTRAROUTER_PROFILE,
  ultrarouterManifestEncoder,
} from './profile.js';
export type {
  BudgetStrategy,
  CompatibilityProfile,
  EncodedManifest,
  ManifestEncoder,
  ManifestEncoderContext,
  ManifestEncoderInput,
} from './profile.js';

// ─── compile (the admission algorithm) ───
export { compile } from './compile.js';
export type { AdapterRefusal, CompileResult, ContextCandidate } from './compile.js';

// ─── render + exit ───
export { ContextExitError, render, toMessages } from './render.js';

// ─── lift (fromMessages — the gateway segmenter code path) ───
export { fromMessages } from './lift.js';
export type { LiftedManifest, LiftExt, LiftLabel, LiftMessageRecord } from './lift.js';

// ─── lint (ur context lint core) ───
export { lintPromptSurface, lintPromptSurfaces } from './lint.js';
export type { LintFinding, LintInput, LintOptions, LintRule } from './lint.js';

// ─── native delivery (the compatibility table + the ONE fallback) ───
export {
  channelsOf,
  deliveredFacts,
  deliveryBlocks,
  findNativeCompatibility,
  findNativeFeature,
  gateSatisfied,
  isNativeFeatureId,
  NATIVE_COMPATIBILITY,
  NATIVE_DELIVERY_CHANNELS,
  NATIVE_DELIVERY_REQUIREMENTS,
  NATIVE_DESCRIPTOR_KINDS,
  NATIVE_DISCLOSURES,
  NATIVE_FALLBACK_REASONS,
  NATIVE_FEATURE_IDS,
  NATIVE_FEATURES,
  NATIVE_OPERATOR_SLOT,
  NATIVE_PLACEMENT_DETAILS,
  nativeModelId,
  placementSatisfied,
  planNativeDelivery,
  selectorMatches,
} from './native/index.js';
export type {
  DeliveredFact,
  NativeCompatibilityRow,
  NativeConversationTurn,
  NativeDeliveryBlock,
  NativeDeliveryChannel,
  NativeDeliveryContract,
  NativeDeliveryFragment,
  NativeDeliveryInput,
  NativeDeliveryPlan,
  NativeDeliveryRequirement,
  NativeDeliveryResult,
  NativeDeliveryTarget,
  NativeDisclosure,
  NativeFallbackReason,
  NativeFeature,
  NativeFeatureChannel,
  NativeFeatureId,
  NativeModuleSelector,
  NativePlacement,
  NativePlacementDetail,
  NativePlacementRule,
  NativePlacementVerdict,
  NativeSelectableEntry,
  NativeUnsupported,
} from './native/index.js';

// ─── SOP layer (compiler, transition language, lazy catalog, ports) ───
export {
  assertSopExecutable,
  authorizePhase,
  catalog,
  checkDescriptor,
  compileSop,
  computeCompiledHash,
  computeProvenanceHash,
  describe,
  describeTokenEstimate,
  DESCRIPTOR_LIMITS,
  descriptorSubject,
  eligible,
  evaluatePredicate,
  EXECUTABLE_SOP_SPEC_CONTRACT,
  gapArtifact,
  isSopRefusalCode,
  loadPhaseBody,
  mandatoryOnlyManifest,
  parsePredicate,
  producesOf,
  renderDescriptor,
  renderPredicate,
  SOP_DEPENDENCY_KINDS,
  SOP_PREDICATE_TYPES,
  SOP_REFUSAL_CODES,
  SopPredicateSchema,
  sopRefusal,
} from './sop/index.js';
export type {
  AuthorizationReceipt,
  AuthorizationReceiptPort,
  AuthorizePhaseInput,
  AuthorizePhaseResult,
  CompiledContent,
  CompileSopRequest,
  CompileSopResult,
  DescriptorSubject,
  ExecutableSopPhase,
  ExecutableSopSpec,
  GapArtifact,
  MandatoryOnlyManifest,
  ParsePredicateResult,
  SopCatalog,
  SopCatalogEntry,
  SopDependency,
  SopDependencyKind,
  SopDraft,
  SopLoadPort,
  SopLoadRef,
  SopPhaseDraft,
  SopPredicate,
  SopPredicateType,
  SopReceiptOutcome,
  SopRefusal,
  SopRefusalCode,
  SopReview,
  SopRuntimeState,
  SopTransition,
  SopTransitionDraft,
} from './sop/index.js';
