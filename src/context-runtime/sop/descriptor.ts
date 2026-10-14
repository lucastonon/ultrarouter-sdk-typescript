// Generated file: vendored context runtime. Do not edit by hand.
/**
 * Lazy descriptor — the compact, ≈60-token summary the model plans against so
 * the FULL SOP body is loaded only at the gated phase boundary
 * ("the catalog is compact; the load is lazy and gated"). A descriptor carries the id,
 * the rendered applicability `when`, the phase names and what the SOP produces — never
 * the body.
 *
 * The budget is an INPUT CONTRACT, not a hope: an over-budget
 * descriptor is the compile REFUSAL `DESCRIPTOR_OVER_BUDGET` — NEVER silently
 * truncated. The overall ≤ 240-char ceiling is exactly ≈ 60 tokens under the
 * chars/4 estimator (reused from the core library, never re-implemented), and each
 * sub-limit is enforced independently with a `detail` naming which one blew.
 */

import { estimateTokensFromChars } from '../_core/token-estimate.js';

import { renderPredicate, type SopPredicate } from './predicates.js';
import { sopRefusal, type SopRefusal } from './refusals.js';
import type { ExecutableSopSpec } from './spec.js';

/** The descriptor input contract. Each limit is enforced independently. */
export const DESCRIPTOR_LIMITS = {
  /** Overall rendered descriptor ceiling: 240 chars ≈ 60 tokens (chars/4). */
  maxChars: 240,
  /** Overall token ceiling (the chars/4 estimate of the rendered descriptor). */
  maxTokens: 60,
  idMaxChars: 64,
  maxPhases: 8,
  phaseIdMaxChars: 32,
  maxProduces: 8,
  produceMaxChars: 32,
  whenMaxChars: 120,
} as const;

/** The subject a descriptor is rendered + budget-checked from. */
export interface DescriptorSubject {
  readonly id: string;
  readonly phaseIds: readonly string[];
  /** What the SOP produces (the union of its phases' artifact contracts). */
  readonly produces: readonly string[];
  readonly applicability: SopPredicate;
}

/** The union of a spec's phases' artifact contracts — what the SOP produces. Deduped,
 * sorted, deterministic. */
export function producesOf(spec: {
  readonly phases: readonly { readonly artifactContracts: readonly string[] }[];
}): readonly string[] {
  const seen = new Set<string>();
  for (const phase of spec.phases) {
    for (const contract of phase.artifactContracts) seen.add(contract);
  }
  return [...seen].sort();
}

/** Build the descriptor subject from a compiled spec. */
export function descriptorSubject(spec: ExecutableSopSpec): DescriptorSubject {
  return {
    id: spec.id,
    phaseIds: spec.phases.map((phase) => phase.id),
    produces: producesOf(spec),
    applicability: spec.applicability,
  };
}

/** Render a descriptor to its compact surface string. Pure + deterministic; performs
 * NO validation (see {@link checkDescriptor} for the input contract). */
export function renderDescriptor(subject: DescriptorSubject): string {
  const when = renderPredicate(subject.applicability);
  return `sop:${subject.id} when=${when} phases=${subject.phaseIds.join(',')} produces=${subject.produces.join(',')}`;
}

/**
 * Enforce the descriptor input contract + budget. Returns the FIRST violated limit as
 * a `DESCRIPTOR_OVER_BUDGET` refusal (with a `detail` naming it), or null when every
 * limit holds. Never truncates. Order is documented + stable.
 */
export function checkDescriptor(subject: DescriptorSubject): SopRefusal | null {
  const L = DESCRIPTOR_LIMITS;
  if (subject.id.length > L.idMaxChars) {
    return sopRefusal(
      'DESCRIPTOR_OVER_BUDGET',
      `descriptor id is ${String(subject.id.length)} chars (> ${String(L.idMaxChars)})`,
      { detail: 'id', path: 'id' },
    );
  }
  if (subject.phaseIds.length > L.maxPhases) {
    return sopRefusal(
      'DESCRIPTOR_OVER_BUDGET',
      `descriptor lists ${String(subject.phaseIds.length)} phases (> ${String(L.maxPhases)})`,
      { detail: 'phase_count', path: 'phases' },
    );
  }
  for (const phaseId of subject.phaseIds) {
    if (phaseId.length > L.phaseIdMaxChars) {
      return sopRefusal(
        'DESCRIPTOR_OVER_BUDGET',
        `phase id "${phaseId}" is ${String(phaseId.length)} chars (> ${String(L.phaseIdMaxChars)})`,
        { detail: 'phase_id', path: 'phases' },
      );
    }
  }
  if (subject.produces.length > L.maxProduces) {
    return sopRefusal(
      'DESCRIPTOR_OVER_BUDGET',
      `descriptor lists ${String(subject.produces.length)} produces (> ${String(L.maxProduces)})`,
      { detail: 'produce_count', path: 'produces' },
    );
  }
  for (const produce of subject.produces) {
    if (produce.length > L.produceMaxChars) {
      return sopRefusal(
        'DESCRIPTOR_OVER_BUDGET',
        `produce "${produce}" is ${String(produce.length)} chars (> ${String(L.produceMaxChars)})`,
        { detail: 'produce', path: 'produces' },
      );
    }
  }
  const when = renderPredicate(subject.applicability);
  if (when.length > L.whenMaxChars) {
    return sopRefusal(
      'DESCRIPTOR_OVER_BUDGET',
      `rendered when is ${String(when.length)} chars (> ${String(L.whenMaxChars)})`,
      { detail: 'when', path: 'applicability' },
    );
  }
  const rendered = renderDescriptor(subject);
  if (rendered.length > L.maxChars || estimateTokensFromChars(rendered.length) > L.maxTokens) {
    return sopRefusal(
      'DESCRIPTOR_OVER_BUDGET',
      `descriptor is ${String(rendered.length)} chars / ~${String(estimateTokensFromChars(rendered.length))} tokens (> ${String(L.maxChars)} chars / ${String(L.maxTokens)} tokens)`,
      { detail: 'descriptor' },
    );
  }
  return null;
}

/** Render the descriptor of an already-compiled spec. `compileSop` enforced the input
 * contract at compile time, so a compiled spec's descriptor always fits. Pure. */
export function describe(spec: ExecutableSopSpec): string {
  return renderDescriptor(descriptorSubject(spec));
}

/** The estimated tokens of a spec's descriptor (chars/4, the ONE estimator). */
export function describeTokenEstimate(spec: ExecutableSopSpec): number {
  return estimateTokensFromChars(describe(spec).length);
}
