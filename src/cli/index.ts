#!/usr/bin/env node
/// <reference types="node" />
/**
 * `ur` — the ultrarouter CLI. Commands (run `ur --help` for every flag; docs/cli.md documents them):
 *
 *   ur bench run|baseline|gate     Bench runs and the baseline-compare CI gate
 *   ur app-ci [run]                the application CI gate + PR check
 *   ur flywheel-pr [run|decision]  a screened flywheel candidate as a reviewable change
 *   ur import                      import usage or trace history
 *   ur outcomes import|pending     backfill outcomes; list claims awaiting resolution
 *   ur flywheel status|calibration learning status
 *   ur context lint                the advisory prompt-surface scanner
 *   ur pack validate               validate a `*.ur.md` knowledge pack
 *
 * Exit codes are the contract: 0 success (or a passing gate); 1 a usage error; 2 a failing gate or
 * any API/pipeline error (fail closed — a broken gate is never green). The typed cores live in the
 * sibling modules (injected IO, unit-testable); this entry is the thin process/spawn wiring.
 */

import { spawn, spawnSync } from 'node:child_process';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative as relativePath, resolve as resolvePath } from 'node:path';

import { DEFAULT_BASE_URL, UltraRouter } from '../client.js';
import { VERSION } from '../version.js';
import type { BenchCompareGate } from '../types.js';

import { CandidateRevisionError, verifyCandidateCheckout } from './revision.js';
import {
  runWorkflowHarness,
  exitCodeOf,
  type AppHarnessDeps,
  type WorkflowHarnessResult,
} from './app-harness.js';
import {
  buildDecisionCallback,
  buildRolloutGateRequest,
  callbackSignatureHeaders,
  candidateBranchName,
  deliverCandidate,
  parseCandidate,
  parseRolloutGate,
  patchFileName,
  planCandidateChange,
  renderCandidatePlan,
  renderCandidateSection,
  renderRolloutSection,
  resolveDeliveryMode,
  unavailableRolloutGate,
  APP_CI_CALLBACK_SIGNATURE_HEADER,
  APP_CI_CALLBACK_TIMESTAMP_HEADER,
  type CandidateDecisionSurface,
  type CandidatePlan,
  type ChangeShape,
  type DeliveryMode,
  type DeliveryResult,
  type FlywheelCandidate,
  type GitHubWriteClient,
  type RepositoryWrite,
  type RolloutGate,
} from './flywheel-pr.js';
import {
  detectChanges,
  isSurfaceKind,
  surfacesForWorkflow,
  type CoverageLabel,
  type SurfaceBinding,
  type WorkflowBinding,
} from './detect.js';
import {
  buildGateJson,
  canonicalJson,
  decideWorkflowOutcome,
  EXIT,
  exitCodeFor,
  hashEvidenceContract,
  HEADLINE_TEXT,
  isStaleEvidence,
  needsConfigurationOutcome,
  overallExitCode,
  renderGateTable,
  resolveBaseline,
  sha256Hex,
  type EvidenceContract,
  type WorkflowOutcome,
} from './gate.js';
import {
  publishCheckRun,
  upsertComment,
  type CheckRunParams,
  type GhCheckRun,
  type GhIssueComment,
  type GitHubClient,
  type PublicationDeps,
} from './pr-comment.js';
import { discoverChangedPaths, type GitRunner } from './changes.js';
import { runImport, type ImportRunOptions } from './import.js';
import {
  runOutcomesImport,
  runOutcomesPending,
  type OutcomesImportOptions,
  type OutcomesPendingOptions,
} from './outcomes.js';
import { runFlywheelCalibration, runFlywheelStatus } from './flywheel.js';
import { runContextLint, type ContextLintOptions } from './context-lint.js';
import { runPackValidate, type PackCliDeps } from './pack.js';
import { parseBenchRunArgs, runBench, type BenchRunOptions } from './run.js';

/** Read a flag value (`--flag value` or `--flag=value`); returns undefined when absent. */
function flagValue(argv: readonly string[], name: string): string | undefined {
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === `--${name}`) return argv[i + 1];
    if (a?.startsWith(`--${name}=`)) return a.slice(name.length + 3);
  }
  return undefined;
}

/** Whether a boolean flag is present. */
function hasFlag(argv: readonly string[], name: string): boolean {
  return argv.includes(`--${name}`);
}

/** The best-effort commit SHA for the default run tag (GITHUB_SHA → git → a timestamp). */
function defaultRunTag(): string {
  const gha = process.env.GITHUB_SHA;
  if (gha !== undefined && gha !== '') return gha.slice(0, 12);
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return `local-${String(Date.now())}`;
  }
}

/** A non-empty env var, or undefined. */
function env(name: string): string | undefined {
  const value = process.env[name];
  return value === undefined || value === '' ? undefined : value;
}

/** The base URL from `--base-url`, then `ULTRAROUTER_BASE_URL`, then `UR_BASE_URL` (same order as the client). */
function resolveBaseUrl(argv: readonly string[]): string | undefined {
  return flagValue(argv, 'base-url') ?? env('ULTRAROUTER_BASE_URL') ?? env('UR_BASE_URL');
}

/** The API key from `--api-key`, then `ULTRAROUTER_API_KEY`, then `UR_API_KEY` (same order as the client). */
function resolveApiKey(argv: readonly string[]): string | undefined {
  return flagValue(argv, 'api-key') ?? env('ULTRAROUTER_API_KEY') ?? env('UR_API_KEY');
}

/** Build an UltraRouter client from flags + env. */
function makeClient(argv: readonly string[]): UltraRouter {
  const baseURL = resolveBaseUrl(argv) ?? DEFAULT_BASE_URL;
  const apiKey = resolveApiKey(argv);
  return new UltraRouter({ baseURL, ...(apiKey !== undefined ? { apiKey } : {}) });
}

/** Spawn `<cmd>` in a shell with the bench env layered on top of the current process env. */
function spawnCapture(cmd: string, env: Record<string, string>): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn(cmd, {
      shell: true,
      stdio: 'inherit',
      env: { ...process.env, ...env },
    });
    // A capture killed by a signal FAILED (exit 128 + n), never a silent 0.
    child.on('close', (code, signal) => resolve(exitCodeOf(code, signal)));
    child.on('error', () => resolve(127));
  });
}

// ─── `ur app-ci` — the application-CI gate + PR check ─────────────────────────────────

/** The versioned `ur app-ci --json` schema tag (bump on any structural change). */
const APP_CI_JSON_SCHEMA = 'ur.app-ci.v1' as const;

/** The parsed, validated `ur app-ci` config (customer-maintained, JSON). */
interface AppCiConfig {
  readonly repository?: string;
  readonly datasetSplit: string;
  readonly evidenceEpoch: string;
  /** The dependency-lock path whose digest pins the evidence contract (default auto-detected). */
  readonly lockfile?: string;
  /** An optional evidence URL template; `{hash}` is substituted with the evidence content address. */
  readonly evidenceUrlTemplate?: string;
  readonly workflows: readonly WorkflowBinding[];
}

/** The `ur app-ci` run options resolved from argv + env. */
interface AppCiOptions {
  readonly config: AppCiConfig;
  readonly configHash: string;
  readonly repository: string;
  readonly baseSha: string;
  readonly headSha: string;
  readonly prNumber: number | null;
  readonly fork: boolean;
  readonly secretsAvailable: boolean;
  readonly allowInconclusive: boolean;
  readonly assertedEvidence: ReadonlyMap<string, string>;
  readonly json: boolean;
  readonly publish: boolean;
  readonly changedPaths: readonly string[];
  /** The IMMUTABLE candidate reference bound into this run's evidence (null ⇒ plain). */
  readonly candidateRef?: string | null;
  /** Env naming the bound candidate, handed to the CANDIDATE revision only. */
  readonly candidateEnv?: Readonly<Record<string, string>>;
  /** Extra comment/check sections (the candidate + rollout blocks). */
  readonly extraSections?: readonly string[];
}

/** Injected IO for {@link runAppCi} (the entry wires git-worktree + scrubbed spawn + fetch GitHub). */
interface AppCiDeps {
  readonly harness: AppHarnessDeps;
  readonly publication: PublicationDeps | null;
  /** Read a bound compare gate for a workflow: `{ gate, error }` — a null gate with a null error means "no bound suite". */
  readonly gateFor: (
    workflow: WorkflowBinding,
  ) => Promise<{ gate: BenchCompareGate | null; error: string | null }>;
  /** SHA-256 of a file's content, or null when the file is absent. */
  readonly fileDigest: (path: string) => string | null;
  /**
   * Verify the current checkout IS `headSha` (the revision the evidence names) before any candidate
   * harness runs. Throws {@link CandidateRevisionError} with a named reason otherwise.
   */
  readonly verifyCandidate: (headSha: string) => void;
  readonly log: (line: string) => void;
  readonly err: (line: string) => void;
}

/** The versioned `ur app-ci --json` result. */
interface AppCiJson {
  readonly schema: typeof APP_CI_JSON_SCHEMA;
  readonly repository: string;
  readonly base_sha: string;
  readonly head_sha: string;
  readonly fork: boolean;
  readonly detection: {
    readonly affected_workflows: readonly string[];
    readonly unmapped: readonly string[];
    readonly needs_configuration: boolean;
  };
  readonly workflows: readonly {
    readonly workflow_id: string;
    readonly headline: WorkflowOutcome['headline'];
    readonly conclusion: WorkflowOutcome['conclusion'];
    readonly coverage: CoverageLabel | null;
    readonly surfaces: readonly string[];
    readonly evidence_hash: string;
    readonly stale: boolean;
    readonly gate_verdict: string | null;
    readonly reasons: readonly string[];
    readonly application: {
      readonly coverage: CoverageLabel;
      readonly baseline_outcome: string;
      readonly candidate_outcome: string;
      readonly sample: number | null;
    } | null;
  }[];
  readonly exit_code: number;
}

/** Serialise an outcome for the `--json` payload (aggregates only — never raw/sealed cases). */
function outcomeToJson(o: WorkflowOutcome): AppCiJson['workflows'][number] {
  return {
    workflow_id: o.workflowId,
    headline: o.headline,
    conclusion: o.conclusion,
    coverage: o.coverage,
    surfaces: o.surfaces,
    evidence_hash: o.evidenceHash,
    stale: o.stale,
    gate_verdict: o.gateVerdict,
    reasons: o.reasons,
    application:
      o.application === null
        ? null
        : {
            coverage: o.application.coverage,
            baseline_outcome: o.application.baselineOutcome,
            candidate_outcome: o.application.candidateOutcome,
            sample: o.application.sample,
          },
  };
}

/**
 * The `ur app-ci` orchestration. Detect (advisory) → per affected workflow: pin the
 * evidence contract, check staleness, run the customer baseline+candidate harness (unless fork/stale),
 * read the bound offline-replay gate (the SAME verdict engine, never forked), decide the fail-closed
 * headline/conclusion → publish ONE idempotent comment + Check Run per workflow/head. Exit 0 only when
 * EVERY outcome is `success`. IO is INJECTED, so the flow is hermetically contract-testable.
 */
async function runAppCi(
  deps: AppCiDeps,
  opts: AppCiOptions,
): Promise<{
  exitCode: number;
  json: AppCiJson;
  outcomes: readonly WorkflowOutcome[];
  /** The evidence contract each affected workflow was pinned against (reads it for the gate). */
  contracts: ReadonlyMap<string, EvidenceContract>;
}> {
  const contracts = new Map<string, EvidenceContract>();
  const detection = detectChanges({
    changedPaths: opts.changedPaths,
    workflows: opts.config.workflows,
  });
  const byId = new Map(opts.config.workflows.map((w) => [w.id, w]));
  const outcomes: WorkflowOutcome[] = [];

  const lockDigest =
    opts.config.lockfile !== undefined
      ? (deps.fileDigest(opts.config.lockfile) ?? 'absent')
      : 'absent';
  let candidateVerified = false;

  for (const workflowId of detection.affectedWorkflows) {
    const wf = byId.get(workflowId);
    if (wf === undefined) continue;

    const contract: EvidenceContract = {
      repository: opts.repository,
      baseSha: opts.baseSha,
      headSha: opts.headSha,
      lockDigest,
      harnessHash: sha256Hex(
        canonicalJson({
          testCommand: wf.testCommand,
          coverage: wf.coverage,
          surfaces: wf.surfaces,
        }),
      ),
      configHash: opts.configHash,
      datasetSplit: opts.config.datasetSplit,
      workflowId: wf.id,
      objective: wf.objective,
      evaluatorVersion: wf.evaluatorVersion,
      evidenceEpoch: opts.config.evidenceEpoch,
      // An absent candidate leaves the field `undefined`, which canonical JSON drops — a
      // plain run therefore keeps its pre- evidence address byte for byte.
      ...(opts.candidateRef !== undefined && opts.candidateRef !== null
        ? { candidateRef: opts.candidateRef }
        : {}),
    };
    contracts.set(wf.id, contract);
    const evidenceHash = hashEvidenceContract(contract);
    const asserted = opts.assertedEvidence.get(wf.id) ?? opts.assertedEvidence.get('*') ?? null;
    const stale = isStaleEvidence(asserted, evidenceHash);
    const evidenceUrl =
      opts.config.evidenceUrlTemplate !== undefined
        ? opts.config.evidenceUrlTemplate.replace('{hash}', evidenceHash)
        : null;
    const surfaces = surfacesForWorkflow(detection, wf.id);

    // Fork or stale ⇒ the untrusted harness is NEVER executed (detection + comment-only).
    let harness: WorkflowHarnessResult | null = null;
    let gate: BenchCompareGate | null = null;
    let gateError: string | null = null;
    if (!opts.fork && !stale) {
      // The candidate runs in this checkout while the evidence names `headSha`: before the first
      // harness runs, the checkout must BE that revision. A mismatch throws before anything is
      // published, so no comment or Check Run ever attests to a revision that was not tested.
      if (!candidateVerified) {
        deps.verifyCandidate(opts.headSha);
        candidateVerified = true;
      }
      harness = await runWorkflowHarness(deps.harness, wf, {
        baseSha: opts.baseSha,
        headSha: opts.headSha,
        secretsAvailable: opts.secretsAvailable,
        ...(opts.candidateEnv !== undefined ? { candidateEnv: opts.candidateEnv } : {}),
      });
      const read = await deps.gateFor(wf);
      gate = read.gate;
      gateError = read.error;
    }

    outcomes.push(
      decideWorkflowOutcome({
        workflowId: wf.id,
        surfaces,
        application: harness?.summary ?? null,
        gate,
        gateError,
        evidenceHash,
        stale,
        fork: opts.fork,
        allowInconclusive: opts.allowInconclusive,
        evidenceUrl,
      }),
    );
  }

  // Advisory `Needs configuration` for any unmapped change (a distinct non-success check).
  if (detection.needsConfiguration) outcomes.push(needsConfigurationOutcome(detection.unmapped));

  // Publish ONE idempotent comment + Check Run per outcome (per workflow / current head).
  if (deps.publication !== null && opts.prNumber !== null && opts.publish) {
    for (const outcome of outcomes) {
      await upsertComment(deps.publication, {
        repo: opts.repository,
        prNumber: opts.prNumber,
        outcome,
        ...(opts.extraSections !== undefined ? { extraSections: opts.extraSections } : {}),
      });
      await publishCheckRun(deps.publication, {
        repo: opts.repository,
        headSha: opts.headSha,
        outcome,
        ...(opts.extraSections !== undefined ? { extraSections: opts.extraSections } : {}),
      });
    }
  } else if (outcomes.length > 0) {
    deps.err('ur app-ci: publication skipped (no --pr / --no-publish); computed outcomes only.');
  }

  const exitCode = overallExitCode(outcomes);
  const json: AppCiJson = {
    schema: APP_CI_JSON_SCHEMA,
    repository: opts.repository,
    base_sha: opts.baseSha,
    head_sha: opts.headSha,
    fork: opts.fork,
    detection: {
      affected_workflows: detection.affectedWorkflows,
      unmapped: detection.unmapped,
      needs_configuration: detection.needsConfiguration,
    },
    workflows: outcomes.map(outcomeToJson),
    exit_code: exitCode,
  };
  return { exitCode, json, outcomes, contracts };
}

/** Parse + VALIDATE an `ur app-ci` config (fail-closed on any structural error). */
function parseAppCiConfig(raw: string): AppCiConfig {
  let obj: unknown;
  try {
    obj = JSON.parse(raw);
  } catch (e) {
    throw new Error(`invalid app-ci config JSON: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (typeof obj !== 'object' || obj === null)
    throw new Error('app-ci config must be a JSON object');
  const o = obj as Record<string, unknown>;
  const str = (v: unknown, name: string): string => {
    if (typeof v !== 'string' || v.trim() === '')
      throw new Error(`app-ci config: '${name}' must be a non-empty string`);
    return v;
  };
  const datasetSplit = str(o.datasetSplit, 'datasetSplit');
  const evidenceEpoch = str(o.evidenceEpoch, 'evidenceEpoch');
  if (!Array.isArray(o.workflows) || o.workflows.length === 0)
    throw new Error('app-ci config: `workflows` must be a non-empty array');
  const workflows: WorkflowBinding[] = o.workflows.map((w, i): WorkflowBinding => {
    if (typeof w !== 'object' || w === null)
      throw new Error(`app-ci config: workflow[${String(i)}] must be an object`);
    const wo = w as Record<string, unknown>;
    const coverage = wo.coverage;
    if (coverage !== 'application' && coverage !== 'model_call_only')
      throw new Error(
        `app-ci config: workflow[${String(i)}].coverage must be 'application' or 'model_call_only'`,
      );
    if (!Array.isArray(wo.surfaces) || wo.surfaces.length === 0)
      throw new Error(`app-ci config: workflow[${String(i)}].surfaces must be a non-empty array`);
    const surfaces: SurfaceBinding[] = wo.surfaces.map((s, j): SurfaceBinding => {
      if (typeof s !== 'object' || s === null)
        throw new Error(
          `app-ci config: workflow[${String(i)}].surfaces[${String(j)}] must be an object`,
        );
      const so = s as Record<string, unknown>;
      if (!isSurfaceKind(so.kind))
        throw new Error(
          `app-ci config: workflow[${String(i)}].surfaces[${String(j)}].kind is not a known surface kind`,
        );
      if (!Array.isArray(so.paths) || !so.paths.every((p) => typeof p === 'string'))
        throw new Error(
          `app-ci config: workflow[${String(i)}].surfaces[${String(j)}].paths must be a string[]`,
        );
      return { kind: so.kind, paths: so.paths as string[] };
    });
    return {
      id: str(wo.id, `workflow[${String(i)}].id`),
      objective: str(wo.objective, `workflow[${String(i)}].objective`),
      evaluatorVersion: str(wo.evaluatorVersion, `workflow[${String(i)}].evaluatorVersion`),
      coverage: coverage as CoverageLabel,
      testCommand: str(wo.testCommand, `workflow[${String(i)}].testCommand`),
      ...(typeof wo.suite === 'string' ? { suite: wo.suite } : {}),
      ...(typeof wo.gateRunId === 'string' ? { gateRunId: wo.gateRunId } : {}),
      surfaces,
    };
  });
  return {
    ...(typeof o.repository === 'string' ? { repository: o.repository } : {}),
    datasetSplit,
    evidenceEpoch,
    ...(typeof o.lockfile === 'string' ? { lockfile: o.lockfile } : {}),
    ...(typeof o.evidenceUrlTemplate === 'string'
      ? { evidenceUrlTemplate: o.evidenceUrlTemplate }
      : {}),
    workflows,
  };
}

/** All `--flag value` occurrences (repeatable flags). */
function flagValues(argv: readonly string[], name: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === `--${name}`) {
      const v = argv[i + 1];
      if (v !== undefined) out.push(v);
    } else if (a?.startsWith(`--${name}=`)) {
      out.push(a.slice(name.length + 3));
    }
  }
  return out;
}

/** A best-effort `git rev-parse` (returns null when git/ref is unavailable). */
/** The real git runner for change discovery (no shell; output captured). */
const realGit: GitRunner = (args) => {
  const res = spawnSync('git', [...args], { encoding: 'utf8' });
  return { status: res.status, stdout: res.stdout ?? '', stderr: res.stderr ?? '' };
};

/** Resolve the changed paths from `--changed-file` / `--changed-from` / git (fails closed). */
function discoverFromArgs(args: readonly string[], baseSha: string, headSha: string): string[] {
  const changedFrom = flagValue(args, 'changed-from');
  return [
    ...discoverChangedPaths({
      explicit: flagValues(args, 'changed-file'),
      ...(changedFrom !== undefined ? { changedFrom: readFileSync(changedFrom, 'utf8') } : {}),
      baseSha,
      headSha,
      git: realGit,
    }).paths,
  ];
}

/** The claimed head: `--head`, then `GITHUB_SHA`, then the checkout's `HEAD`. */
function resolveHeadSha(args: readonly string[]): string {
  return flagValue(args, 'head') ?? process.env.GITHUB_SHA ?? gitRevParse('HEAD') ?? '';
}

/** The baseline: `--base`, then `GITHUB_BASE_SHA`, then `HEAD~1`. */
function resolveBaseSha(args: readonly string[]): string {
  return flagValue(args, 'base') ?? process.env.GITHUB_BASE_SHA ?? gitRevParse('HEAD~1') ?? '';
}

/** The files whose content the evidence binds by digest: the config and the configured lockfile. */
function boundEvidencePaths(configPath: string, config: AppCiConfig): string[] {
  return [configPath, ...(config.lockfile !== undefined ? [config.lockfile] : [])];
}

function gitRevParse(ref: string): string | null {
  try {
    return execFileSync('git', ['rev-parse', ref], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return null;
  }
}

/**
 * A fetch-based {@link GitHubClient} (the trusted publication seam). Uses `GITHUB_API_URL` + a
 * checks/PR-write token. Fails LOUDLY on a non-2xx so a broken publication is never a silent green.
 */
function makeGitHubClient(apiBase: string, token: string): GitHubClient {
  const headers: Record<string, string> = {
    authorization: `Bearer ${token}`,
    accept: 'application/vnd.github+json',
    'x-github-api-version': '2022-11-28',
    'user-agent': 'ultrarouter-app-ci',
    'content-type': 'application/json',
  };
  const call = async (method: string, path: string, body?: unknown): Promise<unknown> => {
    const res = await fetch(`${apiBase}${path}`, {
      method,
      headers,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    if (!res.ok) {
      throw new Error(`github ${method} ${path} failed: ${String(res.status)}`);
    }
    const text = await res.text();
    return text === '' ? {} : (JSON.parse(text) as unknown);
  };
  return {
    async listIssueComments(repo, prNumber): Promise<readonly GhIssueComment[]> {
      const data = (await call(
        'GET',
        `/repos/${repo}/issues/${String(prNumber)}/comments?per_page=100`,
      )) as GhIssueComment[];
      return Array.isArray(data) ? data : [];
    },
    async createIssueComment(repo, prNumber, body): Promise<GhIssueComment> {
      return (await call('POST', `/repos/${repo}/issues/${String(prNumber)}/comments`, {
        body,
      })) as GhIssueComment;
    },
    async updateIssueComment(repo, commentId, body): Promise<GhIssueComment> {
      return (await call('PATCH', `/repos/${repo}/issues/comments/${String(commentId)}`, {
        body,
      })) as GhIssueComment;
    },
    async listCheckRunsForRef(repo, ref): Promise<readonly GhCheckRun[]> {
      const data = (await call('GET', `/repos/${repo}/commits/${ref}/check-runs?per_page=100`)) as {
        check_runs?: GhCheckRun[];
      };
      return Array.isArray(data.check_runs) ? data.check_runs : [];
    },
    async createCheckRun(repo, params: CheckRunParams): Promise<GhCheckRun> {
      return (await call('POST', `/repos/${repo}/check-runs`, params)) as GhCheckRun;
    },
    async updateCheckRun(repo, checkRunId, params: CheckRunParams): Promise<GhCheckRun> {
      return (await call(
        'PATCH',
        `/repos/${repo}/check-runs/${String(checkRunId)}`,
        params,
      )) as GhCheckRun;
    },
  };
}

/**
 * Run one harness command with a SCRUBBED env: the publication token +
 * ultrarouter platform key are DELETED so untrusted customer code never receives platform secrets;
 * the command is passed to a shell verbatim (no interpolation). Structured output is read from a
 * bounded temp file (never stdout) so it cannot smuggle raw bytes into the comment path.
 */
function makeHarnessRunCommand(): AppHarnessDeps['runCommand'] {
  return (cmd, cwd, env) =>
    new Promise((resolve) => {
      const scrubbed: Record<string, string> = {};
      for (const [k, v] of Object.entries(process.env)) if (v !== undefined) scrubbed[k] = v;
      // Never expose the trusted publication/platform secrets to untrusted repository code.
      for (const secret of [
        'GITHUB_TOKEN',
        'UR_APP_CI_GITHUB_TOKEN',
        'UR_API_KEY',
        'ULTRAROUTER_API_KEY',
        'NPM_TOKEN',
        'PYPI_TOKEN',
        'TEST_PYPI_TOKEN',
      ]) {
        delete scrubbed[secret];
      }
      const outFile = join(mkdtempSync(join(tmpdir(), 'ur-app-ci-out-')), 'output.json');
      const child = spawn(cmd, {
        shell: true,
        stdio: 'inherit',
        cwd,
        env: { ...scrubbed, ...env, UR_APP_CI_OUTPUT: outFile },
      });
      const done = (exitCode: number): void => {
        let output: string | null = null;
        try {
          output = readFileSync(outFile, 'utf8');
        } catch {
          output = null;
        }
        try {
          rmSync(outFile, { force: true });
        } catch {
          /* best-effort cleanup */
        }
        resolve({ exitCode, output });
      };
      // A harness killed by a signal FAILED (exit 128 + n), never a silent 0.
      child.on('close', (code, signal) => done(exitCodeOf(code, signal)));
      child.on('error', () => done(127));
    });
}

/** Prepare a revision's working tree: candidate = cwd; baseline = a detached git worktree at base. */
function makePrepareRevision(cleanup: string[]): AppHarnessDeps['prepareRevision'] {
  return (revision, sha) =>
    new Promise((resolve) => {
      if (revision === 'candidate') {
        resolve({ cwd: process.cwd() });
        return;
      }
      if (sha === null || sha === '') {
        resolve(null);
        return;
      }
      // `git worktree add` needs a NON-existent target path, so nest it inside a fresh temp parent.
      const parent = mkdtempSync(join(tmpdir(), 'ur-app-ci-base-'));
      const dir = join(parent, 'wt');
      const res = spawnSync('git', ['worktree', 'add', '--detach', dir, sha], {
        encoding: 'utf8',
        stdio: 'ignore',
      });
      if ((res.status ?? 1) !== 0) {
        try {
          rmSync(parent, { recursive: true, force: true });
        } catch {
          /* ignore */
        }
        resolve(null);
        return;
      }
      cleanup.push(dir);
      resolve({ cwd: dir });
    });
}

/** Remove the git worktrees created for baseline preparation (best-effort). */
function cleanupWorktrees(dirs: readonly string[]): void {
  for (const dir of dirs) {
    spawnSync('git', ['worktree', 'remove', '--force', dir], { stdio: 'ignore' });
    try {
      // `dir` is `<temp-parent>/wt`; remove the whole temp parent.
      rmSync(join(dir, '..'), { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}

/**
 * A path as the current directory names it (both sides resolved through symlinks, so a macOS
 * `/var` → `/private/var` temp path still compares), for a git pathspec.
 */
function cwdRelative(p: string): string {
  const real = (q: string): string => {
    try {
      return realpathSync(q);
    } catch {
      return q;
    }
  };
  const rel = relativePath(real(process.cwd()), real(resolvePath(p)));
  return rel === '' ? '.' : rel;
}

/**
 * The real candidate-checkout check: `HEAD` must be the claimed head and no tracked file may differ
 * from it, except the config and the lockfile, whose content the evidence binds by digest.
 */
function makeVerifyCandidate(boundPaths: readonly string[]): AppCiDeps['verifyCandidate'] {
  return (headSha) => {
    verifyCandidateCheckout({ headSha, boundPaths: boundPaths.map(cwdRelative), git: realGit });
  };
}

/** Build the injected {@link AppCiDeps} from the resolved options + env (the real IO wiring). */
function makeAppCiDeps(opts: {
  client: UltraRouter | null;
  githubApi: string;
  githubToken: string | undefined;
  publish: boolean;
  cleanup: string[];
  /** Files whose content the evidence binds by digest (the config, the lockfile). */
  boundPaths: readonly string[];
}): AppCiDeps {
  const publication: PublicationDeps | null =
    opts.publish && opts.githubToken !== undefined && opts.githubToken !== ''
      ? {
          github: makeGitHubClient(opts.githubApi, opts.githubToken),
          log: (l) => process.stdout.write(`${l}\n`),
          err: (l) => process.stderr.write(`${l}\n`),
        }
      : null;
  return {
    harness: {
      prepareRevision: makePrepareRevision(opts.cleanup),
      runCommand: makeHarnessRunCommand(),
      log: (l) => process.stderr.write(`${l}\n`),
      err: (l) => process.stderr.write(`${l}\n`),
    },
    publication,
    gateFor: async (workflow) => {
      if (workflow.gateRunId !== undefined) {
        if (opts.client === null)
          return { gate: null, error: 'gate_error:no api key for the offline-replay gate' };
        try {
          const gate = await opts.client.ur.bench.gate(workflow.gateRunId);
          return { gate, error: null };
        } catch (e) {
          return { gate: null, error: `gate_error:${e instanceof Error ? e.message : String(e)}` };
        }
      }
      // A suite is declared but no compare run id is available in CI ⇒ the offline replay evaluator
      // could not be completed here — a NAMED needs-evidence reason, never silently "no gate".
      if (workflow.suite !== undefined) return { gate: null, error: 'missing_evaluator' };
      return { gate: null, error: null };
    },
    fileDigest: (path) => {
      try {
        return sha256Hex(readFileSync(path, 'utf8'));
      } catch {
        return null;
      }
    },
    verifyCandidate: makeVerifyCandidate(opts.boundPaths),
    log: (l) => process.stdout.write(`${l}\n`),
    err: (l) => process.stderr.write(`${l}\n`),
  };
}

// ─── `ur flywheel-pr` — the candidate → PR|patch → bound-evidence path ───────────────

/** The versioned `ur flywheel-pr --json` schema tag (bump on any structural change). */
const FLYWHEEL_PR_JSON_SCHEMA = 'ur.flywheel-pr.v1' as const;

/**
 * A fetch-based {@link GitHubWriteClient}. It implements EXACTLY the calls the candidate paths need
 * — probe, read ref/blob, create branch, put file, open PR, read a PR head — and **nothing that
 * merges**: there is no merge method on the interface, so there is none here either.
 */
function makeGitHubWriteClient(apiBase: string, token: string): GitHubWriteClient {
  const headers: Record<string, string> = {
    authorization: `Bearer ${token}`,
    accept: 'application/vnd.github+json',
    'x-github-api-version': '2022-11-28',
    'user-agent': 'ultrarouter-flywheel-pr',
    'content-type': 'application/json',
  };
  const call = async (
    method: string,
    path: string,
    body?: unknown,
  ): Promise<{ status: number; data: unknown }> => {
    const res = await fetch(`${apiBase}${path}`, {
      method,
      headers,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const text = await res.text();
    return { status: res.status, data: text === '' ? {} : (JSON.parse(text) as unknown) };
  };
  const ok = (status: number): boolean => status >= 200 && status < 300;
  return {
    async repositoryWrite(repo): Promise<RepositoryWrite> {
      try {
        const { status, data } = await call('GET', `/repos/${repo}`);
        if (!ok(status)) return 'unknown';
        const perms = (data as { permissions?: { push?: unknown } }).permissions;
        if (perms === undefined || typeof perms.push !== 'boolean') return 'unknown';
        return perms.push ? 'granted' : 'denied';
      } catch {
        return 'unknown'; // an unreadable probe is NEVER read as consent to write
      }
    },
    async getRefSha(repo, ref): Promise<string | null> {
      const { status, data } = await call('GET', `/repos/${repo}/git/ref/heads/${ref}`);
      if (!ok(status)) return null;
      const sha = (data as { object?: { sha?: unknown } }).object?.sha;
      return typeof sha === 'string' ? sha : null;
    },
    async getFileSha(repo, path, ref): Promise<string | null> {
      const { status, data } = await call(
        'GET',
        `/repos/${repo}/contents/${encodeURI(path)}?ref=${encodeURIComponent(ref)}`,
      );
      if (!ok(status)) return null;
      const sha = (data as { sha?: unknown }).sha;
      return typeof sha === 'string' ? sha : null;
    },
    async createBranch(repo, branch, sha): Promise<void> {
      const { status } = await call('POST', `/repos/${repo}/git/refs`, {
        ref: `refs/heads/${branch}`,
        sha,
      });
      // 422 = the ref already exists; re-running the same candidate is idempotent, not an error.
      if (!ok(status) && status !== 422) {
        throw new Error(`could not create branch ${branch}: ${String(status)}`);
      }
    },
    async putFile(repo, input): Promise<void> {
      const { status } = await call('PUT', `/repos/${repo}/contents/${encodeURI(input.path)}`, {
        message: input.message,
        content: input.contentBase64,
        branch: input.branch,
        ...(input.sha !== null ? { sha: input.sha } : {}),
      });
      if (!ok(status)) throw new Error(`could not write ${input.path}: ${String(status)}`);
    },
    async createPullRequest(repo, input): Promise<{ number: number; url: string }> {
      const { status, data } = await call('POST', `/repos/${repo}/pulls`, {
        ...input,
        draft: true,
      });
      if (!ok(status)) throw new Error(`could not open a pull request: ${String(status)}`);
      const d = data as { number?: unknown; html_url?: unknown };
      return {
        number: typeof d.number === 'number' ? d.number : 0,
        url: typeof d.html_url === 'string' ? d.html_url : '',
      };
    },
    async findOpenPullRequest(repo, branch): Promise<{ number: number; url: string } | null> {
      const owner = repo.split('/')[0] ?? '';
      const { status, data } = await call(
        'GET',
        `/repos/${repo}/pulls?state=open&head=${encodeURIComponent(`${owner}:${branch}`)}`,
      );
      if (!ok(status) || !Array.isArray(data) || data.length === 0) return null;
      const first = data[0] as { number?: unknown; html_url?: unknown };
      if (typeof first.number !== 'number') return null;
      return {
        number: first.number,
        url: typeof first.html_url === 'string' ? first.html_url : '',
      };
    },
    async pullRequestHeadRef(repo, prNumber): Promise<string | null> {
      const { status, data } = await call('GET', `/repos/${repo}/pulls/${String(prNumber)}`);
      if (!ok(status)) return null;
      const ref = (data as { head?: { ref?: unknown } }).head?.ref;
      return typeof ref === 'string' ? ref : null;
    },
  };
}

/**
 * Read the server's rollout decision. The unlock is decided by the gateway only — this CLI only
 * supplies the facts it alone
 * observes (the current bound identity + the application headline) and renders the answer. Any
 * failure resolves to `null`, and the caller substitutes the fail-closed gate.
 */
async function readRolloutGate(
  baseUrl: string,
  apiKey: string | undefined,
  candidateRef: string,
  request: unknown,
): Promise<RolloutGate | null> {
  try {
    const res = await fetch(
      `${baseUrl.replace(/\/+$/, '')}/v1/flywheel/candidates/${encodeURIComponent(candidateRef)}/rollout`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(apiKey !== undefined ? { authorization: `Bearer ${apiKey}` } : {}),
        },
        body: JSON.stringify(request),
      },
    );
    if (!res.ok) return null;
    return parseRolloutGate((await res.json()) as unknown);
  } catch {
    return null;
  }
}

/** The `ur flywheel-pr --json` payload (aggregates + addresses only — never a payload body). */
interface FlywheelPrJson {
  readonly schema: typeof FLYWHEEL_PR_JSON_SCHEMA;
  readonly candidate: {
    readonly candidate_ref: string;
    readonly lever_key: string;
    readonly module_id: string;
    readonly module_version: string;
    readonly pack_hash: string;
    readonly epoch: number;
    readonly state: string;
    readonly workflow_id: string;
  };
  readonly plan: {
    readonly shape: ChangeShape;
    readonly destination_branch: string;
    readonly base_branch: string;
    readonly changed_paths: readonly string[];
    readonly classification: string;
    readonly payload_hash: string | null;
    readonly diff_sha256: string;
  };
  readonly delivery: {
    readonly mode: DeliveryMode;
    readonly applied: boolean;
    readonly reason: string;
    readonly repository_write: RepositoryWrite;
    readonly pull_request: number | null;
    readonly patch_path: string | null;
    readonly merged: false;
  };
  readonly app_ci: AppCiJson | null;
  readonly rollout: {
    readonly unlocked: boolean;
    readonly pressed: false;
    readonly blockers: readonly { readonly reason: string; readonly family: string }[];
    readonly evidence_hash: string;
  };
  readonly exit_code: number;
}

/** Resolve the candidate's workflow binding out of a parsed app-ci config (fail closed). */
function workflowFor(config: AppCiConfig, workflowId: string): WorkflowBinding {
  const wf = config.workflows.find((w) => w.id === workflowId);
  if (wf === undefined) {
    throw new Error(`the candidate's workflow '${workflowId}' is not in the app-ci config`);
  }
  return wf;
}

/**
 * `ur flywheel-pr run` — the flow, in this order (the order IS the contract):
 * 1. parse + validate the candidate (only `screened` travels; the reference is recomputed);
 * 2. PLAN the change and classify the OBSERVED diff against the lever's surface;
 * 3. probe the scoped repository write and resolve the delivery mode (fail closed to a patch);
 * 4. RENDER the plan — the diff and the destination branch — BEFORE anything is written;
 * 5. deliver (only with `--apply`): attach to an existing PR, open a new one, or write the patch;
 * 6. run the application CI with the candidate BOUND into the evidence contract;
 * 7. read the SERVER's rollout decision (fail closed) and publish one comment + Check Run.
 * Nothing merges, nothing adopts, and nothing in production is mutated.
 */
async function runFlywheelPrCommand(args: readonly string[]): Promise<number> {
  const configPath = flagValue(args, 'config');
  const candidatePath = flagValue(args, 'candidate');
  if (configPath === undefined || candidatePath === undefined) {
    process.stderr.write(`error: --config <path> and --candidate <path> are required\n${USAGE}\n`);
    return EXIT.USAGE;
  }

  const cleanup: string[] = [];
  try {
    const rawConfig = readFileSync(configPath, 'utf8');
    const config = parseAppCiConfig(rawConfig);
    const candidate: FlywheelCandidate = parseCandidate(readFileSync(candidatePath, 'utf8'));
    const workflow = workflowFor(config, candidate.workflowId);

    const shapeRaw = flagValue(args, 'shape') ?? 'gateway_owned';
    if (shapeRaw !== 'code_owned' && shapeRaw !== 'gateway_owned') {
      process.stderr.write(`error: --shape must be 'code_owned' or 'gateway_owned'\n`);
      return EXIT.USAGE;
    }
    const shape: ChangeShape = shapeRaw;
    const modulePath = flagValue(args, 'module-path');
    const repository =
      flagValue(args, 'repo') ?? config.repository ?? process.env.GITHUB_REPOSITORY ?? '';
    const baseBranch = flagValue(args, 'base-branch') ?? 'main';
    const prRaw = flagValue(args, 'pr') ?? process.env.GITHUB_PR_NUMBER;
    const prNumber = prRaw !== undefined && prRaw !== '' ? Number(prRaw) : null;
    const apply = hasFlag(args, 'apply');
    const githubApi =
      flagValue(args, 'github-api') ?? process.env.GITHUB_API_URL ?? 'https://api.github.com';
    const githubToken = flagValue(args, 'github-token') ?? process.env.GITHUB_TOKEN;
    const json = hasFlag(args, 'json');

    // 1b. the checkout must BE the head the evidence will name, before anything is planned from it
    // or written anywhere (a fork run executes nothing, so there is nothing to bind).
    if (!(hasFlag(args, 'fork') || process.env.UR_APP_CI_FORK === '1')) {
      makeVerifyCandidate(boundEvidencePaths(configPath, config))(resolveHeadSha(args));
    }

    // 2. the plan (nothing is written; the classification gates every later write).
    let moduleBefore: string | null = null;
    if (shape === 'code_owned' && modulePath !== undefined) {
      try {
        moduleBefore = readFileSync(modulePath, 'utf8');
      } catch {
        moduleBefore = null; // a new file
      }
    }
    // A patch/commit path must be REPOSITORY-RELATIVE: an absolute `--config` would produce a diff
    // `git apply` rejects ("invalid path"), and the downloadable-patch path has to actually apply.
    // (`realpath` on both sides: on macOS `$TMPDIR` is a symlink, so `process.cwd()` and an
    // absolute argument can name the same directory through two different prefixes.)
    const real = (p: string): string => {
      try {
        return realpathSync(p);
      } catch {
        return p;
      }
    };
    const repoRelative = (p: string): string => {
      const abs = resolvePath(p);
      for (const root of [process.cwd(), real(process.cwd())]) {
        for (const target of [abs, real(abs)]) {
          const rel = relativePath(root, target);
          if (rel !== '' && !rel.startsWith('..') && !isAbsolute(rel)) return rel;
        }
      }
      return p;
    };
    const plan: CandidatePlan = planCandidateChange({
      candidate,
      shape,
      workflow,
      baseBranch,
      configPath: repoRelative(configPath),
      configBefore: rawConfig,
      ...(flagValue(args, 'branch') !== undefined
        ? { branch: flagValue(args, 'branch') as string }
        : {}),
      ...(modulePath !== undefined ? { modulePath: repoRelative(modulePath) } : {}),
      moduleBefore,
    });

    // 3. the permission probe — an unreadable answer is NEVER read as consent to write.
    const forge =
      githubToken !== undefined && githubToken !== ''
        ? makeGitHubWriteClient(githubApi, githubToken)
        : null;
    const probed: RepositoryWrite = hasFlag(args, 'no-repo-write')
      ? 'denied'
      : forge === null
        ? 'unknown'
        : await forge.repositoryWrite(repository);
    const requestedRaw = flagValue(args, 'mode') ?? 'auto';
    if (!['auto', 'attach', 'open_pr', 'patch'].includes(requestedRaw)) {
      process.stderr.write(`error: --mode must be 'auto', 'attach', 'open_pr' or 'patch'\n`);
      return EXIT.USAGE;
    }
    const resolution = resolveDeliveryMode({
      requested: requestedRaw as DeliveryMode | 'auto',
      repositoryWrite: probed,
      prNumber,
    });
    if (!resolution.ok) {
      process.stderr.write(`error: ${resolution.reason} — pass --pr <n> to attach to a PR\n`);
      return EXIT.USAGE;
    }

    // 4. SHOW the diff + destination branch BEFORE writing anything. The preview goes to STDERR in
    // every mode (a CI log shows both streams) so STDOUT stays a clean machine-readable channel —
    // "show the diff before writing" must not depend on whether `--json` was passed.
    process.stderr.write(
      `${renderCandidatePlan(plan, candidate, { mode: resolution.mode, reason: resolution.reason, apply })}\n`,
    );

    // 5. deliver.
    const patchDir = flagValue(args, 'patch-out') ?? process.cwd();
    const delivery: DeliveryResult = await deliverCandidate(
      {
        forge,
        writePatch: (fileName, contents) => {
          const out = resolvePath(patchDir, fileName);
          writeFileSync(out, contents, 'utf8');
          return Promise.resolve(out);
        },
        toBase64: (utf8) => Buffer.from(utf8, 'utf8').toString('base64'),
        // Delivery progress is HUMAN output: it goes to stderr so `--json` stdout stays parseable.
        log: (l) => process.stderr.write(`${l}\n`),
        err: (l) => process.stderr.write(`${l}\n`),
      },
      {
        repo: repository,
        plan,
        apply,
        mode: resolution.mode,
        reason: resolution.reason,
        prNumber,
        title: `ultrarouter: learned-context candidate ${plan.candidateRef}`,
        body: renderCandidateSection({
          candidate,
          plan,
          delivery: {
            mode: resolution.mode,
            applied: apply,
            destinationBranch: plan.destinationBranch,
            pullRequest: null,
            patchPath: null,
            merged: false,
            reason: resolution.reason,
          },
        }),
        baseSha: flagValue(args, 'base-branch-sha') ?? null,
      },
    );

    // 6. the application CI, with the candidate bound into the evidence contract.
    const appCi = await runBoundAppCi(args, {
      config,
      configPath,
      rawConfig,
      repository,
      candidate,
      prNumber,
      githubApi,
      githubToken,
      cleanup,
    });

    // 7. the SERVER's rollout decision (fail closed), then ONE comment + Check Run per workflow.
    const outcome = appCi.outcomes.find((o) => o.workflowId === candidate.workflowId) ?? null;
    const observed = appCi.contracts.get(candidate.workflowId) ?? null;
    const evidenceHash = outcome?.evidenceHash ?? '';
    let gate: RolloutGate | null = null;
    const baseUrl = resolveBaseUrl(args);
    if (observed !== null && baseUrl !== undefined && baseUrl !== '') {
      gate = await readRolloutGate(
        baseUrl,
        resolveApiKey(args),
        candidate.candidateRef,
        buildRolloutGateRequest({
          candidate,
          observed,
          headline: outcome?.headline ?? null,
          requiresRepositoryWrite: resolution.mode !== 'patch',
          shape,
        }),
      );
    }
    const rollout = gate ?? unavailableRolloutGate(candidate.candidateRef, evidenceHash);

    const sections = [
      renderCandidateSection({ candidate, plan, delivery }),
      renderRolloutSection(rollout),
    ];
    if (
      !hasFlag(args, 'no-publish') &&
      prNumber !== null &&
      githubToken !== undefined &&
      githubToken !== ''
    ) {
      const publication = {
        github: makeGitHubClient(githubApi, githubToken),
        log: (l: string) => process.stderr.write(`${l}\n`),
        err: (l: string) => process.stderr.write(`${l}\n`),
      };
      for (const o of appCi.outcomes) {
        await upsertComment(publication, {
          repo: repository,
          prNumber,
          outcome: o,
          extraSections: o.workflowId === candidate.workflowId ? sections : [],
        });
        await publishCheckRun(publication, {
          repo: repository,
          headSha: appCi.headSha,
          outcome: o,
          extraSections: o.workflowId === candidate.workflowId ? sections : [],
        });
      }
    }

    const payload: FlywheelPrJson = {
      schema: FLYWHEEL_PR_JSON_SCHEMA,
      candidate: {
        candidate_ref: candidate.candidateRef,
        lever_key: candidate.leverKey,
        module_id: candidate.moduleId,
        module_version: candidate.moduleVersion,
        pack_hash: candidate.packHash,
        epoch: candidate.epoch,
        state: candidate.state,
        workflow_id: candidate.workflowId,
      },
      plan: {
        shape: plan.shape,
        destination_branch: plan.destinationBranch,
        base_branch: plan.baseBranch,
        changed_paths: plan.changedPaths,
        classification: plan.classification.kind,
        payload_hash: plan.payloadHash,
        diff_sha256: sha256Hex(plan.diff),
      },
      delivery: {
        mode: delivery.mode,
        applied: delivery.applied,
        reason: delivery.reason,
        repository_write: probed,
        pull_request: delivery.pullRequest?.number ?? null,
        patch_path: delivery.patchPath,
        merged: false,
      },
      app_ci: appCi.json,
      rollout: {
        unlocked: rollout.unlocked,
        pressed: false,
        blockers: rollout.blockers.map((b) => ({ reason: b.reason, family: b.family })),
        evidence_hash: rollout.evidence_hash,
      },
      exit_code: appCi.exitCode,
    };
    // The rollout section is HUMAN output and goes to stderr in every mode, so the named blockers
    // are visible in a CI log whether or not `--json` was asked for; stdout stays machine-readable.
    process.stderr.write(`${renderRolloutSection(rollout)}\n`);
    if (json) process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    else process.stdout.write(`  exit ${String(appCi.exitCode)}\n`);
    return appCi.exitCode;
  } catch (e) {
    process.stderr.write(`error: ${e instanceof Error ? e.message : String(e)}\n`);
    return EXIT.GATE; // fail closed on any candidate/plan/pipeline error
  } finally {
    cleanupWorktrees(cleanup);
  }
}

/** Run the gate with the candidate bound (publication is done by the caller, once). */
async function runBoundAppCi(
  args: readonly string[],
  input: {
    config: AppCiConfig;
    configPath: string;
    rawConfig: string;
    repository: string;
    candidate: FlywheelCandidate;
    prNumber: number | null;
    githubApi: string;
    githubToken: string | undefined;
    cleanup: string[];
  },
): Promise<{
  exitCode: number;
  json: AppCiJson;
  outcomes: readonly WorkflowOutcome[];
  contracts: ReadonlyMap<string, EvidenceContract>;
  headSha: string;
}> {
  const headSha = resolveHeadSha(args);
  const baseSha = resolveBaseSha(args);
  // Fails closed (throws ChangeDiscoveryError) when discovery is unavailable — never "no changes".
  const changedPaths = discoverFromArgs(args, baseSha, headSha);

  let client: UltraRouter | null = null;
  try {
    client = makeClient(args);
  } catch {
    client = null;
  }
  const deps = makeAppCiDeps({
    client,
    githubApi: input.githubApi,
    githubToken: input.githubToken,
    publish: false, // the flywheel command publishes ONE comment with the candidate sections
    cleanup: input.cleanup,
    boundPaths: boundEvidencePaths(input.configPath, input.config),
  });
  const result = await runAppCi(deps, {
    config: input.config,
    configHash: sha256Hex(input.rawConfig),
    repository: input.repository,
    baseSha,
    headSha,
    prNumber: input.prNumber,
    fork: hasFlag(args, 'fork') || process.env.UR_APP_CI_FORK === '1',
    secretsAvailable: hasFlag(args, 'no-secrets') ? false : !hasFlag(args, 'fork'),
    allowInconclusive: hasFlag(args, 'allow-inconclusive'),
    assertedEvidence: parseAssertedEvidence(flagValues(args, 'asserted-evidence-hash')),
    json: false,
    publish: false,
    changedPaths,
    candidateRef: input.candidate.candidateRef,
    candidateEnv: {
      UR_APP_CI_CANDIDATE_REF: input.candidate.candidateRef,
      UR_APP_CI_CANDIDATE_LEVER: input.candidate.leverKey,
      UR_APP_CI_CANDIDATE_MODULE: `${input.candidate.moduleId}@${input.candidate.moduleVersion}`,
      UR_APP_CI_CANDIDATE_BODY_SHA256: input.candidate.bodyHash,
    },
  });
  return { ...result, headSha };
}

/**
 * `ur flywheel-pr decision` — record a HUMAN accept / reject / revert with actor and reason. The
 * body is serialized ONCE, signed with the MAC recipe, and POSTed with a DETERMINISTIC
 * `callback_id`, so a re-send is a visible server-side no-op (`duplicate`) rather than a second
 * decision. A refusal is reported with its reason and exits non-zero; a duplicate exits 0.
 */
async function runFlywheelDecisionCommand(args: readonly string[]): Promise<number> {
  const candidatePath = flagValue(args, 'candidate');
  const decision = flagValue(args, 'decision');
  const actor = flagValue(args, 'actor');
  const reason = flagValue(args, 'reason');
  const evidenceHash = flagValue(args, 'evidence-hash') ?? '';
  if (
    candidatePath === undefined ||
    decision === undefined ||
    actor === undefined ||
    reason === undefined
  ) {
    process.stderr.write(
      `error: --candidate, --decision, --actor and --reason are all required\n${USAGE}\n`,
    );
    return EXIT.USAGE;
  }
  try {
    const candidate = parseCandidate(readFileSync(candidatePath, 'utf8'));
    const surfaceRaw = flagValue(args, 'surface') ?? 'pull_request';
    if (!['pull_request', 'dashboard', 'cli'].includes(surfaceRaw)) {
      process.stderr.write(`error: --surface must be 'pull_request', 'dashboard' or 'cli'\n`);
      return EXIT.USAGE;
    }
    const { body, rawBody } = buildDecisionCallback({
      workspaceId: candidate.workspaceId,
      candidateRef: candidate.candidateRef,
      evidenceHash,
      decision,
      actorId: actor,
      reason,
      surface: surfaceRaw as CandidateDecisionSurface,
      decidedAt: flagValue(args, 'decided-at') ?? new Date().toISOString(),
    });
    const baseUrl = resolveBaseUrl(args);
    const apiKey = resolveApiKey(args);
    if (baseUrl === undefined || baseUrl === '' || apiKey === undefined || apiKey === '') {
      process.stderr.write('error: --base-url and --api-key are required to record a decision\n');
      return EXIT.GATE; // fail closed — a decision that was not recorded is not a decision
    }
    const headers = await callbackSignatureHeaders(apiKey, rawBody, Date.now());
    const res = await fetch(
      `${baseUrl.replace(/\/+$/, '')}/v1/flywheel/candidates/${encodeURIComponent(candidate.candidateRef)}/decisions`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${apiKey}`,
          ...headers,
        },
        body: rawBody,
      },
    );
    const text = await res.text();
    const parsed = text === '' ? {} : (JSON.parse(text) as { status?: unknown; reason?: unknown });
    const status = typeof parsed.status === 'string' ? parsed.status : 'unknown';
    const out = {
      schema: 'ur.flywheel-pr.decision.v1',
      candidate_ref: candidate.candidateRef,
      callback_id: body.callback_id,
      decision: body.decision,
      actor_id: body.actor_id,
      status,
      ...(typeof parsed.reason === 'string' ? { reason: parsed.reason } : {}),
    };
    process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
    if (!res.ok) return EXIT.GATE;
    return status === 'accepted' || status === 'duplicate' ? EXIT.PASS : EXIT.GATE;
  } catch (e) {
    process.stderr.write(`error: ${e instanceof Error ? e.message : String(e)}\n`);
    return EXIT.GATE;
  }
}

/** The `ur` usage text (printed by `ur --help` and on a usage error). */
const USAGE = `usage:
  ur flywheel-pr [run] --config <path> --candidate <path>
            [--shape gateway_owned|code_owned] [--module-path <path>] [--mode auto|attach|open_pr|patch]
            [--apply] [--patch-out <dir>] [--branch <name>] [--base-branch <name>]
            [--base-branch-sha <sha>] [--no-repo-write] [--repo owner/repo] [--base <sha>] [--head <sha>]
            [--pr <n>] [--changed-file <path>]... [--changed-from <file>] [--fork] [--no-secrets]
            [--allow-inconclusive] [--asserted-evidence-hash [wf=]<hash>]...
            [--base-url <url>] [--api-key <key>] [--github-api <url>] [--github-token <tok>]
            [--no-publish] [--json]
  ur flywheel-pr decision --candidate <path> --decision accept|reject|revert
            --actor <id> --reason <text> [--surface pull_request|dashboard|cli]
            [--evidence-hash <hash>] [--decided-at <iso>] [--base-url <url>] [--api-key <key>]
  ur app-ci [run] --config <path> [--repo owner/repo] [--base <sha>] [--head <sha>]
            [--changed-file <path>]... [--changed-from <file>] [--pr <n>] [--fork]
            [--no-secrets] [--allow-inconclusive] [--asserted-evidence-hash [wf=]<hash>]...
            [--github-api <url>] [--github-token <tok>] [--no-publish] [--json]
  ur bench run <suite> [--capture <cmd>] [--budget N] [--gate] [--baseline <ref>] [--json]
                       [--allow-inconclusive] [--cost-ceiling <usd>] [--mode request|task]
                       [--selection selection|noninferiority] [--pin-baseline] [--run-tag <tag>]
                       [--base-url <url>] [--api-key <key>] [--wait-timeout <ms>]
  ur bench baseline <run-id>
  ur bench gate <run-id> [--allow-inconclusive] [--json]
  ur import <file> --format <adapter> [--format-version <v>] [--preview | --mode preview]
            [--resume <import-id>] [--call-type <ct_id>] [--json] [--base-url <url>] [--api-key <key>]
  ur outcomes import <jsonl|csv> [--format jsonl|csv] [--map <field>=<column>]... [--json]
            [--base-url <url>] [--api-key <key>]
  ur outcomes pending [--state pending|overdue] [--archetype <a>] [--since <iso>]
            [--limit <n>] [--cursor <c>] [--json] [--base-url <url>] [--api-key <key>]
  ur flywheel status [--json] [--base-url <url>] [--api-key <key>]
  ur flywheel calibration [--json] [--base-url <url>] [--api-key <key>]
  ur context lint <path>... [--strict] [--max-warnings <n>] [--max-prompt-tokens <n>] [--json]
  ur pack validate <file> [--workspace <id>] [--require-export-consent] [--json]
  ur --help | ur --version`;

/** Parse the repeatable `--asserted-evidence-hash [wf=]<hash>` flag into a workflowId→hash map. */
function parseAssertedEvidence(values: readonly string[]): ReadonlyMap<string, string> {
  const map = new Map<string, string>();
  for (const v of values) {
    const eq = v.indexOf('=');
    if (eq > 0) map.set(v.slice(0, eq), v.slice(eq + 1));
    else map.set('*', v);
  }
  return map;
}

/** The `ur app-ci` command: parse flags/env → build the real IO deps → run → print → exit code. */
async function runAppCiCommand(appArgs: readonly string[]): Promise<number> {
  const configPath = flagValue(appArgs, 'config');
  if (configPath === undefined) {
    process.stderr.write(`error: --config <path> is required\n${USAGE}\n`);
    return EXIT.USAGE;
  }

  let opts: AppCiOptions;
  try {
    const raw = readFileSync(configPath, 'utf8');
    const config = parseAppCiConfig(raw);
    const configHash = sha256Hex(raw);
    const repository =
      flagValue(appArgs, 'repo') ?? config.repository ?? process.env.GITHUB_REPOSITORY ?? '';
    const headSha = resolveHeadSha(appArgs);
    const baseSha = resolveBaseSha(appArgs);

    // Fails closed (throws ChangeDiscoveryError ⇒ exit 2) when discovery is unavailable: a missing
    // base commit or a git error is never treated as "nothing changed".
    const changedPaths = discoverFromArgs(appArgs, baseSha, headSha);

    const prRaw = flagValue(appArgs, 'pr') ?? process.env.GITHUB_PR_NUMBER;
    const prNumber = prRaw !== undefined && prRaw !== '' ? Number(prRaw) : null;
    const fork = hasFlag(appArgs, 'fork') || process.env.UR_APP_CI_FORK === '1';
    const secretsAvailable = hasFlag(appArgs, 'no-secrets') ? false : !fork;

    opts = {
      config,
      configHash,
      repository,
      baseSha,
      headSha,
      prNumber: prNumber !== null && Number.isFinite(prNumber) ? prNumber : null,
      fork,
      secretsAvailable,
      allowInconclusive: hasFlag(appArgs, 'allow-inconclusive'),
      assertedEvidence: parseAssertedEvidence(flagValues(appArgs, 'asserted-evidence-hash')),
      json: hasFlag(appArgs, 'json'),
      publish: !hasFlag(appArgs, 'no-publish'),
      changedPaths,
    };
  } catch (e) {
    process.stderr.write(`error: ${e instanceof Error ? e.message : String(e)}\n`);
    return EXIT.GATE; // fail closed on any config/setup error
  }

  const cleanup: string[] = [];
  try {
    // The offline-replay gate client is OPTIONAL: only workflows with a bound gate run id need it.
    // Absent an API key, a gate-bound workflow fails closed to `needs_evidence`, not a hard crash.
    let client: UltraRouter | null = null;
    try {
      client = makeClient(appArgs);
    } catch {
      client = null;
    }
    const deps = makeAppCiDeps({
      client,
      githubApi:
        flagValue(appArgs, 'github-api') ?? process.env.GITHUB_API_URL ?? 'https://api.github.com',
      githubToken: flagValue(appArgs, 'github-token') ?? process.env.GITHUB_TOKEN,
      publish: opts.publish,
      cleanup,
      boundPaths: boundEvidencePaths(configPath, opts.config),
    });
    const result = await runAppCi(deps, opts);
    if (opts.json) {
      process.stdout.write(`${JSON.stringify(result.json, null, 2)}\n`);
    } else {
      const glyph = (c: WorkflowOutcome['conclusion']): string =>
        c === 'success' ? '✓' : c === 'failure' ? '✗' : '‼';
      process.stdout.write(`ultrarouter app-ci — ${opts.repository} @ ${opts.headSha}\n`);
      for (const o of result.outcomes) {
        process.stdout.write(
          `  ${glyph(o.conclusion)} ${o.workflowId}: ${HEADLINE_TEXT[o.headline]} (${o.conclusion})` +
            `${o.reasons.length > 0 ? ` — ${o.reasons.join(', ')}` : ''}\n`,
        );
      }
      process.stdout.write(`  exit ${String(result.exitCode)}\n`);
    }
    return result.exitCode;
  } catch (e) {
    process.stderr.write(`error: ${e instanceof Error ? e.message : String(e)}\n`);
    return EXIT.GATE; // fail closed on any pipeline error
  } finally {
    cleanupWorktrees(cleanup);
  }
}

/** The `ur pack validate <file>` command: real file system + stdio around the injected-IO core. */
function runPackCommand(sub: string | undefined, rest: readonly string[]): number {
  const deps: PackCliDeps = {
    readFile: (p) => readFileSync(p, 'utf8'),
    log: (l) => process.stdout.write(`${l}\n`),
    err: (l) => process.stderr.write(`${l}\n`),
  };
  if (sub !== 'validate') {
    process.stderr.write(
      `error: unknown pack subcommand '${String(sub)}' (expected validate)\n${USAGE}\n`,
    );
    return EXIT.USAGE;
  }
  const file = positionalArgs(rest, new Set([...GLOBAL_VALUED_FLAGS, 'workspace']))[0];
  if (file === undefined) {
    process.stderr.write(`error: ur pack validate <file> requires a file path\n${USAGE}\n`);
    return EXIT.USAGE;
  }
  const workspace = flagValue(rest, 'workspace');
  return runPackValidate(deps, {
    file,
    ...(workspace !== undefined ? { workspace } : {}),
    requireExportConsent: hasFlag(rest, 'require-export-consent'),
    json: hasFlag(rest, 'json'),
  }).exitCode;
}

/** The `ur import <file>` command: parse flags/env → read the file → POST /v1/imports → exit code. */
async function runImportCommand(args: readonly string[]): Promise<number> {
  const format = flagValue(args, 'format');
  if (format === undefined) {
    process.stderr.write(
      `error: --format <adapter> is required (e.g. usage_summary, openai_chat_jsonl)\n${USAGE}\n`,
    );
    return EXIT.USAGE;
  }
  // Skip the value token of every valued flag, so `ur import --format x file.jsonl` reads `file.jsonl`.
  const file = positionalArgs(
    args,
    new Set([...GLOBAL_VALUED_FLAGS, 'format', 'format-version', 'resume', 'mode', 'call-type']),
  )[0];
  const formatVersion = flagValue(args, 'format-version');
  const resumeId = flagValue(args, 'resume');
  const callTypeId = flagValue(args, 'call-type');
  const opts: ImportRunOptions = {
    file,
    format,
    formatVersion,
    preview: hasFlag(args, 'preview') || flagValue(args, 'mode') === 'preview',
    resumeId,
    ...(callTypeId !== undefined ? { callTypeId } : {}),
    json: hasFlag(args, 'json'),
  };
  const result = await runImport(
    {
      client: makeClient(args),
      readFile: (p) => readFileSync(p, 'utf8'),
      log: (l) => process.stdout.write(`${l}\n`),
      err: (l) => process.stderr.write(`${l}\n`),
    },
    opts,
  );
  return result.exitCode;
}

/**
 * Positional (non-flag) args, skipping the VALUE token of any `--flag value` in `valuedFlags`
 * (so `ur context lint a.ts --max-warnings 5` yields `[a.ts]`, never `[a.ts, '5']`, and a global
 * `--base-url <url>` never masquerades as a positional). `--flag=value` carries its own value.
 */
function positionalArgs(argv: readonly string[], valuedFlags: ReadonlySet<string>): string[] {
  const out: string[] = [];
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === undefined) continue;
    if (a.startsWith('--')) {
      const name = a.slice(2).split('=')[0] ?? '';
      if (!a.includes('=') && valuedFlags.has(name)) i += 1; // consume the value token
      continue;
    }
    out.push(a);
  }
  return out;
}

/** Valued flags shared by every command (their VALUE token is never a positional). */
const GLOBAL_VALUED_FLAGS = ['base-url', 'api-key'] as const;

/** Parse the repeatable `--map <target>=<source>` flag into an outcome-field→column map. */
function parseMapFlag(values: readonly string[]): ReadonlyMap<string, string> {
  const map = new Map<string, string>();
  for (const v of values) {
    const eq = v.indexOf('=');
    if (eq > 0) map.set(v.slice(0, eq).trim(), v.slice(eq + 1).trim());
  }
  return map;
}

/** Shared stdout/stderr IO for the read/write CLI flows. */
function stdIo(): { log: (l: string) => void; err: (l: string) => void } {
  return {
    log: (l) => process.stdout.write(`${l}\n`),
    err: (l) => process.stderr.write(`${l}\n`),
  };
}

/** `ur outcomes <import|pending> …` — the outcome-ledger CLI. */
async function runOutcomesCommand(
  sub: string | undefined,
  rest: readonly string[],
): Promise<number> {
  if (sub === 'import') {
    const file = positionalArgs(rest, new Set([...GLOBAL_VALUED_FLAGS, 'format', 'map']))[0];
    const formatRaw = flagValue(rest, 'format');
    if (formatRaw !== undefined && formatRaw !== 'jsonl' && formatRaw !== 'csv') {
      process.stderr.write(`error: --format must be 'jsonl' or 'csv'\n`);
      return EXIT.USAGE;
    }
    const opts: OutcomesImportOptions = {
      file,
      ...(formatRaw !== undefined ? { format: formatRaw } : {}),
      map: parseMapFlag(flagValues(rest, 'map')),
      json: hasFlag(rest, 'json'),
    };
    const result = await runOutcomesImport(
      { client: makeClient(rest), readFile: (p) => readFileSync(p, 'utf8'), ...stdIo() },
      opts,
    );
    return result.exitCode;
  }

  if (sub === 'pending') {
    const stateRaw = flagValue(rest, 'state');
    if (stateRaw !== undefined && stateRaw !== 'pending' && stateRaw !== 'overdue') {
      process.stderr.write(`error: --state must be 'pending' or 'overdue'\n`);
      return EXIT.USAGE;
    }
    const archetype = flagValue(rest, 'archetype');
    const since = flagValue(rest, 'since');
    const limitRaw = flagValue(rest, 'limit');
    const cursor = flagValue(rest, 'cursor');
    const opts: OutcomesPendingOptions = {
      ...(stateRaw !== undefined ? { state: stateRaw } : {}),
      ...(archetype !== undefined ? { archetype } : {}),
      ...(since !== undefined ? { since } : {}),
      ...(limitRaw !== undefined ? { limit: Number(limitRaw) } : {}),
      ...(cursor !== undefined ? { cursor } : {}),
      json: hasFlag(rest, 'json'),
    };
    const result = await runOutcomesPending({ client: makeClient(rest), ...stdIo() }, opts);
    return result.exitCode;
  }

  process.stderr.write(`error: ur outcomes <import|pending>\n${USAGE}\n`);
  return EXIT.USAGE;
}

/** `ur flywheel <status|calibration> …` — the Flywheel read CLI. */
async function runFlywheelReadCommand(
  sub: string | undefined,
  rest: readonly string[],
): Promise<number> {
  const json = hasFlag(rest, 'json');
  const deps = { client: makeClient(rest), ...stdIo() };
  if (sub === 'status') return (await runFlywheelStatus(deps, { json })).exitCode;
  if (sub === 'calibration') return (await runFlywheelCalibration(deps, { json })).exitCode;
  process.stderr.write(`error: ur flywheel <status|calibration>\n${USAGE}\n`);
  return EXIT.USAGE;
}

/** `ur context lint <path…> …` — the advisory prompt-surface scanner. */
function runContextCommand(sub: string | undefined, rest: readonly string[]): number {
  if (sub !== 'lint') {
    process.stderr.write(`error: ur context lint <path...>\n${USAGE}\n`);
    return EXIT.USAGE;
  }
  const maxWarnRaw = flagValue(rest, 'max-warnings');
  const maxPromptRaw = flagValue(rest, 'max-prompt-tokens');
  const opts: ContextLintOptions = {
    paths: positionalArgs(
      rest,
      new Set([...GLOBAL_VALUED_FLAGS, 'max-warnings', 'max-prompt-tokens']),
    ),
    strict: hasFlag(rest, 'strict') || maxWarnRaw !== undefined,
    maxWarnings: maxWarnRaw !== undefined ? Number(maxWarnRaw) : 0,
    ...(maxPromptRaw !== undefined ? { maxPromptTokens: Number(maxPromptRaw) } : {}),
    json: hasFlag(rest, 'json'),
  };
  const result = runContextLint({ readFile: (p) => readFileSync(p, 'utf8'), ...stdIo() }, opts);
  return result.exitCode;
}

async function main(argv: readonly string[]): Promise<number> {
  const [group, sub, ...rest] = argv;

  // `ur --version` / `ur -v` and `ur --help` / `ur -h` / `ur help` (stdout, exit 0).
  if (group === '--version' || group === '-v' || group === 'version') {
    process.stdout.write(`${VERSION}\n`);
    return EXIT.PASS;
  }
  if (group === undefined || group === '--help' || group === '-h' || group === 'help') {
    const out = group === undefined ? process.stderr : process.stdout;
    out.write(
      `ur ${VERSION} — the ultrarouter CLI\n\n${USAGE}\n\nEnvironment: ULTRAROUTER_API_KEY (or UR_API_KEY), ULTRAROUTER_BASE_URL (or UR_BASE_URL).\nExit codes: 0 success/pass, 1 usage error, 2 gate failure or fail-closed error.\nDocs: https://github.com/lucastonon/ultrarouter-sdk-typescript/blob/main/docs/cli.md\n`,
    );
    return group === undefined ? EXIT.USAGE : EXIT.PASS;
  }

  // `ur import <file> --format <adapter> …` — the history importer (drives POST /v1/imports).
  if (group === 'import') {
    return runImportCommand(argv.slice(1));
  }

  // `ur outcomes <import|pending> …` — the outcome-ledger CLI.
  if (group === 'outcomes') {
    return runOutcomesCommand(sub, rest);
  }

  // `ur flywheel <status|calibration> …` — the Flywheel read CLI.
  if (group === 'flywheel') {
    return runFlywheelReadCommand(sub, rest);
  }

  // `ur context lint <path…> …` — the advisory prompt-surface scanner.
  if (group === 'context') {
    return Promise.resolve(runContextCommand(sub, rest));
  }

  // `ur pack <pull|push> …` — the portable `*.ur.md` knowledge-pack CLI.
  if (group === 'pack') {
    return runPackCommand(sub, rest);
  }

  // `ur app-ci [run] --config <path> …` — the application-CI gate + PR check.
  if (group === 'app-ci') {
    const appArgs = sub === 'run' ? rest : argv.slice(1);
    return runAppCiCommand(appArgs);
  }

  // `ur flywheel-pr [run|decision] …` — the candidate → PR|patch → bound evidence.
  if (group === 'flywheel-pr') {
    if (sub === 'decision') return runFlywheelDecisionCommand(rest);
    return runFlywheelPrCommand(sub === 'run' ? rest : argv.slice(1));
  }

  if (group !== 'bench') {
    process.stderr.write(`error: unknown command '${String(group)}'\n${USAGE}\n`);
    return EXIT.USAGE;
  }

  // `ur bench run <suite> …`
  if (sub === 'run') {
    // Every flag and combination is validated BEFORE any capture or network call.
    const parsed = parseBenchRunArgs(rest, defaultRunTag);
    if (!parsed.ok) {
      process.stderr.write(`error: ${parsed.error}\n${USAGE}\n`);
      return EXIT.USAGE;
    }
    const opts: BenchRunOptions = parsed.options;
    const client = makeClient(rest);
    const result = await runBench(
      {
        client,
        spawnCapture,
        log: (l) => process.stdout.write(`${l}\n`),
        err: (l) => process.stderr.write(`${l}\n`),
      },
      opts,
    );
    return result.exitCode;
  }

  // `ur bench baseline <run-id>` — pin a completed run as the suite baseline.
  if (sub === 'baseline') {
    const runId = rest.find((a) => !a.startsWith('--'));
    if (runId === undefined) {
      process.stderr.write(`error: a run id is required\n${USAGE}\n`);
      return EXIT.USAGE;
    }
    try {
      const client = makeClient(rest);
      const pinned = await client.ur.bench.baseline(runId);
      process.stdout.write(`${JSON.stringify(pinned, null, 2)}\n`);
      return EXIT.PASS;
    } catch (e) {
      process.stderr.write(`error: ${e instanceof Error ? e.message : String(e)}\n`);
      return EXIT.GATE; // fail closed
    }
  }

  // `ur bench gate <run-id>` — read a compare run's gate + exit per the verdict.
  if (sub === 'gate') {
    const runId = rest.find((a) => !a.startsWith('--'));
    if (runId === undefined) {
      process.stderr.write(`error: a run id is required\n${USAGE}\n`);
      return EXIT.USAGE;
    }
    const allowInconclusive = hasFlag(rest, 'allow-inconclusive');
    const json = hasFlag(rest, 'json');
    try {
      const client = makeClient(rest);
      const gate = await client.ur.bench.gate(runId);
      const built = buildGateJson({
        suite: gate.call_types[0]?.call_type_id ?? runId,
        runTag: runId,
        benchRunId: gate.bench_run_id,
        baseline: resolveBaseline(gate.baseline_run_id ?? undefined),
        verdict: gate.verdict,
        allowInconclusive,
        gate,
      });
      process.stdout.write(`${json ? JSON.stringify(built, null, 2) : renderGateTable(built)}\n`);
      return exitCodeFor(gate.verdict, allowInconclusive);
    } catch (e) {
      process.stderr.write(`error: ${e instanceof Error ? e.message : String(e)}\n`);
      return EXIT.GATE; // fail closed
    }
  }

  process.stderr.write(
    `error: unknown bench subcommand '${String(sub)}' (expected run|baseline|gate)\n${USAGE}\n`,
  );
  return EXIT.USAGE;
}

main(process.argv.slice(2))
  .then((code) => {
    process.exitCode = code;
  })
  .catch((e: unknown) => {
    process.stderr.write(`fatal: ${e instanceof Error ? e.message : String(e)}\n`);
    process.exitCode = EXIT.GATE; // fail closed
  });
