// Generated file: vendored context runtime. Do not edit by hand.
/**
 * SOP layer barrel. The SOP compiler, the
 * NEW typed transition language, the lazy descriptor catalog under a hard token
 * budget, the pure `eligible` selector, the two single-use ports, and the fallbacks.
 * Everything is pure + IO-free; the ports are interfaces the caller implements. This
 * barrel is re-exported by `../index.ts` (the package's public surface).
 */

// ─── transition language (NEW) ───
export {
  evaluatePredicate,
  parsePredicate,
  renderPredicate,
  SOP_PREDICATE_TYPES,
  SopPredicateSchema,
} from './predicates.js';
export type {
  ParsePredicateResult,
  SopPredicate,
  SopPredicateType,
  SopRuntimeState,
} from './predicates.js';

// ─── refusals ───
export { isSopRefusalCode, SOP_REFUSAL_CODES, sopRefusal } from './refusals.js';
export type { SopRefusal, SopRefusalCode } from './refusals.js';

// ─── spec + digests ───
export {
  computeCompiledHash,
  computeProvenanceHash,
  EXECUTABLE_SOP_SPEC_CONTRACT,
  SOP_DEPENDENCY_KINDS,
} from './spec.js';
export type {
  CompiledContent,
  ExecutableSopPhase,
  ExecutableSopSpec,
  SopDependency,
  SopDependencyKind,
  SopTransition,
} from './spec.js';

// ─── compile ───
export { assertSopExecutable, compileSop } from './compile.js';
export type {
  CompileSopRequest,
  CompileSopResult,
  SopDraft,
  SopPhaseDraft,
  SopReview,
  SopTransitionDraft,
} from './compile.js';

// ─── lazy descriptor + catalog + eligible ───
export {
  checkDescriptor,
  describe,
  describeTokenEstimate,
  DESCRIPTOR_LIMITS,
  descriptorSubject,
  producesOf,
  renderDescriptor,
} from './descriptor.js';
export type { DescriptorSubject } from './descriptor.js';
export { catalog, eligible } from './catalog.js';
export type { SopCatalog, SopCatalogEntry } from './catalog.js';

// ─── ports (single-use is the store's property) ───
export { authorizePhase, loadPhaseBody } from './ports.js';
export type {
  AuthorizationReceipt,
  AuthorizationReceiptPort,
  AuthorizePhaseInput,
  AuthorizePhaseResult,
  SopLoadPort,
  SopLoadRef,
  SopReceiptOutcome,
} from './ports.js';

// ─── fallbacks (manifest entries with codes) ───
export { gapArtifact, mandatoryOnlyManifest } from './fallbacks.js';
export type { GapArtifact, MandatoryOnlyManifest } from './fallbacks.js';
