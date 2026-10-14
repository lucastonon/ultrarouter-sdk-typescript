/**
 * `ur app-ci` — the TRUSTED publication path: ONE idempotently-updated PR comment
 * and ONE Check Run per workflow / current head. PURE builders + an INJECTED {@link GitHubClient}
 * (the entry wires a fetch-based REST client; contract tests inject a stub) so the whole flow is
 * hermetically testable with no real GitHub.
 *
 * Publication is SEPARATED from untrusted test execution: this module never
 * runs customer code, never sees platform provider secrets, and treats every workflow id / surface /
 * debug excerpt / reason as UNTRUSTED — it HTML/markdown-ESCAPES them, neutralises the comment-marker
 * terminator, redacts every credential from the final body, and NEVER echoes payloads/keys. The
 * comment carries AGGREGATES only ({@link WorkflowOutcome}
 * has no field for raw/sealed cases), so sealed confirmation/holdout rows can never leak into a comment.
 */

import {
  conclusionPasses,
  HEADLINE_TEXT,
  type AppCheckConclusion,
  type WorkflowOutcome,
} from './gate.js';
import { redactSecrets } from './redact.js';

/** A minimal GitHub issue comment (only what we key on). */
export interface GhIssueComment {
  readonly id: number;
  readonly body: string;
}

/** A minimal GitHub Check Run (only what we key on). */
export interface GhCheckRun {
  readonly id: number;
  readonly name: string;
}

/** The Check Run create/update parameters (a completed run with a conclusion + output). */
export interface CheckRunParams {
  readonly name: string;
  readonly head_sha: string;
  readonly status: 'completed';
  readonly conclusion: AppCheckConclusion;
  readonly output: { readonly title: string; readonly summary: string };
}

/** The injected GitHub REST seam (comments read/write + checks write are SEPARATE permissions). */
export interface GitHubClient {
  listIssueComments(repo: string, prNumber: number): Promise<readonly GhIssueComment[]>;
  createIssueComment(repo: string, prNumber: number, body: string): Promise<GhIssueComment>;
  updateIssueComment(repo: string, commentId: number, body: string): Promise<GhIssueComment>;
  listCheckRunsForRef(repo: string, ref: string): Promise<readonly GhCheckRun[]>;
  createCheckRun(repo: string, params: CheckRunParams): Promise<GhCheckRun>;
  updateCheckRun(repo: string, checkRunId: number, params: CheckRunParams): Promise<GhCheckRun>;
}

/** Injected IO for publication (the GitHub client + a logger). */
export interface PublicationDeps {
  readonly github: GitHubClient;
  readonly log: (line: string) => void;
  readonly err: (line: string) => void;
}

/** The Check Run name for a workflow (one per workflow / head). */
export function checkRunName(workflowId: string): string {
  return `ultrarouter app-ci / ${workflowId}`;
}

/** The hidden, per-workflow idempotency marker embedded in the comment body. */
export function commentMarker(workflowId: string): string {
  return `<!-- ur-app-ci:${workflowId} -->`;
}

/**
 * HTML/markdown-ESCAPE an UNTRUSTED string for safe inclusion in a comment:
 * escape `& < >`, neutralise backticks + the marker terminator `-->` (so untrusted text can never
 * close our hidden marker or inject a code fence), and collapse to a single line.
 */
export function escapeUntrusted(raw: string): string {
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/`/g, '&#96;')
    .replace(/-->/g, '--&gt;')
    .replace(/[\r\n]+/g, ' ')
    .trim();
}

/** Format a µUSD figure as USD, or `n/a`. */
function usd(microUsd: number | null): string {
  return microUsd === null ? 'n/a' : `$${(microUsd / 1_000_000).toFixed(6)}`;
}

/** Format a plain USD number (already USD), or `n/a`. */
function plainUsd(value: number | null): string {
  return value === null ? 'n/a' : `$${value.toFixed(6)}`;
}

/**
 * Build the idempotent PR comment for one workflow. The body leads with the hidden marker,
 * renders the headline + scope, and SEPARATES the three evidence stages (application tests / offline
 * replay / live evidence). It shows sample, quality interval, cost/latency tradeoff, up to three
 * redacted debug failures, the signed-evidence link/hash and the next action. Every untrusted string
 * is escaped; there is no raw/sealed-case field to leak. PURE.
 */
export function buildComment(
  outcome: WorkflowOutcome,
  extraSections: readonly string[] = [],
): string {
  const L: string[] = [];
  L.push(commentMarker(outcome.workflowId));
  L.push(`### ultrarouter app-ci — ${HEADLINE_TEXT[outcome.headline]}`);
  L.push('');
  const coverage = outcome.coverage ?? 'unknown';
  const scope =
    outcome.surfaces.length > 0 ? outcome.surfaces.join(', ') : 'no configured surface changes';
  L.push(
    `**Workflow** \`${escapeUntrusted(outcome.workflowId)}\` · **coverage** \`${coverage}\` · **scope** ${escapeUntrusted(scope)}`,
  );
  if (coverage === 'model_call_only') {
    L.push('');
    L.push(
      '> This is a direct model-call comparison — it is labeled as such and **cannot claim application-level coverage**.',
    );
  }
  L.push('');

  // Stage 1 — application tests.
  L.push('**Application tests**');
  const app = outcome.application;
  if (app === null) {
    L.push('- not run in this context');
  } else {
    L.push(`- candidate: \`${app.candidateOutcome}\` · baseline: \`${app.baselineOutcome}\``);
    L.push(
      `- sample n=${app.sample ?? 'n/a'} · passed ${app.passed ?? 'n/a'} · failed ${app.failed ?? 'n/a'}`,
    );
    L.push(
      `- cost/latency: ${plainUsd(app.costUsd)} · ${app.latencyMs === null ? 'n/a' : `${String(app.latencyMs)}ms`}`,
    );
  }
  L.push('');

  // Stage 2 — offline replay (the compare gate — the SAME verdict engine, never forked).
  L.push('**Offline replay (compare gate)**');
  if (outcome.gate === null) {
    L.push('- not run (no bound suite)');
  } else {
    const ct = outcome.gate.call_types[0];
    L.push(`- verdict: \`${outcome.gateVerdict ?? 'unknown'}\``);
    if (ct !== undefined) {
      L.push(
        `- quality: [${ct.quality_interval.low.toFixed(4)}, ${ct.quality_interval.high.toFixed(4)}] vs bar ${ct.quality_interval.bar.toFixed(4)}`,
      );
      L.push(
        `- cost: [${ct.cost_interval.low.toFixed(4)}, ${ct.cost_interval.high.toFixed(4)}] vs bar ${ct.cost_interval.bar.toFixed(4)}` +
          (ct.cost_ceiling.enabled
            ? ` · ceiling ${ct.cost_ceiling.breached ? 'BREACHED' : 'ok'} (${usd(ct.cost_ceiling.observed_mean_micro_usd)} vs ${usd(ct.cost_ceiling.ceiling_micro_usd)})`
            : ''),
      );
    }
  }
  L.push('');

  // Stage 3 — live evidence (never produced by CI — a separate, later stage).
  L.push('**Live evidence**');
  L.push('- none — live randomized confirmation is a separate stage, not CI.');
  L.push('');

  // Extension sections (the flywheel candidate + the rollout gate), when a candidate is
  // bound. Each section is already escaped by its renderer; there is still no raw/sealed-case field.
  for (const section of extraSections) {
    if (section.trim() === '') continue;
    L.push(section);
    L.push('');
  }

  if (outcome.reasons.length > 0) {
    L.push(`**Reasons**: ${outcome.reasons.map((r) => `\`${escapeUntrusted(r)}\``).join(', ')}`);
  }
  if (app !== null && app.debugFailures.length > 0) {
    L.push('');
    L.push('**Screening/debug failures** (redacted, up to 3):');
    for (const d of app.debugFailures.slice(0, 3)) L.push(`- ${escapeUntrusted(d)}`);
  }
  L.push('');
  const evidence = outcome.evidenceUrl
    ? `[\`${outcome.evidenceHash.slice(0, 16)}\`](${encodeURI(outcome.evidenceUrl)})`
    : `\`${outcome.evidenceHash.slice(0, 16)}\``;
  L.push(
    `**Evidence**: ${evidence}${outcome.stale ? ' — ⚠️ STALE (a bound input changed; re-run)' : ''}`,
  );
  L.push(`**Next**: ${escapeUntrusted(outcome.nextAction)}`);
  L.push('');
  L.push(
    '_Summary evidence only. Protected full examples (sealed confirmation/holdout cases + labels) require authenticated workspace access and never appear here._',
  );
  // The FINAL pass: whatever reached the body (an excerpt, a reason, an extension section), no
  // credential leaves the runner — GitHub's log masking does not cover API-posted bodies.
  return redactSecrets(L.join('\n'));
}

/**
 * Upsert the per-workflow comment idempotently: find the existing comment by its hidden
 * marker and UPDATE it, else CREATE one. One comment per workflow, refreshed to the current head.
 */
export async function upsertComment(
  deps: PublicationDeps,
  input: {
    repo: string;
    prNumber: number;
    outcome: WorkflowOutcome;
    /** Extension sections (candidate + rollout), appended before the reasons block. */
    extraSections?: readonly string[];
  },
): Promise<{ action: 'created' | 'updated'; commentId: number }> {
  const body = buildComment(input.outcome, input.extraSections ?? []);
  const marker = commentMarker(input.outcome.workflowId);
  const existing = (await deps.github.listIssueComments(input.repo, input.prNumber)).find((c) =>
    c.body.includes(marker),
  );
  if (existing !== undefined) {
    await deps.github.updateIssueComment(input.repo, existing.id, body);
    deps.err(
      `ur app-ci: updated comment ${String(existing.id)} for '${input.outcome.workflowId}'.`,
    );
    return { action: 'updated', commentId: existing.id };
  }
  const created = await deps.github.createIssueComment(input.repo, input.prNumber, body);
  deps.err(`ur app-ci: created comment ${String(created.id)} for '${input.outcome.workflowId}'.`);
  return { action: 'created', commentId: created.id };
}

/** Build the Check Run params for a workflow outcome (fail-closed conclusion). PURE. */
export function buildCheckRun(
  outcome: WorkflowOutcome,
  headSha: string,
  extraSections: readonly string[] = [],
): CheckRunParams {
  const title = `${HEADLINE_TEXT[outcome.headline]}${conclusionPasses(outcome.conclusion) ? '' : ' — action required'}`;
  return {
    name: checkRunName(outcome.workflowId),
    head_sha: headSha,
    status: 'completed',
    conclusion: outcome.conclusion,
    output: { title, summary: buildComment(outcome, extraSections) },
  };
}

/**
 * Publish the Check Run idempotently: find an existing run with the SAME name at the
 * SAME head and UPDATE it, else CREATE one. One Check Run per workflow / current head. Missing
 * evidence maps to `action_required` (never `neutral`) so it cannot silently satisfy branch protection.
 */
export async function publishCheckRun(
  deps: PublicationDeps,
  input: {
    repo: string;
    headSha: string;
    outcome: WorkflowOutcome;
    /** Extension sections (candidate + rollout) — the same body the comment carries. */
    extraSections?: readonly string[];
  },
): Promise<{ action: 'created' | 'updated'; checkRunId: number }> {
  const params = buildCheckRun(input.outcome, input.headSha, input.extraSections ?? []);
  const existing = (await deps.github.listCheckRunsForRef(input.repo, input.headSha)).find(
    (r) => r.name === params.name,
  );
  if (existing !== undefined) {
    await deps.github.updateCheckRun(input.repo, existing.id, params);
    deps.err(`ur app-ci: updated check run ${String(existing.id)} (${params.conclusion}).`);
    return { action: 'updated', checkRunId: existing.id };
  }
  const created = await deps.github.createCheckRun(input.repo, params);
  deps.err(`ur app-ci: created check run ${String(created.id)} (${params.conclusion}).`);
  return { action: 'created', checkRunId: created.id };
}
