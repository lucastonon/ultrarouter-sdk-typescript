// Generated file: vendored context runtime. Do not edit by hand.
/**
 * `compileSop` — reviewed SOP draft → typed immutable `ExecutableSopSpec`.
 *
 * The COMPILER is extracted from an earlier SOP compiler (the review
 * gate that binds to prose BYTES, the dangling/cycle/duplicate/invalid dependency
 * closure, the two-digest output, the `assertSopExecutable` re-hash). What is NEW —
 * and declared as such — is the typed transition language (`./predicates.ts`): the
 * closed predicate set is validated (an unknown predicate is a REFUSAL, never a
 * pass-through) and the transition GRAPH is checked acyclic SEPARATELY from the
 * dependency graph (two independent acyclicity checks). The descriptor input contract
 * is enforced here too, so an over-budget descriptor is a compile refusal.
 *
 * PURE + deterministic: no clock, no env, no IO, no RNG. `reviewedAt` is a caller-
 * supplied instant STRING (validated, never read from a clock). The same draft +
 * review always produce the same `compiledHash`.
 */

import { checkDescriptor, producesOf, type DescriptorSubject } from './descriptor.js';
import { parsePredicate, type SopPredicate } from './predicates.js';
import { sopRefusal, type SopRefusal } from './refusals.js';
import {
  EXECUTABLE_SOP_SPEC_CONTRACT,
  computeCompiledHash,
  computeProvenanceHash,
  type CompiledContent,
  type ExecutableSopPhase,
  type ExecutableSopSpec,
  type SopDependency,
  type SopTransition,
} from './spec.js';

/** One phase as authored, before normalization. */
export interface SopPhaseDraft {
  readonly id: string;
  /** True ⇒ the phase always runs (mandatory-only fallback keeps it). Default false. */
  readonly mandatory?: boolean;
  readonly allowedActionNames: readonly string[];
  readonly requiredPolicyIds: readonly string[];
  readonly budgets: Readonly<Record<string, number>>;
  readonly stopConditions: readonly string[];
  readonly artifactContracts: readonly string[];
}

/** One transition edge as authored. `when` is validated against the closed set. */
export interface SopTransitionDraft {
  readonly from: string;
  readonly to: string;
  readonly when: SopPredicate;
}

/** A SOP as authored: prose digest + the structure extracted from it + the NEW
 * applicability predicate and transition graph. */
export interface SopDraft {
  readonly id: string;
  readonly version: string;
  /** Digest of the natural-language body. Binds the review to the bytes. */
  readonly proseHash: string;
  readonly inputSchemaHash: string;
  readonly outputSchemaHash: string;
  /** When this SOP is admissible (validated against the closed predicate set). */
  readonly applicability: SopPredicate;
  readonly phases: readonly SopPhaseDraft[];
  readonly transitions: readonly SopTransitionDraft[];
  /** The declared dependency set. Every phase requirement must be in it. */
  readonly dependencies: readonly SopDependency[];
}

/** A human review of one exact set of prose bytes. */
export interface SopReview {
  readonly reviewedBy: string;
  /** An RFC-3339 UTC instant STRING; never a `Date`, never a clock read. */
  readonly reviewedAt: string;
  /** The `proseHash` the reviewer actually read. */
  readonly reviewedProseHash: string;
}

export interface CompileSopRequest {
  readonly draft: SopDraft;
  /** Absent or incomplete review ⇒ `SOP_NOT_REVIEWED`. Prose alone never compiles. */
  readonly review: SopReview | null;
}

/** The result of a SOP compile: the spec, or the refusals that prevented it. Every
 * compile refusal is fatal, so a refused compile carries no spec. */
export type CompileSopResult =
  | { readonly ok: true; readonly spec: ExecutableSopSpec }
  | { readonly ok: false; readonly refusals: readonly SopRefusal[] };

const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const RFC3339_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
const HASH_FIELDS = ['proseHash', 'inputSchemaHash', 'outputSchemaHash'] as const;

function isSha256Hex(value: string): boolean {
  return SHA256_PATTERN.test(value);
}

function isRfc3339Instant(value: string): boolean {
  return RFC3339_PATTERN.test(value) && !Number.isNaN(Date.parse(value));
}

function normalizePhase(phase: SopPhaseDraft): ExecutableSopPhase {
  const budgets: Record<string, number> = {};
  for (const key of Object.keys(phase.budgets).sort()) {
    budgets[key] = phase.budgets[key] as number;
  }
  return {
    id: phase.id,
    mandatory: phase.mandatory ?? false,
    allowedActionNames: [...new Set(phase.allowedActionNames)].sort(),
    requiredPolicyIds: [...new Set(phase.requiredPolicyIds)].sort(),
    budgets,
    stopConditions: [...new Set(phase.stopConditions)].sort(),
    artifactContracts: [...new Set(phase.artifactContracts)].sort(),
  };
}

/** Walk the dependency closure, refusing an invalid hash, a duplicate declaration, a
 * dangling pin or a cycle. The cycle check records a node before visiting its pins so
 * a back-edge is not hidden by the memo. */
function validateDependencyClosure(dependencies: readonly SopDependency[]):
  | { readonly ok: true; readonly dependencies: readonly SopDependency[] }
  | {
      readonly ok: false;
      readonly refusals: readonly SopRefusal[];
    } {
  const refusals: SopRefusal[] = [];
  const byId = new Map<string, SopDependency>();
  for (const dependency of dependencies) {
    if (!isSha256Hex(dependency.contentHash)) {
      refusals.push(
        sopRefusal(
          'SOP_DEPENDENCY_INVALID',
          `dependency "${dependency.id}" carries "${dependency.contentHash}", which is not a lower-case hex SHA-256`,
          { path: `dependencies.${dependency.id}.contentHash` },
        ),
      );
      continue;
    }
    if (byId.has(dependency.id)) {
      refusals.push(
        sopRefusal(
          'SOP_DEPENDENCY_DUPLICATE',
          `dependency "${dependency.id}" is declared more than once`,
          { path: `dependencies.${dependency.id}` },
        ),
      );
      continue;
    }
    byId.set(dependency.id, dependency);
  }
  if (refusals.length > 0) return { ok: false, refusals };

  const visited = new Set<string>();
  const visit = (id: string, stack: readonly string[]): SopRefusal | null => {
    if (stack.includes(id)) {
      return sopRefusal(
        'SOP_DEPENDENCY_CYCLE',
        `pin cycle detected: ${[...stack, id].join(' -> ')}`,
      );
    }
    const node = byId.get(id);
    if (node === undefined) {
      return sopRefusal(
        'SOP_DEPENDENCY_MISSING',
        `missing pin: "${id}" resolves to no declared dependency`,
        { path: `dependencies.${id}` },
      );
    }
    if (visited.has(id)) return null;
    visited.add(id);
    for (const child of node.dependsOn) {
      const failure = visit(child, [...stack, id]);
      if (failure !== null) return failure;
    }
    return null;
  };

  for (const id of [...byId.keys()].sort()) {
    const failure = visit(id, []);
    if (failure !== null) return { ok: false, refusals: [failure] };
  }

  const sorted = [...byId.values()]
    .map((dependency) => ({ ...dependency, dependsOn: [...dependency.dependsOn].sort() }))
    .sort((a, b) => a.id.localeCompare(b.id));
  return { ok: true, dependencies: sorted };
}

/**
 * Validate the NEW transition language: every `when` is in the closed predicate set,
 * every `from`/`to` is a declared phase, and the transition GRAPH is acyclic — the
 * SECOND, independent acyclicity check (a spec may be dependency-acyclic yet
 * transition-cyclic, and is refused for the latter). Returns the normalized, sorted
 * transitions or the refusals that blocked them.
 */
function validateTransitions(
  transitions: readonly SopTransitionDraft[],
  phaseIds: ReadonlySet<string>,
):
  | { readonly ok: true; readonly transitions: readonly SopTransition[] }
  | {
      readonly ok: false;
      readonly refusals: readonly SopRefusal[];
    } {
  const refusals: SopRefusal[] = [];
  const parsed: SopTransition[] = [];
  transitions.forEach((transition, index) => {
    const when = parsePredicate(transition.when);
    if (!when.ok) {
      refusals.push(
        sopRefusal(
          'SOP_PREDICATE_UNKNOWN',
          `transition ${transition.from} -> ${transition.to} carries a predicate outside the closed set`,
          { path: `transitions.${String(index)}.when` },
        ),
      );
      return;
    }
    for (const [role, phase] of [
      ['from', transition.from],
      ['to', transition.to],
    ] as const) {
      if (!phaseIds.has(phase)) {
        refusals.push(
          sopRefusal(
            'SOP_TRANSITION_UNKNOWN_PHASE',
            `transition ${role} "${phase}" is not a declared phase`,
            { path: `transitions.${String(index)}.${role}` },
          ),
        );
      }
    }
    parsed.push({ from: transition.from, to: transition.to, when: when.predicate });
  });
  if (refusals.length > 0) return { ok: false, refusals };

  const cycle = findTransitionCycle(parsed);
  if (cycle !== null) {
    return {
      ok: false,
      refusals: [
        sopRefusal('SOP_TRANSITION_CYCLE', `transition cycle detected: ${cycle.join(' -> ')}`),
      ],
    };
  }

  // Stable order for the digest (transition list order is not semantic).
  const sorted = [...parsed].sort(
    (a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to),
  );
  return { ok: true, transitions: sorted };
}

/** DFS the transition graph (phases = nodes, transitions = directed edges). Returns
 * the cycle path (including a self-loop `a -> a`) or null. */
function findTransitionCycle(transitions: readonly SopTransition[]): readonly string[] | null {
  const out = new Map<string, string[]>();
  for (const transition of transitions) {
    const list = out.get(transition.from) ?? [];
    list.push(transition.to);
    out.set(transition.from, list);
  }
  const done = new Set<string>();
  const visit = (node: string, stack: readonly string[]): readonly string[] | null => {
    if (stack.includes(node)) return [...stack.slice(stack.indexOf(node)), node];
    if (done.has(node)) return null;
    const next = [...(out.get(node) ?? [])].sort();
    for (const child of next) {
      const cycle = visit(child, [...stack, node]);
      if (cycle !== null) return cycle;
    }
    done.add(node);
    return null;
  };
  for (const from of [...out.keys()].sort()) {
    const cycle = visit(from, []);
    if (cycle !== null) return cycle;
  }
  return null;
}

/**
 * Compile a reviewed draft into a typed, immutable executable spec. Stages run in a
 * fixed order (review → identity → phases → dependencies → transitions → descriptor);
 * the first stage that refuses returns its refusals with no spec.
 */
export function compileSop(request: CompileSopRequest): CompileSopResult {
  const { draft, review } = request;

  // 1. Review gate — binds to prose bytes, before anything else.
  if (review === null || review.reviewedBy.trim().length === 0) {
    return refuse(
      'SOP_NOT_REVIEWED',
      `SOP "${draft.id}" has no review; unreviewed prose is never executable`,
    );
  }
  if (!isRfc3339Instant(review.reviewedAt)) {
    return refuse(
      'SOP_REVIEW_INSTANT_INVALID',
      `SOP "${draft.id}" was reviewed at "${review.reviewedAt}", which is not a strict RFC-3339 UTC instant`,
      { path: 'review.reviewedAt' },
    );
  }
  if (review.reviewedProseHash !== draft.proseHash) {
    return refuse(
      'SOP_REVIEW_STALE',
      `SOP "${draft.id}" changed after review: the review covers ${review.reviewedProseHash}, the draft is ${draft.proseHash}`,
      { path: 'review.reviewedProseHash' },
    );
  }

  // 2. Identity.
  const identity: SopRefusal[] = [];
  if (draft.id.trim().length === 0 || draft.version.trim().length === 0) {
    identity.push(
      sopRefusal('SOP_IDENTITY_INVALID', 'a compiled SOP must carry a non-empty id and version'),
    );
  }
  for (const field of HASH_FIELDS) {
    if (!isSha256Hex(draft[field])) {
      identity.push(
        sopRefusal(
          'SOP_IDENTITY_INVALID',
          `SOP "${draft.id}" carries a ${field} that is not a lower-case hex SHA-256`,
          { path: field },
        ),
      );
    }
  }
  if (identity.length > 0) return { ok: false, refusals: identity };

  // 3. Phases.
  const phaseRefusals: SopRefusal[] = [];
  if (draft.phases.length === 0) {
    phaseRefusals.push(
      sopRefusal('SOP_PHASE_INVALID', `SOP "${draft.id}" declares no phases`, { path: 'phases' }),
    );
  }
  const phaseIds = new Set<string>();
  for (const phase of draft.phases) {
    if (phase.id.trim().length === 0) {
      phaseRefusals.push(
        sopRefusal('SOP_PHASE_INVALID', `SOP "${draft.id}" declares a phase with an empty id`, {
          path: 'phases',
        }),
      );
      continue;
    }
    if (phaseIds.has(phase.id)) {
      phaseRefusals.push(
        sopRefusal('SOP_PHASE_INVALID', `SOP "${draft.id}" declares phase "${phase.id}" twice`, {
          path: `phases.${phase.id}`,
        }),
      );
      continue;
    }
    phaseIds.add(phase.id);
    for (const [key, value] of Object.entries(phase.budgets)) {
      if (!Number.isFinite(value)) {
        phaseRefusals.push(
          sopRefusal(
            'SOP_PHASE_INVALID',
            `phase "${phase.id}" of SOP "${draft.id}" declares a non-finite budget "${key}"`,
            { path: `phases.${phase.id}.budgets.${key}` },
          ),
        );
      }
    }
  }
  if (phaseRefusals.length > 0) return { ok: false, refusals: phaseRefusals };

  // 4. Dependencies (dangling / cycle / duplicate / invalid) + phase requirements.
  const closure = validateDependencyClosure(draft.dependencies);
  if (!closure.ok) return { ok: false, refusals: closure.refusals };
  const declared = new Set(closure.dependencies.map((dependency) => dependency.id));
  const missing: SopRefusal[] = [];
  for (const phase of draft.phases) {
    for (const policyId of phase.requiredPolicyIds) {
      if (!declared.has(policyId)) {
        missing.push(
          sopRefusal(
            'SOP_DEPENDENCY_MISSING',
            `phase "${phase.id}" requires "${policyId}", which is not in the declared dependency set`,
            { path: `phases.${phase.id}.requiredPolicyIds` },
          ),
        );
      }
    }
  }
  if (missing.length > 0) return { ok: false, refusals: missing };

  // 5. Transition language (closed predicate set + SEPARATE transition-graph acyclicity).
  const applicability = parsePredicate(draft.applicability);
  if (!applicability.ok) {
    return refuse(
      'SOP_PREDICATE_UNKNOWN',
      `SOP "${draft.id}" applicability is outside the closed set`,
      {
        path: 'applicability',
      },
    );
  }
  const transitions = validateTransitions(draft.transitions, phaseIds);
  if (!transitions.ok) return { ok: false, refusals: transitions.refusals };

  // 6. Descriptor input contract — an over-budget descriptor is a compile refusal.
  const phases = draft.phases.map(normalizePhase);
  const subject: DescriptorSubject = {
    id: draft.id,
    phaseIds: phases.map((phase) => phase.id),
    produces: producesOf({ phases }),
    applicability: applicability.predicate,
  };
  const descriptorRefusal = checkDescriptor(subject);
  if (descriptorRefusal !== null) return { ok: false, refusals: [descriptorRefusal] };

  // 7. Normalize, hash, freeze.
  const content: CompiledContent = {
    id: draft.id,
    version: draft.version,
    inputSchemaHash: draft.inputSchemaHash,
    outputSchemaHash: draft.outputSchemaHash,
    proseHash: draft.proseHash,
    applicability: applicability.predicate,
    phases,
    transitions: transitions.transitions,
    dependencies: closure.dependencies,
  };
  const compiledHash = computeCompiledHash(content);
  const spec: ExecutableSopSpec = Object.freeze({
    contract: EXECUTABLE_SOP_SPEC_CONTRACT,
    ...content,
    compiledHash,
    reviewedBy: review.reviewedBy,
    reviewedAt: review.reviewedAt,
    provenanceHash: computeProvenanceHash({
      compiledHash,
      reviewedBy: review.reviewedBy,
      reviewedAt: review.reviewedAt,
    }),
  });
  return { ok: true, spec };
}

function refuse(
  code: SopRefusal['code'],
  message: string,
  extra?: { readonly detail?: string; readonly path?: string },
): CompileSopResult {
  return { ok: false, refusals: [sopRefusal(code, message, extra)] };
}

/**
 * Refuse to treat anything that is not a verified compiled spec as executable. A value
 * that merely LOOKS like a spec (a JSON blob read back from a store) is re-hashed, so
 * a hand-edited stored spec is refused rather than executed (extracted from an earlier SOP compiler
 * `assertSopExecutable`). Pure: recomputes the content + provenance digests.
 */
export function assertSopExecutable(candidate: unknown):
  | { readonly ok: true; readonly spec: ExecutableSopSpec }
  | {
      readonly ok: false;
      readonly refusal: SopRefusal;
    } {
  if (
    candidate === null ||
    typeof candidate !== 'object' ||
    (candidate as { contract?: unknown }).contract !== EXECUTABLE_SOP_SPEC_CONTRACT
  ) {
    return {
      ok: false,
      refusal: sopRefusal(
        'SOP_NOT_EXECUTABLE',
        `the value offered for execution is not a ${EXECUTABLE_SOP_SPEC_CONTRACT} document`,
      ),
    };
  }
  const spec = candidate as ExecutableSopSpec;
  if (typeof spec.reviewedBy !== 'string' || spec.reviewedBy.trim() === '') {
    return {
      ok: false,
      refusal: sopRefusal(
        'SOP_NOT_REVIEWED',
        `compiled SOP "${String(spec.id)}" carries no reviewer; it cannot execute`,
      ),
    };
  }
  if (typeof spec.reviewedAt !== 'string' || !isRfc3339Instant(spec.reviewedAt)) {
    return {
      ok: false,
      refusal: sopRefusal(
        'SOP_REVIEW_INSTANT_INVALID',
        `compiled SOP "${String(spec.id)}" carries a reviewedAt that is not an instant`,
      ),
    };
  }
  const recomputed = computeCompiledHash(spec);
  if (recomputed !== spec.compiledHash) {
    return {
      ok: false,
      refusal: sopRefusal(
        'SOP_COMPILED_HASH_MISMATCH',
        `compiled SOP "${String(spec.id)}" no longer hashes to its recorded compiledHash`,
      ),
    };
  }
  const provenance = computeProvenanceHash({
    compiledHash: spec.compiledHash,
    reviewedBy: spec.reviewedBy,
    reviewedAt: spec.reviewedAt,
  });
  if (provenance !== spec.provenanceHash) {
    return {
      ok: false,
      refusal: sopRefusal(
        'SOP_COMPILED_HASH_MISMATCH',
        `compiled SOP "${String(spec.id)}" carries a review identity that does not match its provenanceHash`,
      ),
    };
  }
  return { ok: true, spec };
}
