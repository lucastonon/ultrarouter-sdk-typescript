// Generated file: vendored context runtime. Do not edit by hand.
/**
 * Compile (the normative, profile-parameterised admission
 * algorithm). PURE: no clock, no env, no RNG, no IO. Same inputs ⇒ same manifest hash.
 *
 * The ONE compiler every adopting profile shares. Parent-specific AUTHORITY (tenant isolation,
 * leases, locale, editorial authority, dedupe identity) is enforced by each parent's
 * ADAPTER, which pre-refuses a candidate via `adapterRefusal` BEFORE compile;
 * the compiler folds that refusal inline, in candidate order, and never reads
 * `ext` for authority. The GENERIC steps here — stage/planner bounds, pins by exact
 * id+kind+hash, required kinds, availability vs `asOf`, forbidden kinds, release
 * binding, trust slotting, profile limits, budget admission (shed whole modules), and
 * ordering by `profile.orderRule` — are the same code path for every profile.
 */

import { ContractSchema, type Contract, type Limit } from './contract.js';
import { EnvelopeSchema, hashEnvelope, type Envelope } from './envelope.js';
import { hashContextValue } from './hash.js';
import { ManifestSchema, scaffoldSubject, type Manifest, type ManifestEntry } from './manifest.js';
import { INSTRUCTION_SLOT } from './messages.js';
import { ModuleSchema, type Module } from './module.js';
import type { CompatibilityProfile, ManifestEncoderInput } from './profile.js';
import type { ContextRefusalReason, Refusal } from './refusals.js';

/** A parent adapter's authority pre-refusal for one candidate (dedupe, scope, lease,
 * locale, editorial authority). Folded inline by the compiler, in candidate order.
 * `code` is the parent's verbatim refusal code (emitted as-is — the parity seam);
 * `reason` is the generic classification (defaults to `code` when the parent's authority
 * is not in the base vocabulary). */
export interface AdapterRefusal {
  readonly code: string;
  readonly message: string;
  readonly reason?: string;
  readonly detail?: string;
}

/** One candidate offered to compile: the module, an optional explicit slot, and an
 * optional adapter authority pre-refusal. Direct callers pass just `{ module }`. */
export interface ContextCandidate {
  readonly module: Module;
  readonly slot?: string;
  readonly adapterRefusal?: AdapterRefusal;
}

/** The result of compile: the manifest (null when inadmissible) + every refusal. */
export interface CompileResult {
  readonly ok: boolean;
  readonly manifest: Manifest | null;
  readonly refusals: readonly Refusal[];
}

const DEFAULT_REFERENCE_SLOT = 'reference';

function facetMatchesRelease(
  facet: string | readonly string[] | undefined,
  release: string | readonly string[] | undefined,
): boolean {
  if (facet === undefined || release === undefined) return false;
  const facetList = Array.isArray(facet) ? facet : [facet];
  const releaseList = Array.isArray(release) ? release : [release];
  return facetList.some((value) => releaseList.includes(value));
}

/** Numeric instant compare (ms). Returns null when either side is unparseable. */
function instantCmp(left: string, right: string): number | null {
  const a = Date.parse(left);
  const b = Date.parse(right);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return a - b;
}

/** Resolve the slot a candidate lands in. Untrusted modules never default to the
 * instruction slot; an EXPLICIT untrusted instruction placement is a refusal (below). */
function resolveSlot(candidate: ContextCandidate): string {
  const explicit = candidate.slot ?? candidate.module.slotHint;
  if (explicit !== undefined) return explicit;
  return candidate.module.trustClass === 'untrusted' ? DEFAULT_REFERENCE_SLOT : INSTRUCTION_SLOT;
}

interface EligibilityFinding {
  readonly reason: ContextRefusalReason;
  readonly detail?: string;
  readonly message: string;
}

/**
 * The generic per-candidate eligibility. Returns the FIRST
 * failing reason or null. Order is documented + stable so a candidate that matches
 * several conditions always yields the same reason (parity precondition: fixtures keep
 * one reason per excluded candidate). Excludes budget + limits (handled by the caller,
 * which counts state).
 */
function eligibilityFinding(
  module: Module,
  slot: string,
  envelope: Envelope,
  contract: Contract,
  profile: CompatibilityProfile,
): EligibilityFinding | null {
  if (contract.forbiddenKinds.includes(module.kind)) {
    return { reason: 'FORBIDDEN_KIND', message: `kind ${module.kind} is forbidden for this stage` };
  }
  if (
    (profile.authoritativeKinds ?? []).includes(module.kind) &&
    module.trustClass !== 'authoritative'
  ) {
    return {
      reason: 'AUTHORITATIVE_CONTEXT_UNTRUSTED',
      message: `kind ${module.kind} must be authoritative`,
    };
  }
  const binding = profile.releaseBinding;
  if (binding && binding.kinds.includes(module.kind)) {
    if (!facetMatchesRelease(module.facets[binding.facet], envelope.releases[binding.releaseKey])) {
      return {
        reason: 'POLICY_RELEASE_MISMATCH',
        message: `kind ${module.kind} is not bound to a pinned ${binding.releaseKey} release`,
      };
    }
  }
  const availabilityFinding = availabilityRefusal(module, envelope, profile);
  if (availabilityFinding) return availabilityFinding;
  if (module.trustClass === 'untrusted' && slot === INSTRUCTION_SLOT) {
    return {
      reason: 'UNTRUSTED_IN_INSTRUCTION_SLOT',
      message: 'untrusted content may not be placed in an instruction slot',
    };
  }
  return null;
}

function availabilityRefusal(
  module: Module,
  envelope: Envelope,
  profile: CompatibilityProfile,
): EligibilityFinding | null {
  const { from, to } = module.availability;
  if (from === null) {
    if (profile.availability?.refuseUndated) {
      return {
        reason: 'AVAILABILITY_REFUSED',
        detail: 'unknown',
        message: 'the module carries no availability and cannot be dated against the cutoff',
      };
    }
    // Default: a module with no window is always available.
  } else {
    const cmp = instantCmp(from, envelope.asOf);
    if (cmp !== null && cmp > 0) {
      return {
        reason: 'AVAILABILITY_REFUSED',
        detail: 'after_cutoff',
        message: 'the module became available after the knowledge cutoff',
      };
    }
  }
  if (to !== null) {
    const cmp = instantCmp(to, envelope.asOf);
    if (cmp !== null && cmp < 0) {
      return {
        reason: 'AVAILABILITY_REFUSED',
        detail: 'expired',
        message: 'the module expired before the knowledge cutoff',
      };
    }
  }
  return null;
}

/** Whether an undated-module refusal is FATAL for this envelope's mode (STRICT). */
function undatedIsFatal(
  finding: EligibilityFinding,
  envelope: Envelope,
  profile: CompatibilityProfile,
): boolean {
  return (
    finding.detail === 'unknown' &&
    (profile.availability?.strictModes ?? []).includes(envelope.mode)
  );
}

function facetCountKey(limit: Limit): string {
  return `${limit.kind ?? ''}|${limit.facet ?? ''}|${limit.facetValue ?? ''}`;
}

function limitMatches(limit: Limit, module: Module): boolean {
  if (limit.kind !== undefined && limit.kind !== module.kind) return false;
  if (limit.facet !== undefined) {
    const value = module.facets[limit.facet];
    if (value === undefined) return false;
    if (limit.facetValue !== undefined) {
      const list = Array.isArray(value) ? value : [value];
      if (!list.includes(limit.facetValue)) return false;
    }
  }
  return true;
}

interface Admitted {
  readonly module: Module;
  readonly slot: string;
  readonly mandatory: boolean;
  readonly admissionIndex: number;
}

export function compile(
  envelopeRaw: Envelope,
  contractRaw: Contract,
  candidatesRaw: readonly ContextCandidate[],
  profile: CompatibilityProfile,
): CompileResult {
  const envelope = EnvelopeSchema.parse(envelopeRaw);
  const contract = ContractSchema.parse(contractRaw);
  const candidates = candidatesRaw.map((candidate) => ({
    module: ModuleSchema.parse(candidate.module),
    slot: candidate.slot,
    adapterRefusal: candidate.adapterRefusal,
  }));

  const refusals: Refusal[] = [];
  let fatal = false;
  const refuse = (
    reason: ContextRefusalReason,
    opts: {
      readonly message: string;
      readonly fatal: boolean;
      readonly detail?: string;
      readonly moduleId?: string;
      readonly kind?: string;
      readonly path?: string;
    },
  ): void => {
    refusals.push({
      reason,
      code: profile.refusals.encode(reason, opts.detail),
      message: opts.message,
      fatal: opts.fatal,
      ...(opts.detail !== undefined ? { detail: opts.detail } : {}),
      ...(opts.moduleId !== undefined ? { moduleId: opts.moduleId } : {}),
      ...(opts.kind !== undefined ? { kind: opts.kind } : {}),
      ...(opts.path !== undefined ? { path: opts.path } : {}),
    });
    if (opts.fatal) fatal = true;
  };
  const refuseAdapter = (
    adapter: AdapterRefusal,
    opts: { readonly fatal: boolean; readonly moduleId?: string; readonly kind?: string },
  ): void => {
    refusals.push({
      reason: adapter.reason ?? adapter.code,
      code: adapter.code,
      message: adapter.message,
      fatal: opts.fatal,
      ...(adapter.detail !== undefined ? { detail: adapter.detail } : {}),
      ...(opts.moduleId !== undefined ? { moduleId: opts.moduleId } : {}),
      ...(opts.kind !== undefined ? { kind: opts.kind } : {}),
    });
    if (opts.fatal) fatal = true;
  };

  // 1. Stage / planner-bound validation.
  if (contract.stage !== envelope.stage) {
    refuse('STAGE_CONTRACT_MISMATCH', {
      message: 'the contract stage does not match the execution stage',
      fatal: true,
      path: 'contract.stage',
    });
  }
  for (const key of ['plannerDepth', 'plannerPass', 'toolCalls'] as const) {
    const ceiling = contract.budgets[key];
    const requested = envelope.budgets[key];
    if (ceiling !== undefined && requested !== undefined && requested > ceiling) {
      refuse('PLANNER_BOUND_EXCEEDED', {
        message: `planning ${key} ${String(requested)} exceeds the contract ceiling ${String(ceiling)}`,
        fatal: true,
        detail: key,
        path: `envelope.budgets.${key}`,
      });
    }
  }

  const byId = new Map(candidates.map((candidate) => [candidate.module.id, candidate]));
  const allowedKinds = new Set([...contract.requiredKinds, ...contract.optionalKinds]);

  // 2. Pins by exact id + kind + hash (only under a strict pin policy).
  const pinnedIds = new Set<string>();
  if (contract.pinPolicy === 'strict') {
    const requiredKindsPinned = new Set<string>();
    for (const pin of envelope.pins) {
      pinnedIds.add(pin.id);
      requiredKindsPinned.add(pin.kind);
      if (!allowedKinds.has(pin.kind)) {
        refuse('PINNED_CONTEXT_NOT_REQUESTED', {
          message: `pin ${pin.id} is a kind (${pin.kind}) the contract neither requires nor allows`,
          fatal: true,
          moduleId: pin.id,
          kind: pin.kind,
        });
        continue;
      }
      const candidate = byId.get(pin.id);
      if (!candidate) {
        refuse('REQUIRED_CONTEXT_MISSING', {
          message: `pinned module ${pin.id} could not be resolved`,
          fatal: true,
          moduleId: pin.id,
          kind: pin.kind,
        });
        continue;
      }
      if (candidate.module.kind !== pin.kind || candidate.module.contentHash !== pin.contentHash) {
        refuse('PINNED_CONTEXT_MISMATCH', {
          message: `pinned module ${pin.id} does not match the frozen kind and content hash`,
          fatal: true,
          moduleId: pin.id,
          kind: pin.kind,
        });
      }
    }
    // 3. Required kinds present — each must be covered by a pin.
    for (const kind of contract.requiredKinds) {
      if (!requiredKindsPinned.has(kind)) {
        refuse('REQUIRED_CONTEXT_NOT_PINNED', {
          message: `required kind ${kind} has no pin`,
          fatal: true,
          kind,
        });
      }
    }
  }

  // 4/5. Eligibility + slotting. Mandatory (pinned) first, in pin order; then optional
  // candidates in selection order (adapter refusals folded inline).
  const admitted: Admitted[] = [];
  let admissionIndex = 0;

  const admit = (module: Module, slot: string, mandatory: boolean): void => {
    admitted.push({ module, slot, mandatory, admissionIndex });
    admissionIndex += 1;
  };

  // Mandatory pass.
  for (const pin of contract.pinPolicy === 'strict' ? envelope.pins : []) {
    const candidate = byId.get(pin.id);
    // A pin that already failed resolution / match was recorded fatal above; skip it.
    if (
      !candidate ||
      candidate.module.kind !== pin.kind ||
      candidate.module.contentHash !== pin.contentHash
    ) {
      continue;
    }
    if (!allowedKinds.has(pin.kind)) continue;
    const slot = resolveSlot(candidate);
    if (candidate.adapterRefusal) {
      refuseAdapter(candidate.adapterRefusal, { fatal: true, moduleId: pin.id, kind: pin.kind });
      continue;
    }
    const finding = eligibilityFinding(candidate.module, slot, envelope, contract, profile);
    if (finding) {
      refuse(finding.reason, {
        message: finding.message,
        fatal: true,
        detail: finding.detail,
        moduleId: pin.id,
        kind: pin.kind,
      });
      continue;
    }
    admit(candidate.module, slot, true);
  }

  // Optional pass.
  const limits: Limit[] = [...profile.limits, ...contract.limits];
  const limitCounts = new Map<string, number>();
  const kindCounts = new Map<string, number>();
  let optionalConsidered = 0;
  const budget = profile.budget;
  const tentativeOptional: Admitted[] = [];

  for (const candidate of candidates) {
    const { module } = candidate;
    if (pinnedIds.has(module.id)) continue; // handled in the mandatory pass
    const slot = resolveSlot(candidate);

    if (candidate.adapterRefusal) {
      refuseAdapter(candidate.adapterRefusal, {
        fatal: false,
        moduleId: module.id,
        kind: module.kind,
      });
      continue;
    }
    // Result ceiling: only candidates that reached consideration count toward it.
    if (profile.resultCeiling != null && optionalConsidered >= profile.resultCeiling) {
      refuse('LIMIT_EXCEEDED', {
        message: `optional result ceiling ${String(profile.resultCeiling)} reached`,
        fatal: false,
        detail: 'result_ceiling',
        moduleId: module.id,
        kind: module.kind,
      });
      continue;
    }
    optionalConsidered += 1;
    if (!allowedKinds.has(module.kind)) {
      refuse('FORBIDDEN_KIND', {
        message: `kind ${module.kind} is not optional for this stage`,
        fatal: false,
        detail: 'not_optional',
        moduleId: module.id,
        kind: module.kind,
      });
      continue;
    }
    const finding = eligibilityFinding(module, slot, envelope, contract, profile);
    if (finding) {
      refuse(finding.reason, {
        message: finding.message,
        fatal: undatedIsFatal(finding, envelope, profile),
        detail: finding.detail,
        moduleId: module.id,
        kind: module.kind,
      });
      continue;
    }
    // Explicit per-kind / per-facet limits.
    const matchedLimit = limits.find((limit) => limitMatches(limit, module));
    if (matchedLimit) {
      const key = facetCountKey(matchedLimit);
      const count = limitCounts.get(key) ?? 0;
      if (count >= matchedLimit.max) {
        refuse('LIMIT_EXCEEDED', {
          message: `${matchedLimit.label ?? matchedLimit.kind ?? matchedLimit.facet ?? 'limit'} cap ${String(matchedLimit.max)} reached`,
          fatal: false,
          detail: 'limit',
          moduleId: module.id,
          kind: module.kind,
        });
        continue;
      }
      limitCounts.set(key, count + 1);
    } else if (profile.defaultKindLimit != null) {
      const count = kindCounts.get(module.kind) ?? 0;
      if (count >= profile.defaultKindLimit) {
        refuse('LIMIT_EXCEEDED', {
          message: `default kind cap ${String(profile.defaultKindLimit)} reached for ${module.kind}`,
          fatal: false,
          detail: 'default_kind_limit',
          moduleId: module.id,
          kind: module.kind,
        });
        continue;
      }
      kindCounts.set(module.kind, count + 1);
    }

    // 6. Budget admission.
    if (budget.kind === 'count') {
      const limit = budget.limit(envelope, contract);
      const admittedCount = admitted.length + tentativeOptional.length;
      if (limit != null && admittedCount >= limit) {
        refuse('BUDGET_EXCEEDED', {
          message: `selection budget ${String(limit)} reached`,
          fatal: false,
          detail: 'count',
          moduleId: module.id,
          kind: module.kind,
        });
        continue;
      }
      admit(module, slot, false);
    } else {
      // Token budget shed happens after the pass; tentatively hold the candidate.
      tentativeOptional.push({ module, slot, mandatory: false, admissionIndex });
      admissionIndex += 1;
    }
  }

  // 6 (tokens). Shed by keep-priority to fit the token ceiling; mandatory never shed.
  if (budget.kind === 'tokens') {
    const limit = budget.limit(envelope, contract);
    let admittedTokens = admitted.reduce((sum, entry) => sum + entry.module.tokenEstimate, 0);
    const keepOrder = [...tentativeOptional].sort(
      (left, right) =>
        budget.keepPriority(toEntryShape(right)) - budget.keepPriority(toEntryShape(left)) ||
        left.admissionIndex - right.admissionIndex,
    );
    const kept = new Set<number>();
    const shedMode = budget.shedMode ?? 'prefix';
    let shedding = false;
    for (const candidate of keepOrder) {
      const fits = limit == null || admittedTokens + candidate.module.tokenEstimate <= limit;
      if (!shedding && fits) {
        kept.add(candidate.admissionIndex);
        admittedTokens += candidate.module.tokenEstimate;
      } else {
        // Prefix shedding: once one module overflows, shed it AND the rest (monotone).
        if (shedMode === 'prefix') shedding = true;
        refuse('BUDGET_EXCEEDED', {
          message:
            'optional module shed to preserve higher-priority context within the token budget',
          fatal: false,
          detail: 'tokens',
          moduleId: candidate.module.id,
          kind: candidate.module.kind,
        });
      }
    }
    for (const candidate of tentativeOptional) {
      if (kept.has(candidate.admissionIndex)) admitted.push(candidate);
    }
  }

  // 3 (post-admission). Each required kind must be covered by an admitted MANDATORY
  // module — a pin that failed eligibility leaves its kind uncovered here even though
  // the pin existed (mirrors the parents' "required kind missing" after eligibility).
  const admittedMandatoryKinds = new Set(
    admitted.filter((entry) => entry.mandatory).map((entry) => entry.module.kind),
  );
  for (const kind of contract.requiredKinds) {
    if (!admittedMandatoryKinds.has(kind)) {
      refuse('REQUIRED_CONTEXT_MISSING', {
        message: `required kind ${kind} is not covered by an admitted module`,
        fatal: true,
        detail: 'kind',
        kind,
      });
    }
  }

  if (fatal) {
    return { ok: false, manifest: null, refusals };
  }

  // 7. Ordering.
  const ordered = orderEntries(admitted, profile);

  const entries: ManifestEntry[] = ordered.map((entry, order) => ({
    moduleId: entry.module.id,
    version: entry.module.version,
    kind: entry.module.kind,
    memoryClass: entry.module.memoryClass,
    trustClass: entry.module.trustClass,
    privacyClass: entry.module.privacyClass,
    contentHash: entry.module.contentHash,
    order,
    mandatory: entry.mandatory,
    tokenEstimate: entry.module.tokenEstimate,
    slot: entry.slot,
    ...(entry.module.ext !== undefined ? { ext: entry.module.ext } : {}),
  }));

  const tokensAdmitted = entries.reduce((sum, entry) => sum + entry.tokenEstimate, 0);
  const tokenLimit = budget.kind === 'tokens' ? budget.limit(envelope, contract) : null;
  const envelopeHash = profile.hashEnvelope?.(envelope) ?? hashEnvelope(envelope);
  const scaffoldHash = hashContextValue(scaffoldSubject(entries));

  const encoderInput: ManifestEncoderInput = {
    envelopeId: envelope.id,
    stage: envelope.stage,
    entries,
    refused: refusals,
    budgets: {
      tokensAdmitted,
      tokenLimit,
      admitted: entries.length,
      refused: refusals.length,
    },
    envelopeHash,
    scaffoldHash,
  };
  const encoded = profile.manifestEncoder(encoderInput, { envelope, contract });

  const manifest = ManifestSchema.parse({
    ...encoderInput,
    manifestHash: encoded.hash,
  });

  return { ok: true, manifest, refusals };
}

/** A minimal `ManifestEntry`-shaped view for the budget keep-priority (which reads
 * only the memory class / kind). Avoids building a full entry before ordering. */
function toEntryShape(entry: Admitted): ManifestEntry {
  return {
    moduleId: entry.module.id,
    version: entry.module.version,
    kind: entry.module.kind,
    memoryClass: entry.module.memoryClass,
    trustClass: entry.module.trustClass,
    privacyClass: entry.module.privacyClass,
    contentHash: entry.module.contentHash,
    order: entry.admissionIndex,
    mandatory: entry.mandatory,
    tokenEstimate: entry.module.tokenEstimate,
    slot: entry.slot,
  };
}

function orderEntries(
  admitted: readonly Admitted[],
  profile: CompatibilityProfile,
): readonly Admitted[] {
  if (profile.orderRule === 'selection') {
    return [...admitted].sort((left, right) => left.admissionIndex - right.admissionIndex);
  }
  const rank = profile.volatilityRank ?? (() => 0);
  return [...admitted].sort(
    (left, right) =>
      rank(toEntryShape(left)) - rank(toEntryShape(right)) ||
      left.admissionIndex - right.admissionIndex,
  );
}
