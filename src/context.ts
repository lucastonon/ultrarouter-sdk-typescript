/**
 * `@ultrarouter/sdk/context`: the pure context runtime. Describe the context a model call is built
 * from as typed, versioned, content-hashed modules; compile them against a per-stage contract into a
 * manifest (what was admitted, what was refused and why); render the manifest into messages; and
 * leave at any time, because `toMessages(fromMessages(m))` reproduces `m` exactly.
 *
 * This is a separate entry point from `@ultrarouter/sdk`: importing the client never loads the
 * context runtime, and the context runtime never needs a network or a running service. It is pure
 * (no I/O, no clock, no randomness); the only host primitive it uses is sha256 from `node:crypto`.
 * Its single dependency, `zod`, is bundled into this entry, so the package still has zero runtime
 * dependencies.
 *
 * @example
 * ```ts
 * import { fromMessages, toMessages } from "@ultrarouter/sdk/context";
 *
 * const messages = [
 *   { role: "system" as const, content: "You are a support assistant." },
 *   { role: "user" as const, content: "Where is my order?" },
 * ];
 * const lifted = fromMessages(messages);
 * console.log(lifted.labels.map((l) => l.kind)); // the segment labels the gateway would assign
 * console.log(JSON.stringify(toMessages(lifted.manifest)) === JSON.stringify(messages)); // true
 * ```
 *
 * @packageDocumentation
 */
import * as runtime from './context-runtime/index.js';

export * from './context-runtime/index.js';

// The portable `*.ur.md` knowledge-pack format and `loadPack`. A pack projects to a context `Module`.
export * from './pack.js';

// The learned-module placement rule (also exported from `@ultrarouter/sdk`).
export * from './learned-placement.js';

// The hosted-prompt render rule (also exported from `@ultrarouter/sdk`).
export * from './prompt-render.js';

// ─────────────────────────────── documented re-exports ───────────────────────────────
// The runtime files are generated from the gateway's implementation and are not edited here. The
// declarations below re-export the members that carry no documentation of their own, adding it.
// A local export takes precedence over the `export *` above, and each one is the identical value or
// type.

/** A trust class: `authoritative`, `approved_derived` or `untrusted` (never admitted into the instruction slot). */
export type TrustClass = runtime.TrustClass;

/** A facet value used for scope matching: a string or a set of strings. */
export type FacetValue = runtime.FacetValue;

/** When a module is available: ISO-8601 `from` / `to` instants, `null` meaning unbounded (a `null` `from` means the module has no availability of its own). */
export type Availability = runtime.Availability;

/**
 * A module: one typed, versioned, content-hashed unit of context (`id`, `version`, `kind`,
 * `memoryClass`, `trustClass`, `privacyClass`, `availability`, `contentHash`, `tokenEstimate`,
 * `facets`, optional `slotHint` and `ext`). Only `trustClass` carries meaning for the compiler; the
 * other labels are carried through.
 */
export type Module = runtime.Module;

/** The zod schema that validates a {@link Module}. */
export const ModuleSchema: typeof runtime.ModuleSchema = runtime.ModuleSchema;

/** A per-kind or per-facet admission cap (`max`), with an optional `label`. */
export type Limit = runtime.Limit;

/** How the compiler treats envelope pins: `strict` (every pin must resolve and match) or `none`. */
export type PinPolicy = runtime.PinPolicy;

/**
 * A per-stage contract: which module kinds are required, optional or forbidden; the budgets; the
 * per-kind or per-facet `limits`; the pin policy; and the slot vocabulary.
 */
export type Contract = runtime.Contract;

/** The zod schema that validates a {@link Contract}. */
export const ContractSchema: typeof runtime.ContractSchema = runtime.ContractSchema;

/** A mandatory pin: an exact module identity (`id`, `kind`, `contentHash`) the envelope requires, with its `purpose`. */
export type Pin = runtime.Pin;

/** The budgets one execution runs under (`tokens`, `toolCalls`, `plannerDepth`, `plannerPass`, `timeMs`, `microUsd`); each is optional. */
export type EnvelopeBudgets = runtime.EnvelopeBudgets;

/**
 * An envelope: the identity of one execution (`id`, `tenant`, `stage`, `mode`, the `asOf` knowledge
 * cutoff, `cutoffs`, `budgets`, `seed`, `pins`, release bindings and the permission epoch). Seal it
 * with `sealEnvelope` to freeze and hash it.
 */
export type Envelope = runtime.Envelope;

/** The zod schema that validates an {@link Envelope}. */
export const EnvelopeSchema: typeof runtime.EnvelopeSchema = runtime.EnvelopeSchema;

/** An exact declared range in the `ur.segments` coordinate system (UTF-16 code units). */
export type ContextRange = runtime.ContextRange;

/** One admitted manifest entry: the module identity, its labels, slot, token estimate and content hash. */
export type ManifestEntry = runtime.ManifestEntry;

/** The zod schema that validates a {@link ManifestEntry}. */
export const ManifestEntrySchema: typeof runtime.ManifestEntrySchema = runtime.ManifestEntrySchema;

/** The token accounting of a compiled manifest. */
export type ManifestBudgets = runtime.ManifestBudgets;

/**
 * A compiled manifest: the admitted entries in order, every refusal with its reason, the budgets, and
 * the envelope and manifest hashes. Send it to the gateway with `toWire(manifest)` as `ur.manifest`.
 */
export type Manifest = runtime.Manifest;

/** The zod schema that validates a {@link Manifest}. */
export const ManifestSchema: typeof runtime.ManifestSchema = runtime.ManifestSchema;

/** Whether a manifest entry was delivered through a provider-native feature (`native`) or not (`unavailable`). */
export type NativeDeliveryState = runtime.NativeDeliveryState;

/** A refusal: why a candidate (or the whole compile) was not admitted, with a stable `code`, a `reason` and whether it is `fatal`. */
export type Refusal = runtime.Refusal;

/** A stable base refusal reason emitted by `compile` (one of `CONTEXT_REFUSAL_REASONS`). */
export type ContextRefusalReason = runtime.ContextRefusalReason;

/** A stable refusal reason emitted when context cannot be delivered (one of `CONTEXT_DELIVERY_REFUSAL_REASONS`). */
export type ContextDeliveryRefusalReason = runtime.ContextDeliveryRefusalReason;

/** A core memory class: one of `CORE_MEMORY_CLASSES` (extend the set with `defineMemoryClasses`). */
export type CoreMemoryClass = runtime.CoreMemoryClass;

/**
 * A compatibility profile: the ordering rule, vocabularies (memory classes, kinds, refusals), limits,
 * budget strategy, render serializer and manifest encoder that `compile` runs under.
 * `ULTRAROUTER_PROFILE` is the default.
 */
export type CompatibilityProfile = runtime.CompatibilityProfile;

/**
 * Compile candidate modules into a manifest under a contract and a profile. Pure and deterministic:
 * the same inputs always produce the same manifest hash. Returns `{ ok, manifest, refusals }`;
 * `manifest` is `null` when a fatal refusal makes the run inadmissible.
 *
 * @example
 * ```ts
 * import { compile, ULTRAROUTER_PROFILE, type Contract, type Envelope, type Module } from "@ultrarouter/sdk/context";
 *
 * const envelope: Envelope = {
 *   id: "env-1", tenant: "acme", stage: "answer", mode: "live", asOf: "2026-01-01T00:00:00.000Z",
 *   cutoffs: {}, budgets: { tokens: 400 }, seed: "s", pins: [], releases: {}, permissionEpoch: "e1",
 * };
 * const contract: Contract = {
 *   stage: "answer", requiredKinds: [], optionalKinds: ["policy", "faq"], forbiddenKinds: [],
 *   budgets: { tokens: 400 }, limits: [], pinPolicy: "none", slots: ["instruction", "reference"],
 * };
 * const policy: Module = {
 *   id: "refunds", version: "3", kind: "policy", memoryClass: "procedural", trustClass: "authoritative",
 *   privacyClass: "internal", availability: { from: "2025-01-01T00:00:00.000Z", to: null },
 *   contentHash: "sha256:refunds-v3", tokenEstimate: 120, facets: {},
 * };
 * const result = compile(envelope, contract, [{ module: policy }], ULTRAROUTER_PROFILE);
 * console.log(result.ok, result.manifest?.entries.map((e) => e.moduleId));
 * ```
 */
export function compile(
  envelope: runtime.Envelope,
  contract: runtime.Contract,
  candidates: readonly runtime.ContextCandidate[],
  profile: runtime.CompatibilityProfile,
): runtime.CompileResult {
  return runtime.compile(envelope, contract, candidates, profile);
}

/** Options for `lintPromptSurface`: `maxPromptTokens` sets the oversized-prompt threshold. */
export type LintOptions = runtime.LintOptions;

/** A prompt-surface lint rule: `oversized_prompt`, `untrusted_interpolation` or `inline_exemplars`. */
export type LintRule = runtime.LintRule;

/** A provider-native delivery channel (one of `NATIVE_DELIVERY_CHANNELS`). */
export type NativeDeliveryChannel = runtime.NativeDeliveryChannel;

/** A requirement a native delivery must satisfy (one of `NATIVE_DELIVERY_REQUIREMENTS`). */
export type NativeDeliveryRequirement = runtime.NativeDeliveryRequirement;

/** A disclosure level for a provider-native feature (one of `NATIVE_DISCLOSURES`). */
export type NativeDisclosure = runtime.NativeDisclosure;

/** Why a native delivery fell back to plain messages (one of `NATIVE_FALLBACK_REASONS`). */
export type NativeFallbackReason = runtime.NativeFallbackReason;

/** A provider-native feature id (one of `NATIVE_FEATURE_IDS`). */
export type NativeFeatureId = runtime.NativeFeatureId;

/** A placement detail for a provider-native feature (one of `NATIVE_PLACEMENT_DETAILS`). */
export type NativePlacementDetail = runtime.NativePlacementDetail;

/** A request to `compileSop`: the authored `draft` and its `review` (or `null` when unreviewed, which is refused). */
export type CompileSopRequest = runtime.CompileSopRequest;

/** An SOP dependency kind (one of `SOP_DEPENDENCY_KINDS`). */
export type SopDependencyKind = runtime.SopDependencyKind;

/** An SOP transition predicate type (one of `SOP_PREDICATE_TYPES`). */
export type SopPredicateType = runtime.SopPredicateType;

/** A stable SOP compiler refusal code (one of `SOP_REFUSAL_CODES`). */
export type SopRefusalCode = runtime.SopRefusalCode;
