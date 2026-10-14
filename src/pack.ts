/**
 * The portable knowledge-pack format `*.ur.md` (`ur.knowledge/1`) and `loadPack`. A pack is a signed,
 * diffable projection of learned knowledge that you can keep in a file, review in a pull request and
 * load in one call with no service running. It is never a second source of truth.
 *
 * The SDK implements the same closed vocabularies, canonical-JSON projections and two hashes as the
 * gateway (`content_hash`, the join key; `provenance_hash`, which binds an SOP to its review) over the
 * context runtime's canonical-JSON and sha256 primitives, so a hash computed here matches the one the
 * gateway computes. Pure and deterministic; the only host primitive used is sha256.
 */

import { canonicalJson, sha256Hex } from './context-runtime/hash.js';
import { ModuleSchema, type Module } from './context-runtime/module.js';

// ─────────────────────────────── constrained YAML-frontmatter codec ───────────────────────────────

class FrontmatterParseError extends Error {
  constructor(detail: string) {
    super(`malformed frontmatter: ${detail}`);
    this.name = 'FrontmatterParseError';
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Emit a frontmatter object as the constrained YAML a pack uses (block maps for `blockKeys`, inline JSON otherwise). */
export function emitFrontmatter(
  obj: Record<string, unknown>,
  blockKeys: ReadonlySet<string> = new Set(),
): string {
  const lines: string[] = [];
  for (const key of Object.keys(obj)) {
    const value = obj[key];
    if (isPlainObject(value) && blockKeys.has(key)) {
      lines.push(`${key}:`);
      for (const subKey of Object.keys(value))
        lines.push(`  ${subKey}: ${JSON.stringify(value[subKey])}`);
    } else {
      lines.push(`${key}: ${JSON.stringify(value)}`);
    }
  }
  return lines.join('\n');
}

function parseInline(raw: string, context: string): unknown {
  try {
    return JSON.parse(raw.trim());
  } catch {
    throw new FrontmatterParseError(`'${context}' is not a valid inline value`);
  }
}

/** Parse the constrained YAML frontmatter a pack uses. Throws on malformed input. */
export function parseFrontmatter(text: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const rawLines = text.split('\n');
  let i = 0;
  while (i < rawLines.length) {
    const line = rawLines[i] ?? '';
    i += 1;
    if (line.trim() === '' || line.trimStart().startsWith('#')) continue;
    if (line.startsWith('  '))
      throw new FrontmatterParseError(`unexpected indented line: ${line.trim()}`);
    const colon = line.indexOf(':');
    if (colon < 0) throw new FrontmatterParseError(`line has no key: ${line}`);
    const key = line.slice(0, colon).trim();
    if (key === '') throw new FrontmatterParseError(`empty key: ${line}`);
    const rest = line.slice(colon + 1).trim();
    if (rest === '') {
      const map: Record<string, unknown> = {};
      let sawChild = false;
      while (i < rawLines.length) {
        const child = rawLines[i] ?? '';
        if (child.trim() === '' || child.trimStart().startsWith('#')) {
          i += 1;
          continue;
        }
        if (!child.startsWith('  ')) break;
        if (child.startsWith('    '))
          throw new FrontmatterParseError(`block maps are one level deep: ${child.trim()}`);
        const childColon = child.indexOf(':');
        if (childColon < 0) throw new FrontmatterParseError(`block-map line has no key: ${child}`);
        const childKey = child.slice(2, childColon).trim();
        const childRest = child.slice(childColon + 1).trim();
        if (childKey === '' || childRest === '')
          throw new FrontmatterParseError(`bad block-map line: ${child}`);
        map[childKey] = parseInline(childRest, `${key}.${childKey}`);
        sawChild = true;
        i += 1;
      }
      if (!sawChild) throw new FrontmatterParseError(`block map '${key}' has no entries`);
      out[key] = map;
    } else {
      out[key] = parseInline(rest, key);
    }
  }
  return out;
}

// ─────────────────────────────── closed vocabularies ───────────────────────────────

/** The format token of a knowledge pack (`ur_format` in the frontmatter). */
export const UR_KNOWLEDGE_FORMAT = 'ur.knowledge/1' as const;
/** The knowledge-pack format token type. */
export type UrKnowledgeFormat = typeof UR_KNOWLEDGE_FORMAT;

/** Every pack kind: an SOP, a learned pack, an exemplar set, a checklist or a calibration table. */
export const PACK_KINDS = [
  'sop',
  'learned_pack',
  'exemplar_set',
  'checklist',
  'calibration_table',
] as const;
/** A pack kind (one of {@link PACK_KINDS}). */
export type PackKind = (typeof PACK_KINDS)[number];

/** Every memory class a pack may declare. */
export const PACK_MEMORY_CLASSES = [
  'working',
  'episodic',
  'semantic',
  'procedural',
  'declared',
] as const;
/** A pack memory class (one of {@link PACK_MEMORY_CLASSES}). */
export type PackMemoryClass = (typeof PACK_MEMORY_CLASSES)[number];

/** Every trust class a pack may declare. */
export const PACK_TRUST_CLASSES = ['authoritative', 'approved_derived', 'untrusted'] as const;
/** A pack trust class (one of {@link PACK_TRUST_CLASSES}). `untrusted` never enters the instruction slot. */
export type PackTrustClass = (typeof PACK_TRUST_CLASSES)[number];

/** Every slot a pack may target. */
export const PACK_SLOTS = ['learned', 'reference', 'exemplar', 'instruction'] as const;
/** A pack slot (one of {@link PACK_SLOTS}). */
export type PackSlot = (typeof PACK_SLOTS)[number];

/** Every native-delivery declaration a pack may carry. */
export const PACK_NATIVE_DELIVERIES = ['anthropic', 'inline', 'unavailable'] as const;
/** A native-delivery declaration (one of {@link PACK_NATIVE_DELIVERIES}). */
export type PackNativeDelivery = (typeof PACK_NATIVE_DELIVERIES)[number];

/** Exemplar polarities: a `positive` example to follow or a `negative` one to avoid. */
export const PACK_EXEMPLAR_POLARITIES = ['positive', 'negative'] as const;
/** An exemplar polarity (one of {@link PACK_EXEMPLAR_POLARITIES}). */
export type PackExemplarPolarity = (typeof PACK_EXEMPLAR_POLARITIES)[number];

/** The maximum length of a pack `descriptor`, in characters. */
export const DESCRIPTOR_MAX_LENGTH = 240;

// ─────────────────────────────── the closed applies_when predicate AST ───────────────────────────────

/**
 * The closed `applies_when` predicate language: `always`, a situation, call type, archetype or
 * facet test, combined with `all`, `any` and `not`.
 */
export type PackPredicate =
  | { readonly type: 'always' }
  | { readonly type: 'situation_is'; readonly situationClass: string }
  | { readonly type: 'call_type_is'; readonly callTypeId: string }
  | { readonly type: 'archetype_is'; readonly archetype: string }
  | { readonly type: 'facet_eq'; readonly facet: string; readonly value: string }
  | { readonly type: 'facet_in'; readonly facet: string; readonly values: readonly string[] }
  | { readonly type: 'all'; readonly of: readonly PackPredicate[] }
  | { readonly type: 'any'; readonly of: readonly PackPredicate[] }
  | { readonly type: 'not'; readonly of: PackPredicate };

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === 'string');
}

/** Parse an `applies_when` value into a {@link PackPredicate}, or `null` when it is not a valid predicate. */
export function parsePackPredicate(value: unknown): PackPredicate | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const o = value as Record<string, unknown>;
  switch (o.type) {
    case 'always':
      return { type: 'always' };
    case 'situation_is':
      return typeof o.situationClass === 'string' && o.situationClass !== ''
        ? { type: 'situation_is', situationClass: o.situationClass }
        : null;
    case 'call_type_is':
      return typeof o.callTypeId === 'string' && o.callTypeId !== ''
        ? { type: 'call_type_is', callTypeId: o.callTypeId }
        : null;
    case 'archetype_is':
      return typeof o.archetype === 'string' && o.archetype !== ''
        ? { type: 'archetype_is', archetype: o.archetype }
        : null;
    case 'facet_eq':
      return typeof o.facet === 'string' && o.facet !== '' && typeof o.value === 'string'
        ? { type: 'facet_eq', facet: o.facet, value: o.value }
        : null;
    case 'facet_in':
      return typeof o.facet === 'string' && o.facet !== '' && isStringArray(o.values)
        ? { type: 'facet_in', facet: o.facet, values: o.values }
        : null;
    case 'all':
    case 'any': {
      if (!Array.isArray(o.of)) return null;
      const of: PackPredicate[] = [];
      for (const child of o.of) {
        const parsed = parsePackPredicate(child);
        if (parsed === null) return null;
        of.push(parsed);
      }
      return o.type === 'all' ? { type: 'all', of } : { type: 'any', of };
    }
    case 'not': {
      const inner = parsePackPredicate(o.of);
      return inner === null ? null : { type: 'not', of: inner };
    }
    default:
      return null;
  }
}

function predicateToJson(predicate: PackPredicate): Record<string, unknown> {
  switch (predicate.type) {
    case 'all':
    case 'any':
      return { type: predicate.type, of: predicate.of.map(predicateToJson) };
    case 'not':
      return { type: 'not', of: predicateToJson(predicate.of) };
    default:
      return { ...predicate };
  }
}

// ─────────────────────────────── the document types ───────────────────────────────

/** When a pack is valid and what invalidates it. */
export interface PackValidity {
  /** Valid from (ISO 8601), or `null` for unbounded. */
  readonly from: string | null;
  /** Valid until (ISO 8601), or `null` for unbounded. */
  readonly to: string | null;
  /** The epoch or version label the pack is bound to. */
  readonly epochBinding: string;
  /** Events that invalidate the pack. */
  readonly invalidationTriggers: readonly string[];
}
/** The evidence a pack was derived from: counts, an interval, the evidence tier, arm sources and the time window. */
export interface PackEvidence {
  /** Observations behind the pack. */
  readonly n: number;
  /** Independent clusters behind the pack. */
  readonly clusters: number;
  /** The interval around the headline estimate. */
  readonly interval: readonly [number, number];
  /** The evidence tier (for example `authored` or `measured`). */
  readonly evidenceTier: string;
  /** The experiment arms the evidence came from. */
  readonly armSources: readonly string[];
  /** The observation window. */
  readonly window: { readonly start: string | null; readonly end: string | null };
}
/** Where a pack's content came from: the fact ids, a digest of their rollup and the ranker version. */
export interface PackLineage {
  /** The fact ids the content was derived from (never empty). */
  readonly factIds: readonly string[];
  /** A digest of the fact rollup. */
  readonly rollupDigest: string;
  /** The ranker version that selected the facts, when one did. */
  readonly rankerVersion?: string;
}
/** The pack's consent block: the owning workspace, whether export is consented, and the redaction version. */
export interface PackConsent {
  /** The owning workspace id. */
  readonly workspace: string;
  /** Whether exporting the pack is consented. */
  readonly exportConsent: boolean;
  /** The redaction policy version applied to the content. */
  readonly redactionVersion: string;
}
/** One checklist item. */
export interface PackChecklistItem {
  /** The source fact id. */
  readonly factId: string;
  /** The checklist text. */
  readonly text: string;
}
/** One exemplar: a rendered example with its outcome and polarity. */
export interface PackExemplar {
  /** The source fact id. */
  readonly factId: string;
  /** The observed outcome. */
  readonly outcome: string;
  /** `positive` (follow) or `negative` (avoid). */
  readonly polarity: PackExemplarPolarity;
  /** The rendered example. */
  readonly rendering: string;
  /** The outcome events that support it. */
  readonly outcomeEventIds: readonly string[];
}
/** One base rate: an observed rate with its sample size and interval. */
export interface PackBaseRate {
  /** The source fact id. */
  readonly factId: string;
  /** What the rate measures. */
  readonly subject: string;
  /** The observed rate (0 to 1). */
  readonly rate: number;
  /** The sample size. */
  readonly n: number;
  /** The interval around the rate. */
  readonly interval: readonly [number, number];
}
/** One refuted assertion and the outcome that refuted it. */
export interface PackRefuted {
  /** The source fact id. */
  readonly factId: string;
  /** The refuted assertion. */
  readonly assertion: string;
  /** The outcome that refuted it. */
  readonly refutingOutcomeId: string;
}
/** The pack body sections. */
export interface PackBody {
  /** Checklist items. */
  readonly checklist: readonly PackChecklistItem[];
  /** Exemplars. */
  readonly exemplars: readonly PackExemplar[];
  /** Base rates. */
  readonly baseRates: readonly PackBaseRate[];
  /** Refuted assertions. */
  readonly refuted: readonly PackRefuted[];
}

/** Every SOP dependency kind. */
export const PACK_SOP_DEPENDENCY_KINDS = ['POLICY', 'PACKET', 'RUBRIC'] as const;
/** An SOP dependency kind (one of {@link PACK_SOP_DEPENDENCY_KINDS}). */
export type PackSopDependencyKind = (typeof PACK_SOP_DEPENDENCY_KINDS)[number];
/** One SOP dependency. */
export interface PackSopDependency {
  /** The dependency kind. */
  readonly kind: PackSopDependencyKind;
  /** The dependency id. */
  readonly id: string;
}
/** One SOP phase. */
export interface PackSopPhase {
  /** The phase id. */
  readonly id: string;
  /** Actions allowed in the phase. */
  readonly allowedActionNames: readonly string[];
  /** Policies the phase requires. */
  readonly requiredPolicyIds: readonly string[];
  /** Artifacts the phase must produce. */
  readonly artifactContracts: readonly string[];
}
/** The SOP transition rules. */
export interface PackSopTransitions {
  /** `linear` (phase by phase) or `none`. */
  readonly forward: 'linear' | 'none';
  /** Phases that may be returned to. */
  readonly backward: readonly string[];
}
/** The SOP payload of a `sop` pack. */
export interface PackSop {
  /** The SOP name. */
  readonly name: string;
  /** The SOP version label. */
  readonly versionLabel: string;
  /** The phases, in order. */
  readonly phases: readonly PackSopPhase[];
  /** The dependencies. */
  readonly dependencies: readonly PackSopDependency[];
  /** The transition rules. */
  readonly transitions: PackSopTransitions;
  /** Phrases that must hold in every phase. */
  readonly invariantPhrases: readonly string[];
}

/** A parsed knowledge pack: frontmatter fields, the two hashes, the body and the optional SOP payload. */
export interface PackDocument {
  /** The format token (`ur.knowledge/1`). */
  readonly urFormat: UrKnowledgeFormat;
  /** The pack id. */
  readonly id: string;
  /** The pack version. */
  readonly version: number;
  /** The pack kind. */
  readonly kind: PackKind;
  /** The memory class. */
  readonly memoryClass: PackMemoryClass;
  /** The trust class. */
  readonly trustClass: PackTrustClass;
  /** The slot the pack targets. */
  readonly slot: PackSlot;
  /** A short description (at most {@link DESCRIPTOR_MAX_LENGTH} characters). */
  readonly descriptor: string;
  /** When the pack applies. */
  readonly appliesWhen: PackPredicate;
  /** The phases the pack applies to. */
  readonly phase: readonly string[];
  /** Whether the pack may be used only once per execution. */
  readonly singleUse: boolean;
  /** How the pack is delivered to a provider. */
  readonly nativeDelivery: PackNativeDelivery;
  /** The estimated token size of the rendered content. */
  readonly tokenEstimate: number;
  /** Validity and invalidation. */
  readonly validity: PackValidity;
  /** The supporting evidence. */
  readonly evidence: PackEvidence;
  /** Where the content came from. */
  readonly lineage: PackLineage;
  /** Ownership and export consent. */
  readonly consent: PackConsent;
  /** The content hash (the join key). */
  readonly contentHash: string;
  /** The provenance hash. */
  readonly provenanceHash: string;
  /** The body sections. */
  readonly body: PackBody;
  /** The SOP payload (present on `sop` packs). */
  readonly sop?: PackSop;
}

/** A named reason a pack was refused by {@link parsePack} or {@link validatePack}. */
export type PackRefusalCode =
  | 'UNSUPPORTED_FORMAT'
  | 'UNKNOWN_KIND'
  | 'UNKNOWN_MEMORY_CLASS'
  | 'UNKNOWN_TRUST_CLASS'
  | 'UNKNOWN_SLOT'
  | 'UNKNOWN_NATIVE_DELIVERY'
  | 'DESCRIPTOR_OVER_BUDGET'
  | 'INVALID_PREDICATE'
  | 'EMPTY_LINEAGE'
  | 'LEARNED_MUST_BE_APPROVED_DERIVED'
  | 'UNTRUSTED_IN_INSTRUCTION_SLOT'
  | 'EXPORT_CONSENT_REVOKED'
  | 'TENANT_MISMATCH'
  | 'CONTENT_HASH_MISMATCH'
  | 'PROVENANCE_HASH_MISMATCH'
  | 'MALFORMED_FRONTMATTER'
  | 'MALFORMED_BODY'
  | 'MISSING_FIELD';

/** Thrown by {@link parsePack} for a structural failure; `reason` names it. */
export class PackRefusedError extends Error {
  /** The named refusal. */
  readonly reason: PackRefusalCode;
  /** Create the error from a refusal and a detail message. */
  constructor(reason: PackRefusalCode, detail: string) {
    super(`${reason}: ${detail}`);
    this.name = 'PackRefusedError';
    this.reason = reason;
  }
}

// ─────────────────────────────── canonical projections + hashes ───────────────────────────────

function sopToJson(sop: PackSop): Record<string, unknown> {
  return {
    name: sop.name,
    version_label: sop.versionLabel,
    phases: sop.phases.map((p) => ({
      id: p.id,
      allowed_action_names: [...p.allowedActionNames],
      required_policy_ids: [...p.requiredPolicyIds],
      artifact_contracts: [...p.artifactContracts],
    })),
    dependencies: sop.dependencies.map((d) => ({ kind: d.kind, id: d.id })),
    transitions: { forward: sop.transitions.forward, backward: [...sop.transitions.backward] },
    invariant_phrases: [...sop.invariantPhrases],
  };
}

/** The canonical projection a pack's `content_hash` is computed over. */
export function packContentProjection(doc: PackDocument): Record<string, unknown> {
  return {
    ur_format: doc.urFormat,
    id: doc.id,
    version: doc.version,
    kind: doc.kind,
    memory_class: doc.memoryClass,
    trust_class: doc.trustClass,
    slot: doc.slot,
    descriptor: doc.descriptor,
    applies_when: doc.appliesWhen,
    phase: [...doc.phase],
    single_use: doc.singleUse,
    native_delivery: doc.nativeDelivery,
    token_estimate: doc.tokenEstimate,
    body: {
      checklist: doc.body.checklist.map((c) => ({ fact_id: c.factId, text: c.text })),
      exemplars: doc.body.exemplars.map((e) => ({
        fact_id: e.factId,
        outcome: e.outcome,
        polarity: e.polarity,
        rendering: e.rendering,
        outcome_event_ids: [...e.outcomeEventIds],
      })),
      base_rates: doc.body.baseRates.map((b) => ({
        fact_id: b.factId,
        subject: b.subject,
        rate: b.rate,
        n: b.n,
        interval: [...b.interval],
      })),
      refuted: doc.body.refuted.map((r) => ({
        fact_id: r.factId,
        assertion: r.assertion,
        refuting_outcome_id: r.refutingOutcomeId,
      })),
    },
    ...(doc.sop !== undefined ? { sop: sopToJson(doc.sop) } : {}),
  };
}

/** Compute a pack's `content_hash` (the join key) from its content projection. */
export function packContentHash(doc: PackDocument): string {
  return sha256Hex(canonicalJson(packContentProjection(doc)));
}

/** The canonical projection a pack's `provenance_hash` is computed over. */
export function packProvenanceProjection(doc: PackDocument): Record<string, unknown> {
  return {
    content_hash: doc.contentHash,
    validity: {
      from: doc.validity.from,
      to: doc.validity.to,
      epoch_binding: doc.validity.epochBinding,
      invalidation_triggers: [...doc.validity.invalidationTriggers].sort(),
    },
    evidence: {
      n: doc.evidence.n,
      clusters: doc.evidence.clusters,
      interval: [...doc.evidence.interval],
      evidence_tier: doc.evidence.evidenceTier,
      arm_sources: [...doc.evidence.armSources].sort(),
      window: { start: doc.evidence.window.start, end: doc.evidence.window.end },
    },
    lineage: {
      fact_ids: [...doc.lineage.factIds].sort(),
      rollup_digest: doc.lineage.rollupDigest,
      ...(doc.lineage.rankerVersion !== undefined
        ? { ranker_version: doc.lineage.rankerVersion }
        : {}),
    },
    consent: {
      workspace: doc.consent.workspace,
      export_consent: doc.consent.exportConsent,
      redaction_version: doc.consent.redactionVersion,
    },
  };
}

/** Compute a pack's `provenance_hash`, which binds an SOP pack to its reviewed provenance. */
export function packProvenanceHash(doc: PackDocument): string {
  return sha256Hex(canonicalJson(packProvenanceProjection(doc)));
}

// ─────────────────────────────── render + parse ───────────────────────────────

const PACK_BLOCK_KEYS: ReadonlySet<string> = new Set([
  'validity',
  'evidence',
  'lineage',
  'consent',
]);

/** Render a pack document to its canonical `*.ur.md` text. `renderPack(parsePack(text))` reproduces `text`. */
export function renderPack(doc: PackDocument): string {
  const front: Record<string, unknown> = {
    ur_format: doc.urFormat,
    id: doc.id,
    version: doc.version,
    kind: doc.kind,
    memory_class: doc.memoryClass,
    trust_class: doc.trustClass,
    slot: doc.slot,
    descriptor: doc.descriptor,
    applies_when: predicateToJson(doc.appliesWhen),
    phase: [...doc.phase],
    single_use: doc.singleUse,
    native_delivery: doc.nativeDelivery,
    token_estimate: doc.tokenEstimate,
    validity: {
      from: doc.validity.from,
      to: doc.validity.to,
      epoch_binding: doc.validity.epochBinding,
      invalidation_triggers: [...doc.validity.invalidationTriggers],
    },
    evidence: {
      n: doc.evidence.n,
      clusters: doc.evidence.clusters,
      interval: [...doc.evidence.interval],
      evidence_tier: doc.evidence.evidenceTier,
      arm_sources: [...doc.evidence.armSources],
      window: { start: doc.evidence.window.start, end: doc.evidence.window.end },
    },
    lineage: {
      fact_ids: [...doc.lineage.factIds],
      rollup_digest: doc.lineage.rollupDigest,
      ...(doc.lineage.rankerVersion !== undefined
        ? { ranker_version: doc.lineage.rankerVersion }
        : {}),
    },
    consent: {
      workspace: doc.consent.workspace,
      export_consent: doc.consent.exportConsent,
      redaction_version: doc.consent.redactionVersion,
    },
    ...(doc.sop !== undefined ? { sop: sopToJson(doc.sop) } : {}),
    content_hash: doc.contentHash,
    provenance_hash: doc.provenanceHash,
  };
  const sections: string[] = [`---\n${emitFrontmatter(front, PACK_BLOCK_KEYS)}\n---`];
  sections.push(
    renderSection(
      'checklist',
      doc.body.checklist.map((c) => ({ fact_id: c.factId, text: c.text })),
    ),
  );
  sections.push(
    renderSection(
      'exemplars',
      doc.body.exemplars.map((e) => ({
        fact_id: e.factId,
        outcome: e.outcome,
        polarity: e.polarity,
        rendering: e.rendering,
        outcome_event_ids: [...e.outcomeEventIds],
      })),
    ),
  );
  sections.push(
    renderSection(
      'base_rates',
      doc.body.baseRates.map((b) => ({
        fact_id: b.factId,
        subject: b.subject,
        rate: b.rate,
        n: b.n,
        interval: [...b.interval],
      })),
    ),
  );
  sections.push(
    renderSection(
      'refuted',
      doc.body.refuted.map((r) => ({
        fact_id: r.factId,
        assertion: r.assertion,
        refuting_outcome_id: r.refutingOutcomeId,
      })),
    ),
  );
  return `${sections.join('\n\n')}\n`;
}

function renderSection(name: string, items: readonly unknown[]): string {
  const lines = [`## ${name}`];
  for (const item of items) lines.push(`- ${JSON.stringify(item)}`);
  return lines.join('\n');
}

function requireString(o: Record<string, unknown>, key: string, ctx = key): string {
  const v = o[key];
  if (typeof v !== 'string')
    throw new PackRefusedError('MISSING_FIELD', `'${ctx}' must be a string`);
  return v;
}
function nullableString(o: Record<string, unknown>, key: string, ctx: string): string | null {
  const v = o[key];
  if (v === null) return null;
  if (typeof v !== 'string')
    throw new PackRefusedError('MISSING_FIELD', `'${ctx}' must be a string or null`);
  return v;
}
function requireNumber(o: Record<string, unknown>, key: string, ctx = key): number {
  const v = o[key];
  if (typeof v !== 'number' || !Number.isFinite(v))
    throw new PackRefusedError('MISSING_FIELD', `'${ctx}' must be a number`);
  return v;
}
function requireBoolean(o: Record<string, unknown>, key: string, ctx = key): boolean {
  const v = o[key];
  if (typeof v !== 'boolean')
    throw new PackRefusedError('MISSING_FIELD', `'${ctx}' must be a boolean`);
  return v;
}
function requireStringArray(o: Record<string, unknown>, key: string, ctx = key): string[] {
  const v = o[key];
  if (!isStringArray(v))
    throw new PackRefusedError('MISSING_FIELD', `'${ctx}' must be a string array`);
  return v;
}
function requireInterval(o: Record<string, unknown>, key: string, ctx: string): [number, number] {
  const v = o[key];
  if (!Array.isArray(v) || v.length !== 2 || typeof v[0] !== 'number' || typeof v[1] !== 'number') {
    throw new PackRefusedError('MISSING_FIELD', `'${ctx}' must be a [low, high] number pair`);
  }
  return [v[0], v[1]];
}
function requireObject(
  o: Record<string, unknown>,
  key: string,
  ctx = key,
): Record<string, unknown> {
  const v = o[key];
  if (typeof v !== 'object' || v === null || Array.isArray(v))
    throw new PackRefusedError('MISSING_FIELD', `'${ctx}' must be an object`);
  return v as Record<string, unknown>;
}
function requireEnum<T extends string>(
  o: Record<string, unknown>,
  key: string,
  allowed: readonly T[],
  refusal: PackRefusalCode,
): T {
  const v = o[key];
  if (typeof v !== 'string' || !(allowed as readonly string[]).includes(v))
    throw new PackRefusedError(refusal, `'${key}' = ${JSON.stringify(v)}`);
  return v as T;
}

/**
 * Parse `*.ur.md` text into a {@link PackDocument}. Structural only: it throws
 * {@link PackRefusedError} on a malformed document but does not check the hashes (use
 * {@link validatePack} or {@link loadPack}).
 */
export function parsePack(text: string): PackDocument {
  const match = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(text);
  if (match === null)
    throw new PackRefusedError('MALFORMED_FRONTMATTER', 'no `---` frontmatter fence found');
  let front: Record<string, unknown>;
  try {
    front = parseFrontmatter(match[1] ?? '');
  } catch (e) {
    if (e instanceof FrontmatterParseError)
      throw new PackRefusedError('MALFORMED_FRONTMATTER', e.message);
    throw e;
  }
  const body = parseBody(match[2] ?? '');
  const urFormat = requireString(front, 'ur_format');
  if (urFormat !== UR_KNOWLEDGE_FORMAT) throw new PackRefusedError('UNSUPPORTED_FORMAT', urFormat);
  const appliesWhen = parsePackPredicate(front.applies_when);
  if (appliesWhen === null)
    throw new PackRefusedError(
      'INVALID_PREDICATE',
      'applies_when is outside the closed predicate set',
    );
  const validity = requireObject(front, 'validity');
  const evidence = requireObject(front, 'evidence');
  const lineage = requireObject(front, 'lineage');
  const consent = requireObject(front, 'consent');
  const windowObj = requireObject(evidence, 'window', 'evidence.window');
  return {
    urFormat: UR_KNOWLEDGE_FORMAT,
    id: requireString(front, 'id'),
    version: requireNumber(front, 'version'),
    kind: requireEnum(front, 'kind', PACK_KINDS, 'UNKNOWN_KIND'),
    memoryClass: requireEnum(front, 'memory_class', PACK_MEMORY_CLASSES, 'UNKNOWN_MEMORY_CLASS'),
    trustClass: requireEnum(front, 'trust_class', PACK_TRUST_CLASSES, 'UNKNOWN_TRUST_CLASS'),
    slot: requireEnum(front, 'slot', PACK_SLOTS, 'UNKNOWN_SLOT'),
    descriptor: requireString(front, 'descriptor'),
    appliesWhen,
    phase: requireStringArray(front, 'phase'),
    singleUse: requireBoolean(front, 'single_use'),
    nativeDelivery: requireEnum(
      front,
      'native_delivery',
      PACK_NATIVE_DELIVERIES,
      'UNKNOWN_NATIVE_DELIVERY',
    ),
    tokenEstimate: requireNumber(front, 'token_estimate'),
    validity: {
      from: nullableString(validity, 'from', 'validity.from'),
      to: nullableString(validity, 'to', 'validity.to'),
      epochBinding: requireString(validity, 'epoch_binding', 'validity.epoch_binding'),
      invalidationTriggers: requireStringArray(
        validity,
        'invalidation_triggers',
        'validity.invalidation_triggers',
      ),
    },
    evidence: {
      n: requireNumber(evidence, 'n', 'evidence.n'),
      clusters: requireNumber(evidence, 'clusters', 'evidence.clusters'),
      interval: requireInterval(evidence, 'interval', 'evidence.interval'),
      evidenceTier: requireString(evidence, 'evidence_tier', 'evidence.evidence_tier'),
      armSources: requireStringArray(evidence, 'arm_sources', 'evidence.arm_sources'),
      window: {
        start: nullableString(windowObj, 'start', 'evidence.window.start'),
        end: nullableString(windowObj, 'end', 'evidence.window.end'),
      },
    },
    lineage: {
      factIds: requireStringArray(lineage, 'fact_ids', 'lineage.fact_ids'),
      rollupDigest: requireString(lineage, 'rollup_digest', 'lineage.rollup_digest'),
      ...(typeof lineage.ranker_version === 'string'
        ? { rankerVersion: lineage.ranker_version }
        : {}),
    },
    consent: {
      workspace: requireString(consent, 'workspace', 'consent.workspace'),
      exportConsent: requireBoolean(consent, 'export_consent', 'consent.export_consent'),
      redactionVersion: requireString(consent, 'redaction_version', 'consent.redaction_version'),
    },
    contentHash: requireString(front, 'content_hash'),
    provenanceHash: requireString(front, 'provenance_hash'),
    body,
    ...(front.sop !== undefined ? { sop: parseSop(front.sop) } : {}),
  };
}

function parseSop(value: unknown): PackSop {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new PackRefusedError('MALFORMED_FRONTMATTER', 'sop must be an object');
  const o = value as Record<string, unknown>;
  if (!Array.isArray(o.phases))
    throw new PackRefusedError('MISSING_FIELD', 'sop.phases must be an array');
  const phases: PackSopPhase[] = o.phases.map((p, i) => {
    if (typeof p !== 'object' || p === null || Array.isArray(p))
      throw new PackRefusedError('MISSING_FIELD', `sop.phases[${String(i)}] must be an object`);
    const pr = p as Record<string, unknown>;
    return {
      id: requireString(pr, 'id', `sop.phases[${String(i)}].id`),
      allowedActionNames: requireStringArray(
        pr,
        'allowed_action_names',
        `sop.phases[${String(i)}].allowed_action_names`,
      ),
      requiredPolicyIds: requireStringArray(
        pr,
        'required_policy_ids',
        `sop.phases[${String(i)}].required_policy_ids`,
      ),
      artifactContracts: requireStringArray(
        pr,
        'artifact_contracts',
        `sop.phases[${String(i)}].artifact_contracts`,
      ),
    };
  });
  const depsRaw = Array.isArray(o.dependencies) ? o.dependencies : [];
  const dependencies: PackSopDependency[] = depsRaw.map((d, i) => {
    if (typeof d !== 'object' || d === null || Array.isArray(d))
      throw new PackRefusedError(
        'MISSING_FIELD',
        `sop.dependencies[${String(i)}] must be an object`,
      );
    const dr = d as Record<string, unknown>;
    const kind = requireString(dr, 'kind', `sop.dependencies[${String(i)}].kind`);
    if (!(PACK_SOP_DEPENDENCY_KINDS as readonly string[]).includes(kind))
      throw new PackRefusedError(
        'MALFORMED_FRONTMATTER',
        `sop.dependencies[${String(i)}].kind '${kind}' invalid`,
      );
    return {
      kind: kind as PackSopDependencyKind,
      id: requireString(dr, 'id', `sop.dependencies[${String(i)}].id`),
    };
  });
  const transitions = requireObject(o, 'transitions', 'sop.transitions');
  const forward = requireString(transitions, 'forward', 'sop.transitions.forward');
  if (forward !== 'linear' && forward !== 'none')
    throw new PackRefusedError(
      'MALFORMED_FRONTMATTER',
      `sop.transitions.forward '${forward}' invalid`,
    );
  return {
    name: requireString(o, 'name', 'sop.name'),
    versionLabel: requireString(o, 'version_label', 'sop.version_label'),
    phases,
    dependencies,
    transitions: {
      forward,
      backward: requireStringArray(transitions, 'backward', 'sop.transitions.backward'),
    },
    invariantPhrases: requireStringArray(o, 'invariant_phrases', 'sop.invariant_phrases'),
  };
}

function parseBody(text: string): PackBody {
  const sections = splitBodySections(text);
  return {
    checklist: (sections.checklist ?? []).map((raw, i) => {
      const o = parseBodyItem(raw, `checklist[${String(i)}]`);
      return {
        factId: requireString(o, 'fact_id', `checklist[${String(i)}].fact_id`),
        text: requireString(o, 'text', `checklist[${String(i)}].text`),
      };
    }),
    exemplars: (sections.exemplars ?? []).map((raw, i) => {
      const o = parseBodyItem(raw, `exemplars[${String(i)}]`);
      const polarity = requireString(o, 'polarity', `exemplars[${String(i)}].polarity`);
      if (!(PACK_EXEMPLAR_POLARITIES as readonly string[]).includes(polarity))
        throw new PackRefusedError(
          'MALFORMED_BODY',
          `exemplars[${String(i)}].polarity '${polarity}' invalid`,
        );
      return {
        factId: requireString(o, 'fact_id', `exemplars[${String(i)}].fact_id`),
        outcome: requireString(o, 'outcome', `exemplars[${String(i)}].outcome`),
        polarity: polarity as PackExemplarPolarity,
        rendering: requireString(o, 'rendering', `exemplars[${String(i)}].rendering`),
        outcomeEventIds: requireStringArray(
          o,
          'outcome_event_ids',
          `exemplars[${String(i)}].outcome_event_ids`,
        ),
      };
    }),
    baseRates: (sections.base_rates ?? []).map((raw, i) => {
      const o = parseBodyItem(raw, `base_rates[${String(i)}]`);
      return {
        factId: requireString(o, 'fact_id', `base_rates[${String(i)}].fact_id`),
        subject: requireString(o, 'subject', `base_rates[${String(i)}].subject`),
        rate: requireNumber(o, 'rate', `base_rates[${String(i)}].rate`),
        n: requireNumber(o, 'n', `base_rates[${String(i)}].n`),
        interval: requireInterval(o, 'interval', `base_rates[${String(i)}].interval`),
      };
    }),
    refuted: (sections.refuted ?? []).map((raw, i) => {
      const o = parseBodyItem(raw, `refuted[${String(i)}]`);
      return {
        factId: requireString(o, 'fact_id', `refuted[${String(i)}].fact_id`),
        assertion: requireString(o, 'assertion', `refuted[${String(i)}].assertion`),
        refutingOutcomeId: requireString(
          o,
          'refuting_outcome_id',
          `refuted[${String(i)}].refuting_outcome_id`,
        ),
      };
    }),
  };
}

function splitBodySections(text: string): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  let current: string | null = null;
  for (const line of text.split('\n')) {
    const header = /^##\s+(\w+)\s*$/.exec(line);
    if (header !== null) {
      current = header[1] ?? null;
      if (current !== null && out[current] === undefined) out[current] = [];
      continue;
    }
    if (current === null) continue;
    const trimmed = line.trim();
    if (trimmed === '') continue;
    if (!trimmed.startsWith('- '))
      throw new PackRefusedError('MALFORMED_BODY', `section '${current}' has a non-list line`);
    (out[current] as string[]).push(trimmed.slice(2));
  }
  return out;
}

function parseBodyItem(raw: string, context: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new PackRefusedError('MALFORMED_BODY', `${context} is not valid inline JSON`);
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed))
    throw new PackRefusedError('MALFORMED_BODY', `${context} must be a JSON object`);
  return parsed as Record<string, unknown>;
}

// ─────────────────────────────── validate ───────────────────────────────

/** Optional checks for {@link validatePack} and {@link loadPack}. */
export interface PackValidationContext {
  /** Refuse a pack owned by a different workspace. */
  readonly workspace?: string;
  /** Refuse a pack without export consent. */
  readonly requireExportConsent?: boolean;
}
/** The result of {@link validatePack}: `{ ok: true, document }` or `{ ok: false, refusals }`. */
export type PackValidation =
  | { readonly ok: true; readonly document: PackDocument }
  | { readonly ok: false; readonly refusals: readonly PackRefusalCode[] };

/**
 * Validate a parsed pack: closed vocabularies, the trust/slot rules, recomputed hashes, and (from
 * `ctx`) the tenant and export consent. Returns every refusal, never throws.
 */
export function validatePack(doc: PackDocument, ctx: PackValidationContext = {}): PackValidation {
  const refusals: PackRefusalCode[] = [];
  if (doc.urFormat !== UR_KNOWLEDGE_FORMAT) refusals.push('UNSUPPORTED_FORMAT');
  if (!(PACK_KINDS as readonly string[]).includes(doc.kind)) refusals.push('UNKNOWN_KIND');
  if (!(PACK_MEMORY_CLASSES as readonly string[]).includes(doc.memoryClass))
    refusals.push('UNKNOWN_MEMORY_CLASS');
  if (!(PACK_TRUST_CLASSES as readonly string[]).includes(doc.trustClass))
    refusals.push('UNKNOWN_TRUST_CLASS');
  if (!(PACK_SLOTS as readonly string[]).includes(doc.slot)) refusals.push('UNKNOWN_SLOT');
  if (doc.descriptor.length > DESCRIPTOR_MAX_LENGTH) refusals.push('DESCRIPTOR_OVER_BUDGET');
  if (doc.lineage.factIds.length === 0) refusals.push('EMPTY_LINEAGE');
  if (doc.kind === 'learned_pack' && doc.trustClass !== 'approved_derived')
    refusals.push('LEARNED_MUST_BE_APPROVED_DERIVED');
  if (
    (doc.trustClass === 'approved_derived' || doc.trustClass === 'untrusted') &&
    doc.slot === 'instruction'
  )
    refusals.push('UNTRUSTED_IN_INSTRUCTION_SLOT');
  if (packContentHash({ ...doc, contentHash: '', provenanceHash: '' }) !== doc.contentHash)
    refusals.push('CONTENT_HASH_MISMATCH');
  if (packProvenanceHash({ ...doc, provenanceHash: '' }) !== doc.provenanceHash)
    refusals.push('PROVENANCE_HASH_MISMATCH');
  if (ctx.workspace !== undefined && doc.consent.workspace !== ctx.workspace)
    refusals.push('TENANT_MISMATCH');
  if (ctx.requireExportConsent === true && doc.consent.exportConsent !== true)
    refusals.push('EXPORT_CONSENT_REVOKED');
  return refusals.length === 0 ? { ok: true, document: doc } : { ok: false, refusals };
}

// ─────────────────────────────── loadPack → Module ───────────────────────────────

/** The result of {@link loadPack}: the parsed document and its projection as a context `Module`. */
export interface LoadedPack {
  /** The parsed, validated pack. */
  readonly document: PackDocument;
  /** The pack projected to a context `Module`. */
  readonly module: Module;
}

/** Thrown by {@link loadPack} when a pack is refused; `refusals` lists every reason. */
export class LoadPackError extends Error {
  /** Every refusal. */
  readonly refusals: readonly PackRefusalCode[];
  /** Create the error from the refusal list. */
  constructor(refusals: readonly PackRefusalCode[]) {
    super(`pack refused: ${refusals.join(', ')}`);
    this.name = 'LoadPackError';
    this.refusals = refusals;
  }
}

/**
 * Parse and validate a pack, failing closed, and project it to a context `Module` (its
 * `contentHash` is the join key). Throws {@link LoadPackError} listing every refusal.
 *
 * @example
 * ```ts
 * import { readFileSync } from "node:fs";
 * import { loadPack } from "@ultrarouter/sdk/context";
 *
 * const { document, module } = loadPack(readFileSync("knowledge/release-checklist.ur.md", "utf8"), {
 *   workspace: "ws_fixture",
 * });
 * console.log(document.kind, module.contentHash === document.contentHash);
 * ```
 */
export function loadPack(text: string, ctx: PackValidationContext = {}): LoadedPack {
  const document = parsePack(text);
  const validation = validatePack(document, ctx);
  if (!validation.ok) throw new LoadPackError(validation.refusals);
  const module = ModuleSchema.parse({
    id: document.id,
    version: String(document.version),
    kind: document.kind,
    memoryClass: document.memoryClass,
    trustClass: document.trustClass,
    privacyClass: `redacted:${document.consent.redactionVersion}`,
    availability: { from: document.validity.from, to: document.validity.to },
    contentHash: document.contentHash,
    tokenEstimate: document.tokenEstimate,
    facets: {},
    slotHint: document.slot,
    ext: {
      ur_knowledge: {
        provenance_hash: document.provenanceHash,
        validity: packProvenanceProjection(document).validity,
        evidence: packProvenanceProjection(document).evidence,
        lineage: packProvenanceProjection(document).lineage,
        consent: packProvenanceProjection(document).consent,
        applies_when: predicateToJson(document.appliesWhen),
        single_use: document.singleUse,
        native_delivery: document.nativeDelivery,
        phase: [...document.phase],
        body: packContentProjection(document).body,
        ...(document.sop !== undefined ? { sop: sopToJson(document.sop) } : {}),
      },
    },
  });
  return { document, module };
}
