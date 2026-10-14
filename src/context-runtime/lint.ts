// Generated file: vendored context runtime. Do not edit by hand.
/**
 * `ur context lint` — the PURE advisory core. Scans prompt-surface
 * source text and returns typed findings; it NEVER modifies a file (the CLI wiring lives
 * elsewhere). Heuristic and deterministic: same input ⇒ same findings, in file order. The
 * findings teach the runtime's discipline — extract oversized inline prompts into
 * modules, never concatenate untrusted values into an instruction, move inline few-shot
 * blocks into exemplar modules.
 */

/** One advisory finding. `line` is 1-based; `severity` is advisory only. */
export interface LintFinding {
  readonly rule: LintRule;
  readonly severity: 'warn' | 'info';
  readonly line: number;
  readonly message: string;
}

export type LintRule = 'oversized_prompt' | 'untrusted_interpolation' | 'inline_exemplars';

/** One file to scan. Content only — the scanner is pure and reads no filesystem. */
export interface LintInput {
  readonly path: string;
  readonly contents: string;
}

export interface LintOptions {
  /** Estimated-token ceiling (chars/4) above which a prompt is flagged. Default 2000. */
  readonly maxPromptTokens?: number;
}

/** Words that mark a string as an instruction/system surface. */
const INSTRUCTION_MARKERS = [
  'you are',
  'your task',
  'always',
  'never',
  'you must',
  'do not',
  'follow these',
  'system prompt',
  "role: 'system'",
  'role: "system"',
];

/** Identifier roots that look like untrusted, caller-supplied content. */
const UNTRUSTED_IDENTIFIER =
  /\b(user|userinput|input|document|documents|retrieved|content|message|messages|query|snippet|context|search|scraped|web)\w*/i;

const INTERPOLATION = /\$\{\s*([A-Za-z_$][\w.$]*)/g;

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function hasInstructionMarker(lower: string): boolean {
  return INSTRUCTION_MARKERS.some((marker) => lower.includes(marker));
}

/**
 * Scan ONE prompt-surface file. Pure, deterministic, non-mutating. Findings are ordered
 * by line then rule so two runs over the same input are byte-identical.
 */
export function lintPromptSurface(
  input: LintInput,
  options: LintOptions = {},
): readonly LintFinding[] {
  const maxPromptTokens = options.maxPromptTokens ?? 2000;
  const findings: LintFinding[] = [];
  const lower = input.contents.toLowerCase();

  if (hasInstructionMarker(lower) && estimateTokens(input.contents) > maxPromptTokens) {
    findings.push({
      rule: 'oversized_prompt',
      severity: 'warn',
      line: 1,
      message: `prompt surface is ~${String(estimateTokens(input.contents))} tokens (> ${String(maxPromptTokens)}); extract stable material into context modules loaded by the runtime`,
    });
  }

  const lines = input.contents.split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    const lowerLine = line.toLowerCase();
    const lineNumber = index + 1;

    if (hasInstructionMarker(lowerLine)) {
      INTERPOLATION.lastIndex = 0;
      let match: RegExpExecArray | null = INTERPOLATION.exec(line);
      while (match !== null) {
        const identifier = match[1] ?? '';
        if (UNTRUSTED_IDENTIFIER.test(identifier)) {
          findings.push({
            rule: 'untrusted_interpolation',
            severity: 'warn',
            line: lineNumber,
            message: `untrusted value \`${identifier}\` interpolated into an instruction surface; keep untrusted content in a fenced reference slot, never an instruction`,
          });
          break;
        }
        match = INTERPOLATION.exec(line);
      }
    }

    if (fewShotMarkerCount(lowerLine) >= 3) {
      findings.push({
        rule: 'inline_exemplars',
        severity: 'info',
        line: lineNumber,
        message:
          'inline few-shot examples detected; move them into exemplar modules the runtime can admit and shed by budget',
      });
    }
  }

  return findings.sort(
    (left, right) => left.line - right.line || left.rule.localeCompare(right.rule),
  );
}

function fewShotMarkerCount(lowerLine: string): number {
  let count = 0;
  for (const marker of ['example', 'q:', 'a:', 'input:', 'output:']) {
    if (lowerLine.includes(marker)) count += 1;
  }
  return count;
}

/** Scan many files in the order given. Convenience over {@link lintPromptSurface}. */
export function lintPromptSurfaces(
  inputs: readonly LintInput[],
  options: LintOptions = {},
): readonly (LintFinding & { readonly path: string })[] {
  return inputs.flatMap((input) =>
    lintPromptSurface(input, options).map((finding) => ({ ...finding, path: input.path })),
  );
}
