# API reference: `@ultrarouter/sdk/context`

Generated from the TypeScript sources and their TSDoc by `scripts/gen-docs.mjs` (do not edit by hand). Version 0.1.0. 252 exports.

```ts
import { /* named exports */ } from '@ultrarouter/sdk/context';
```

## Contents

- **Classes:** [`ContextExitError`](#contextexiterror), [`LoadPackError`](#loadpackerror), [`PackRefusedError`](#packrefusederror), [`PromptVariablesMissingError`](#promptvariablesmissingerror)
- **Functions:** [`applyLearnedContext`](#applylearnedcontext), [`assertSopExecutable`](#assertsopexecutable), [`authorizePhase`](#authorizephase), [`canonicalJson`](#canonicaljson), [`catalog`](#catalog), [`channelsOf`](#channelsof), [`checkDescriptor`](#checkdescriptor), [`compile`](#compile), [`compileSop`](#compilesop), [`computeCompiledHash`](#computecompiledhash), [`computeProvenanceHash`](#computeprovenancehash), [`defaultVolatilityRank`](#defaultvolatilityrank), [`defineKinds`](#definekinds), [`defineMemoryClasses`](#definememoryclasses), [`defineRefusals`](#definerefusals), [`deliveredFacts`](#deliveredfacts), [`deliveryBlocks`](#deliveryblocks), [`describe`](#describe), [`describeTokenEstimate`](#describetokenestimate), [`descriptorSubject`](#descriptorsubject), [`eligible`](#eligible), [`emitFrontmatter`](#emitfrontmatter), [`encodeUltrarouterManifest`](#encodeultraroutermanifest), [`evaluatePredicate`](#evaluatepredicate), [`findNativeCompatibility`](#findnativecompatibility), [`findNativeFeature`](#findnativefeature), [`fromMessages`](#frommessages), [`gapArtifact`](#gapartifact), [`gateSatisfied`](#gatesatisfied), [`hashContextValue`](#hashcontextvalue), [`hashEnvelope`](#hashenvelope), [`isContextDeliveryRefusalReason`](#iscontextdeliveryrefusalreason), [`isContextRefusalReason`](#iscontextrefusalreason), [`isNativeFeatureId`](#isnativefeatureid), [`isSopRefusalCode`](#issoprefusalcode), [`learnedPlacementIndex`](#learnedplacementindex), [`lintPromptSurface`](#lintpromptsurface), [`lintPromptSurfaces`](#lintpromptsurfaces), [`loadPack`](#loadpack), [`loadPhaseBody`](#loadphasebody), [`mandatoryOnlyManifest`](#mandatoryonlymanifest), [`nativeModelId`](#nativemodelid), [`packContentHash`](#packcontenthash), [`packContentProjection`](#packcontentprojection), [`packProvenanceHash`](#packprovenancehash), [`packProvenanceProjection`](#packprovenanceprojection), [`parseFrontmatter`](#parsefrontmatter), [`parsePack`](#parsepack), [`parsePackPredicate`](#parsepackpredicate), [`parsePredicate`](#parsepredicate), [`placementSatisfied`](#placementsatisfied), [`planNativeDelivery`](#plannativedelivery), [`producesOf`](#producesof), [`render`](#render), [`renderDescriptor`](#renderdescriptor), [`renderHostedPromptResult`](#renderhostedpromptresult), [`renderPack`](#renderpack), [`renderPredicate`](#renderpredicate), [`renderPrompt`](#renderprompt), [`scaffoldSubject`](#scaffoldsubject), [`sealEnvelope`](#sealenvelope), [`selectorMatches`](#selectormatches), [`sha256Hex`](#sha256hex), [`sopRefusal`](#soprefusal), [`toMessages`](#tomessages), [`toWire`](#towire), [`validatePack`](#validatepack)
- **Constants:** [`AvailabilitySchema`](#availabilityschema), [`CONTEXT_DELIVERY_REFUSAL_REASONS`](#context_delivery_refusal_reasons), [`CONTEXT_REFUSAL_REASONS`](#context_refusal_reasons), [`ContextRangeSchema`](#contextrangeschema), [`ContractSchema`](#contractschema), [`CORE_MEMORY_CLASSES`](#core_memory_classes), [`defaultRenderSerializer`](#defaultrenderserializer), [`DESCRIPTOR_LIMITS`](#descriptor_limits), [`DESCRIPTOR_MAX_LENGTH`](#descriptor_max_length), [`EnvelopeBudgetsSchema`](#envelopebudgetsschema), [`EnvelopeSchema`](#envelopeschema), [`EXECUTABLE_SOP_SPEC_CONTRACT`](#executable_sop_spec_contract), [`FacetValueSchema`](#facetvalueschema), [`INSTRUCTION_SLOT`](#instruction_slot), [`LEARNED_MESSAGE_ROLE`](#learned_message_role), [`LimitSchema`](#limitschema), [`ManifestBudgetsSchema`](#manifestbudgetsschema), [`ManifestEntrySchema`](#manifestentryschema), [`ManifestSchema`](#manifestschema), [`ModuleSchema`](#moduleschema), [`NATIVE_COMPATIBILITY`](#native_compatibility), [`NATIVE_DELIVERY_CHANNELS`](#native_delivery_channels), [`NATIVE_DELIVERY_REQUIREMENTS`](#native_delivery_requirements), [`NATIVE_DELIVERY_STATES`](#native_delivery_states), [`NATIVE_DESCRIPTOR_KINDS`](#native_descriptor_kinds), [`NATIVE_DISCLOSURES`](#native_disclosures), [`NATIVE_FALLBACK_REASONS`](#native_fallback_reasons), [`NATIVE_FEATURE_IDS`](#native_feature_ids), [`NATIVE_FEATURES`](#native_features), [`NATIVE_OPERATOR_SLOT`](#native_operator_slot), [`NATIVE_PLACEMENT_DETAILS`](#native_placement_details), [`PACK_EXEMPLAR_POLARITIES`](#pack_exemplar_polarities), [`PACK_KINDS`](#pack_kinds), [`PACK_MEMORY_CLASSES`](#pack_memory_classes), [`PACK_NATIVE_DELIVERIES`](#pack_native_deliveries), [`PACK_SLOTS`](#pack_slots), [`PACK_SOP_DEPENDENCY_KINDS`](#pack_sop_dependency_kinds), [`PACK_TRUST_CLASSES`](#pack_trust_classes), [`PIN_POLICIES`](#pin_policies), [`PinSchema`](#pinschema), [`PROMPT_VARIABLES_MISSING_CODE`](#prompt_variables_missing_code), [`REFERENCE_SLOTS`](#reference_slots), [`RefusalSchema`](#refusalschema), [`SOP_DEPENDENCY_KINDS`](#sop_dependency_kinds), [`SOP_PREDICATE_TYPES`](#sop_predicate_types), [`SOP_REFUSAL_CODES`](#sop_refusal_codes), [`SopPredicateSchema`](#soppredicateschema), [`TRUST_CLASSES`](#trust_classes), [`ULTRAROUTER_PROFILE`](#ultrarouter_profile), [`ultrarouterManifestEncoder`](#ultraroutermanifestencoder), [`UR_KNOWLEDGE_FORMAT`](#ur_knowledge_format)
- **Interfaces:** [`AdapterRefusal`](#adapterrefusal), [`AuthorizationReceipt`](#authorizationreceipt), [`AuthorizationReceiptPort`](#authorizationreceiptport), [`AuthorizePhaseInput`](#authorizephaseinput), [`ChatMessage`](#chatmessage), [`CompiledContent`](#compiledcontent), [`CompileResult`](#compileresult), [`ContextCandidate`](#contextcandidate), [`DeliveredFact`](#deliveredfact), [`DescriptorSubject`](#descriptorsubject), [`EncodedManifest`](#encodedmanifest), [`ExecutableSopPhase`](#executablesopphase), [`ExecutableSopSpec`](#executablesopspec), [`GapArtifact`](#gapartifact), [`HostedPromptVariable`](#hostedpromptvariable), [`KindSet`](#kindset), [`LearnedMessage`](#learnedmessage), [`LiftedManifest`](#liftedmanifest), [`LiftExt`](#liftext), [`LiftLabel`](#liftlabel), [`LiftMessageRecord`](#liftmessagerecord), [`LintFinding`](#lintfinding), [`LintInput`](#lintinput), [`LoadedPack`](#loadedpack), [`MandatoryOnlyManifest`](#mandatoryonlymanifest), [`ManifestEncoderContext`](#manifestencodercontext), [`MemoryClassSet`](#memoryclassset), [`NativeCompatibilityRow`](#nativecompatibilityrow), [`NativeConversationTurn`](#nativeconversationturn), [`NativeDeliveryBlock`](#nativedeliveryblock), [`NativeDeliveryContract`](#nativedeliverycontract), [`NativeDeliveryFragment`](#nativedeliveryfragment), [`NativeDeliveryInput`](#nativedeliveryinput), [`NativeDeliveryPlan`](#nativedeliveryplan), [`NativeDeliveryResult`](#nativedeliveryresult), [`NativeDeliveryTarget`](#nativedeliverytarget), [`NativeFeature`](#nativefeature), [`NativeModuleSelector`](#nativemoduleselector), [`NativePlacement`](#nativeplacement), [`NativePlacementRule`](#nativeplacementrule), [`NativeSelectableEntry`](#nativeselectableentry), [`NativeUnsupported`](#nativeunsupported), [`PackBaseRate`](#packbaserate), [`PackBody`](#packbody), [`PackChecklistItem`](#packchecklistitem), [`PackConsent`](#packconsent), [`PackDocument`](#packdocument), [`PackEvidence`](#packevidence), [`PackExemplar`](#packexemplar), [`PackLineage`](#packlineage), [`PackRefuted`](#packrefuted), [`PackSop`](#packsop), [`PackSopDependency`](#packsopdependency), [`PackSopPhase`](#packsopphase), [`PackSopTransitions`](#packsoptransitions), [`PackValidationContext`](#packvalidationcontext), [`PackValidity`](#packvalidity), [`RefusalRegistry`](#refusalregistry), [`RenderablePrompt`](#renderableprompt), [`ScaffoldSubjectEntry`](#scaffoldsubjectentry), [`SealedEnvelope`](#sealedenvelope), [`SopCatalog`](#sopcatalog), [`SopCatalogEntry`](#sopcatalogentry), [`SopDependency`](#sopdependency), [`SopDraft`](#sopdraft), [`SopLoadPort`](#soploadport), [`SopLoadRef`](#soploadref), [`SopPhaseDraft`](#sopphasedraft), [`SopRefusal`](#soprefusal), [`SopReview`](#sopreview), [`SopRuntimeState`](#sopruntimestate), [`SopTransition`](#soptransition), [`SopTransitionDraft`](#soptransitiondraft), [`UrManifestWire`](#urmanifestwire), [`UrManifestWireEntry`](#urmanifestwireentry)
- **Types:** [`AuthorizePhaseResult`](#authorizephaseresult), [`Availability`](#availability), [`BudgetStrategy`](#budgetstrategy), [`CompatibilityProfile`](#compatibilityprofile), [`CompileSopRequest`](#compilesoprequest), [`CompileSopResult`](#compilesopresult), [`ContextDeliveryRefusalReason`](#contextdeliveryrefusalreason), [`ContextRange`](#contextrange), [`ContextRefusalReason`](#contextrefusalreason), [`Contract`](#contract), [`CoreMemoryClass`](#corememoryclass), [`Envelope`](#envelope), [`EnvelopeBudgets`](#envelopebudgets), [`FacetValue`](#facetvalue), [`Limit`](#limit), [`LintOptions`](#lintoptions), [`LintRule`](#lintrule), [`Manifest`](#manifest), [`ManifestBudgets`](#manifestbudgets), [`ManifestEncoder`](#manifestencoder), [`ManifestEncoderInput`](#manifestencoderinput), [`ManifestEntry`](#manifestentry), [`Module`](#module), [`NativeDeliveryChannel`](#nativedeliverychannel), [`NativeDeliveryRequirement`](#nativedeliveryrequirement), [`NativeDeliveryState`](#nativedeliverystate), [`NativeDisclosure`](#nativedisclosure), [`NativeFallbackReason`](#nativefallbackreason), [`NativeFeatureChannel`](#nativefeaturechannel), [`NativeFeatureId`](#nativefeatureid), [`NativePlacementDetail`](#nativeplacementdetail), [`NativePlacementVerdict`](#nativeplacementverdict), [`PackExemplarPolarity`](#packexemplarpolarity), [`PackKind`](#packkind), [`PackMemoryClass`](#packmemoryclass), [`PackNativeDelivery`](#packnativedelivery), [`PackPredicate`](#packpredicate), [`PackRefusalCode`](#packrefusalcode), [`PackSlot`](#packslot), [`PackSopDependencyKind`](#packsopdependencykind), [`PackTrustClass`](#packtrustclass), [`PackValidation`](#packvalidation), [`ParsePredicateResult`](#parsepredicateresult), [`Pin`](#pin), [`PinPolicy`](#pinpolicy), [`Refusal`](#refusal), [`RenderPromptResult`](#renderpromptresult), [`RenderSerializer`](#renderserializer), [`SopDependencyKind`](#sopdependencykind), [`SopPredicate`](#soppredicate), [`SopPredicateType`](#soppredicatetype), [`SopReceiptOutcome`](#sopreceiptoutcome), [`SopRefusalCode`](#soprefusalcode), [`TrustClass`](#trustclass), [`UrKnowledgeFormat`](#urknowledgeformat)

## Classes

### ContextExitError

class · `src/context-runtime/render.ts`

A raised, typed error when `toMessages` is asked to exit a manifest that carries
neither lift reconstruction data nor supplied bodies.

```ts signature
class ContextExitError
```

| Member | Description |
| --- | --- |
| `constructor(message: string)` |  |

### LoadPackError

class · `src/pack.ts`

Thrown by [`loadPack`](#loadpack) when a pack is refused; `refusals` lists every reason.

```ts signature
class LoadPackError
```

| Member | Description |
| --- | --- |
| `readonly refusals: readonly PackRefusalCode[]` | Every refusal. |
| `constructor(refusals: readonly PackRefusalCode[])` | Create the error from the refusal list. |

### PackRefusedError

class · `src/pack.ts`

Thrown by [`parsePack`](#parsepack) for a structural failure; `reason` names it.

```ts signature
class PackRefusedError
```

| Member | Description |
| --- | --- |
| `readonly reason: PackRefusalCode` | The named refusal. |
| `constructor(reason: PackRefusalCode, detail: string)` | Create the error from a refusal and a detail message. |

### PromptVariablesMissingError

class · `src/prompt-render.ts`

A NAMED missing-required-variable refusal (the SDK face of the gateway's `prompt_variables_missing`
error). Lists the missing variable names — never a silent blank. `code` matches the gateway.

```ts signature
class PromptVariablesMissingError
```

| Member | Description |
| --- | --- |
| `readonly code: string` | Always `prompt_variables_missing`. |
| `readonly missing: readonly string[]` | The missing variable names, sorted. |
| `constructor(missing: readonly string[])` | Create the error from the missing variable names. |

## Functions

### applyLearnedContext

function · `src/learned-placement.ts`

Insert the learned block into a customer's messages at [`learnedPlacementIndex`](#learnedplacementindex) — the SAME
splice the gateway inject seam performs (`[...before, { role: 'user', content: body },...after]`).
PURE: returns a NEW array and never mutates the input. When `content` is null/empty (a holdout, or
no learned module) the messages pass through UNCHANGED (byte-identical) — the runtime never adds a
module the platform withheld.

```ts signature
function applyLearnedContext<M extends {
    readonly role?: unknown;
}>(messages: readonly M[], content: string | null | undefined): (M | LearnedMessage)[]
```

### assertSopExecutable

function · `src/context-runtime/sop/compile.ts`

Refuse to treat anything that is not a verified compiled spec as executable. A value
that merely LOOKS like a spec (a JSON blob read back from a store) is re-hashed, so
a hand-edited stored spec is refused rather than executed (extracted from an earlier SOP compiler
`assertSopExecutable`). Pure: recomputes the content + provenance digests.

```ts signature
function assertSopExecutable(candidate: unknown): {
    readonly ok: true;
    readonly spec: ExecutableSopSpec;
} | {
    readonly ok: false;
    readonly refusal: SopRefusal;
}
```

### authorizePhase

function · `src/context-runtime/sop/ports.ts`

Authorize one phase execution. PURE: builds the execution-bound receipt
`{spec_hash, phase, args_hash, exec_id}` and asks the port to record it. An unknown
phase is refused WITHOUT recording; a `duplicate` verdict from the store is the
`SOP_RECEIPT_REUSED` refusal (single use enforced BY the store). Never throws.

```ts signature
function authorizePhase(input: AuthorizePhaseInput, port: AuthorizationReceiptPort): AuthorizePhaseResult
```

### canonicalJson

function · `src/context-runtime/_core/canonical-json.ts`

Serialize `value` as canonical JSON (keys sorted recursively, `Date` as ISO).

```ts signature
function canonicalJson(value: unknown): string
```

### catalog

function · `src/context-runtime/sop/catalog.ts`

Build the compact descriptor catalog for a set of compiled specs. Pure; loads NO
bodies (the descriptor is rendered from the spec's structure alone).

```ts signature
function catalog(specs: readonly ExecutableSopSpec[]): SopCatalog
```

### channelsOf

function · `src/context-runtime/native/plan.ts`

Every delivery block of a fragment, grouped by channel (one group per channel).

```ts signature
function channelsOf(fragment: NativeDeliveryFragment): readonly (readonly NativeDeliveryBlock[])[]
```

### checkDescriptor

function · `src/context-runtime/sop/descriptor.ts`

Enforce the descriptor input contract + budget. Returns the FIRST violated limit as
a `DESCRIPTOR_OVER_BUDGET` refusal (with a `detail` naming it), or null when every
limit holds. Never truncates. Order is documented + stable.

```ts signature
function checkDescriptor(subject: DescriptorSubject): SopRefusal | null
```

### compile

function · `src/context.ts`

Compile candidate modules into a manifest under a contract and a profile. Pure and deterministic:
the same inputs always produce the same manifest hash. Returns `{ ok, manifest, refusals }`;
`manifest` is `null` when a fatal refusal makes the run inadmissible.

```ts signature
function compile(envelope: runtime.Envelope, contract: runtime.Contract, candidates: readonly runtime.ContextCandidate[], profile: runtime.CompatibilityProfile): runtime.CompileResult
```

**Example**

```ts
import { compile, ULTRAROUTER_PROFILE, type Contract, type Envelope, type Module } from "@ultrarouter/sdk/context";

const envelope: Envelope = {
  id: "env-1", tenant: "acme", stage: "answer", mode: "live", asOf: "2026-01-01T00:00:00.000Z",
  cutoffs: {}, budgets: { tokens: 400 }, seed: "s", pins: [], releases: {}, permissionEpoch: "e1",
};
const contract: Contract = {
  stage: "answer", requiredKinds: [], optionalKinds: ["policy", "faq"], forbiddenKinds: [],
  budgets: { tokens: 400 }, limits: [], pinPolicy: "none", slots: ["instruction", "reference"],
};
const policy: Module = {
  id: "refunds", version: "3", kind: "policy", memoryClass: "procedural", trustClass: "authoritative",
  privacyClass: "internal", availability: { from: "2025-01-01T00:00:00.000Z", to: null },
  contentHash: "sha256:refunds-v3", tokenEstimate: 120, facets: {},
};
const result = compile(envelope, contract, [{ module: policy }], ULTRAROUTER_PROFILE);
console.log(result.ok, result.manifest?.entries.map((e) => e.moduleId));
```

### compileSop

function · `src/context-runtime/sop/compile.ts`

Compile a reviewed draft into a typed, immutable executable spec. Stages run in a
fixed order (review → identity → phases → dependencies → transitions → descriptor);
the first stage that refuses returns its refusals with no spec.

```ts signature
function compileSop(request: CompileSopRequest): CompileSopResult
```

### computeCompiledHash

function · `src/context-runtime/sop/spec.ts`

Digest of the content only. Idempotent across re-reviews of the same prose.

```ts signature
function computeCompiledHash(content: CompiledContent): string
```

### computeProvenanceHash

function · `src/context-runtime/sop/spec.ts`

Digest of the content digest plus the review identity ("who approved these exact
bytes, and when" — itself content-addressed).

```ts signature
function computeProvenanceHash(init: {
    readonly compiledHash: string;
    readonly reviewedBy: string;
    readonly reviewedAt: string;
}): string
```

### defaultVolatilityRank

function · `src/context-runtime/profile.ts`

The ultrarouter default volatility ranking: stable (procedural) first, volatile
(episodic) last. Unknown classes rank in the middle so they are never mistaken for
the most stable prefix.

```ts signature
function defaultVolatilityRank(entry: ManifestEntry): number
```

### defineKinds

function · `src/context-runtime/kinds.ts`

Build a kind set from a parent's (or the default's) kind vocabulary. Duplicates
are collapsed; order is preserved for stable serialization.

```ts signature
function defineKinds(kinds: readonly string[]): KindSet
```

### defineMemoryClasses

function · `src/context-runtime/memory.ts`

Build a memory-class set. The core four are always present; `extra` appends a
parent's own classes (deduplicated, order preserved). The compiler treats every
member as an opaque label.

```ts signature
function defineMemoryClasses(extra: readonly string[] = []): MemoryClassSet
```

### defineRefusals

function · `src/context-runtime/refusals.ts`

Build a refusal registry.

With no arguments this is the ultrarouter default: the base reasons ARE the codes.
A parent profile passes `extraCodes` (its own vocabulary, which must be emitted
verbatim) and a `map` from (reason, detail) → code; anything the map does not
cover falls back to the base reason string, which keeps the registry total.

```ts signature
function defineRefusals(config?: {
    readonly extraCodes?: readonly string[];
    readonly map?: (reason: ContextRefusalReason, detail?: string) => string | undefined;
}): RefusalRegistry
```

### deliveredFacts

function · `src/context-runtime/native/plan.ts`

The SET OF FACTS a plan delivers: one entry per module, identity + classification
only, SORTED BY `moduleId` so two plans that group modules into different channels
compare directly.

This is the subject of the fallback-parity property: native delivery and the
inline fallback must deliver the SAME facts — nothing dropped, nothing invented,
nothing reclassified. It deliberately excludes the body text: a
`disclosure: 'descriptor'` channel (tool search / deferred loading) sends fewer BYTES
up front by design while making the SAME module available to the execution.

```ts signature
function deliveredFacts(plan: NativeDeliveryPlan): readonly DeliveredFact[]
```

### deliveryBlocks

function · `src/context-runtime/native/plan.ts`

Every delivery block of a fragment, flattened. Pure.

```ts signature
function deliveryBlocks(fragment: NativeDeliveryFragment): readonly NativeDeliveryBlock[]
```

### describe

function · `src/context-runtime/sop/descriptor.ts`

Render the descriptor of an already-compiled spec. `compileSop` enforced the input
contract at compile time, so a compiled spec's descriptor always fits. Pure.

```ts signature
function describe(spec: ExecutableSopSpec): string
```

### describeTokenEstimate

function · `src/context-runtime/sop/descriptor.ts`

The estimated tokens of a spec's descriptor (chars/4, the ONE estimator).

```ts signature
function describeTokenEstimate(spec: ExecutableSopSpec): number
```

### descriptorSubject

function · `src/context-runtime/sop/descriptor.ts`

Build the descriptor subject from a compiled spec.

```ts signature
function descriptorSubject(spec: ExecutableSopSpec): DescriptorSubject
```

### eligible

function · `src/context-runtime/sop/catalog.ts`

The admissible SOP ids for the current runtime state — each spec whose
applicability predicate holds. Pure + deterministic; returns ids in `specs` order.
Loads NO bodies (planning reads descriptors/predicates only).

```ts signature
function eligible(specs: readonly ExecutableSopSpec[], state: SopRuntimeState): readonly string[]
```

### emitFrontmatter

function · `src/pack.ts`

Emit a frontmatter object as the constrained YAML a pack uses (block maps for `blockKeys`, inline JSON otherwise).

```ts signature
function emitFrontmatter(obj: Record<string, unknown>, blockKeys: ReadonlySet<string> = new Set()): string
```

### encodeUltrarouterManifest

function · `src/context-runtime/profile.ts`

The ultrarouter-default manifest bytes: the canonical JSON over a stable,
bodies-free subject. Two structurally-equal manifests encode identically. Takes no
`ctx` (the default reads only the core manifest) so the lift path can reuse it.

`nativeDelivery` is bound into the subject ONLY WHEN PRESENT (not as
`?? null` like `range`/`ext`). That is deliberate: the field distinguishes "this
execution never asked about native delivery" from "it asked and the fallback ran", so
a manifest that never asked must keep its previous bytes — content addresses already
stored cannot be invalidated by a delivery feature
the execution never used. A manifest that DID record a delivery decision hashes
differently from one that recorded the other decision, which is the point.

```ts signature
function encodeUltrarouterManifest(manifest: ManifestEncoderInput): EncodedManifest
```

### evaluatePredicate

function · `src/context-runtime/sop/predicates.ts`

Evaluate a predicate against runtime state. Pure + total: `all([])` is true,
`any([])` is false, a missing budget kind is 0 remaining.

```ts signature
function evaluatePredicate(predicate: SopPredicate, state: SopRuntimeState): boolean
```

### findNativeCompatibility

function · `src/context-runtime/native/table.ts`

The row for one (provider, model, feature) triple, or `null` when the table declares
none — the fallback case. This is the ONLY way support is decided.

```ts signature
function findNativeCompatibility(target: Pick<NativeDeliveryTarget, 'provider' | 'model'>, feature: NativeFeatureId, table: readonly NativeCompatibilityRow[] = NATIVE_COMPATIBILITY): NativeCompatibilityRow | null
```

### findNativeFeature

function · `src/context-runtime/native/features.ts`

Look a feature up by id in a feature table (default: the frozen v1 set).

```ts signature
function findNativeFeature(id: string, features: readonly NativeFeature[] = NATIVE_FEATURES): NativeFeature | null
```

### fromMessages

function · `src/context-runtime/lift.ts`

Lift an OpenAI `messages` array into a labelled manifest via the gateway segmenter.
`hints` are the SDK `ur.segments` labels (same input the gateway honours). Pure.

```ts signature
function fromMessages(messages: readonly PromptMessage[], hints?: readonly SegmentHint[]): LiftedManifest
```

### gapArtifact

function · `src/context-runtime/sop/fallbacks.ts`

Build a named gap artifact for a phase that could not run because `missing` was
absent. Pure.

```ts signature
function gapArtifact(spec: ExecutableSopSpec, phase: string, missing: string, reason = `phase "${phase}" could not run: required "${missing}" was not observed`): GapArtifact
```

### gateSatisfied

function · `src/context-runtime/native/table.ts`

Whether the caller is sending the gate a row requires (a `null` gate needs nothing).

```ts signature
function gateSatisfied(row: NativeCompatibilityRow, target: NativeDeliveryTarget): boolean
```

### hashContextValue

function · `src/context-runtime/hash.ts`

The ultrarouter-default content digest: sha256 hex over the canonical JSON
of a value. Deterministic and pure — two structurally-equal values digest
identically regardless of key order.

```ts signature
function hashContextValue(value: unknown): string
```

### hashEnvelope

function · `src/context-runtime/envelope.ts`

The ultrarouter-default digest of an envelope's exact validated content.

```ts signature
function hashEnvelope(envelope: Envelope): string
```

### isContextDeliveryRefusalReason

function · `src/context-runtime/refusals.ts`

Whether `value` is one of the delivery refusal reasons.

```ts signature
function isContextDeliveryRefusalReason(value: string): value is ContextDeliveryRefusalReason
```

### isContextRefusalReason

function · `src/context-runtime/refusals.ts`

Whether `value` is one of the base refusal reasons.

```ts signature
function isContextRefusalReason(value: string): value is ContextRefusalReason
```

### isNativeFeatureId

function · `src/context-runtime/native/features.ts`

Whether `value` is one of the closed v1 feature ids.

```ts signature
function isNativeFeatureId(value: string): value is NativeFeatureId
```

### isSopRefusalCode

function · `src/context-runtime/sop/refusals.ts`

Whether `value` is one of the closed SOP refusal codes.

```ts signature
function isSopRefusalCode(value: string): value is SopRefusalCode
```

### learnedPlacementIndex

function · `src/learned-placement.ts`

The CACHE-SAFE placement index ("cache-placed after the stable prefix"). The learned
block is inserted immediately AFTER the leading run of `system` messages, so (a) the provider's
stable prefix stays byte-identical, and (b) the learned block — itself stable for a call type —
EXTENDS that prefix rather than invalidating it. A conversation with no leading system message
places the block FIRST (index 0), still ahead of every volatile turn.

```ts signature
function learnedPlacementIndex(messages: readonly {
    readonly role?: unknown;
}[]): number
```

### lintPromptSurface

function · `src/context-runtime/lint.ts`

Scan ONE prompt-surface file. Pure, deterministic, non-mutating. Findings are ordered
by line then rule so two runs over the same input are byte-identical.

```ts signature
function lintPromptSurface(input: LintInput, options: LintOptions = {}): readonly LintFinding[]
```

### lintPromptSurfaces

function · `src/context-runtime/lint.ts`

Scan many files in the order given. Convenience over [`lintPromptSurface`](#lintpromptsurface).

```ts signature
function lintPromptSurfaces(inputs: readonly LintInput[], options: LintOptions = {}): readonly (LintFinding & {
    readonly path: string;
})[]
```

### loadPack

function · `src/pack.ts`

Parse and validate a pack, failing closed, and project it to a context `Module` (its
`contentHash` is the join key). Throws [`LoadPackError`](#loadpackerror) listing every refusal.

```ts signature
function loadPack(text: string, ctx: PackValidationContext = {}): LoadedPack
```

**Example**

```ts
import { readFileSync } from "node:fs";
import { loadPack } from "@ultrarouter/sdk/context";

const { document, module } = loadPack(readFileSync("knowledge/release-checklist.ur.md", "utf8"), {
  workspace: "ws_fixture",
});
console.log(document.kind, module.contentHash === document.contentHash);
```

### loadPhaseBody

function · `src/context-runtime/sop/ports.ts`

Load a phase's full body via the caller's [`SopLoadPort`](#soploadport), at the gated phase
boundary. This is the ONLY package path that calls `load`; planning never does.
Validates the phase exists first. Pure dispatcher — it touches no store itself.

```ts signature
function loadPhaseBody(port: SopLoadPort, spec: ExecutableSopSpec, phase: string): unknown
```

### mandatoryOnlyManifest

function · `src/context-runtime/sop/fallbacks.ts`

Build the mandatory-only fallback manifest entry for a spec whose planner bound was
exceeded. Pure; keeps only the `mandatory` phases, in execution order.

```ts signature
function mandatoryOnlyManifest(spec: ExecutableSopSpec, reason = 'planner bound exceeded; dropped to the mandatory-only manifest'): MandatoryOnlyManifest
```

### nativeModelId

function · `src/context-runtime/native/table.ts`

The provider-native model id the table is keyed on. A `<provider>/` prefix for THIS
target's provider is stripped (the model catalog's `<provider>/<model>` convention);
anything else is used VERBATIM, so a foreign prefix can never be mistaken for a
supported model. Pure.

```ts signature
function nativeModelId(provider: string, model: string): string
```

### packContentHash

function · `src/pack.ts`

Compute a pack's `content_hash` (the join key) from its content projection.

```ts signature
function packContentHash(doc: PackDocument): string
```

### packContentProjection

function · `src/pack.ts`

The canonical projection a pack's `content_hash` is computed over.

```ts signature
function packContentProjection(doc: PackDocument): Record<string, unknown>
```

### packProvenanceHash

function · `src/pack.ts`

Compute a pack's `provenance_hash`, which binds an SOP pack to its reviewed provenance.

```ts signature
function packProvenanceHash(doc: PackDocument): string
```

### packProvenanceProjection

function · `src/pack.ts`

The canonical projection a pack's `provenance_hash` is computed over.

```ts signature
function packProvenanceProjection(doc: PackDocument): Record<string, unknown>
```

### parseFrontmatter

function · `src/pack.ts`

Parse the constrained YAML frontmatter a pack uses. Throws on malformed input.

```ts signature
function parseFrontmatter(text: string): Record<string, unknown>
```

### parsePack

function · `src/pack.ts`

Parse `*.ur.md` text into a [`PackDocument`](#packdocument). Structural only: it throws
[`PackRefusedError`](#packrefusederror) on a malformed document but does not check the hashes (use
[`validatePack`](#validatepack) or [`loadPack`](#loadpack)).

```ts signature
function parsePack(text: string): PackDocument
```

### parsePackPredicate

function · `src/pack.ts`

Parse an `applies_when` value into a [`PackPredicate`](#packpredicate), or `null` when it is not a valid predicate.

```ts signature
function parsePackPredicate(value: unknown): PackPredicate | null
```

### parsePredicate

function · `src/context-runtime/sop/predicates.ts`

Validate an untrusted authoring value against the closed predicate set. Pure —
a value outside the set yields `{ ok: false }` (mapped to `SOP_PREDICATE_UNKNOWN`
by the compiler), NEVER a throw and NEVER a silent pass-through.

```ts signature
function parsePredicate(value: unknown): ParsePredicateResult
```

### placementSatisfied

function · `src/context-runtime/native/features.ts`

Evaluate a placement rule against the conversation the delivery is appended to.

FAIL CLOSED: the insertion point is the END of `conversation`, so an ABSENT or EMPTY
conversation satisfies NOTHING — a rule is never skipped because its evidence is
missing. `neverFirst` is checked before `requiresPrecedingRole` so an empty
conversation always reports `never_first`.

```ts signature
function placementSatisfied(rule: NativePlacementRule | undefined, conversation: readonly NativeConversationTurn[] | undefined): NativePlacementVerdict
```

### planNativeDelivery

function · `src/context-runtime/native/plan.ts`

Plan how a compiled manifest is DELIVERED to one provider/model.

Never throws on a delivery decision (refusals are data, like the compiler's); it does
validate the manifest with `ManifestSchema`, which throws on a malformed input exactly
as `compile` does.

```ts signature
function planNativeDelivery(input: NativeDeliveryInput): NativeDeliveryResult
```

### producesOf

function · `src/context-runtime/sop/descriptor.ts`

The union of a spec's phases' artifact contracts — what the SOP produces. Deduped,
sorted, deterministic.

```ts signature
function producesOf(spec: {
    readonly phases: readonly {
        readonly artifactContracts: readonly string[];
    }[];
}): readonly string[]
```

### render

function · `src/context-runtime/render.ts`

Render a compiled manifest into provider messages using a serializer (default: the
ultrarouter serializer). `bodies` maps `moduleId` → body text. Pure.

```ts signature
function render(manifest: Manifest, bodies: ReadonlyMap<string, string>, serializer: RenderSerializer = defaultRenderSerializer): readonly ChatMessage[]
```

### renderDescriptor

function · `src/context-runtime/sop/descriptor.ts`

Render a descriptor to its compact surface string. Pure + deterministic; performs
NO validation (see [`checkDescriptor`](#checkdescriptor) for the input contract).

```ts signature
function renderDescriptor(subject: DescriptorSubject): string
```

### renderHostedPromptResult

function · `src/prompt-render.ts`

Render a hosted prompt template (pure), returning a result object instead of throwing. It
substitutes every `{{name}}` slot with the
supplied value (coerced to a string); FAIL-CLOSED with `{ ok:false, missing }` (sorted, de-duped) when
any DECLARED-REQUIRED variable is absent/null/undefined. A missing OPTIONAL variable (declared not
required, or an undeclared `{{slot}}`) renders as the empty string.

```ts signature
function renderHostedPromptResult(input: {
    readonly template: string;
    readonly variables: readonly HostedPromptVariable[];
    readonly vars?: Readonly<Record<string, unknown>>;
}): RenderPromptResult
```

### renderPack

function · `src/pack.ts`

Render a pack document to its canonical `*.ur.md` text. `renderPack(parsePack(text))` reproduces `text`.

```ts signature
function renderPack(doc: PackDocument): string
```

### renderPredicate

function · `src/context-runtime/sop/predicates.ts`

Render a predicate to the surface syntax — the exact strings the plan
names (`artifact_present(contract)`, `stop_condition(id)`, `budget_remaining(kind) > n`,
`all(…)`, `any(…)`). Deterministic; used by the descriptor's rendered `when`.

```ts signature
function renderPredicate(predicate: SopPredicate): string
```

### renderPrompt

function · `src/prompt-render.ts`

Render a hosted prompt (the ergonomic API) — returns the substituted instruction string, or THROWS
[`PromptVariablesMissingError`](#promptvariablesmissingerror) listing the names when a DECLARED-REQUIRED variable is missing
(fail-closed, the SAME rule the gateway applies — never a silent blank). `prompt` is the shape
`UltraRouter.getPrompt` / preflight `prompt` returns.

```ts signature
function renderPrompt(prompt: RenderablePrompt, vars?: Readonly<Record<string, unknown>>): string
```

### scaffoldSubject

function · `src/context-runtime/manifest.ts`

The ordered scaffold subject for a set of entries. Pure; hashed by the caller.

```ts signature
function scaffoldSubject(entries: readonly Pick<ManifestEntry, 'moduleId' | 'kind' | 'slot' | 'mandatory' | 'order'>[]): readonly ScaffoldSubjectEntry[]
```

### sealEnvelope

function · `src/context-runtime/envelope.ts`

Parse, deep-freeze and hash an envelope. The frozen object cannot be mutated by a
later stage; the hash is what pins it into the manifest and survives the process.

```ts signature
function sealEnvelope(raw: Envelope): SealedEnvelope
```

### selectorMatches

function · `src/context-runtime/native/features.ts`

Whether a selector admits an entry. Every declared field must match (AND). Pure.

```ts signature
function selectorMatches(selector: NativeModuleSelector, entry: NativeSelectableEntry): boolean
```

### sha256Hex

function · `src/context-runtime/_core/sha256-hex.ts`

SHA-256 hex digest of a UTF-8 string. Deterministic and pure; `node:crypto` gives a
synchronous digest (WebCrypto's is asynchronous only).

This module is shipped verbatim in the public SDK: keep its comments free of internal
references.

```ts signature
function sha256Hex(text: string): string
```

### sopRefusal

function · `src/context-runtime/sop/refusals.ts`

Build a [`SopRefusal`](#soprefusal). Pure data — omits undefined optional fields so two
refusals with the same content are structurally (and canonically) equal.

```ts signature
function sopRefusal(code: SopRefusalCode, message: string, extra?: {
    readonly detail?: string;
    readonly path?: string;
}): SopRefusal
```

### toMessages

function · `src/context-runtime/render.ts`

Exit a manifest back to messages. A LIFTED manifest reconstructs the exact original
input: each message's string content is rebuilt by concatenating its segments' texts
in range order (proving the segments are lossless), and non-content keys are restored
in their original order — byte-identical for `toMessages(fromMessages(m))`. A
COMPILED manifest is rendered from `bodies` via the default serializer. Pure.

```ts signature
function toMessages(manifest: Manifest, bodies?: ReadonlyMap<string, string>): readonly ChatMessage[]
```

### toWire

function · `src/context-runtime/manifest.ts`

Render a manifest to the wire shape. Pure; carries no bodies.

```ts signature
function toWire(manifest: Manifest): UrManifestWire
```

### validatePack

function · `src/pack.ts`

Validate a parsed pack: closed vocabularies, the trust/slot rules, recomputed hashes, and (from
`ctx`) the tenant and export consent. Returns every refusal, never throws.

```ts signature
function validatePack(doc: PackDocument, ctx: PackValidationContext = {}): PackValidation
```

## Constants

### AvailabilitySchema

const · `src/context-runtime/module.ts`

When a module is available. `from`/`to` are ISO-8601 instants or null (unbounded).
A null `from` means "no availability of its own" — the compiler treats that as an
availability refusal unless the profile's mode tolerates it.

```ts signature
const AvailabilitySchema = z.object({
  from: z.string().min(1).nullable(),
  to: z.string().min(1).nullable(),
})
```

### CONTEXT_DELIVERY_REFUSAL_REASONS

const · `src/context-runtime/refusals.ts`

DELIVERY refusals — emitted by the native-delivery layer (`./native/plan.ts`),
NEVER by `compile`.

They are kept OUT of [`CONTEXT_REFUSAL_REASONS`](#context_refusal_reasons) on purpose: that set is the
specification table verbatim (the admission algorithm's closed vocabulary, whose completeness
the compile test suite asserts by exercising every member). A delivery reason no compiler
path can emit does not belong in it. Both vocabularies share the ONE [`Refusal`](#refusal)
shape, so a delivery refusal records on a manifest exactly like an admission one.

`NATIVE_UNAVAILABLE` is emitted ONLY when the contract REQUIRED native delivery. A
contract that merely PREFERS it degrades silently — the record is
`manifest.nativeDelivery = 'unavailable'` plus the plan's `unsupported` list, never a
refusal code.

```ts signature
const CONTEXT_DELIVERY_REFUSAL_REASONS = ['NATIVE_UNAVAILABLE'] as const
```

### CONTEXT_REFUSAL_REASONS

const · `src/context-runtime/refusals.ts`

The base refusal reasons (the closed generic vocabulary the compiler
emits). A profile's `encode` maps each onto the concrete code string it renders.

```ts signature
const CONTEXT_REFUSAL_REASONS = [
  'STAGE_CONTRACT_MISMATCH',
  'PLANNER_BOUND_EXCEEDED',
  'PINNED_CONTEXT_NOT_REQUESTED',
  'REQUIRED_CONTEXT_NOT_PINNED',
  'PINNED_CONTEXT_MISMATCH',
  'REQUIRED_CONTEXT_MISSING',
  'AUTHORITATIV …
```

### ContextRangeSchema

const · `src/context-runtime/manifest.ts`

A wire range in the `ur.segments` coordinate system (UTF-16 code units).

```ts signature
const ContextRangeSchema = z.object({
  messageIndex: z.number().int().nonnegative(),
  partIndex: z.number().int().nonnegative().optional(),
  start: z.number().int().nonnegative(),
  end: z.number().int().nonnegative(),
})
```

### ContractSchema

const · `src/context.ts`

The zod schema that validates a [`Contract`](#contract).

```ts signature
const ContractSchema: typeof runtime.ContractSchema
```

### CORE_MEMORY_CLASSES

const · `src/context-runtime/memory.ts`

The core four memory classes (`Module.memoryClass`).

```ts signature
const CORE_MEMORY_CLASSES = ['working', 'episodic', 'semantic', 'procedural'] as const
```

### defaultRenderSerializer

const · `src/context-runtime/messages.ts`

The ultrarouter-default serializer. Deterministic: entries are consumed in manifest
order; a missing body renders an empty string (never a throw). Instruction-slot
modules concatenate into ONE system message; reference/exemplar modules concatenate
into ONE fenced user message led by the safety note; any other slot becomes an
ordered user message. A manifest with no entries renders no messages.

```ts signature
const defaultRenderSerializer: RenderSerializer
```

### DESCRIPTOR_LIMITS

const · `src/context-runtime/sop/descriptor.ts`

The descriptor input contract. Each limit is enforced independently.

```ts signature
const DESCRIPTOR_LIMITS = {
  /** Overall rendered descriptor ceiling: 240 chars ≈ 60 tokens (chars/4). */
  maxChars: 240,
  /** Overall token ceiling (the chars/4 estimate of the rendered descriptor). */
  maxTokens: 60,
  i …
```

### DESCRIPTOR_MAX_LENGTH

const · `src/pack.ts`

The maximum length of a pack `descriptor`, in characters.

```ts signature
const DESCRIPTOR_MAX_LENGTH = 240
```

### EnvelopeBudgetsSchema

const · `src/context-runtime/envelope.ts`

The deterministic budgets one execution runs under. Every field is optional so a
profile that does not model a given budget kind simply omits it.

```ts signature
const EnvelopeBudgetsSchema = z.object({
  tokens: z.number().int().nonnegative().optional(),
  toolCalls: z.number().int().nonnegative().optional(),
  plannerDepth: z.number().int().nonnegative().optional(),
  plannerPass: z.numb …
```

### EnvelopeSchema

const · `src/context.ts`

The zod schema that validates an [`Envelope`](#envelope).

```ts signature
const EnvelopeSchema: typeof runtime.EnvelopeSchema
```

### EXECUTABLE_SOP_SPEC_CONTRACT

const · `src/context-runtime/sop/spec.ts`

Contract token stamped into every digest subject (spec identity).

```ts signature
const EXECUTABLE_SOP_SPEC_CONTRACT = 'ultrarouter/executable-sop-spec/v1'
```

### FacetValueSchema

const · `src/context-runtime/module.ts`

A facet value — a scalar or a set (used by parent adapters for scope matching).

```ts signature
const FacetValueSchema = z.union([z.string(), z.array(z.string())])
```

### INSTRUCTION_SLOT

const · `src/context-runtime/messages.ts`

The instruction slot name the default serializer treats as system instructions.

```ts signature
const INSTRUCTION_SLOT = 'instruction'
```

### LEARNED_MESSAGE_ROLE

const · `src/learned-placement.ts`

The role the learned block is injected under — a DATA `user` message, exactly as the seam splices.

```ts signature
const LEARNED_MESSAGE_ROLE = 'user'
```

### LimitSchema

const · `src/context-runtime/contract.ts`

A per-kind or per-facet cap. `max` admits at most that many matching modules
(for example per-kind caps such as 3, 8 or 25, and
per-facet caps such as `facet:'polarity'`). A limit with a `kind` counts
that kind; a limit with `facet`(+optional `facetValue`) counts modules whose facet
matches. `LIMIT_EXCEEDED` is emitted when a candidate would exceed a cap.

```ts signature
const LimitSchema = z.object({
  kind: z.string().min(1).optional(),
  facet: z.string().min(1).optional(),
  facetValue: z.string().min(1).optional(),
  max: z.number().int().nonnegative(),
  label: z.string().min(1).op …
```

### ManifestBudgetsSchema

const · `src/context-runtime/manifest.ts`

Admission accounting for one manifest.

```ts signature
const ManifestBudgetsSchema = z.object({
  tokensAdmitted: z.number().int().nonnegative(),
  tokenLimit: z.number().int().nonnegative().nullable(),
  admitted: z.number().int().nonnegative(),
  refused: z.number().int().nonnegativ …
```

### ManifestEntrySchema

const · `src/context.ts`

The zod schema that validates a [`ManifestEntry`](#manifestentry).

```ts signature
const ManifestEntrySchema: typeof runtime.ManifestEntrySchema
```

### ManifestSchema

const · `src/context.ts`

The zod schema that validates a [`Manifest`](#manifest).

```ts signature
const ManifestSchema: typeof runtime.ManifestSchema
```

### ModuleSchema

const · `src/context.ts`

The zod schema that validates a [`Module`](#module).

```ts signature
const ModuleSchema: typeof runtime.ModuleSchema
```

### NATIVE_COMPATIBILITY

const · `src/context-runtime/native/table.ts`

The v1 compatibility table.

`mid_conversation_system` carries NO gate value: the specification names none, so the
pair is gated by the MODEL alone — which is why it is declared for the three larger
models and NOT for `claude-haiku-4-5`. A haiku target therefore takes the fallback for
turn-scoped operator text and for the memory tool: model gating expressed as missing
rows rather than a condition.

```ts signature
const NATIVE_COMPATIBILITY: readonly NativeCompatibilityRow[]
```

### NATIVE_DELIVERY_CHANNELS

const · `src/context-runtime/native/features.ts`

Where a module is delivered. `inline` is the ONE documented fallback.

```ts signature
const NATIVE_DELIVERY_CHANNELS = [
  'deferred_tool',
  'memory',
  'compaction_window',
  'mid_conversation_system',
  'inline',
] as const
```

### NATIVE_DELIVERY_REQUIREMENTS

const · `src/context-runtime/native/plan.ts`

How strongly the stage contract wants native delivery.

```ts signature
const NATIVE_DELIVERY_REQUIREMENTS = ['required', 'preferred'] as const
```

### NATIVE_DELIVERY_STATES

const · `src/context-runtime/manifest.ts`

Native delivery, as recorded on the manifest. `native` = at least one entry was
delivered through a provider's own context feature; `unavailable` = the ONE documented
fallback ran (the catalog was rendered inline).

The field is OPTIONAL and means three different things by presence: ABSENT = this
execution never asked about native delivery (a plain `compile` output), `unavailable` =
it asked and the fallback ran, `native` = it asked and a native channel carried it.
"Did not ask" is deliberately distinguishable from "asked and could not".

```ts signature
const NATIVE_DELIVERY_STATES = ['native', 'unavailable'] as const
```

### NATIVE_DESCRIPTOR_KINDS

const · `src/context-runtime/native/features.ts`

The kinds a module must declare to be delivered as a deferred-loading tool. A module
is a descriptor because it SAYS so, never because the planner guessed
(planning loads descriptors only).

```ts signature
const NATIVE_DESCRIPTOR_KINDS = ['sop_descriptor', 'tool_descriptor'] as const
```

### NATIVE_DISCLOSURES

const · `src/context-runtime/native/features.ts`

What the model sees up front on this channel.

  - `full` — the module is delivered in the request as material the model reads now.
  - `descriptor` — the module delivered IS a compact descriptor, and the material it
    NAMES (the SOP/tool body) is fetched by the model on demand through the provider's
    own tool search. That deferred material was never a manifest module, so the PLAN
    still carries the same bytes for the module itself as the inline fallback would —
    which is why fallback parity can assert facts AND bytes. The saving comes from the
    provider not expanding what the descriptor points at.

```ts signature
const NATIVE_DISCLOSURES = ['full', 'descriptor'] as const
```

### NATIVE_FALLBACK_REASONS

const · `src/context-runtime/native/plan.ts`

Why an entry took the inline fallback (a closed, reportable vocabulary).

```ts signature
const NATIVE_FALLBACK_REASONS = [
  /** No declared feature selects this entry — it was never a native candidate. */
  'no_matching_feature',
  /** The (provider, model, feature) triple has no row in the compatibility table. */
  'f …
```

### NATIVE_FEATURE_IDS

const · `src/context-runtime/native/features.ts`

The closed v1 feature vocabulary (the specification names exactly these).

```ts signature
const NATIVE_FEATURE_IDS = [
  'tool_search_deferred_loading',
  'server_compaction',
  'context_editing',
  'memory_tool',
  'mid_conversation_system',
] as const
```

### NATIVE_FEATURES

const · `src/context-runtime/native/features.ts`

The FOUR frozen v1 mappings, in PRIORITY order: an entry matched
by several features is delivered through the FIRST one in this list that its target
actually supports. Order is part of the contract — it is what makes the plan
deterministic.

```ts signature
const NATIVE_FEATURES: readonly NativeFeature[]
```

### NATIVE_OPERATOR_SLOT

const · `src/context-runtime/native/features.ts`

The slot that marks turn-scoped OPERATOR text.

```ts signature
const NATIVE_OPERATOR_SLOT = 'operator'
```

### NATIVE_PLACEMENT_DETAILS

const · `src/context-runtime/native/features.ts`

Why a placement rule was not satisfied (a closed, reportable vocabulary).

```ts signature
const NATIVE_PLACEMENT_DETAILS = ['never_first', 'preceding_role'] as const
```

### PACK_EXEMPLAR_POLARITIES

const · `src/pack.ts`

Exemplar polarities: a `positive` example to follow or a `negative` one to avoid.

```ts signature
const PACK_EXEMPLAR_POLARITIES = ['positive', 'negative'] as const
```

### PACK_KINDS

const · `src/pack.ts`

Every pack kind: an SOP, a learned pack, an exemplar set, a checklist or a calibration table.

```ts signature
const PACK_KINDS = [
  'sop',
  'learned_pack',
  'exemplar_set',
  'checklist',
  'calibration_table',
] as const
```

### PACK_MEMORY_CLASSES

const · `src/pack.ts`

Every memory class a pack may declare.

```ts signature
const PACK_MEMORY_CLASSES = [
  'working',
  'episodic',
  'semantic',
  'procedural',
  'declared',
] as const
```

### PACK_NATIVE_DELIVERIES

const · `src/pack.ts`

Every native-delivery declaration a pack may carry.

```ts signature
const PACK_NATIVE_DELIVERIES = ['anthropic', 'inline', 'unavailable'] as const
```

### PACK_SLOTS

const · `src/pack.ts`

Every slot a pack may target.

```ts signature
const PACK_SLOTS = ['learned', 'reference', 'exemplar', 'instruction'] as const
```

### PACK_SOP_DEPENDENCY_KINDS

const · `src/pack.ts`

Every SOP dependency kind.

```ts signature
const PACK_SOP_DEPENDENCY_KINDS = ['POLICY', 'PACKET', 'RUBRIC'] as const
```

### PACK_TRUST_CLASSES

const · `src/pack.ts`

Every trust class a pack may declare.

```ts signature
const PACK_TRUST_CLASSES = ['authoritative', 'approved_derived', 'untrusted'] as const
```

### PIN_POLICIES

const · `src/context-runtime/contract.ts`

How the compiler treats envelope pins. `strict`: every pin must resolve + match its
kind/hash or the run is inadmissible. `none`: the profile does not use pins.

```ts signature
const PIN_POLICIES = ['strict', 'none'] as const
```

### PinSchema

const · `src/context-runtime/envelope.ts`

A mandatory pin: an exact module identity the envelope requires by id + kind + hash.

```ts signature
const PinSchema = z.object({
  id: z.string().min(1),
  kind: z.string().min(1),
  contentHash: z.string().min(1),
  purpose: z.string().trim().min(1).max(200),
})
```

### PROMPT_VARIABLES_MISSING_CODE

const · `src/prompt-render.ts`

The stable error code the gateway raises for a missing required hosted-prompt variable.

```ts signature
const PROMPT_VARIABLES_MISSING_CODE = 'prompt_variables_missing'
```

### REFERENCE_SLOTS

const · `src/context-runtime/messages.ts`

Slots whose content is fenced data (never an instruction).

```ts signature
const REFERENCE_SLOTS: readonly string[]
```

### RefusalSchema

const · `src/context-runtime/refusals.ts`

A single refusal. `code` is the string the active profile renders — identical to the
base reason under the ultrarouter default, the parent's verbatim code under a parent
profile (the parity seam). `reason` is the generic classification: for a refusal the
COMPILER emits it is always one of [`CONTEXT_REFUSAL_REASONS`](#context_refusal_reasons); for a refusal an
ADAPTER pre-computes (parent authority — cross-tenant, dedupe, lease, locale) it is
the parent's own reason string, which the base vocabulary does not enumerate. `detail`
disambiguates reasons a parent splits into several codes (availability: `after_cutoff`
vs `unknown`).

```ts signature
const RefusalSchema = z.object({
  reason: z.string().min(1),
  code: z.string().min(1),
  message: z.string().min(1),
  path: z.string().optional(),
  moduleId: z.string().optional(),
  kind: z.string().optional(),
  deta …
```

### SOP_DEPENDENCY_KINDS

const · `src/context-runtime/sop/spec.ts`

SOP dependency kinds. `SOP` is NEW in this runtime (a SOP may pin another SOP).

```ts signature
const SOP_DEPENDENCY_KINDS = ['POLICY', 'PACKET', 'RUBRIC', 'SOP'] as const
```

### SOP_PREDICATE_TYPES

const · `src/context-runtime/sop/predicates.ts`

The closed set of predicate `type` discriminators (for docs + introspection).

```ts signature
const SOP_PREDICATE_TYPES = [
  'artifact_present',
  'stop_condition',
  'budget_remaining',
  'all',
  'any',
] as const
```

### SOP_REFUSAL_CODES

const · `src/context-runtime/sop/refusals.ts`

The closed set of SOP refusal codes.

```ts signature
const SOP_REFUSAL_CODES = [
  // Review gate (prose never executes).
  'SOP_NOT_REVIEWED',
  'SOP_REVIEW_STALE',
  'SOP_REVIEW_INSTANT_INVALID',
  // Structure.
  'SOP_IDENTITY_INVALID',
  'SOP_PHASE_INVALID',
  // Dependency …
```

### SopPredicateSchema

const · `src/context-runtime/sop/predicates.ts`

The recursive zod schema for the closed predicate set. `z.lazy` carries the
recursion for `all`/`any`; anything outside the set fails to parse (⇒ the
`SOP_PREDICATE_UNKNOWN` refusal at compile time). Exported so a caller can
validate authoring input before it reaches [`compileSop`](#compilesop).

```ts signature
const SopPredicateSchema: z.ZodType<SopPredicate>
```

### TRUST_CLASSES

const · `src/context-runtime/module.ts`

Trust classes. `untrusted` never enters an instruction slot.

```ts signature
const TRUST_CLASSES = ['authoritative', 'approved_derived', 'untrusted'] as const
```

### ULTRAROUTER_PROFILE

const · `src/context-runtime/profile.ts`

The default profile for NEW ultrarouter adopters (`volatility` order).

```ts signature
const ULTRAROUTER_PROFILE: CompatibilityProfile
```

### ultrarouterManifestEncoder

const · `src/context-runtime/profile.ts`

The ultrarouter-default manifest encoder (profile form).

```ts signature
const ultrarouterManifestEncoder: ManifestEncoder
```

### UR_KNOWLEDGE_FORMAT

const · `src/pack.ts`

The format token of a knowledge pack (`ur_format` in the frontmatter).

```ts signature
const UR_KNOWLEDGE_FORMAT = 'ur.knowledge/1' as const
```

## Interfaces

### AdapterRefusal

interface · `src/context-runtime/compile.ts`

A parent adapter's authority pre-refusal for one candidate (dedupe, scope, lease,
locale, editorial authority). Folded inline by the compiler, in candidate order.
`code` is the parent's verbatim refusal code (emitted as-is — the parity seam);
`reason` is the generic classification (defaults to `code` when the parent's authority
is not in the base vocabulary).

```ts signature
interface AdapterRefusal {
    readonly code: string;
    readonly message: string;
    readonly reason?: string;
    readonly detail?: string;
}
```

| Member | Description |
| --- | --- |
| `readonly code: string` |  |
| `readonly message: string` |  |
| `readonly reason?: string` |  |
| `readonly detail?: string` |  |

### AuthorizationReceipt

interface · `src/context-runtime/sop/ports.ts`

A single-use, execution-bound authorization receipt.

```ts signature
interface AuthorizationReceipt {
    readonly specHash: string;
    readonly phase: string;
    readonly argsHash: string;
    readonly execId: string;
}
```

| Member | Description |
| --- | --- |
| `readonly specHash: string` | The spec's content digest (`compiledHash`). |
| `readonly phase: string` |  |
| `readonly argsHash: string` | Content digest of the exact phase arguments. |
| `readonly execId: string` | The execution this authorization is bound to. |

### AuthorizationReceiptPort

interface · `src/context-runtime/sop/ports.ts`

Records a single-use, execution-bound receipt. The implementation MUST make the
record-or-reject atomic (e.g. a unique insert) so two concurrent identical requests
cannot both be told `recorded` — single use is enforced HERE, not by the pure
[`authorizePhase`](#authorizephase).

```ts signature
interface AuthorizationReceiptPort {
    record(receipt: AuthorizationReceipt): SopReceiptOutcome;
}
```

| Member | Description |
| --- | --- |
| `record(receipt: AuthorizationReceipt): SopReceiptOutcome` |  |

### AuthorizePhaseInput

interface · `src/context-runtime/sop/ports.ts`

The input to authorize one phase execution.

```ts signature
interface AuthorizePhaseInput {
    readonly spec: ExecutableSopSpec;
    readonly phase: string;
    readonly args: unknown;
    readonly execId: string;
}
```

| Member | Description |
| --- | --- |
| `readonly spec: ExecutableSopSpec` |  |
| `readonly phase: string` |  |
| `readonly args: unknown` | The exact phase arguments (content-hashed into the receipt). |
| `readonly execId: string` |  |

### ChatMessage

interface · `src/context-runtime/messages.ts`

An OpenAI-shaped chat message. Extra keys round-trip verbatim (exit fidelity).

```ts signature
interface ChatMessage {
    readonly role: string;
    readonly content: unknown;
    readonly [key: string]: unknown;
}
```

| Member | Description |
| --- | --- |
| `readonly role: string` |  |
| `readonly content: unknown` |  |
| `readonly [key: string]: unknown;` |  |

### CompiledContent

interface · `src/context-runtime/sop/spec.ts`

The content-only projection `compiledHash` is taken over — identity, schema
hashes, the applicability predicate, the ordered phases, the sorted transitions and
the sorted dependency closure. Excludes `reviewedBy`/`reviewedAt`, so recompiling
the same reviewed prose is idempotent.

```ts signature
interface CompiledContent {
    readonly id: string;
    readonly version: string;
    readonly inputSchemaHash: string;
    readonly outputSchemaHash: string;
    readonly proseHash: string;
    readonly applicability: SopPredicate;
    readonly phases: readonly ExecutableSopPhase[];
    readonly transitions: readonly SopTransition[];
    readonly dependencies: readonly SopDependency[];
}
```

| Member | Description |
| --- | --- |
| `readonly id: string` |  |
| `readonly version: string` |  |
| `readonly inputSchemaHash: string` |  |
| `readonly outputSchemaHash: string` |  |
| `readonly proseHash: string` |  |
| `readonly applicability: SopPredicate` |  |
| `readonly phases: readonly ExecutableSopPhase[]` |  |
| `readonly transitions: readonly SopTransition[]` |  |
| `readonly dependencies: readonly SopDependency[]` |  |

### CompileResult

interface · `src/context-runtime/compile.ts`

The result of compile: the manifest (null when inadmissible) + every refusal.

```ts signature
interface CompileResult {
    readonly ok: boolean;
    readonly manifest: Manifest | null;
    readonly refusals: readonly Refusal[];
}
```

| Member | Description |
| --- | --- |
| `readonly ok: boolean` |  |
| `readonly manifest: Manifest \| null` |  |
| `readonly refusals: readonly Refusal[]` |  |

### ContextCandidate

interface · `src/context-runtime/compile.ts`

One candidate offered to compile: the module, an optional explicit slot, and an
optional adapter authority pre-refusal. Direct callers pass just `{ module }`.

```ts signature
interface ContextCandidate {
    readonly module: Module;
    readonly slot?: string;
    readonly adapterRefusal?: AdapterRefusal;
}
```

| Member | Description |
| --- | --- |
| `readonly module: Module` |  |
| `readonly slot?: string` |  |
| `readonly adapterRefusal?: AdapterRefusal` |  |

### DeliveredFact

interface · `src/context-runtime/native/plan.ts`

One delivered FACT: a module's identity + classification, free of delivery detail.

```ts signature
interface DeliveredFact {
    readonly moduleId: string;
    readonly contentHash: string;
    readonly kind: string;
    readonly memoryClass: string;
    readonly trustClass: string;
    readonly slot: string;
    readonly mandatory: boolean;
}
```

| Member | Description |
| --- | --- |
| `readonly moduleId: string` |  |
| `readonly contentHash: string` |  |
| `readonly kind: string` |  |
| `readonly memoryClass: string` |  |
| `readonly trustClass: string` |  |
| `readonly slot: string` |  |
| `readonly mandatory: boolean` |  |

### DescriptorSubject

interface · `src/context-runtime/sop/descriptor.ts`

The subject a descriptor is rendered + budget-checked from.

```ts signature
interface DescriptorSubject {
    readonly id: string;
    readonly phaseIds: readonly string[];
    readonly produces: readonly string[];
    readonly applicability: SopPredicate;
}
```

| Member | Description |
| --- | --- |
| `readonly id: string` |  |
| `readonly phaseIds: readonly string[]` |  |
| `readonly produces: readonly string[]` | What the SOP produces (the union of its phases' artifact contracts). |
| `readonly applicability: SopPredicate` |  |

### EncodedManifest

interface · `src/context-runtime/profile.ts`

A profile's manifest serialization: parent bytes + the hash taken over them.

```ts signature
interface EncodedManifest {
    readonly bytes: string;
    readonly hash: string;
}
```

| Member | Description |
| --- | --- |
| `readonly bytes: string` |  |
| `readonly hash: string` |  |

### ExecutableSopPhase

interface · `src/context-runtime/sop/spec.ts`

One phase of a compiled SOP. Phase ORDER is the execution sequence; everything
WITHIN a phase is a sorted set so authorings differing only by list order compile
to the same digest.

```ts signature
interface ExecutableSopPhase {
    readonly id: string;
    readonly mandatory: boolean;
    readonly allowedActionNames: readonly string[];
    readonly requiredPolicyIds: readonly string[];
    readonly budgets: Readonly<Record<string, number>>;
    readonly stopConditions: readonly string[];
    readonly artifactContracts: readonly string[];
}
```

| Member | Description |
| --- | --- |
| `readonly id: string` |  |
| `readonly mandatory: boolean` | True ⇒ the phase runs regardless of the planner budget (the mandatory-only fallback keeps these). NEW in this runtime. |
| `readonly allowedActionNames: readonly string[]` | Canonical action names, sorted. Nothing else may be called in this phase. |
| `readonly requiredPolicyIds: readonly string[]` | Policy ids the phase requires, sorted. Each must be in the dependency closure. |
| `readonly budgets: Readonly<Record<string, number>>` | Numeric budgets, by key. |
| `readonly stopConditions: readonly string[]` | Deterministic stop conditions, sorted. |
| `readonly artifactContracts: readonly string[]` | Artifact contracts the phase must emit, sorted. |

### ExecutableSopSpec

interface · `src/context-runtime/sop/spec.ts`

The compiled, immutable spec. Only [`compileSop`](#compilesop)
constructs one.

```ts signature
interface ExecutableSopSpec {
    readonly contract: typeof EXECUTABLE_SOP_SPEC_CONTRACT;
    readonly id: string;
    readonly version: string;
    readonly inputSchemaHash: string;
    readonly outputSchemaHash: string;
    readonly applicability: SopPredicate;
    readonly phases: readonly ExecutableSopPhase[];
    readonly transitions: readonly SopTransition[];
    readonly dependencies: readonly SopDependency[];
    readonly proseHash: string;
    readonly compiledHash: string;
    readonly reviewedBy: string;
    readonly reviewedAt: string;
    readonly provenanceHash: string;
}
```

| Member | Description |
| --- | --- |
| `readonly contract: typeof EXECUTABLE_SOP_SPEC_CONTRACT` |  |
| `readonly id: string` |  |
| `readonly version: string` |  |
| `readonly inputSchemaHash: string` |  |
| `readonly outputSchemaHash: string` |  |
| `readonly applicability: SopPredicate` | When this SOP is admissible (the descriptor's rendered `when`; the `eligible` selector reads it). Part of the compiled content. |
| `readonly phases: readonly ExecutableSopPhase[]` |  |
| `readonly transitions: readonly SopTransition[]` | The typed transition graph (checked acyclic at compile, separately from the dependency graph). |
| `readonly dependencies: readonly SopDependency[]` | The full dependency closure, sorted by id. |
| `readonly proseHash: string` | Digest of the natural-language prose this compiled from. |
| `readonly compiledHash: string` |  |
| `readonly reviewedBy: string` |  |
| `readonly reviewedAt: string` |  |
| `readonly provenanceHash: string` | Digest of [`ExecutableSopSpec.compiledHash`](#executablesopspec) plus the review identity. |

### GapArtifact

interface · `src/context-runtime/sop/fallbacks.ts`

The named gap artifact: a phase could not run because a required input was absent.
A manifest entry with a base-vocabulary code that a downstream gate can read.

```ts signature
interface GapArtifact {
    readonly code: Extract<ContextRefusalReason, 'REQUIRED_CONTEXT_MISSING'>;
    readonly kind: 'gap';
    readonly sopId: string;
    readonly specHash: string;
    readonly phase: string;
    readonly missing: string;
    readonly reason: string;
}
```

| Member | Description |
| --- | --- |
| `readonly code: Extract<ContextRefusalReason, 'REQUIRED_CONTEXT_MISSING'>` |  |
| `readonly kind: 'gap'` |  |
| `readonly sopId: string` |  |
| `readonly specHash: string` |  |
| `readonly phase: string` | The phase that could not run. |
| `readonly missing: string` | The required artifact/policy that was missing. |
| `readonly reason: string` |  |

### HostedPromptVariable

interface · `src/prompt-render.ts`

One DECLARED template variable — a `{{name}}` slot and whether the caller MUST supply it.

```ts signature
interface HostedPromptVariable {
    readonly name: string;
    readonly required: boolean;
}
```

| Member | Description |
| --- | --- |
| `readonly name: string` | The variable name (the `name` in `{{name}}`). |
| `readonly required: boolean` | Whether the caller must supply it. |

### KindSet

interface · `src/context-runtime/kinds.ts`

A resolved set of kinds a profile recognises.

```ts signature
interface KindSet {
    readonly kinds: readonly string[];
    has(value: string): boolean;
}
```

| Member | Description |
| --- | --- |
| `readonly kinds: readonly string[]` |  |
| `has(value: string): boolean` |  |

### LearnedMessage

interface · `src/learned-placement.ts`

The learned block the placement inserts: a DATA `user` message carrying the rendered module body.

```ts signature
interface LearnedMessage {
    readonly role: typeof LEARNED_MESSAGE_ROLE;
    readonly content: string;
}
```

| Member | Description |
| --- | --- |
| `readonly role: typeof LEARNED_MESSAGE_ROLE` | Always `user`: learned context is data, never an instruction. |
| `readonly content: string` | The rendered learned-module body. |

### LiftedManifest

interface · `src/context-runtime/lift.ts`

The result of a lift: a labelled manifest + the raw segmenter labels + diagnostics.

```ts signature
interface LiftedManifest {
    readonly manifest: Manifest;
    readonly labels: readonly LiftLabel[];
    readonly unparseable: boolean;
    readonly warnings?: readonly string[];
}
```

| Member | Description |
| --- | --- |
| `readonly manifest: Manifest` |  |
| `readonly labels: readonly LiftLabel[]` |  |
| `readonly unparseable: boolean` |  |
| `readonly warnings?: readonly string[]` |  |

### LiftExt

interface · `src/context-runtime/lift.ts`

The reconstruction record stored on a lifted manifest's `ext.lift`.

```ts signature
interface LiftExt {
    readonly messages: readonly LiftMessageRecord[];
}
```

| Member | Description |
| --- | --- |
| `readonly messages: readonly LiftMessageRecord[]` |  |

### LiftLabel

interface · `src/context-runtime/lift.ts`

One label the lift exposes — the gateway segmenter's classification for a message.

```ts signature
interface LiftLabel {
    readonly messageIndex: number;
    readonly kind: SegmentKind;
    readonly eligible: boolean;
    readonly range?: {
        readonly start: number;
        readonly end: number;
    };
}
```

| Member | Description |
| --- | --- |
| `readonly messageIndex: number` |  |
| `readonly kind: SegmentKind` |  |
| `readonly eligible: boolean` |  |
| `readonly range?: { readonly start: number; readonly end: number }` |  |

### LiftMessageRecord

interface · `src/context-runtime/lift.ts`

How a message's content is reconstructed at the exit. `string` content is rebuilt
from its segment texts (proving losslessness); anything else is re-emitted verbatim.

```ts signature
interface LiftMessageRecord {
    readonly index: number;
    readonly keyOrder: readonly string[];
    readonly scaffold: Record<string, unknown>;
    readonly contentIsString: boolean;
    readonly rawContent: unknown;
}
```

| Member | Description |
| --- | --- |
| `readonly index: number` |  |
| `readonly keyOrder: readonly string[]` |  |
| `readonly scaffold: Record<string, unknown>` |  |
| `readonly contentIsString: boolean` |  |
| `readonly rawContent: unknown` |  |

### LintFinding

interface · `src/context-runtime/lint.ts`

One advisory finding. `line` is 1-based; `severity` is advisory only.

```ts signature
interface LintFinding {
    readonly rule: LintRule;
    readonly severity: 'warn' | 'info';
    readonly line: number;
    readonly message: string;
}
```

| Member | Description |
| --- | --- |
| `readonly rule: LintRule` |  |
| `readonly severity: 'warn' \| 'info'` |  |
| `readonly line: number` |  |
| `readonly message: string` |  |

### LintInput

interface · `src/context-runtime/lint.ts`

One file to scan. Content only — the scanner is pure and reads no filesystem.

```ts signature
interface LintInput {
    readonly path: string;
    readonly contents: string;
}
```

| Member | Description |
| --- | --- |
| `readonly path: string` |  |
| `readonly contents: string` |  |

### LoadedPack

interface · `src/pack.ts`

The result of [`loadPack`](#loadpack): the parsed document and its projection as a context `Module`.

```ts signature
interface LoadedPack {
    readonly document: PackDocument;
    readonly module: Module;
}
```

| Member | Description |
| --- | --- |
| `readonly document: PackDocument` | The parsed, validated pack. |
| `readonly module: Module` | The pack projected to a context `Module`. |

### MandatoryOnlyManifest

interface · `src/context-runtime/sop/fallbacks.ts`

The mandatory-only fallback: when the planner bound is exceeded, run only the
phases that must always run. A manifest entry with a base-vocabulary code.

```ts signature
interface MandatoryOnlyManifest {
    readonly code: Extract<ContextRefusalReason, 'PLANNER_BOUND_EXCEEDED'>;
    readonly kind: 'mandatory_only';
    readonly sopId: string;
    readonly specHash: string;
    readonly phases: readonly string[];
    readonly reason: string;
}
```

| Member | Description |
| --- | --- |
| `readonly code: Extract<ContextRefusalReason, 'PLANNER_BOUND_EXCEEDED'>` |  |
| `readonly kind: 'mandatory_only'` |  |
| `readonly sopId: string` |  |
| `readonly specHash: string` |  |
| `readonly phases: readonly string[]` | The mandatory phase ids, in execution order. |
| `readonly reason: string` |  |

### ManifestEncoderContext

interface · `src/context-runtime/profile.ts`

The context an encoder may read (the source envelope + contract, for parent fields).

```ts signature
interface ManifestEncoderContext {
    readonly envelope: Envelope;
    readonly contract: Contract;
}
```

| Member | Description |
| --- | --- |
| `readonly envelope: Envelope` |  |
| `readonly contract: Contract` |  |

### MemoryClassSet

interface · `src/context-runtime/memory.ts`

A resolved set of admissible memory classes for one profile.

```ts signature
interface MemoryClassSet {
    readonly classes: readonly string[];
    has(value: string): boolean;
}
```

| Member | Description |
| --- | --- |
| `readonly classes: readonly string[]` |  |
| `has(value: string): boolean` |  |

### NativeCompatibilityRow

interface · `src/context-runtime/native/table.ts`

One row of the compatibility table: this model, this feature, behind this gate.

```ts signature
interface NativeCompatibilityRow {
    readonly provider: string;
    readonly model: string;
    readonly feature: NativeFeatureId;
    readonly betaHeader: string | null;
}
```

| Member | Description |
| --- | --- |
| `readonly provider: string` | The provider slug (e.g. `anthropic`). |
| `readonly model: string` | The PROVIDER-NATIVE model id (no `provider/` prefix — see [`nativeModelId`](#nativemodelid)). |
| `readonly feature: NativeFeatureId` |  |
| `readonly betaHeader: string \| null` | The gate value the caller must be sending for this pair (`anthropic-beta`), or `null` when the pair is gated by the MODEL alone. Frozen from the specification. |

### NativeConversationTurn

interface · `src/context-runtime/native/features.ts`

One turn of the conversation a delivery would be appended to (roles only — the
placement rules read the SHAPE of the conversation, never its content).

```ts signature
interface NativeConversationTurn {
    readonly role: string;
}
```

| Member | Description |
| --- | --- |
| `readonly role: string` |  |

### NativeDeliveryBlock

interface · `src/context-runtime/native/plan.ts`

One module's delivery payload. The adapter renders these onto the provider wire.

```ts signature
interface NativeDeliveryBlock {
    readonly moduleId: string;
    readonly contentHash: string;
    readonly kind: string;
    readonly memoryClass: string;
    readonly trustClass: string;
    readonly slot: string;
    readonly mandatory: boolean;
    readonly order: number;
    readonly text: string;
    readonly feature: NativeFeatureId | null;
    readonly token: string | null;
}
```

| Member | Description |
| --- | --- |
| `readonly moduleId: string` |  |
| `readonly contentHash: string` |  |
| `readonly kind: string` |  |
| `readonly memoryClass: string` |  |
| `readonly trustClass: string` |  |
| `readonly slot: string` |  |
| `readonly mandatory: boolean` |  |
| `readonly order: number` | The manifest order this module was admitted in (delivery never reorders). |
| `readonly text: string` | The body text. On a `descriptor`-disclosure channel this is what the model sees up front (the body itself loads on demand); elsewhere it is the full module body. |
| `readonly feature: NativeFeatureId \| null` | The feature carrying it; `null` inline. |
| `readonly token: string \| null` | The provider feature/tool token (`memory_20250818`, …); `null` inline. |

### NativeDeliveryContract

interface · `src/context-runtime/native/plan.ts`

The stage contract's native-delivery clause. Supplied explicitly by the caller/adapter
— never derived from a module's or envelope's `ext` (the core derives
no authority from `ext`).

```ts signature
interface NativeDeliveryContract {
    readonly requirement: NativeDeliveryRequirement;
    readonly optIns?: readonly NativeFeatureId[];
}
```

| Member | Description |
| --- | --- |
| `readonly requirement: NativeDeliveryRequirement` | `required` ⇒ a denied native candidate is the fatal `NATIVE_UNAVAILABLE` refusal. `preferred` (the default when the clause is absent) ⇒ degrade silently-but-recorded. |
| `readonly optIns?: readonly NativeFeatureId[]` | Features the APP explicitly opted into. A feature with `requiresOptIn` that is not named here takes the fallback. |

### NativeDeliveryFragment

interface · `src/context-runtime/native/plan.ts`

The provider-neutral request fragment. Grouped by channel, each group in manifest
order. The ADAPTER maps these onto the provider wire (this package never imports a
provider); every block appears in exactly one group.

```ts signature
interface NativeDeliveryFragment {
    readonly gateHeaders: readonly string[];
    readonly deferredTools: readonly NativeDeliveryBlock[];
    readonly memory: readonly NativeDeliveryBlock[];
    readonly compactionWindow: readonly NativeDeliveryBlock[];
    readonly systemMessages: readonly NativeDeliveryBlock[];
    readonly inline: readonly NativeDeliveryBlock[];
}
```

| Member | Description |
| --- | --- |
| `readonly gateHeaders: readonly string[]` | The gate values the request must carry, deduplicated, in feature-table order. |
| `readonly deferredTools: readonly NativeDeliveryBlock[]` | `defer_loading: true` tools: `moduleId` is the tool name, `text` the description. |
| `readonly memory: readonly NativeDeliveryBlock[]` | Memory-tool records (procedural, opt-in only). |
| `readonly compactionWindow: readonly NativeDeliveryBlock[]` | The compaction / context-editing window (episodic). |
| `readonly systemMessages: readonly NativeDeliveryBlock[]` | Mid-conversation `system` messages, appended after the last conversation turn. |
| `readonly inline: readonly NativeDeliveryBlock[]` | The ONE documented fallback: everything else, rendered inline by the caller. |

### NativeDeliveryInput

interface · `src/context-runtime/native/plan.ts`

The input to [`planNativeDelivery`](#plannativedelivery).

```ts signature
interface NativeDeliveryInput {
    readonly manifest: Manifest;
    readonly target: NativeDeliveryTarget;
    readonly contract?: NativeDeliveryContract;
    readonly conversation?: readonly NativeConversationTurn[];
    readonly bodies?: ReadonlyMap<string, string>;
    readonly features?: readonly NativeFeature[];
    readonly table?: readonly NativeCompatibilityRow[];
    readonly manifestEncoder?: (manifest: ManifestEncoderInput) => EncodedManifest;
}
```

| Member | Description |
| --- | --- |
| `readonly manifest: Manifest` | A compiled (or lifted) manifest — what this execution is allowed to see. |
| `readonly target: NativeDeliveryTarget` |  |
| `readonly contract?: NativeDeliveryContract` | The stage contract's clause. Absent ⇒ `preferred`, no opt-ins. |
| `readonly conversation?: readonly NativeConversationTurn[]` | The conversation the delivery is appended to (roles only). ABSENT ⇒ placement rules cannot be satisfied (fail closed — missing evidence is never an implicit pass). |
| `readonly bodies?: ReadonlyMap<string, string>` | `moduleId` → body text. A missing body renders '' (never a throw), exactly like the default render serializer. |
| `readonly features?: readonly NativeFeature[]` | Override the feature table (tests / a future profile). Default: the frozen v1 set. |
| `readonly table?: readonly NativeCompatibilityRow[]` | Override the compatibility table. Default: the frozen v1 table. |
| `readonly manifestEncoder?: (manifest: ManifestEncoderInput) => EncodedManifest` | How the re-recorded manifest is content-addressed. Default: the ultrarouter encoder; a parent profile passes `(m) => profile.manifestEncoder(m, ctx)`. |

### NativeDeliveryPlan

interface · `src/context-runtime/native/plan.ts`

The delivery plan for one execution.

```ts signature
interface NativeDeliveryPlan {
    readonly nativeDelivery: NativeDeliveryState;
    readonly manifest: Manifest;
    readonly placements: readonly NativePlacement[];
    readonly availableFeatures: readonly NativeFeatureId[];
    readonly unsupported: readonly NativeUnsupported[];
    readonly fragment: NativeDeliveryFragment;
}
```

| Member | Description |
| --- | --- |
| `readonly nativeDelivery: NativeDeliveryState` | `native` when at least one entry took a native channel, else `unavailable`. |
| `readonly manifest: Manifest` | The manifest with `nativeDelivery` recorded and `manifestHash` re-computed. `scaffoldHash` is UNCHANGED — delivery is per-execution, call-type identity is not. |
| `readonly placements: readonly NativePlacement[]` | One placement per manifest entry, in manifest order. |
| `readonly availableFeatures: readonly NativeFeatureId[]` | Every feature the target supports for this request (gate + opt-in satisfied). |
| `readonly unsupported: readonly NativeUnsupported[]` | Every feature that selected an entry but could not carry it, deduplicated. |
| `readonly fragment: NativeDeliveryFragment` |  |

### NativeDeliveryResult

interface · `src/context-runtime/native/plan.ts`

The result of planning. Mirrors `compile`: a FATAL refusal yields NO plan at all, so a
caller cannot accidentally dispatch a fallback the contract forbade.

```ts signature
interface NativeDeliveryResult {
    readonly ok: boolean;
    readonly plan: NativeDeliveryPlan | null;
    readonly refusals: readonly Refusal[];
}
```

| Member | Description |
| --- | --- |
| `readonly ok: boolean` |  |
| `readonly plan: NativeDeliveryPlan \| null` | `null` iff the contract REQUIRED native delivery and it was denied. |
| `readonly refusals: readonly Refusal[]` |  |

### NativeDeliveryTarget

interface · `src/context-runtime/native/table.ts`

Who the delivery is aimed at. `betaHeaders` are the gate values the caller WILL send.

```ts signature
interface NativeDeliveryTarget {
    readonly provider: string;
    readonly model: string;
    readonly betaHeaders?: readonly string[];
}
```

| Member | Description |
| --- | --- |
| `readonly provider: string` | The provider slug (`anthropic`). |
| `readonly model: string` | The model id — either provider-native (`claude-sonnet-5`) or the catalog's provider-prefixed form (`anthropic/claude-sonnet-5`); see [`nativeModelId`](#nativemodelid). |
| `readonly betaHeaders?: readonly string[]` | The gate values the caller is sending. Omitted ⇒ none (every gated feature falls back). |

### NativeFeature

interface · `src/context-runtime/native/features.ts`

One native delivery feature.

```ts signature
interface NativeFeature {
    readonly id: NativeFeatureId;
    readonly channel: NativeFeatureChannel;
    readonly selector: NativeModuleSelector;
    readonly token: string;
    readonly disclosure: NativeDisclosure;
    readonly requiresOptIn: boolean;
    readonly placement?: NativePlacementRule;
    readonly description: string;
}
```

| Member | Description |
| --- | --- |
| `readonly id: NativeFeatureId` |  |
| `readonly channel: NativeFeatureChannel` |  |
| `readonly selector: NativeModuleSelector` |  |
| `readonly token: string` | The provider feature/tool token the request names, FROZEN verbatim from the specification. Changing it is a data edit here, never a code change. |
| `readonly disclosure: NativeDisclosure` |  |
| `readonly requiresOptIn: boolean` | True ⇒ the APP must have opted in by naming this feature (the specification: the memory tool is used "where the app opted in"). An absent opt-in takes the fallback. |
| `readonly placement?: NativePlacementRule` |  |
| `readonly description: string` | One line explaining the mapping (surfaced in the plan's `unsupported` reasons). |

### NativeModuleSelector

interface · `src/context-runtime/native/features.ts`

Which manifest entries a feature can carry. Every declared field must match (AND);
an omitted field does not constrain. Matching is on the entry's DECLARED labels —
the planner never infers a module's role from its content.

```ts signature
interface NativeModuleSelector {
    readonly memoryClasses?: readonly string[];
    readonly kinds?: readonly string[];
    readonly slots?: readonly string[];
}
```

| Member | Description |
| --- | --- |
| `readonly memoryClasses?: readonly string[]` |  |
| `readonly kinds?: readonly string[]` |  |
| `readonly slots?: readonly string[]` |  |

### NativePlacement

interface · `src/context-runtime/native/plan.ts`

Where ONE manifest entry is delivered, and (when inline) why.

```ts signature
interface NativePlacement {
    readonly moduleId: string;
    readonly contentHash: string;
    readonly channel: NativeDeliveryChannel;
    readonly feature: NativeFeatureId | null;
    readonly betaHeader: string | null;
    readonly reason?: NativeFallbackReason;
    readonly detail?: string;
}
```

| Member | Description |
| --- | --- |
| `readonly moduleId: string` |  |
| `readonly contentHash: string` |  |
| `readonly channel: NativeDeliveryChannel` |  |
| `readonly feature: NativeFeatureId \| null` | The feature carrying it; `null` for the inline fallback. |
| `readonly betaHeader: string \| null` | The gate value the request must carry for this placement; `null` when ungated. |
| `readonly reason?: NativeFallbackReason` | Set only on an inline placement — why the native path did not take it. |
| `readonly detail?: string` |  |

### NativePlacementRule

interface · `src/context-runtime/native/features.ts`

A placement restriction, as DATA. Evaluated against the conversation the delivery
would be appended to; an unsatisfied rule sends the entry to the inline fallback
(fail closed — a missing conversation can never satisfy a rule).

```ts signature
interface NativePlacementRule {
    readonly neverFirst?: boolean;
    readonly requiresPrecedingRole?: string;
}
```

| Member | Description |
| --- | --- |
| `readonly neverFirst?: boolean` | The insertion point may NEVER be the first message of the conversation. |
| `readonly requiresPrecedingRole?: string` | The message immediately BEFORE the insertion point must carry this role. |

### NativeSelectableEntry

interface · `src/context-runtime/native/features.ts`

The labels a selector is matched against (the manifest-entry subset it reads).

```ts signature
interface NativeSelectableEntry {
    readonly kind: string;
    readonly memoryClass: string;
    readonly slot: string;
}
```

| Member | Description |
| --- | --- |
| `readonly kind: string` |  |
| `readonly memoryClass: string` |  |
| `readonly slot: string` |  |

### NativeUnsupported

interface · `src/context-runtime/native/plan.ts`

A feature that COULD have carried an entry but did not, and why.

```ts signature
interface NativeUnsupported {
    readonly feature: NativeFeatureId;
    readonly reason: Exclude<NativeFallbackReason, 'no_matching_feature'>;
    readonly detail?: string;
    readonly message: string;
}
```

| Member | Description |
| --- | --- |
| `readonly feature: NativeFeatureId` |  |
| `readonly reason: Exclude<NativeFallbackReason, 'no_matching_feature'>` |  |
| `readonly detail?: string` | Disambiguates a reason covering several conditions (the placement rule that blew). |
| `readonly message: string` |  |

### PackBaseRate

interface · `src/pack.ts`

One base rate: an observed rate with its sample size and interval.

```ts signature
interface PackBaseRate {
    readonly factId: string;
    readonly subject: string;
    readonly rate: number;
    readonly n: number;
    readonly interval: readonly [
        number,
        number
    ];
}
```

| Member | Description |
| --- | --- |
| `readonly factId: string` | The source fact id. |
| `readonly subject: string` | What the rate measures. |
| `readonly rate: number` | The observed rate (0 to 1). |
| `readonly n: number` | The sample size. |
| `readonly interval: readonly [number, number]` | The interval around the rate. |

### PackBody

interface · `src/pack.ts`

The pack body sections.

```ts signature
interface PackBody {
    readonly checklist: readonly PackChecklistItem[];
    readonly exemplars: readonly PackExemplar[];
    readonly baseRates: readonly PackBaseRate[];
    readonly refuted: readonly PackRefuted[];
}
```

| Member | Description |
| --- | --- |
| `readonly checklist: readonly PackChecklistItem[]` | Checklist items. |
| `readonly exemplars: readonly PackExemplar[]` | Exemplars. |
| `readonly baseRates: readonly PackBaseRate[]` | Base rates. |
| `readonly refuted: readonly PackRefuted[]` | Refuted assertions. |

### PackChecklistItem

interface · `src/pack.ts`

One checklist item.

```ts signature
interface PackChecklistItem {
    readonly factId: string;
    readonly text: string;
}
```

| Member | Description |
| --- | --- |
| `readonly factId: string` | The source fact id. |
| `readonly text: string` | The checklist text. |

### PackConsent

interface · `src/pack.ts`

The pack's consent block: the owning workspace, whether export is consented, and the redaction version.

```ts signature
interface PackConsent {
    readonly workspace: string;
    readonly exportConsent: boolean;
    readonly redactionVersion: string;
}
```

| Member | Description |
| --- | --- |
| `readonly workspace: string` | The owning workspace id. |
| `readonly exportConsent: boolean` | Whether exporting the pack is consented. |
| `readonly redactionVersion: string` | The redaction policy version applied to the content. |

### PackDocument

interface · `src/pack.ts`

A parsed knowledge pack: frontmatter fields, the two hashes, the body and the optional SOP payload.

```ts signature
interface PackDocument {
    readonly urFormat: UrKnowledgeFormat;
    readonly id: string;
    readonly version: number;
    readonly kind: PackKind;
    readonly memoryClass: PackMemoryClass;
    readonly trustClass: PackTrustClass;
    readonly slot: PackSlot;
    readonly descriptor: string;
    readonly appliesWhen: PackPredicate;
    readonly phase: readonly string[];
    readonly singleUse: boolean;
    readonly nativeDelivery: PackNativeDelivery;
    readonly tokenEstimate: number;
    readonly validity: PackValidity;
    readonly evidence: PackEvidence;
    readonly lineage: PackLineage;
    readonly consent: PackConsent;
    readonly contentHash: string;
    readonly provenanceHash: string;
    readonly body: PackBody;
    readonly sop?: PackSop;
}
```

| Member | Description |
| --- | --- |
| `readonly urFormat: UrKnowledgeFormat` | The format token (`ur.knowledge/1`). |
| `readonly id: string` | The pack id. |
| `readonly version: number` | The pack version. |
| `readonly kind: PackKind` | The pack kind. |
| `readonly memoryClass: PackMemoryClass` | The memory class. |
| `readonly trustClass: PackTrustClass` | The trust class. |
| `readonly slot: PackSlot` | The slot the pack targets. |
| `readonly descriptor: string` | A short description (at most [`DESCRIPTOR_MAX_LENGTH`](#descriptor_max_length) characters). |
| `readonly appliesWhen: PackPredicate` | When the pack applies. |
| `readonly phase: readonly string[]` | The phases the pack applies to. |
| `readonly singleUse: boolean` | Whether the pack may be used only once per execution. |
| `readonly nativeDelivery: PackNativeDelivery` | How the pack is delivered to a provider. |
| `readonly tokenEstimate: number` | The estimated token size of the rendered content. |
| `readonly validity: PackValidity` | Validity and invalidation. |
| `readonly evidence: PackEvidence` | The supporting evidence. |
| `readonly lineage: PackLineage` | Where the content came from. |
| `readonly consent: PackConsent` | Ownership and export consent. |
| `readonly contentHash: string` | The content hash (the join key). |
| `readonly provenanceHash: string` | The provenance hash. |
| `readonly body: PackBody` | The body sections. |
| `readonly sop?: PackSop` | The SOP payload (present on `sop` packs). |

### PackEvidence

interface · `src/pack.ts`

The evidence a pack was derived from: counts, an interval, the evidence tier, arm sources and the time window.

```ts signature
interface PackEvidence {
    readonly n: number;
    readonly clusters: number;
    readonly interval: readonly [
        number,
        number
    ];
    readonly evidenceTier: string;
    readonly armSources: readonly string[];
    readonly window: {
        readonly start: string | null;
        readonly end: string | null;
    };
}
```

| Member | Description |
| --- | --- |
| `readonly n: number` | Observations behind the pack. |
| `readonly clusters: number` | Independent clusters behind the pack. |
| `readonly interval: readonly [number, number]` | The interval around the headline estimate. |
| `readonly evidenceTier: string` | The evidence tier (for example `authored` or `measured`). |
| `readonly armSources: readonly string[]` | The experiment arms the evidence came from. |
| `readonly window: { readonly start: string \| null; readonly end: string \| null }` | The observation window. |

### PackExemplar

interface · `src/pack.ts`

One exemplar: a rendered example with its outcome and polarity.

```ts signature
interface PackExemplar {
    readonly factId: string;
    readonly outcome: string;
    readonly polarity: PackExemplarPolarity;
    readonly rendering: string;
    readonly outcomeEventIds: readonly string[];
}
```

| Member | Description |
| --- | --- |
| `readonly factId: string` | The source fact id. |
| `readonly outcome: string` | The observed outcome. |
| `readonly polarity: PackExemplarPolarity` | `positive` (follow) or `negative` (avoid). |
| `readonly rendering: string` | The rendered example. |
| `readonly outcomeEventIds: readonly string[]` | The outcome events that support it. |

### PackLineage

interface · `src/pack.ts`

Where a pack's content came from: the fact ids, a digest of their rollup and the ranker version.

```ts signature
interface PackLineage {
    readonly factIds: readonly string[];
    readonly rollupDigest: string;
    readonly rankerVersion?: string;
}
```

| Member | Description |
| --- | --- |
| `readonly factIds: readonly string[]` | The fact ids the content was derived from (never empty). |
| `readonly rollupDigest: string` | A digest of the fact rollup. |
| `readonly rankerVersion?: string` | The ranker version that selected the facts, when one did. |

### PackRefuted

interface · `src/pack.ts`

One refuted assertion and the outcome that refuted it.

```ts signature
interface PackRefuted {
    readonly factId: string;
    readonly assertion: string;
    readonly refutingOutcomeId: string;
}
```

| Member | Description |
| --- | --- |
| `readonly factId: string` | The source fact id. |
| `readonly assertion: string` | The refuted assertion. |
| `readonly refutingOutcomeId: string` | The outcome that refuted it. |

### PackSop

interface · `src/pack.ts`

The SOP payload of a `sop` pack.

```ts signature
interface PackSop {
    readonly name: string;
    readonly versionLabel: string;
    readonly phases: readonly PackSopPhase[];
    readonly dependencies: readonly PackSopDependency[];
    readonly transitions: PackSopTransitions;
    readonly invariantPhrases: readonly string[];
}
```

| Member | Description |
| --- | --- |
| `readonly name: string` | The SOP name. |
| `readonly versionLabel: string` | The SOP version label. |
| `readonly phases: readonly PackSopPhase[]` | The phases, in order. |
| `readonly dependencies: readonly PackSopDependency[]` | The dependencies. |
| `readonly transitions: PackSopTransitions` | The transition rules. |
| `readonly invariantPhrases: readonly string[]` | Phrases that must hold in every phase. |

### PackSopDependency

interface · `src/pack.ts`

One SOP dependency.

```ts signature
interface PackSopDependency {
    readonly kind: PackSopDependencyKind;
    readonly id: string;
}
```

| Member | Description |
| --- | --- |
| `readonly kind: PackSopDependencyKind` | The dependency kind. |
| `readonly id: string` | The dependency id. |

### PackSopPhase

interface · `src/pack.ts`

One SOP phase.

```ts signature
interface PackSopPhase {
    readonly id: string;
    readonly allowedActionNames: readonly string[];
    readonly requiredPolicyIds: readonly string[];
    readonly artifactContracts: readonly string[];
}
```

| Member | Description |
| --- | --- |
| `readonly id: string` | The phase id. |
| `readonly allowedActionNames: readonly string[]` | Actions allowed in the phase. |
| `readonly requiredPolicyIds: readonly string[]` | Policies the phase requires. |
| `readonly artifactContracts: readonly string[]` | Artifacts the phase must produce. |

### PackSopTransitions

interface · `src/pack.ts`

The SOP transition rules.

```ts signature
interface PackSopTransitions {
    readonly forward: 'linear' | 'none';
    readonly backward: readonly string[];
}
```

| Member | Description |
| --- | --- |
| `readonly forward: 'linear' \| 'none'` | `linear` (phase by phase) or `none`. |
| `readonly backward: readonly string[]` | Phases that may be returned to. |

### PackValidationContext

interface · `src/pack.ts`

Optional checks for [`validatePack`](#validatepack) and [`loadPack`](#loadpack).

```ts signature
interface PackValidationContext {
    readonly workspace?: string;
    readonly requireExportConsent?: boolean;
}
```

| Member | Description |
| --- | --- |
| `readonly workspace?: string` | Refuse a pack owned by a different workspace. |
| `readonly requireExportConsent?: boolean` | Refuse a pack without export consent. |

### PackValidity

interface · `src/pack.ts`

When a pack is valid and what invalidates it.

```ts signature
interface PackValidity {
    readonly from: string | null;
    readonly to: string | null;
    readonly epochBinding: string;
    readonly invalidationTriggers: readonly string[];
}
```

| Member | Description |
| --- | --- |
| `readonly from: string \| null` | Valid from (ISO 8601), or `null` for unbounded. |
| `readonly to: string \| null` | Valid until (ISO 8601), or `null` for unbounded. |
| `readonly epochBinding: string` | The epoch or version label the pack is bound to. |
| `readonly invalidationTriggers: readonly string[]` | Events that invalidate the pack. |

### RefusalRegistry

interface · `src/context-runtime/refusals.ts`

How a profile renders base reasons as concrete codes.

`codes` is the profile's full code vocabulary (base ∪ parent). `encode` maps a
base reason (plus optional detail) to the code the profile emits — the parity
seam: under a parent profile a `BUDGET_EXCEEDED` refusal must render the parent's
own string, not the base one.

```ts signature
interface RefusalRegistry {
    readonly codes: readonly string[];
    encode(reason: ContextRefusalReason, detail?: string): string;
}
```

| Member | Description |
| --- | --- |
| `readonly codes: readonly string[]` |  |
| `encode(reason: ContextRefusalReason, detail?: string): string` |  |

### RenderablePrompt

interface · `src/prompt-render.ts`

A hosted prompt as [`renderPrompt`](#renderprompt) needs it — the shape `getPrompt()` / preflight `prompt` returns.

```ts signature
interface RenderablePrompt {
    readonly template: string;
    readonly variables: readonly HostedPromptVariable[];
}
```

| Member | Description |
| --- | --- |
| `readonly template: string` | The template text with `{{name}}` slots. |
| `readonly variables: readonly HostedPromptVariable[]` | The declared variables. |

### ScaffoldSubjectEntry

interface · `src/context-runtime/manifest.ts`

The subject `scaffoldHash` is taken over — kinds/slots/ids + structural order only,
so it is stable across executions that select the same modules (versions, content
hashes and token estimates deliberately excluded). Used for call-type identity.

```ts signature
interface ScaffoldSubjectEntry {
    readonly moduleId: string;
    readonly kind: string;
    readonly slot: string;
    readonly mandatory: boolean;
    readonly order: number;
}
```

| Member | Description |
| --- | --- |
| `readonly moduleId: string` |  |
| `readonly kind: string` |  |
| `readonly slot: string` |  |
| `readonly mandatory: boolean` |  |
| `readonly order: number` |  |

### SealedEnvelope

interface · `src/context-runtime/envelope.ts`

A parsed, deep-frozen envelope plus its default (ultrarouter) content digest.

```ts signature
interface SealedEnvelope {
    readonly envelope: Readonly<Envelope>;
    readonly envelopeHash: string;
}
```

| Member | Description |
| --- | --- |
| `readonly envelope: Readonly<Envelope>` |  |
| `readonly envelopeHash: string` |  |

### SopCatalog

interface · `src/context-runtime/sop/catalog.ts`

The compact planning catalog for a set of compiled SOPs.

```ts signature
interface SopCatalog {
    readonly entries: readonly SopCatalogEntry[];
    readonly totalTokenEstimate: number;
}
```

| Member | Description |
| --- | --- |
| `readonly entries: readonly SopCatalogEntry[]` |  |
| `readonly totalTokenEstimate: number` | Sum of the entries' chars/4 token estimates — the ≤ 2,000-token planning budget. |

### SopCatalogEntry

interface · `src/context-runtime/sop/catalog.ts`

One catalog entry: a SOP's id + its rendered descriptor + the descriptor's token
estimate (chars/4). No body.

```ts signature
interface SopCatalogEntry {
    readonly id: string;
    readonly descriptor: string;
    readonly tokenEstimate: number;
}
```

| Member | Description |
| --- | --- |
| `readonly id: string` |  |
| `readonly descriptor: string` |  |
| `readonly tokenEstimate: number` |  |

### SopDependency

interface · `src/context-runtime/sop/spec.ts`

One resolved dependency of a compiled SOP.

```ts signature
interface SopDependency {
    readonly id: string;
    readonly kind: SopDependencyKind;
    readonly contentHash: string;
    readonly dependsOn: readonly string[];
}
```

| Member | Description |
| --- | --- |
| `readonly id: string` |  |
| `readonly kind: SopDependencyKind` |  |
| `readonly contentHash: string` | Lower-case hex SHA-256 of the dependency's pinned content. |
| `readonly dependsOn: readonly string[]` | Ids this dependency itself pins (its own closure edges). |

### SopDraft

interface · `src/context-runtime/sop/compile.ts`

A SOP as authored: prose digest + the structure extracted from it + the NEW
applicability predicate and transition graph.

```ts signature
interface SopDraft {
    readonly id: string;
    readonly version: string;
    readonly proseHash: string;
    readonly inputSchemaHash: string;
    readonly outputSchemaHash: string;
    readonly applicability: SopPredicate;
    readonly phases: readonly SopPhaseDraft[];
    readonly transitions: readonly SopTransitionDraft[];
    readonly dependencies: readonly SopDependency[];
}
```

| Member | Description |
| --- | --- |
| `readonly id: string` |  |
| `readonly version: string` |  |
| `readonly proseHash: string` | Digest of the natural-language body. Binds the review to the bytes. |
| `readonly inputSchemaHash: string` |  |
| `readonly outputSchemaHash: string` |  |
| `readonly applicability: SopPredicate` | When this SOP is admissible (validated against the closed predicate set). |
| `readonly phases: readonly SopPhaseDraft[]` |  |
| `readonly transitions: readonly SopTransitionDraft[]` |  |
| `readonly dependencies: readonly SopDependency[]` | The declared dependency set. Every phase requirement must be in it. |

### SopLoadPort

interface · `src/context-runtime/sop/ports.ts`

Loads a full SOP body. The caller's implementation is the ONLY thing that touches
a store; the pure package calls it only at the gated phase boundary. May be sync or
async depending on the backing store.

```ts signature
interface SopLoadPort {
    load(ref: SopLoadRef): unknown;
}
```

| Member | Description |
| --- | --- |
| `load(ref: SopLoadRef): unknown` |  |

### SopLoadRef

interface · `src/context-runtime/sop/ports.ts`

A reference to the SOP body a phase needs at execution.

```ts signature
interface SopLoadRef {
    readonly specId: string;
    readonly specHash: string;
    readonly phase: string;
}
```

| Member | Description |
| --- | --- |
| `readonly specId: string` |  |
| `readonly specHash: string` |  |
| `readonly phase: string` |  |

### SopPhaseDraft

interface · `src/context-runtime/sop/compile.ts`

One phase as authored, before normalization.

```ts signature
interface SopPhaseDraft {
    readonly id: string;
    readonly mandatory?: boolean;
    readonly allowedActionNames: readonly string[];
    readonly requiredPolicyIds: readonly string[];
    readonly budgets: Readonly<Record<string, number>>;
    readonly stopConditions: readonly string[];
    readonly artifactContracts: readonly string[];
}
```

| Member | Description |
| --- | --- |
| `readonly id: string` |  |
| `readonly mandatory?: boolean` | True ⇒ the phase always runs (mandatory-only fallback keeps it). Default false. |
| `readonly allowedActionNames: readonly string[]` |  |
| `readonly requiredPolicyIds: readonly string[]` |  |
| `readonly budgets: Readonly<Record<string, number>>` |  |
| `readonly stopConditions: readonly string[]` |  |
| `readonly artifactContracts: readonly string[]` |  |

### SopRefusal

interface · `src/context-runtime/sop/refusals.ts`

One SOP refusal. `code` is from the closed [`SOP_REFUSAL_CODES`](#sop_refusal_codes); `detail`
disambiguates a code that covers several conditions (the descriptor sub-limit that
blew the budget, the dependency defect kind); `path` names the offending field.
Every SOP-compile refusal is fatal (there is no partial spec), so there is no
`fatal` flag — a refused compile returns no spec at all.

```ts signature
interface SopRefusal {
    readonly code: SopRefusalCode;
    readonly message: string;
    readonly detail?: string;
    readonly path?: string;
}
```

| Member | Description |
| --- | --- |
| `readonly code: SopRefusalCode` |  |
| `readonly message: string` |  |
| `readonly detail?: string` |  |
| `readonly path?: string` |  |

### SopReview

interface · `src/context-runtime/sop/compile.ts`

A human review of one exact set of prose bytes.

```ts signature
interface SopReview {
    readonly reviewedBy: string;
    readonly reviewedAt: string;
    readonly reviewedProseHash: string;
}
```

| Member | Description |
| --- | --- |
| `readonly reviewedBy: string` |  |
| `readonly reviewedAt: string` | An RFC-3339 UTC instant STRING; never a `Date`, never a clock read. |
| `readonly reviewedProseHash: string` | The `proseHash` the reviewer actually read. |

### SopRuntimeState

interface · `src/context-runtime/sop/predicates.ts`

The runtime state a predicate is evaluated against (pure `eligible` input).

```ts signature
interface SopRuntimeState {
    readonly artifacts: readonly string[];
    readonly stopConditions: readonly string[];
    readonly budgetsRemaining: Readonly<Record<string, number>>;
}
```

| Member | Description |
| --- | --- |
| `readonly artifacts: readonly string[]` | Artifact contracts already produced this run. |
| `readonly stopConditions: readonly string[]` | Stop conditions already reached this run. |
| `readonly budgetsRemaining: Readonly<Record<string, number>>` | Remaining budget by kind (a missing kind is treated as 0 remaining). |

### SopTransition

interface · `src/context-runtime/sop/spec.ts`

One typed transition edge of the NEW transition language: `from` phase → `to`
phase, taken `when` the (closed-set) predicate holds.

```ts signature
interface SopTransition {
    readonly from: string;
    readonly to: string;
    readonly when: SopPredicate;
}
```

| Member | Description |
| --- | --- |
| `readonly from: string` |  |
| `readonly to: string` |  |
| `readonly when: SopPredicate` |  |

### SopTransitionDraft

interface · `src/context-runtime/sop/compile.ts`

One transition edge as authored. `when` is validated against the closed set.

```ts signature
interface SopTransitionDraft {
    readonly from: string;
    readonly to: string;
    readonly when: SopPredicate;
}
```

| Member | Description |
| --- | --- |
| `readonly from: string` |  |
| `readonly to: string` |  |
| `readonly when: SopPredicate` |  |

### UrManifestWire

interface · `src/context-runtime/manifest.ts`

The `ur.manifest` wire shape. No bodies — hashes/ranges/labels only.

```ts signature
interface UrManifestWire {
    readonly scaffold_hash: string;
    readonly manifest_hash: string;
    readonly envelope_hash: string;
    readonly entries: readonly UrManifestWireEntry[];
}
```

| Member | Description |
| --- | --- |
| `readonly scaffold_hash: string` |  |
| `readonly manifest_hash: string` |  |
| `readonly envelope_hash: string` |  |
| `readonly entries: readonly UrManifestWireEntry[]` |  |

### UrManifestWireEntry

interface · `src/context-runtime/manifest.ts`

One entry on the wire (`ur.manifest`). Snake-cased for the OpenAPI surface.

```ts signature
interface UrManifestWireEntry {
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
```

| Member | Description |
| --- | --- |
| `readonly kind: string` |  |
| `readonly slot: string` |  |
| `readonly trust_class: string` |  |
| `readonly memory_class: string` |  |
| `readonly content_hash: string` |  |
| `readonly mandatory: boolean` |  |
| `readonly order: number` |  |
| `readonly range?: { readonly message_index: number; readonly part_index?: number; readonly start: number; readonly end: number; }` |  |

## Types

### AuthorizePhaseResult

type · `src/context-runtime/sop/ports.ts`

The outcome of [`authorizePhase`](#authorizephase).

```ts signature
type AuthorizePhaseResult = {
    readonly ok: true;
    readonly receipt: AuthorizationReceipt;
} | {
    readonly ok: false;
    readonly refusal: SopRefusal;
    readonly receipt: AuthorizationReceipt | null;
};
```

### Availability

type · `src/context.ts`

When a module is available: ISO-8601 `from` / `to` instants, `null` meaning unbounded (a `null` `from` means the module has no availability of its own).

```ts signature
type Availability = runtime.Availability;
```

### BudgetStrategy

type · `src/context-runtime/profile.ts`

How the profile admits within budget (shed whole modules,
never truncate). `tokens`: a token ceiling with a keep-priority (shed lowest-keep
first — for example a history→evidence→strategy ladder). `count`: a maximum pin count
checked inline in selection order (a selection budget). A `null` limit is
unbounded.

```ts signature
type BudgetStrategy = {
    readonly kind: 'tokens';
    limit(envelope: Envelope, contract: Contract): number | null;
    keepPriority(entry: ManifestEntry): number;
    readonly shedMode?: 'prefix' | 'greedy';
} | {
    readonly kind: 'count';
    limit(envelope: Envelope, contract: Contract): number | null;
};
```

### CompatibilityProfile

type · `src/context.ts`

A compatibility profile: the ordering rule, vocabularies (memory classes, kinds, refusals), limits,
budget strategy, render serializer and manifest encoder that `compile` runs under.
`ULTRAROUTER_PROFILE` is the default.

```ts signature
type CompatibilityProfile = runtime.CompatibilityProfile;
```

### CompileSopRequest

type · `src/context.ts`

A request to `compileSop`: the authored `draft` and its `review` (or `null` when unreviewed, which is refused).

```ts signature
type CompileSopRequest = runtime.CompileSopRequest;
```

### CompileSopResult

type · `src/context-runtime/sop/compile.ts`

The result of a SOP compile: the spec, or the refusals that prevented it. Every
compile refusal is fatal, so a refused compile carries no spec.

```ts signature
type CompileSopResult = {
    readonly ok: true;
    readonly spec: ExecutableSopSpec;
} | {
    readonly ok: false;
    readonly refusals: readonly SopRefusal[];
};
```

### ContextDeliveryRefusalReason

type · `src/context.ts`

A stable refusal reason emitted when context cannot be delivered (one of `CONTEXT_DELIVERY_REFUSAL_REASONS`).

```ts signature
type ContextDeliveryRefusalReason = runtime.ContextDeliveryRefusalReason;
```

### ContextRange

type · `src/context.ts`

An exact declared range in the `ur.segments` coordinate system (UTF-16 code units).

```ts signature
type ContextRange = runtime.ContextRange;
```

### ContextRefusalReason

type · `src/context.ts`

A stable base refusal reason emitted by `compile` (one of `CONTEXT_REFUSAL_REASONS`).

```ts signature
type ContextRefusalReason = runtime.ContextRefusalReason;
```

### Contract

type · `src/context.ts`

A per-stage contract: which module kinds are required, optional or forbidden; the budgets; the
per-kind or per-facet `limits`; the pin policy; and the slot vocabulary.

```ts signature
type Contract = runtime.Contract;
```

### CoreMemoryClass

type · `src/context.ts`

A core memory class: one of `CORE_MEMORY_CLASSES` (extend the set with `defineMemoryClasses`).

```ts signature
type CoreMemoryClass = runtime.CoreMemoryClass;
```

### Envelope

type · `src/context.ts`

An envelope: the identity of one execution (`id`, `tenant`, `stage`, `mode`, the `asOf` knowledge
cutoff, `cutoffs`, `budgets`, `seed`, `pins`, release bindings and the permission epoch). Seal it
with `sealEnvelope` to freeze and hash it.

```ts signature
type Envelope = runtime.Envelope;
```

### EnvelopeBudgets

type · `src/context.ts`

The budgets one execution runs under (`tokens`, `toolCalls`, `plannerDepth`, `plannerPass`, `timeMs`, `microUsd`); each is optional.

```ts signature
type EnvelopeBudgets = runtime.EnvelopeBudgets;
```

### FacetValue

type · `src/context.ts`

A facet value used for scope matching: a string or a set of strings.

```ts signature
type FacetValue = runtime.FacetValue;
```

### Limit

type · `src/context.ts`

A per-kind or per-facet admission cap (`max`), with an optional `label`.

```ts signature
type Limit = runtime.Limit;
```

### LintOptions

type · `src/context.ts`

Options for `lintPromptSurface`: `maxPromptTokens` sets the oversized-prompt threshold.

```ts signature
type LintOptions = runtime.LintOptions;
```

### LintRule

type · `src/context.ts`

A prompt-surface lint rule: `oversized_prompt`, `untrusted_interpolation` or `inline_exemplars`.

```ts signature
type LintRule = runtime.LintRule;
```

### Manifest

type · `src/context.ts`

A compiled manifest: the admitted entries in order, every refusal with its reason, the budgets, and
the envelope and manifest hashes. Send it to the gateway with `toWire(manifest)` as `ur.manifest`.

```ts signature
type Manifest = runtime.Manifest;
```

### ManifestBudgets

type · `src/context.ts`

The token accounting of a compiled manifest.

```ts signature
type ManifestBudgets = runtime.ManifestBudgets;
```

### ManifestEncoder

type · `src/context-runtime/profile.ts`

The parity seam: reconstruct the parent's manifest bytes + hash from a core manifest.

```ts signature
type ManifestEncoder = (manifest: ManifestEncoderInput, ctx: ManifestEncoderContext) => EncodedManifest;
```

### ManifestEncoderInput

type · `src/context-runtime/profile.ts`

The manifest data the encoder serializes — everything except the hash it produces.

```ts signature
type ManifestEncoderInput = Omit<Manifest, 'manifestHash'>;
```

### ManifestEntry

type · `src/context.ts`

One admitted manifest entry: the module identity, its labels, slot, token estimate and content hash.

```ts signature
type ManifestEntry = runtime.ManifestEntry;
```

### Module

type · `src/context.ts`

A module: one typed, versioned, content-hashed unit of context (`id`, `version`, `kind`,
`memoryClass`, `trustClass`, `privacyClass`, `availability`, `contentHash`, `tokenEstimate`,
`facets`, optional `slotHint` and `ext`). Only `trustClass` carries meaning for the compiler; the
other labels are carried through.

```ts signature
type Module = runtime.Module;
```

### NativeDeliveryChannel

type · `src/context.ts`

A provider-native delivery channel (one of `NATIVE_DELIVERY_CHANNELS`).

```ts signature
type NativeDeliveryChannel = runtime.NativeDeliveryChannel;
```

### NativeDeliveryRequirement

type · `src/context.ts`

A requirement a native delivery must satisfy (one of `NATIVE_DELIVERY_REQUIREMENTS`).

```ts signature
type NativeDeliveryRequirement = runtime.NativeDeliveryRequirement;
```

### NativeDeliveryState

type · `src/context.ts`

Whether a manifest entry was delivered through a provider-native feature (`native`) or not (`unavailable`).

```ts signature
type NativeDeliveryState = runtime.NativeDeliveryState;
```

### NativeDisclosure

type · `src/context.ts`

A disclosure level for a provider-native feature (one of `NATIVE_DISCLOSURES`).

```ts signature
type NativeDisclosure = runtime.NativeDisclosure;
```

### NativeFallbackReason

type · `src/context.ts`

Why a native delivery fell back to plain messages (one of `NATIVE_FALLBACK_REASONS`).

```ts signature
type NativeFallbackReason = runtime.NativeFallbackReason;
```

### NativeFeatureChannel

type · `src/context-runtime/native/features.ts`

A channel a native FEATURE may declare (everything except the inline fallback).

```ts signature
type NativeFeatureChannel = Exclude<NativeDeliveryChannel, 'inline'>;
```

### NativeFeatureId

type · `src/context.ts`

A provider-native feature id (one of `NATIVE_FEATURE_IDS`).

```ts signature
type NativeFeatureId = runtime.NativeFeatureId;
```

### NativePlacementDetail

type · `src/context.ts`

A placement detail for a provider-native feature (one of `NATIVE_PLACEMENT_DETAILS`).

```ts signature
type NativePlacementDetail = runtime.NativePlacementDetail;
```

### NativePlacementVerdict

type · `src/context-runtime/native/features.ts`

The verdict of one placement check.

```ts signature
type NativePlacementVerdict = {
    readonly ok: true;
} | {
    readonly ok: false;
    readonly detail: NativePlacementDetail;
    readonly message: string;
};
```

### PackExemplarPolarity

type · `src/pack.ts`

An exemplar polarity (one of [`PACK_EXEMPLAR_POLARITIES`](#pack_exemplar_polarities)).

```ts signature
type PackExemplarPolarity = (typeof PACK_EXEMPLAR_POLARITIES)[number];
```

### PackKind

type · `src/pack.ts`

A pack kind (one of [`PACK_KINDS`](#pack_kinds)).

```ts signature
type PackKind = (typeof PACK_KINDS)[number];
```

### PackMemoryClass

type · `src/pack.ts`

A pack memory class (one of [`PACK_MEMORY_CLASSES`](#pack_memory_classes)).

```ts signature
type PackMemoryClass = (typeof PACK_MEMORY_CLASSES)[number];
```

### PackNativeDelivery

type · `src/pack.ts`

A native-delivery declaration (one of [`PACK_NATIVE_DELIVERIES`](#pack_native_deliveries)).

```ts signature
type PackNativeDelivery = (typeof PACK_NATIVE_DELIVERIES)[number];
```

### PackPredicate

type · `src/pack.ts`

The closed `applies_when` predicate language: `always`, a situation, call type, archetype or
facet test, combined with `all`, `any` and `not`.

```ts signature
type PackPredicate = {
    readonly type: 'always';
} | {
    readonly type: 'situation_is';
    readonly situationClass: string;
} | {
    readonly type: 'call_type_is';
    readonly callTypeId: string;
} | {
    readonly type: 'archetype_is';
    readonly archetype: string;
} | {
    readonly type: 'facet_eq';
    readonly facet: string;
    readonly value: string;
} | {
    readonly type: 'facet_in';
    readonly facet: string;
    readonly values: readonly string[];
} | {
    readonly type: 'all';
    readonly of: readonly PackPredicate[];
} | {
    readonly type: 'any';
    readonly of: readonly PackPredicate[];
} | {
    readonly type: 'not';
    readonly of: PackPredicate;
};
```

### PackRefusalCode

type · `src/pack.ts`

A named reason a pack was refused by [`parsePack`](#parsepack) or [`validatePack`](#validatepack).

```ts signature
type PackRefusalCode = 'UNSUPPORTED_FORMAT' | 'UNKNOWN_KIND' | 'UNKNOWN_MEMORY_CLASS' | 'UNKNOWN_TRUST_CLASS' | 'UNKNOWN_SLOT' | 'UNKNOWN_NATIVE_DELIVERY' | 'DESCRIPTOR_OVER_BUDGET' | 'INVALID_PREDICATE' | 'EMPTY_LINEAGE' | 'LEARNED_MUST_BE_APPROVED_DERIVED' | 'UNTRUSTED_IN_INSTRUCTION_SLOT' | 'EXPORT_CONSENT_REVOKED' | 'TENANT_MISMATCH' | 'CONTENT_HASH_MISMATCH' | 'PROVENANCE_HASH_MISMATCH' | 'MALFORMED_FRONTMATTER' | 'MALFORMED_BODY' | 'MISSING_FIELD';
```

### PackSlot

type · `src/pack.ts`

A pack slot (one of [`PACK_SLOTS`](#pack_slots)).

```ts signature
type PackSlot = (typeof PACK_SLOTS)[number];
```

### PackSopDependencyKind

type · `src/pack.ts`

An SOP dependency kind (one of [`PACK_SOP_DEPENDENCY_KINDS`](#pack_sop_dependency_kinds)).

```ts signature
type PackSopDependencyKind = (typeof PACK_SOP_DEPENDENCY_KINDS)[number];
```

### PackTrustClass

type · `src/pack.ts`

A pack trust class (one of [`PACK_TRUST_CLASSES`](#pack_trust_classes)). `untrusted` never enters the instruction slot.

```ts signature
type PackTrustClass = (typeof PACK_TRUST_CLASSES)[number];
```

### PackValidation

type · `src/pack.ts`

The result of [`validatePack`](#validatepack): `{ ok: true, document }` or `{ ok: false, refusals }`.

```ts signature
type PackValidation = {
    readonly ok: true;
    readonly document: PackDocument;
} | {
    readonly ok: false;
    readonly refusals: readonly PackRefusalCode[];
};
```

### ParsePredicateResult

type · `src/context-runtime/sop/predicates.ts`

The result of validating one authoring predicate against the closed set.

```ts signature
type ParsePredicateResult = {
    readonly ok: true;
    readonly predicate: SopPredicate;
} | {
    readonly ok: false;
};
```

### Pin

type · `src/context.ts`

A mandatory pin: an exact module identity (`id`, `kind`, `contentHash`) the envelope requires, with its `purpose`.

```ts signature
type Pin = runtime.Pin;
```

### PinPolicy

type · `src/context.ts`

How the compiler treats envelope pins: `strict` (every pin must resolve and match) or `none`.

```ts signature
type PinPolicy = runtime.PinPolicy;
```

### Refusal

type · `src/context.ts`

A refusal: why a candidate (or the whole compile) was not admitted, with a stable `code`, a `reason` and whether it is `fatal`.

```ts signature
type Refusal = runtime.Refusal;
```

### RenderPromptResult

type · `src/prompt-render.ts`

The result of [`renderHostedPromptResult`](#renderhostedpromptresult): a rendered instruction, or a NAMED missing-variable refusal.

```ts signature
type RenderPromptResult = {
    readonly ok: true;
    readonly text: string;
} | {
    readonly ok: false;
    readonly missing: readonly string[];
};
```

### RenderSerializer

type · `src/context-runtime/messages.ts`

A profile's rendering of a compiled manifest into provider messages. Pure.

```ts signature
type RenderSerializer = (input: {
    readonly manifest: Manifest;
    readonly bodies: ReadonlyMap<string, string>;
}) => readonly ChatMessage[];
```

### SopDependencyKind

type · `src/context.ts`

An SOP dependency kind (one of `SOP_DEPENDENCY_KINDS`).

```ts signature
type SopDependencyKind = runtime.SopDependencyKind;
```

### SopPredicate

type · `src/context-runtime/sop/predicates.ts`

A transition/applicability predicate. A CLOSED discriminated union — the ONLY
shapes the compiler admits. `all([])` is vacuously true (a SOP that always
applies); `any([])` is vacuously false.

```ts signature
type SopPredicate = {
    readonly type: 'artifact_present';
    readonly contract: string;
} | {
    readonly type: 'stop_condition';
    readonly id: string;
} | {
    readonly type: 'budget_remaining';
    readonly kind: string;
    readonly gt: number;
} | {
    readonly type: 'all';
    readonly of: readonly SopPredicate[];
} | {
    readonly type: 'any';
    readonly of: readonly SopPredicate[];
};
```

### SopPredicateType

type · `src/context.ts`

An SOP transition predicate type (one of `SOP_PREDICATE_TYPES`).

```ts signature
type SopPredicateType = runtime.SopPredicateType;
```

### SopReceiptOutcome

type · `src/context-runtime/sop/ports.ts`

The store's verdict on recording a receipt. `recorded` = fresh (authorized);
`duplicate` = this exact receipt was already used (single-use violation).

```ts signature
type SopReceiptOutcome = 'recorded' | 'duplicate';
```

### SopRefusalCode

type · `src/context.ts`

A stable SOP compiler refusal code (one of `SOP_REFUSAL_CODES`).

```ts signature
type SopRefusalCode = runtime.SopRefusalCode;
```

### TrustClass

type · `src/context.ts`

A trust class: `authoritative`, `approved_derived` or `untrusted` (never admitted into the instruction slot).

```ts signature
type TrustClass = runtime.TrustClass;
```

### UrKnowledgeFormat

type · `src/pack.ts`

The knowledge-pack format token type.

```ts signature
type UrKnowledgeFormat = typeof UR_KNOWLEDGE_FORMAT;
```
