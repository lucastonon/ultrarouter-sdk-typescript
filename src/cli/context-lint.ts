/**
 * `ur context lint <path…>` — the CLI wiring of the advisory prompt-surface
 * scanner. It is a thin, non-mutating shell over the context runtime's lint core
 * (`lintPromptSurfaces`), never a parallel lint vocabulary: the rules (`oversized_prompt`,
 * `untrusted_interpolation`, `inline_exemplars`) and their messages come verbatim from the context
 * runtime. The scanner reads file CONTENTS only and NEVER writes a file.
 *
 * Exit-code contract: advisory by default (exit 0 — the findings teach, they do not fail a
 * build). `--strict` (equivalently `--max-warnings 0`) turns `warn`-severity findings into a
 * fail: exit 2 with each flagged surface LISTED when the warn count exceeds the threshold
 * (`info` findings never fail). A read error fails CLOSED (exit 2) — a surface that could not
 * be scanned is never a silent pass; no paths is a usage error (exit 1).
 *
 * IO is INJECTED (`readFile`, `log`/`err`), so the flow is unit-testable with no filesystem.
 */

import { lintPromptSurfaces, type LintFinding, type LintInput } from '../context-runtime/lint.js';

import { EXIT } from './gate.js';

/** The versioned `ur context lint --json` schema tag (bump on any structural change). */
export const CONTEXT_LINT_JSON_SCHEMA = 'ur.context-lint.v1' as const;

/** Resolved `ur context lint` options (parsed from argv). */
export interface ContextLintOptions {
  readonly paths: readonly string[];
  /** `--strict` — fail (exit 2) when `warn` findings exceed `maxWarnings`. */
  readonly strict: boolean;
  /** `--max-warnings <n>` — the `warn`-severity budget under `--strict` (default 0). */
  readonly maxWarnings: number;
  /** `--max-prompt-tokens <n>` — the oversized-prompt ceiling forwarded to the core. */
  readonly maxPromptTokens?: number;
  readonly json: boolean;
}

/** Injected IO for {@link runContextLint}. */
export interface ContextLintDeps {
  readonly readFile: (path: string) => string;
  readonly log: (line: string) => void;
  readonly err: (line: string) => void;
}

/** A finding with its source path (as `lintPromptSurfaces` returns). */
type PathFinding = LintFinding & { readonly path: string };

/** The result of an `ur context lint` invocation. */
export interface ContextLintResult {
  readonly exitCode: number;
  readonly findings: readonly PathFinding[];
}

/**
 * Run `ur context lint`. Read each path → run the context-runtime scanner → print the findings →
 * decide the exit code. Advisory (exit 0) unless `--strict` promotes an over-budget `warn`
 * count to a fail (exit 2, findings listed); a read error is fail-closed (exit 2).
 */
export function runContextLint(deps: ContextLintDeps, opts: ContextLintOptions): ContextLintResult {
  if (opts.paths.length === 0) {
    deps.err('ur context lint: at least one prompt-surface file path is required');
    return { exitCode: EXIT.USAGE, findings: [] };
  }

  const inputs: LintInput[] = [];
  for (const path of opts.paths) {
    let contents: string;
    try {
      contents = deps.readFile(path);
    } catch (e) {
      deps.err(
        `ur context lint: cannot read '${path}': ${e instanceof Error ? e.message : String(e)}`,
      );
      return { exitCode: EXIT.GATE, findings: [] }; // fail closed
    }
    inputs.push({ path, contents });
  }

  const findings = lintPromptSurfaces(
    inputs,
    opts.maxPromptTokens !== undefined ? { maxPromptTokens: opts.maxPromptTokens } : {},
  );
  const warnCount = findings.filter((f) => f.severity === 'warn').length;

  if (opts.json) {
    deps.log(
      JSON.stringify(
        {
          schema: CONTEXT_LINT_JSON_SCHEMA,
          files: opts.paths.length,
          warn_count: warnCount,
          info_count: findings.length - warnCount,
          strict: opts.strict,
          max_warnings: opts.maxWarnings,
          findings: findings.map((f) => ({
            path: f.path,
            line: f.line,
            severity: f.severity,
            rule: f.rule,
            message: f.message,
          })),
        },
        null,
        2,
      ),
    );
  } else {
    deps.log(
      `ultrarouter context lint — ${String(opts.paths.length)} file(s) · ${String(warnCount)} warning(s), ` +
        `${String(findings.length - warnCount)} info`,
    );
    for (const f of findings) {
      deps.log(`  ${f.path}:${String(f.line)}  [${f.severity}] ${f.rule} — ${f.message}`);
    }
    if (findings.length === 0) deps.log('  clean — no prompt-surface findings');
  }

  const failed = opts.strict && warnCount > opts.maxWarnings;
  return { exitCode: failed ? EXIT.GATE : EXIT.PASS, findings };
}

export { EXIT };
