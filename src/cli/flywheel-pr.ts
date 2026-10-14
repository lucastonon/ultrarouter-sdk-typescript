/**
 * `ur flywheel-pr` — carry a SCREENED flywheel candidate out of the
 * gateway and into the customer's OWN application CI as a REVIEWABLE change, then bring back bound
 * evidence. It EXTENDS the harness (`cli/{detect,app-harness,gate,pr-comment}.ts`) — there is
 * no second verdict engine, no second evidence contract and no second publication path here.
 *
 * What this module owns, and the rule each piece encodes:
 *
 * - **The candidate is immutable.** {@link parseCandidate} recomputes the body hash and the
 * {@link candidateReference} content address from the candidate's own provenance (module id +
 * version, pack hash, ranker version, k, key spec, source snapshot, epoch). A pack change or a
 * ranker refit therefore produces a DIFFERENT reference — the PR, the patch, the harness config
 * and the dashboard can only ever point at one exact candidate. The reference recipe is pinned to
 * the gateway's by a shared golden ({@link CANDIDATE_REF_PARITY_REFERENCE}).
 * - **Only `screened` may travel.** Screening parks a lever at `screened`; `adopted` is the terminal
 * state of live confirmation and is refused here with its own reason (`adopted_is_not_ci`) rather
 * than waved through as "even better than screened".
 * - **Show the diff and the destination branch BEFORE writing.** {@link renderCandidatePlan} is
 * emitted unconditionally; {@link deliverCandidate} touches the forge ONLY when `apply` is true.
 * - **Never auto-merge.** {@link GitHubWriteClient} has no merge method — not "we don't call it",
 * there is nothing to call. {@link DeliveryResult.merged} is the literal `false`.
 * - **No write permission is a FIRST-CLASS path, not a degraded error.** An ungranted (or
 * unreadable) `contents: write` resolves to a downloadable `.patch` and the IDENTICAL check
 * workflow — same evidence contract, same harness, same comment, same Check Run.
 * - **CI unlocks the rollout button; it never presses it.** The unlock DECISION has exactly one
 * implementation, on the gateway. This CLI
 * assembles the facts ({@link buildRolloutGateRequest}), READS the decision, and fails CLOSED to
 * `authorization_unavailable` when it cannot. {@link parseRolloutGate} rejects a response that
 * claims to have pressed anything.
 * - **Classification keys on the OBSERVED diff**, never the declared lever name: a
 * code-owned change must land on a configured `context_module` surface, and a gateway-owned change
 * may touch ONLY the `candidateRef` key of its own workflow in the harness config.
 *
 * IO is INJECTED throughout, so the whole flow is hermetically contract-testable with no forge, no
 * network and no real repository.
 */

import { signReviewerPayload } from '../reviewer.js';

import { pathMatchesAny, type SurfaceKind, type WorkflowBinding } from './detect.js';
import { canonicalJson, sha256Hex, type EvidenceContract, type Headline } from './gate.js';

// ─────────────────────────────── the immutable candidate ───────────────────────────────

/** The version tag every candidate reference carries (must match the gateway's). */
export const CANDIDATE_REF_VERSION = 'urcand1';
/** The schema tag a candidate export carries (bump on any structural change). */
export const CANDIDATE_SCHEMA = 'ur.flywheel.candidate.v1' as const;

/**
 * The provenance-bearing IDENTITY of a flywheel lever candidate. Mirrors
 * the gateway's candidate identity field for field — ids, versions, hashes and
 * integers only. The module BODY is not part of the identity; its sha256 is.
 */
export interface FlywheelCandidateIdentity {
  readonly workspaceId: string;
  readonly leverKey: string;
  readonly moduleId: string;
  readonly moduleVersion: string;
  readonly packHash: string;
  readonly rankerVersion: string;
  readonly k: number;
  readonly keySpec: string;
  readonly sourceSnapshot: string;
  readonly situationClass: string;
  readonly epoch: number;
  readonly bodyHash: string;
}

/**
 * The content address of a candidate — byte-identical to the gateway's `candidateReference`. Both
 * sides canonicalize the SAME snake_case payload and take the first 32 hex of its sha256; the golden
 * below pins that agreement so a drift on either side turns BOTH suites red rather than leaving the
 * PR and the dashboard quietly pointing at different objects.
 */
export function candidateReference(identity: FlywheelCandidateIdentity): string {
  return `${CANDIDATE_REF_VERSION}_${sha256Hex(
    canonicalJson({
      body_hash: identity.bodyHash,
      epoch: identity.epoch,
      k: identity.k,
      key_spec: identity.keySpec,
      lever_key: identity.leverKey,
      module_id: identity.moduleId,
      module_version: identity.moduleVersion,
      pack_hash: identity.packHash,
      ranker_version: identity.rankerVersion,
      situation_class: identity.situationClass,
      source_snapshot: identity.sourceSnapshot,
      workspace_id: identity.workspaceId,
    }),
  ).slice(0, 32)}`;
}

/** The shared parity fixture: the gateway asserts the same identity hashes to the same reference. */
export const CANDIDATE_REF_PARITY_IDENTITY: FlywheelCandidateIdentity = {
  workspaceId: 'ws_parity',
  leverKey: 'learned_context',
  moduleId: 'lcm_0123456789abcdef01234567',
  moduleVersion: 'lcm1_0123456789abcdef0123456789abcdef',
  packHash: 'lcp1_fedcba9876543210fedcba9876543210',
  rankerVersion: 'lcr1_0011223344556677',
  k: 3,
  keySpec: 'sit1',
  sourceSnapshot: '2026-09-01T00:00:00.000Z',
  situationClass: 'checkout/refund',
  epoch: 7,
  bodyHash: 'a'.repeat(64),
};
/** The golden reference of {@link CANDIDATE_REF_PARITY_IDENTITY} (asserted here and by the gateway). */
export const CANDIDATE_REF_PARITY_REFERENCE = 'urcand1_97f75bd8497dd264d25a7c1e265abf6e';

/** The shared parity fixture for the evidence object (the gateway asserts the same address). */
export const APP_IDENTITY_PARITY_VECTOR: EvidenceContract = {
  repository: 'acme/app',
  baseSha: 'b'.repeat(40),
  headSha: 'h'.repeat(40),
  lockDigest: 'lock-digest',
  harnessHash: 'harness-hash',
  configHash: 'config-hash',
  datasetSplit: 'holdout-a',
  workflowId: 'wf_checkout',
  objective: 'checkout-accuracy',
  evaluatorVersion: 'eval.v3',
  evidenceEpoch: 'epoch-2026-09',
  candidateRef: 'urcand1_0123456789abcdef0123456789abcdef',
};
/** The golden address of {@link APP_IDENTITY_PARITY_VECTOR} (asserted here and by the gateway). */
export const APP_IDENTITY_PARITY_HASH =
  '06eecba8bdf3cd608b1f3066dd9ed176357c1507dcb4de9b7e3c987cf1270200';

/** A candidate as exported by the gateway and consumed here (identity + state + the module body). */
export interface FlywheelCandidate extends FlywheelCandidateIdentity {
  /** The lifecycle state. ONLY `screened` may be carried into application CI. */
  readonly state: string;
  /** The workflow this candidate is bound to (must exist in the app-ci config). */
  readonly workflowId: string;
  /** The rendered module body — derived statistics only; never raw cases (the gateway guarantees it). */
  readonly body: string;
  /** The immutable reference, recomputed here from the identity (never trusted from the file). */
  readonly candidateRef: string;
  /** An optional link template to the signed evidence object; `{hash}` is substituted. */
  readonly evidenceUrlTemplate?: string;
}

/** Why a candidate file was refused. Every value is NAMED — there is no generic "invalid". */
export type CandidateRefusal =
  | 'invalid_candidate_json'
  | 'missing_field'
  | 'candidate_not_screened'
  | 'adopted_is_not_ci'
  | 'unknown_lever_state'
  | 'candidate_body_hash_mismatch'
  | 'empty_candidate_body';

/** Thrown by {@link parseCandidate}. The reason is machine-readable; the message names the field. */
export class CandidateRefusedError extends Error {
  readonly reason: CandidateRefusal;
  constructor(reason: CandidateRefusal, detail: string) {
    super(`${reason}: ${detail}`);
    this.name = 'CandidateRefusedError';
    this.reason = reason;
  }
}

/** The lifecycle states a candidate may legitimately be in (`adopted` is NOT one of them). */
const SCREENED_STATE = 'screened';
const KNOWN_LEVER_STATES: readonly string[] = ['screening', SCREENED_STATE, 'rejected', 'parked'];

/**
 * Parse + VALIDATE a candidate export, FAILING CLOSED on every path. The reference is RECOMPUTED
 * from the identity rather than read from the file, and the body hash is RECOMPUTED from the body —
 * so a candidate file edited in transit cannot smuggle a different payload under a trusted address.
 */
export function parseCandidate(raw: string): FlywheelCandidate {
  let obj: unknown;
  try {
    obj = JSON.parse(raw);
  } catch (e) {
    throw new CandidateRefusedError(
      'invalid_candidate_json',
      e instanceof Error ? e.message : String(e),
    );
  }
  if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) {
    throw new CandidateRefusedError(
      'invalid_candidate_json',
      'the candidate must be a JSON object',
    );
  }
  const o = obj as Record<string, unknown>;
  const str = (key: string): string => {
    const v = o[key];
    if (typeof v !== 'string' || v.trim() === '') {
      throw new CandidateRefusedError('missing_field', `'${key}' must be a non-empty string`);
    }
    return v;
  };
  const int = (key: string): number => {
    const v = o[key];
    if (typeof v !== 'number' || !Number.isInteger(v)) {
      throw new CandidateRefusedError('missing_field', `'${key}' must be an integer`);
    }
    return v;
  };

  const state = str('state');
  if (state === 'adopted') {
    throw new CandidateRefusedError(
      'adopted_is_not_ci',
      'an adopted candidate has nothing left to validate in CI — adoption is decided by live confirmation, not CI',
    );
  }
  if (!KNOWN_LEVER_STATES.includes(state)) {
    throw new CandidateRefusedError('unknown_lever_state', state);
  }
  if (state !== SCREENED_STATE) {
    throw new CandidateRefusedError('candidate_not_screened', state);
  }

  const body = typeof o.body === 'string' ? o.body : '';
  if (body.trim() === '') {
    throw new CandidateRefusedError('empty_candidate_body', 'the module body is empty');
  }
  const bodyHash = str('bodyHash');
  const recomputed = sha256Hex(body);
  if (recomputed !== bodyHash) {
    throw new CandidateRefusedError(
      'candidate_body_hash_mismatch',
      `declared ${bodyHash.slice(0, 16)}…, recomputed ${recomputed.slice(0, 16)}…`,
    );
  }

  const identity: FlywheelCandidateIdentity = {
    workspaceId: str('workspaceId'),
    leverKey: str('leverKey'),
    moduleId: str('moduleId'),
    moduleVersion: str('moduleVersion'),
    packHash: str('packHash'),
    rankerVersion: str('rankerVersion'),
    k: int('k'),
    keySpec: str('keySpec'),
    sourceSnapshot: str('sourceSnapshot'),
    situationClass: str('situationClass'),
    epoch: int('epoch'),
    bodyHash,
  };
  return {
    ...identity,
    state,
    workflowId: str('workflowId'),
    body,
    candidateRef: candidateReference(identity),
    ...(typeof o.evidenceUrlTemplate === 'string'
      ? { evidenceUrlTemplate: o.evidenceUrlTemplate }
      : {}),
  };
}

// ─────────────────────────────── unified diff (git-apply-able) ───────────────────────────────

/** One proposed file change. `before === null` ⇒ a new file. */
export interface FileChange {
  readonly path: string;
  readonly before: string | null;
  readonly after: string;
}

/** Split content into lines + whether it ended with a newline (drives the `\ No newline` marker). */
function splitLines(content: string): { lines: string[]; eofNewline: boolean } {
  if (content === '') return { lines: [], eofNewline: true };
  if (content.endsWith('\n')) return { lines: content.slice(0, -1).split('\n'), eofNewline: true };
  return { lines: content.split('\n'), eofNewline: false };
}

const DIFF_CONTEXT = 3;
const NO_NEWLINE = '\\ No newline at end of file';

/**
 * Render ONE file's change as a unified diff with a single hunk (common prefix/suffix trimmed to
 * {@link DIFF_CONTEXT} lines of context). Emits the `\ No newline at end of file` marker when a side
 * does not end with a newline, so the output is a real patch `git apply` accepts — the contract
 * battery proves that with `git apply --check`, not by inspection. Deterministic; PURE.
 */
export function unifiedDiffForFile(change: FileChange): string {
  const before = splitLines(change.before ?? '');
  const after = splitLines(change.after);
  if (change.before !== null && change.before === change.after) return '';

  const min = Math.min(before.lines.length, after.lines.length);
  let prefix = 0;
  while (prefix < min && before.lines[prefix] === after.lines[prefix]) prefix += 1;
  let suffix = 0;
  while (
    suffix < min - prefix &&
    before.lines[before.lines.length - 1 - suffix] === after.lines[after.lines.length - 1 - suffix]
  ) {
    suffix += 1;
  }
  // When the two sides disagree about the FINAL newline, the last line is not shareable context —
  // it has to appear as a `-`/`+` pair carrying the `\ No newline` marker, or `git apply` rejects
  // the hunk. Dropping the common suffix is what makes that representable.
  if (before.eofNewline !== after.eofNewline) {
    suffix = 0;
    if (prefix === before.lines.length && prefix === after.lines.length && prefix > 0) prefix -= 1;
  }

  const removed = before.lines.slice(prefix, before.lines.length - suffix);
  const added = after.lines.slice(prefix, after.lines.length - suffix);
  const leadCount = Math.min(DIFF_CONTEXT, prefix);
  const trailCount = Math.min(DIFF_CONTEXT, suffix);
  const lead = before.lines.slice(prefix - leadCount, prefix);
  const trail = before.lines.slice(
    before.lines.length - suffix,
    before.lines.length - suffix + trailCount,
  );

  const oldStart = before.lines.length === 0 ? 0 : prefix - leadCount + 1;
  const oldCount = leadCount + removed.length + trailCount;
  const newStart = after.lines.length === 0 ? 0 : prefix - leadCount + 1;
  const newCount = leadCount + added.length + trailCount;

  const out: string[] = [`diff --git a/${change.path} b/${change.path}`];
  if (change.before === null) out.push('new file mode 100644');
  out.push(change.before === null ? '--- /dev/null' : `--- a/${change.path}`);
  out.push(`+++ b/${change.path}`);
  out.push(
    `@@ -${String(oldStart)},${String(oldCount)} +${String(newStart)},${String(newCount)} @@`,
  );
  for (const l of lead) out.push(` ${l}`);
  for (const [i, l] of removed.entries()) {
    out.push(`-${l}`);
    // The removed run reaches EOF exactly when there is no trailing context AND no common suffix.
    if (i === removed.length - 1 && trailCount === 0 && suffix === 0 && !before.eofNewline) {
      out.push(NO_NEWLINE);
    }
  }
  for (const [i, l] of added.entries()) {
    out.push(`+${l}`);
    if (i === added.length - 1 && trailCount === 0 && suffix === 0 && !after.eofNewline) {
      out.push(NO_NEWLINE);
    }
  }
  for (const [i, l] of trail.entries()) {
    out.push(` ${l}`);
    if (
      i === trail.length - 1 &&
      trailCount === suffix &&
      !before.eofNewline &&
      before.eofNewline === after.eofNewline
    ) {
      out.push(NO_NEWLINE);
    }
  }
  return `${out.join('\n')}\n`;
}

/** Render a whole change set as one patch. PURE + deterministic (input order preserved). */
export function unifiedDiff(changes: readonly FileChange[]): string {
  return changes.map(unifiedDiffForFile).join('');
}

// ─────────────────────────────── observed-diff classification ───────────────────────────────

/**
 * The application SURFACE kinds each flywheel lever family may change (`learned_context` ⇒ the
 * `context_module` application surface, and so on). Classification keys on what the diff OBSERVABLY touches; a
 * candidate that claims `learned_context` but edits a prompt file is `out_of_surface`, refused.
 */
export const LEVER_SURFACE_KINDS: Readonly<Record<string, readonly SurfaceKind[]>> = {
  learned_context: ['context_module'],
  prompt_optimization: ['prompt'],
  candidate_ranking: ['retrieval_config'],
  custom_model: ['model'],
};

/** The classification verdict of a proposed candidate change. Only `in_surface` may be delivered. */
export type SurfaceClassification =
  | {
      readonly kind: 'in_surface';
      readonly lever: string;
      readonly surfaces: readonly SurfaceKind[];
    }
  | { readonly kind: 'unknown_lever'; readonly lever: string }
  | {
      readonly kind: 'out_of_surface';
      readonly lever: string;
      readonly offending: readonly string[];
    }
  | {
      readonly kind: 'bundled';
      readonly lever: string;
      readonly surfaces: readonly SurfaceKind[];
    };

/** The ONLY harness-config key a gateway-owned candidate change may touch. */
export const CANDIDATE_CONFIG_KEY = 'candidateRef';

/**
 * Classify a proposed candidate change by what it OBSERVABLY touches (never the declared
 * name).
 *
 * - `code_owned` — every changed repository path must match one of the WORKFLOW's configured
 * surface globs, and every matched surface KIND must be in the lever's allowed set. A path that
 * matches nothing, or a kind outside the lever's surface, is `out_of_surface`; a diff spanning
 * more than one allowed kind is `bundled` (a bundled change cannot be attributed to one lever).
 * - `gateway_owned` — the harness config's OBSERVED key diff must be exactly the candidate's own
 * `workflows[<id>].candidateRef`. Any other changed key is `out_of_surface`, so a "just add the
 * reference" commit cannot quietly also swap the test command or the dataset split.
 */
export function classifyCandidateDiff(input: {
  readonly leverKey: string;
  readonly shape: ChangeShape;
  readonly workflow: WorkflowBinding;
  readonly changedPaths: readonly string[];
  readonly changedConfigKeys?: readonly string[];
}): SurfaceClassification {
  const allowed = LEVER_SURFACE_KINDS[input.leverKey];
  if (allowed === undefined) return { kind: 'unknown_lever', lever: input.leverKey };

  if (input.shape === 'gateway_owned') {
    const expected = `workflows[${input.workflow.id}].${CANDIDATE_CONFIG_KEY}`;
    const keys = input.changedConfigKeys ?? [];
    const offending = keys.filter((k) => k !== expected);
    if (keys.length === 0 || offending.length > 0) {
      return {
        kind: 'out_of_surface',
        lever: input.leverKey,
        offending: keys.length === 0 ? ['no_observed_change'] : offending,
      };
    }
    return { kind: 'in_surface', lever: input.leverKey, surfaces: allowed };
  }

  const matched = new Set<SurfaceKind>();
  const offending: string[] = [];
  for (const path of input.changedPaths) {
    let hit: SurfaceKind | undefined;
    for (const surface of input.workflow.surfaces) {
      if (pathMatchesAny(path, surface.paths)) {
        hit = surface.kind;
        break;
      }
    }
    if (hit === undefined || !allowed.includes(hit)) offending.push(path);
    else matched.add(hit);
  }
  if (offending.length > 0) return { kind: 'out_of_surface', lever: input.leverKey, offending };
  const surfaces = [...matched];
  if (surfaces.length > 1) return { kind: 'bundled', lever: input.leverKey, surfaces };
  return { kind: 'in_surface', lever: input.leverKey, surfaces };
}

// ─────────────────────────────── the change plan ───────────────────────────────

/** The two change shapes names. */
export type ChangeShape = 'code_owned' | 'gateway_owned';

/** The plan: exactly what would be written, where, and the payload it refers to. */
export interface CandidatePlan {
  readonly schema: 'ur.flywheel.plan.v1';
  readonly candidateRef: string;
  readonly shape: ChangeShape;
  readonly baseBranch: string;
  readonly destinationBranch: string;
  readonly files: readonly FileChange[];
  readonly diff: string;
  /** Gateway-owned ONLY: the LINKED payload diff (the module body that reference resolves to). */
  readonly payloadDiff: string | null;
  readonly payloadHash: string | null;
  readonly classification: SurfaceClassification;
  readonly changedPaths: readonly string[];
}

/** Thrown when a plan cannot be built (an empty diff, a bad config, an out-of-surface change). */
export class PlanRefusedError extends Error {
  readonly reason: 'no_change' | 'invalid_config' | 'workflow_not_found' | 'missing_module_path';
  constructor(
    reason: 'no_change' | 'invalid_config' | 'workflow_not_found' | 'missing_module_path',
    detail: string,
  ) {
    super(`${reason}: ${detail}`);
    this.name = 'PlanRefusedError';
    this.reason = reason;
  }
}

/** Inputs to {@link planCandidateChange}. Contents are read by the caller (this module does no IO). */
export interface PlanCandidateInput {
  readonly candidate: FlywheelCandidate;
  readonly shape: ChangeShape;
  readonly workflow: WorkflowBinding;
  readonly baseBranch: string;
  /** Override the deterministic branch name (default `ultrarouter/candidate/<ref>`). */
  readonly branch?: string;
  /** The app-ci config path + its CURRENT contents (both shapes read it; only gateway-owned edits it). */
  readonly configPath: string;
  readonly configBefore: string;
  /** code_owned: the repository path the module body is written to, + its current contents. */
  readonly modulePath?: string;
  readonly moduleBefore?: string | null;
}

/**
 * Give `content` the same final-newline convention as `like` (a POSIX file normally ends with one;
 * a file that does not must not silently gain one just because we edited it).
 */
function matchEofNewline(content: string, like: string): string {
  const body = content.endsWith('\n') ? content.slice(0, -1) : content;
  return like.endsWith('\n') || like === '' ? `${body}\n` : body;
}

/** The deterministic destination branch for a candidate (no RNG, no clock — re-runs are idempotent). */
export function candidateBranchName(candidateRef: string): string {
  return `ultrarouter/candidate/${candidateRef}`;
}

/** The header the code-owned module file carries so the file itself names its immutable source. */
export function codeOwnedModuleHeader(candidate: FlywheelCandidate): string {
  return [
    `<!-- ultrarouter learned-context candidate ${candidate.candidateRef} -->`,
    `<!-- lever ${candidate.leverKey} · module ${candidate.moduleId}@${candidate.moduleVersion} -->`,
    `<!-- pack ${candidate.packHash} · ranker ${candidate.rankerVersion} · epoch ${String(candidate.epoch)} -->`,
    '<!-- Generated from this workspace’s own recorded outcomes. Reviewed by a human before merge; -->',
    '<!-- merging it is NOT measured improvement (live confirmation is a separate stage). -->',
  ].join('\n');
}

/** Flat key-path diff of two parsed JSON configs (the OBSERVED config change). */
export function changedConfigKeys(before: unknown, after: unknown): readonly string[] {
  const flatten = (value: unknown, prefix: string, out: Map<string, string>): void => {
    if (value === null || typeof value !== 'object') {
      out.set(prefix, JSON.stringify(value) ?? 'null');
      return;
    }
    if (Array.isArray(value)) {
      for (const [i, v] of value.entries()) {
        // Index workflow arrays by their stable `id` so a reorder is not read as a change.
        const item = v as { id?: unknown };
        const key =
          typeof item === 'object' && item !== null && typeof item.id === 'string'
            ? item.id
            : String(i);
        flatten(v, `${prefix}[${key}]`, out);
      }
      return;
    }
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      flatten(v, prefix === '' ? k : `${prefix}.${k}`, out);
    }
  };
  const a = new Map<string, string>();
  const b = new Map<string, string>();
  flatten(before, '', a);
  flatten(after, '', b);
  const keys = new Set([...a.keys(), ...b.keys()]);
  return [...keys].filter((k) => a.get(k) !== b.get(k)).sort();
}

/**
 * Build the change plan for a candidate. NOTHING is written here — the plan is the artefact the
 * caller RENDERS before asking for a write ("Show the diff and destination branch before
 * writing"). The plan is refused unless the OBSERVED diff classifies in-surface for the candidate's
 * lever family, so an out-of-surface "learned context" change can never reach a repository.
 */
export function planCandidateChange(input: PlanCandidateInput): CandidatePlan {
  let configBefore: unknown;
  try {
    configBefore = JSON.parse(input.configBefore);
  } catch (e) {
    throw new PlanRefusedError('invalid_config', e instanceof Error ? e.message : String(e));
  }
  if (typeof configBefore !== 'object' || configBefore === null) {
    throw new PlanRefusedError('invalid_config', 'the app-ci config must be a JSON object');
  }
  const workflows = (configBefore as { workflows?: unknown }).workflows;
  if (!Array.isArray(workflows)) {
    throw new PlanRefusedError('invalid_config', '`workflows` must be an array');
  }
  const index = workflows.findIndex(
    (w) => typeof w === 'object' && w !== null && (w as { id?: unknown }).id === input.workflow.id,
  );
  if (index < 0) throw new PlanRefusedError('workflow_not_found', input.workflow.id);

  const destinationBranch = input.branch ?? candidateBranchName(input.candidate.candidateRef);
  const files: FileChange[] = [];
  let payloadDiff: string | null = null;
  let payloadHash: string | null = null;
  let observedConfigKeys: readonly string[] = [];

  if (input.shape === 'gateway_owned') {
    // The reference — and ONLY the reference — is written into the harness configuration.
    const next = JSON.parse(input.configBefore) as { workflows: Record<string, unknown>[] };
    const target = next.workflows[index];
    if (target !== undefined) target[CANDIDATE_CONFIG_KEY] = input.candidate.candidateRef;
    // Preserve the file's own final-newline convention: adding a reference must not also rewrite
    // the last byte of a file the customer maintains.
    const after = matchEofNewline(JSON.stringify(next, null, 2), input.configBefore);
    files.push({ path: input.configPath, before: input.configBefore, after });
    observedConfigKeys = changedConfigKeys(configBefore, next);
    // The LINKED payload diff: what that reference resolves to, shown but NEVER written to the repo.
    payloadDiff = unifiedDiffForFile({
      path: `(gateway payload) ${input.candidate.moduleId}@${input.candidate.moduleVersion}`,
      before: null,
      after: `${input.candidate.body}\n`,
    });
    payloadHash = input.candidate.bodyHash;
  } else {
    const modulePath = input.modulePath;
    if (modulePath === undefined || modulePath.trim() === '') {
      throw new PlanRefusedError(
        'missing_module_path',
        'a code-owned change needs the repository path the module is written to',
      );
    }
    const after = matchEofNewline(
      `${codeOwnedModuleHeader(input.candidate)}\n\n${input.candidate.body}`,
      input.moduleBefore ?? '\n',
    );
    files.push({ path: modulePath, before: input.moduleBefore ?? null, after });
  }

  const diff = unifiedDiff(files);
  if (diff === '') throw new PlanRefusedError('no_change', 'the candidate proposes no change');
  const changedPaths = files.map((f) => f.path);

  return {
    schema: 'ur.flywheel.plan.v1',
    candidateRef: input.candidate.candidateRef,
    shape: input.shape,
    baseBranch: input.baseBranch,
    destinationBranch,
    files,
    diff,
    payloadDiff,
    payloadHash,
    classification: classifyCandidateDiff({
      leverKey: input.candidate.leverKey,
      shape: input.shape,
      workflow: input.workflow,
      changedPaths,
      changedConfigKeys: observedConfigKeys,
    }),
    changedPaths,
  };
}

/**
 * The human-readable PREVIEW. Emitted BEFORE any write, on every run — including a plan-only run —
 * so "show the diff and destination branch before writing" holds even when the write is refused.
 */
export function renderCandidatePlan(
  plan: CandidatePlan,
  candidate: FlywheelCandidate,
  delivery: { readonly mode: DeliveryMode; readonly reason: string; readonly apply: boolean },
): string {
  const L: string[] = [];
  L.push(`ultrarouter flywheel-pr — candidate ${plan.candidateRef}`);
  L.push(
    `  lever ${candidate.leverKey} · module ${candidate.moduleId}@${candidate.moduleVersion} · ` +
      `pack ${candidate.packHash} · epoch ${String(candidate.epoch)} · state ${candidate.state}`,
  );
  L.push(`  shape ${plan.shape} · classification ${plan.classification.kind}`);
  L.push(`  destination branch: ${plan.destinationBranch}  (from ${plan.baseBranch})`);
  L.push(
    `  delivery: ${delivery.mode} (${delivery.reason})${delivery.apply ? '' : ' — PLAN ONLY, nothing written'}`,
  );
  L.push('');
  L.push('--- proposed diff ---');
  L.push(plan.diff.trimEnd());
  if (plan.payloadDiff !== null) {
    L.push('');
    L.push(
      `--- linked payload (gateway-owned, NOT written to the repository; sha256 ${String(plan.payloadHash)}) ---`,
    );
    L.push(plan.payloadDiff.trimEnd());
  }
  L.push('');
  L.push('This change is never auto-merged, and a merged PR is not measured improvement.');
  return L.join('\n');
}

// ─────────────────────────────── delivery (PR / attach / patch) ───────────────────────────────

/** How the change reaches the customer. `patch` is a first-class path, not a degraded error. */
export type DeliveryMode = 'attach' | 'open_pr' | 'patch';

/** The scoped repository-write grant, as PROBED. `unknown` fails closed to the patch path. */
export type RepositoryWrite = 'granted' | 'denied' | 'unknown';

/** Why a delivery mode was chosen (rendered in the preview and in the PR comment). */
export type DeliveryReason =
  'repo_write_granted' | 'no_repo_write_permission' | 'repo_write_unknown' | 'patch_requested';

/** The resolution of the requested mode against the probed permission. */
export type DeliveryResolution =
  | {
      readonly ok: true;
      readonly mode: DeliveryMode;
      readonly reason: DeliveryReason;
      readonly repositoryWrite: RepositoryWrite;
    }
  | { readonly ok: false; readonly reason: 'attach_requires_pr' };

/**
 * Resolve the delivery mode. The permission decides FIRST and fails CLOSED: anything other than a
 * confirmed `granted` resolves to `patch`, so an unreadable probe can never be mistaken for consent
 * to write. With the grant in hand, `auto` attaches to an existing PR when there is one and opens a
 * new one otherwise. PURE.
 */
export function resolveDeliveryMode(input: {
  readonly requested: DeliveryMode | 'auto';
  readonly repositoryWrite: RepositoryWrite;
  readonly prNumber: number | null;
}): DeliveryResolution {
  if (input.requested === 'patch') {
    return {
      ok: true,
      mode: 'patch',
      reason: 'patch_requested',
      repositoryWrite: input.repositoryWrite,
    };
  }
  if (input.repositoryWrite !== 'granted') {
    return {
      ok: true,
      mode: 'patch',
      reason:
        input.repositoryWrite === 'denied' ? 'no_repo_write_permission' : 'repo_write_unknown',
      repositoryWrite: input.repositoryWrite,
    };
  }
  if (input.requested === 'attach') {
    if (input.prNumber === null) return { ok: false, reason: 'attach_requires_pr' };
    return { ok: true, mode: 'attach', reason: 'repo_write_granted', repositoryWrite: 'granted' };
  }
  if (input.requested === 'open_pr') {
    return { ok: true, mode: 'open_pr', reason: 'repo_write_granted', repositoryWrite: 'granted' };
  }
  return {
    ok: true,
    mode: input.prNumber === null ? 'open_pr' : 'attach',
    reason: 'repo_write_granted',
    repositoryWrite: 'granted',
  };
}

/**
 * The repository-WRITE seam. It deliberately has **no merge method**: "never auto-merge" is not a
 * discipline we keep, it is a capability this CLI does not possess. Adding one would be a visible,
 * reviewable change to this interface — and `contract-tests/flywheel-ci` asserts both that no such
 * member exists and that no merge request reaches the forge.
 */
export interface GitHubWriteClient {
  /** Probe the scoped write grant. `unknown` on any unreadable answer — never optimistic. */
  repositoryWrite(repo: string): Promise<RepositoryWrite>;
  /** Resolve a ref to a commit sha (`null` when absent). */
  getRefSha(repo: string, ref: string): Promise<string | null>;
  /** The blob sha of a file on a ref (`null` when the file does not exist there). */
  getFileSha(repo: string, path: string, ref: string): Promise<string | null>;
  /** Create a branch ref at `sha`. Idempotent: an existing ref is not an error. */
  createBranch(repo: string, branch: string, sha: string): Promise<void>;
  /** Create/update one file on a branch (one commit per file). */
  putFile(
    repo: string,
    input: {
      readonly path: string;
      readonly branch: string;
      readonly message: string;
      readonly contentBase64: string;
      readonly sha: string | null;
    },
  ): Promise<void>;
  /** Open a pull request. Draft by default — a human opens it for review, nothing merges it. */
  createPullRequest(
    repo: string,
    input: {
      readonly title: string;
      readonly head: string;
      readonly base: string;
      readonly body: string;
    },
  ): Promise<{ readonly number: number; readonly url: string }>;
  /**
   * An OPEN pull request already targeting `branch`, if there is one. Re-running the candidate
   * check on a new head must refresh the existing PR, never open a second one for the same
   * candidate — the destination branch is deterministic, so this makes the whole delivery
   * idempotent the way the comment and Check Run already are.
   */
  findOpenPullRequest(
    repo: string,
    branch: string,
  ): Promise<{ readonly number: number; readonly url: string } | null>;
  /** The head ref of an existing PR (for `attach`). */
  pullRequestHeadRef(repo: string, prNumber: number): Promise<string | null>;
}

/** Injected IO for {@link deliverCandidate}. */
export interface DeliveryDeps {
  /** `null` ⇒ no forge access at all ⇒ the patch path (still a full check workflow). */
  readonly forge: GitHubWriteClient | null;
  /** Persist the downloadable patch; resolves the path it was written to. */
  readonly writePatch: (fileName: string, contents: string) => Promise<string>;
  readonly toBase64: (utf8: string) => string;
  readonly log: (line: string) => void;
  readonly err: (line: string) => void;
}

/** What delivery actually did. `merged` is the literal `false` — there is no branch that merges. */
export interface DeliveryResult {
  readonly mode: DeliveryMode;
  readonly applied: boolean;
  readonly destinationBranch: string | null;
  readonly pullRequest: { readonly number: number; readonly url: string } | null;
  readonly patchPath: string | null;
  readonly merged: false;
  readonly reason: string;
}

/** The patch file name for a candidate (deterministic; safe for every filesystem). */
export function patchFileName(candidateRef: string): string {
  return `ultrarouter-candidate-${candidateRef.replace(/[^A-Za-z0-9._-]/g, '_')}.patch`;
}

/**
 * Deliver the planned change. `apply:false` NEVER touches the forge or the filesystem — the plan has
 * already been rendered, and the run stops there. With `apply:true`:
 *
 * - `open_pr` — create the destination branch at the base sha, commit each file, open a PR;
 * - `attach` — commit each file onto the EXISTING PR's head branch (no new PR, no merge);
 * - `patch` — write the `.patch` next to the run and report its path; nothing is pushed.
 *
 * Every path returns `merged: false`. An out-of-surface classification is refused BEFORE any write.
 */
export async function deliverCandidate(
  deps: DeliveryDeps,
  input: {
    readonly repo: string;
    readonly plan: CandidatePlan;
    readonly apply: boolean;
    readonly mode: DeliveryMode;
    readonly reason: string;
    readonly prNumber: number | null;
    readonly title: string;
    readonly body: string;
    readonly baseSha: string | null;
  },
): Promise<DeliveryResult> {
  const stop = (reason: string): DeliveryResult => ({
    mode: input.mode,
    applied: false,
    destinationBranch: null,
    pullRequest: null,
    patchPath: null,
    merged: false,
    reason,
  });

  if (input.plan.classification.kind !== 'in_surface') {
    deps.err(
      `ur flywheel-pr: refusing to write — the observed diff is ${input.plan.classification.kind} for lever '${input.plan.classification.lever}'.`,
    );
    return stop(`classification_${input.plan.classification.kind}`);
  }
  if (!input.apply) return stop('plan_only');

  if (input.mode === 'patch') {
    const path = await deps.writePatch(patchFileName(input.plan.candidateRef), input.plan.diff);
    deps.log(`ur flywheel-pr: wrote the downloadable patch to ${path} (apply with \`git apply\`).`);
    return {
      mode: 'patch',
      applied: true,
      destinationBranch: null,
      pullRequest: null,
      patchPath: path,
      merged: false,
      reason: input.reason,
    };
  }

  const forge = deps.forge;
  if (forge === null) {
    deps.err('ur flywheel-pr: no forge client — falling back to the downloadable patch.');
    const path = await deps.writePatch(patchFileName(input.plan.candidateRef), input.plan.diff);
    return {
      mode: 'patch',
      applied: true,
      destinationBranch: null,
      pullRequest: null,
      patchPath: path,
      merged: false,
      reason: 'forge_unavailable',
    };
  }

  let branch: string;
  if (input.mode === 'attach') {
    const head =
      input.prNumber === null ? null : await forge.pullRequestHeadRef(input.repo, input.prNumber);
    if (head === null) return stop('attach_requires_pr');
    branch = head;
  } else {
    branch = input.plan.destinationBranch;
    const baseSha = input.baseSha ?? (await forge.getRefSha(input.repo, input.plan.baseBranch));
    if (baseSha === null) return stop('base_branch_unresolved');
    await forge.createBranch(input.repo, branch, baseSha);
  }

  for (const file of input.plan.files) {
    const sha = await forge.getFileSha(input.repo, file.path, branch);
    await forge.putFile(input.repo, {
      path: file.path,
      branch,
      message: `chore(ultrarouter): bind learned-context candidate ${input.plan.candidateRef}`,
      contentBase64: deps.toBase64(file.after),
      sha,
    });
  }

  if (input.mode === 'attach') {
    deps.log(
      `ur flywheel-pr: attached the candidate to PR #${String(input.prNumber)} on ${branch}.`,
    );
    return {
      mode: 'attach',
      applied: true,
      destinationBranch: branch,
      pullRequest: input.prNumber === null ? null : { number: input.prNumber, url: '' },
      patchPath: null,
      merged: false,
      reason: input.reason,
    };
  }

  const existing = await forge.findOpenPullRequest(input.repo, branch);
  const pr =
    existing ??
    (await forge.createPullRequest(input.repo, {
      title: input.title,
      head: branch,
      base: input.plan.baseBranch,
      body: input.body,
    }));
  deps.log(
    existing === null
      ? `ur flywheel-pr: opened PR #${String(pr.number)} (${pr.url}) — review and merge it yourself.`
      : `ur flywheel-pr: refreshed the existing PR #${String(pr.number)} (${pr.url}) — no second PR opened.`,
  );
  return {
    mode: 'open_pr',
    applied: true,
    destinationBranch: branch,
    pullRequest: pr,
    patchPath: null,
    merged: false,
    reason: input.reason,
  };
}

// ─────────────────────────────── the rollout gate (read, never computed here) ───────────────────────────────

/** The request this CLI sends so the server can decide the unlock (the gate is decided server-side only). */
export interface RolloutGateRequest {
  readonly schema: 'ur.flywheel.rollout.request.v1';
  readonly candidate_ref: string;
  readonly candidate_state: string;
  /** The bound inputs as OBSERVED in this CI run — the only half the server cannot see. */
  readonly observed_identity: EvidenceContract;
  readonly application_headline: Headline | null;
  readonly requires_repository_write: boolean;
  readonly change_shape: ChangeShape;
}

/** One named refusal as returned by the server. The vocabulary is the gateway's, not ours. */
export interface RolloutBlocker {
  readonly reason: string;
  readonly family: string;
  readonly message: string;
  readonly detail?: string;
}

/** The server's unlock decision. `pressed` is the literal `false` — CI never starts a rollout. */
export interface RolloutGate {
  readonly unlocked: boolean;
  readonly pressed: false;
  readonly blockers: readonly RolloutBlocker[];
  readonly evidence_hash: string;
  readonly candidate_ref: string;
}

/** Assemble the gate request from the facts this run observed. PURE. */
export function buildRolloutGateRequest(input: {
  readonly candidate: FlywheelCandidate;
  readonly observed: EvidenceContract;
  readonly headline: Headline | null;
  readonly requiresRepositoryWrite: boolean;
  readonly shape: ChangeShape;
}): RolloutGateRequest {
  return {
    schema: 'ur.flywheel.rollout.request.v1',
    candidate_ref: input.candidate.candidateRef,
    candidate_state: input.candidate.state,
    observed_identity: input.observed,
    application_headline: input.headline,
    requires_repository_write: input.requiresRepositoryWrite,
    change_shape: input.shape,
  };
}

/**
 * Parse a rollout decision, FAILING CLOSED. `null` means "unusable" and the caller must substitute
 * {@link unavailableRolloutGate}. Four responses are rejected outright:
 *
 * - anything that is not an object with a boolean `unlocked` and a blocker array;
 * - a response claiming `pressed: true` — CI is never told a rollout STARTED, and a server saying so
 * is a protocol violation we refuse rather than render;
 * - a response that OMITS `pressed` — an endpoint that does not speak this protocol must not be
 * able to unlock the button by saying less (missing evidence is a refusal, never a pass);
 * - `unlocked: true` alongside a non-empty blocker list (an internally inconsistent unlock).
 */
export function parseRolloutGate(raw: unknown): RolloutGate | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.unlocked !== 'boolean') return null;
  if (o.pressed !== false) return null;
  if (!Array.isArray(o.blockers)) return null;
  const blockers: RolloutBlocker[] = [];
  for (const b of o.blockers) {
    if (typeof b !== 'object' || b === null) return null;
    const bo = b as Record<string, unknown>;
    if (typeof bo.reason !== 'string' || bo.reason.trim() === '') return null;
    blockers.push({
      reason: bo.reason,
      family: typeof bo.family === 'string' ? bo.family : 'unknown',
      message: typeof bo.message === 'string' ? bo.message : bo.reason,
      ...(typeof bo.detail === 'string' ? { detail: bo.detail } : {}),
    });
  }
  if (o.unlocked && blockers.length > 0) return null;
  return {
    unlocked: o.unlocked,
    pressed: false,
    blockers,
    evidence_hash: typeof o.evidence_hash === 'string' ? o.evidence_hash : '',
    candidate_ref: typeof o.candidate_ref === 'string' ? o.candidate_ref : '',
  };
}

/** The FAIL-CLOSED gate used whenever the server decision could not be read. Never unlocked. */
export function unavailableRolloutGate(candidateRef: string, evidenceHash: string): RolloutGate {
  return {
    unlocked: false,
    pressed: false,
    blockers: [
      {
        reason: 'authorization_unavailable',
        family: 'permissions',
        message: 'the server-side rollout authorization was not supplied — fail closed',
      },
    ],
    evidence_hash: evidenceHash,
    candidate_ref: candidateRef,
  };
}

// ─────────────────────────────── the human decision callback ───────────────────────────────

/** The closed human-decision vocabulary (mirrors the gateway's). */
export const CANDIDATE_DECISIONS = ['accept', 'reject', 'revert'] as const;
export type CandidateDecision = (typeof CANDIDATE_DECISIONS)[number];
export function isCandidateDecision(value: unknown): value is CandidateDecision {
  return typeof value === 'string' && (CANDIDATE_DECISIONS as readonly string[]).includes(value);
}

/** Where the human decided. All three link the SAME immutable evidence object. */
export const CANDIDATE_DECISION_SURFACES = ['pull_request', 'dashboard', 'cli'] as const;
export type CandidateDecisionSurface = (typeof CANDIDATE_DECISION_SURFACES)[number];

/** The schema tag every app-CI callback carries. */
export const APP_CI_CALLBACK_SCHEMA = 'ur.appci.callback.v1' as const;
/** The callback signature headers — the MAC recipe, a DISTINCT header namespace. */
export const APP_CI_CALLBACK_SIGNATURE_HEADER = 'x-ur-appci-signature';
export const APP_CI_CALLBACK_TIMESTAMP_HEADER = 'x-ur-appci-timestamp';

/** The two callback kinds this CLI emits. */
export type AppCiCallbackKind = 'evidence' | 'decision';

/**
 * The DETERMINISTIC idempotency key. Derived from the callback's own identity rather than generated,
 * so a re-sent callback carries the SAME id and the server absorbs it as a visible no-op FOREVER —
 * not merely inside the signature freshness window. Must match the gateway's callback id recipe.
 */
export function appCiCallbackId(input: {
  readonly kind: AppCiCallbackKind;
  readonly workspaceId: string;
  readonly candidateRef: string;
  readonly evidenceHash: string;
  readonly decision?: CandidateDecision;
  readonly actorId?: string;
}): string {
  return `urcb1_${sha256Hex(
    canonicalJson({
      candidate_ref: input.candidateRef,
      decision: input.decision ?? null,
      actor_id: input.actorId ?? null,
      evidence_hash: input.evidenceHash,
      kind: input.kind,
      workspace_id: input.workspaceId,
    }),
  ).slice(0, 32)}`;
}

/** A human accept/reject/revert as sent. The candidate BODY never travels — only its reference. */
export interface CandidateDecisionCallback {
  readonly schema: typeof APP_CI_CALLBACK_SCHEMA;
  readonly kind: 'decision';
  readonly callback_id: string;
  readonly workspace_id: string;
  readonly candidate_ref: string;
  readonly evidence_hash: string;
  readonly decision: CandidateDecision;
  readonly actor_id: string;
  readonly reason: string;
  readonly surface: CandidateDecisionSurface;
  readonly decided_at: string;
}

/** Thrown when a decision is missing its mandatory actor or reason. */
export class DecisionRefusedError extends Error {
  readonly reason: 'unknown_decision' | 'actor_required' | 'reason_required';
  constructor(reason: 'unknown_decision' | 'actor_required' | 'reason_required', detail: string) {
    super(`${reason}: ${detail}`);
    this.name = 'DecisionRefusedError';
    this.reason = reason;
  }
}

/**
 * Build a decision callback body plus the EXACT bytes that will be signed and sent. The body is
 * serialized ONCE here and the same string is both signed and transmitted, so a signature can never
 * describe different bytes than were sent (the property, kept).
 *
 * Fails closed on a missing actor or a blank reason: "recorded with actor/reason" is only true if
 * their absence is an error rather than a null column.
 */
export function buildDecisionCallback(input: {
  readonly workspaceId: string;
  readonly candidateRef: string;
  readonly evidenceHash: string;
  readonly decision: string;
  readonly actorId: string;
  readonly reason: string;
  readonly surface: CandidateDecisionSurface;
  readonly decidedAt: string;
}): { readonly body: CandidateDecisionCallback; readonly rawBody: string } {
  if (!isCandidateDecision(input.decision)) {
    throw new DecisionRefusedError('unknown_decision', String(input.decision));
  }
  if (input.actorId.trim() === '') {
    throw new DecisionRefusedError('actor_required', 'a human decision needs an actor');
  }
  if (input.reason.trim() === '') {
    throw new DecisionRefusedError('reason_required', 'a human decision needs a non-empty reason');
  }
  const body: CandidateDecisionCallback = {
    schema: APP_CI_CALLBACK_SCHEMA,
    kind: 'decision',
    callback_id: appCiCallbackId({
      kind: 'decision',
      workspaceId: input.workspaceId,
      candidateRef: input.candidateRef,
      evidenceHash: input.evidenceHash,
      decision: input.decision,
      actorId: input.actorId,
    }),
    workspace_id: input.workspaceId,
    candidate_ref: input.candidateRef,
    evidence_hash: input.evidenceHash,
    decision: input.decision,
    actor_id: input.actorId,
    reason: input.reason,
    surface: input.surface,
    decided_at: input.decidedAt,
  };
  return { body, rawBody: JSON.stringify(body) };
}

/**
 * The two signature headers for an already-serialized callback body. The MAC is computed by the same
 * `signReviewerPayload` implementation the reviewer adapter uses (WebCrypto, `HMAC-SHA256` over `"<unix-seconds>.<body>"`,
 * keyed by the API key) — this module does not own a second signing scheme; only the header
 * namespace differs, which is deliberate domain separation between the two endpoints.
 */
export async function callbackSignatureHeaders(
  secret: string,
  rawBody: string,
  nowMs: number,
): Promise<Record<string, string>> {
  const timestamp = String(Math.floor(nowMs / 1000));
  return {
    [APP_CI_CALLBACK_TIMESTAMP_HEADER]: timestamp,
    [APP_CI_CALLBACK_SIGNATURE_HEADER]: await signReviewerPayload(secret, timestamp, rawBody),
  };
}

// ─────────────────────────────── the comment sections ───────────────────────────────

/** Escape untrusted text for a markdown comment (the same rules as `pr-comment.ts`). */
function esc(raw: string): string {
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/`/g, '&#96;')
    .replace(/-->/g, '--&gt;')
    .replace(/[\r\n]+/g, ' ')
    .trim();
}

/**
 * The CANDIDATE section appended to the comment. It states the immutable reference, the
 * provenance, the change shape, the destination and — explicitly — that a merged PR is not measured
 * improvement. Aggregates and addresses only: the module body never appears in a comment.
 */
export function renderCandidateSection(input: {
  readonly candidate: FlywheelCandidate;
  readonly plan: CandidatePlan;
  readonly delivery: DeliveryResult;
}): string {
  const { candidate, plan, delivery } = input;
  const L: string[] = [];
  L.push('**Flywheel candidate**');
  L.push(
    `- reference \`${esc(candidate.candidateRef)}\` · lever \`${esc(candidate.leverKey)}\` · state \`${esc(candidate.state)}\``,
  );
  L.push(
    `- provenance: module \`${esc(candidate.moduleId)}@${esc(candidate.moduleVersion)}\` · pack \`${esc(candidate.packHash)}\` · ranker \`${esc(candidate.rankerVersion)}\` · epoch \`${String(candidate.epoch)}\``,
  );
  L.push(
    `- change shape \`${plan.shape}\` (${plan.shape === 'gateway_owned' ? 'immutable candidate reference in the harness config + a linked payload diff' : 'a code-owned file diff'}) · classification \`${plan.classification.kind}\``,
  );
  const dest =
    delivery.pullRequest !== null
      ? `PR #${String(delivery.pullRequest.number)} on \`${esc(delivery.destinationBranch ?? '')}\``
      : delivery.patchPath !== null
        ? `downloadable patch \`${esc(delivery.patchPath)}\``
        : `\`${esc(plan.destinationBranch)}\` (not written: ${esc(delivery.reason)})`;
  L.push(`- delivery \`${delivery.mode}\` → ${dest}`);
  if (plan.payloadHash !== null)
    L.push(`- linked payload sha256 \`${plan.payloadHash.slice(0, 16)}\``);
  L.push(
    '- this PR is **never auto-merged**, and **merging it is not measured improvement** — live randomized confirmation is a separate stage.',
  );
  return L.join('\n');
}

/**
 * The ROLLOUT section. It renders the server's decision verbatim: either the unlocked button (still
 * NOT pressed — starting a rollout is a human action in the dashboard, never something CI does), or
 * every named blocker with its family, so the customer sees the whole repair list at once.
 */
export function renderRolloutSection(gate: RolloutGate): string {
  const L: string[] = [];
  L.push('**Controlled rollout**');
  if (gate.unlocked) {
    L.push(
      '- ✅ **Start controlled rollout** is UNLOCKED — every precondition (permissions, consent, budget, qualification, frozen baseline) is satisfied.',
    );
    L.push(
      '- CI does not press it. Start the rollout from the dashboard; live confirmation and adoption happen there.',
    );
  } else {
    L.push(
      '- ⛔ **Start controlled rollout** is BLOCKED. Each blocker below has its own cause and its own fix:',
    );
    for (const b of gate.blockers) {
      L.push(
        `  - \`${esc(b.reason)}\` (${esc(b.family)}) — ${esc(b.message)}${b.detail !== undefined ? ` [${esc(b.detail)}]` : ''}`,
      );
    }
  }
  L.push(
    `- evidence object \`${esc(gate.evidence_hash.slice(0, 16))}\` · candidate \`${esc(gate.candidate_ref)}\``,
  );
  return L.join('\n');
}
