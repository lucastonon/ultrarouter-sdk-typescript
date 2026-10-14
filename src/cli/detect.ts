/**
 * `ur app-ci` — advisory change DETECTION. PURE, no IO. Maps a set of changed
 * repository paths onto the customer-declared workflow bindings and classifies each change by the
 * configured surface kind (prompt / model / tool-schema / retrieval-config / Context module / SOP).
 *
 * Detection is ADVISORY: it decides WHICH workflows a diff touches and whether any
 * changed path is UNMAPPED. An unmapped change is `Needs configuration` — never a passing quality
 * verdict. This module NEVER runs anything, NEVER reaches the network, and NEVER decides quality;
 * the verdict continues to come from the existing gate path (`gate.ts`).
 */

/** The configured application-surface kinds a bound path can carry. */
export type SurfaceKind =
  'prompt' | 'model' | 'tool_schema' | 'retrieval_config' | 'context_module' | 'sop';

/** The closed surface-kind vocabulary (used to validate a config, in declaration order). */
export const SURFACE_KINDS: readonly SurfaceKind[] = [
  'prompt',
  'model',
  'tool_schema',
  'retrieval_config',
  'context_module',
  'sop',
] as const;

/** True iff `v` is a known {@link SurfaceKind}. */
export function isSurfaceKind(v: unknown): v is SurfaceKind {
  return typeof v === 'string' && (SURFACE_KINDS as readonly string[]).includes(v);
}

/** How a workflow's evidence is covered — a raw model-call comparison is labeled as such. */
export type CoverageLabel = 'application' | 'model_call_only';

/** One surface → path-glob binding inside a workflow. */
export interface SurfaceBinding {
  readonly kind: SurfaceKind;
  readonly paths: readonly string[];
}

/**
 * A customer-declared workflow binding. Each changed surface binds to explicit path globs AND a
 * customer-maintained application test command. `coverage` MUST be declared — a raw
 * model-call comparison (`model_call_only`) can never claim application-level coverage; an absent
 * or unknown coverage is a configuration error (fail-closed), not an implicit `application`.
 */
export interface WorkflowBinding {
  readonly id: string;
  readonly objective: string;
  readonly evaluatorVersion: string;
  readonly coverage: CoverageLabel;
  /** The customer-maintained application test/replay command (UNTRUSTED — never interpolated). */
  readonly testCommand: string;
  /** An optional Bench suite whose gate supplies the offline-replay quality verdict. */
  readonly suite?: string | undefined;
  /** An optional pre-computed compare run id to read the gate from (avoids a re-run in CI). */
  readonly gateRunId?: string | undefined;
  readonly surfaces: readonly SurfaceBinding[];
}

/** One classified change: a path that matched a workflow's surface glob. */
export interface MappedChange {
  readonly path: string;
  readonly kind: SurfaceKind;
  readonly workflowId: string;
}

/** The advisory detection result for a diff (PURE). */
export interface DetectionResult {
  readonly changedPaths: readonly string[];
  /** Every (path, kind, workflow) match — a path can map to more than one workflow/surface. */
  readonly mapped: readonly MappedChange[];
  /** Changed paths that matched NO configured surface (⇒ `Needs configuration`). */
  readonly unmapped: readonly string[];
  /** Distinct workflow ids touched by the diff (evaluation is scoped to these). */
  readonly affectedWorkflows: readonly string[];
  /** True iff any changed path is unmapped — advisory `Needs configuration`, never a pass. */
  readonly needsConfiguration: boolean;
}

/**
 * Compile a `.gitignore`-flavoured glob to an anchored RegExp. Supports `**` (across path
 * segments, incl. an optional leading `**\/`), `*` (within a segment), and `?` (one non-slash
 * char); every other character is matched literally. PURE + deterministic.
 */
function globToRegExp(glob: string): RegExp {
  let re = '';
  for (let i = 0; i < glob.length; i += 1) {
    const c = glob[i];
    if (c === undefined) continue;
    if (c === '*') {
      if (glob[i + 1] === '*') {
        if (glob[i + 2] === '/') {
          re += '(?:.*/)?'; // `**/` — zero or more leading segments
          i += 2;
        } else {
          re += '.*'; // `**` — anything, including slashes
          i += 1;
        }
      } else {
        re += '[^/]*'; // `*` — within a single segment
      }
    } else if (c === '?') {
      re += '[^/]';
    } else {
      re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp(`^${re}$`);
}

/** True iff `path` matches any of the globs. PURE. */
export function pathMatchesAny(path: string, globs: readonly string[]): boolean {
  return globs.some((g) => globToRegExp(g).test(path));
}

/**
 * Detect which workflows a diff touches and whether any change is unmapped (PURE).
 *
 * A changed path is MAPPED when it matches a surface glob in any workflow (recording the workflow
 * + surface kind); a path matching NO configured surface is UNMAPPED ⇒ `needsConfiguration` (an
 * advisory `Needs configuration`, never a passing quality verdict). Order is preserved and stable.
 */
export function detectChanges(input: {
  readonly changedPaths: readonly string[];
  readonly workflows: readonly WorkflowBinding[];
}): DetectionResult {
  const mapped: MappedChange[] = [];
  const unmapped: string[] = [];
  const affected = new Set<string>();

  for (const path of input.changedPaths) {
    let matchedAny = false;
    for (const wf of input.workflows) {
      for (const surface of wf.surfaces) {
        if (pathMatchesAny(path, surface.paths)) {
          mapped.push({ path, kind: surface.kind, workflowId: wf.id });
          affected.add(wf.id);
          matchedAny = true;
        }
      }
    }
    if (!matchedAny) unmapped.push(path);
  }

  return {
    changedPaths: input.changedPaths,
    mapped,
    unmapped,
    // Keep the workflow order deterministic (config order), not Set-insertion order.
    affectedWorkflows: input.workflows.map((w) => w.id).filter((id) => affected.has(id)),
    needsConfiguration: unmapped.length > 0,
  };
}

/** The distinct surface kinds a workflow was touched on (for the comment's scope line). PURE. */
export function surfacesForWorkflow(
  detection: DetectionResult,
  workflowId: string,
): readonly SurfaceKind[] {
  const kinds = new Set<SurfaceKind>();
  for (const m of detection.mapped) if (m.workflowId === workflowId) kinds.add(m.kind);
  return SURFACE_KINDS.filter((k) => kinds.has(k));
}
