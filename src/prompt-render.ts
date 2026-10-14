/**
 * The hosted-prompt render rule: the fail-closed `{{name}}` substitution the gateway applies to a
 * hosted prompt. A caller that fetches the active hosted prompt (with `getPrompt()`) and renders it
 * client-side gets exactly the string the gateway would have sent.
 *
 * The rule mirrors the gateway's implementation and is pinned to it by a shared golden
 * (`test/prompt/render-golden.json`, generated from the gateway's own renderer and kept current by a
 * drift check on the gateway side).
 *
 * Fail-closed: a missing variable declared as required is a named refusal listing the names, never a
 * silent blank (the same `prompt_variables_missing` the gateway returns). {@link renderPrompt} throws
 * {@link PromptVariablesMissingError}; {@link renderHostedPromptResult} returns a result object.
 *
 * Exported from both `@ultrarouter/sdk` and `@ultrarouter/sdk/context`.
 */

/** One DECLARED template variable — a `{{name}}` slot and whether the caller MUST supply it. */
export interface HostedPromptVariable {
  /** The variable name (the `name` in `{{name}}`). */
  readonly name: string;
  /** Whether the caller must supply it. */
  readonly required: boolean;
}

/** A hosted prompt as {@link renderPrompt} needs it — the shape `getPrompt()` / preflight `prompt` returns. */
export interface RenderablePrompt {
  /** The template text with `{{name}}` slots. */
  readonly template: string;
  /** The declared variables. */
  readonly variables: readonly HostedPromptVariable[];
}

/** The result of {@link renderHostedPromptResult}: a rendered instruction, or a NAMED missing-variable refusal. */
export type RenderPromptResult =
  | { readonly ok: true; readonly text: string }
  | { readonly ok: false; readonly missing: readonly string[] };

/** The `{{name}}` token pattern — a name is `[A-Za-z0-9_]+` (no dots/spaces). Byte-equivalent to core. */
const VARIABLE_TOKEN_RE = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g;

/** The stable error code the gateway raises for a missing required hosted-prompt variable. */
export const PROMPT_VARIABLES_MISSING_CODE = 'prompt_variables_missing';

/**
 * A NAMED missing-required-variable refusal (the SDK face of the gateway's `prompt_variables_missing`
 * error). Lists the missing variable names — never a silent blank. `code` matches the gateway.
 */
export class PromptVariablesMissingError extends Error {
  /** Always `prompt_variables_missing`. */
  readonly code: string = PROMPT_VARIABLES_MISSING_CODE;
  /** The missing variable names, sorted. */
  readonly missing: readonly string[];

  /** Create the error from the missing variable names. */

  constructor(missing: readonly string[]) {
    super(`prompt_variables_missing: required variable(s) not supplied: ${missing.join(', ')}`);
    this.name = 'PromptVariablesMissingError';
    this.missing = missing;
  }
}

/**
 * Render a hosted prompt template (pure), returning a result object instead of throwing. It
 * substitutes every `{{name}}` slot with the
 * supplied value (coerced to a string); FAIL-CLOSED with `{ ok:false, missing }` (sorted, de-duped) when
 * any DECLARED-REQUIRED variable is absent/null/undefined. A missing OPTIONAL variable (declared not
 * required, or an undeclared `{{slot}}`) renders as the empty string.
 */
export function renderHostedPromptResult(input: {
  readonly template: string;
  readonly variables: readonly HostedPromptVariable[];
  readonly vars?: Readonly<Record<string, unknown>>;
}): RenderPromptResult {
  const vars = input.vars ?? {};
  const supplied = (name: string): boolean => {
    const value = vars[name];
    return value !== undefined && value !== null;
  };
  const requiredNames = new Set<string>();
  for (const v of input.variables) if (v.required) requiredNames.add(v.name);

  const missing = [...requiredNames].filter((name) => !supplied(name)).sort();
  if (missing.length > 0) return { ok: false, missing };

  const text = input.template.replace(VARIABLE_TOKEN_RE, (_match, name: string) => {
    const value = vars[name];
    return value === undefined || value === null ? '' : String(value);
  });
  return { ok: true, text };
}

/**
 * Render a hosted prompt (the ergonomic API) — returns the substituted instruction string, or THROWS
 * {@link PromptVariablesMissingError} listing the names when a DECLARED-REQUIRED variable is missing
 * (fail-closed, the SAME rule the gateway applies — never a silent blank). `prompt` is the shape
 * {@link import('./client.js').UltraRouter.getPrompt} / preflight `prompt` returns.
 */
export function renderPrompt(
  prompt: RenderablePrompt,
  vars?: Readonly<Record<string, unknown>>,
): string {
  const result = renderHostedPromptResult({
    template: prompt.template,
    variables: prompt.variables,
    ...(vars !== undefined ? { vars } : {}),
  });
  if (!result.ok) throw new PromptVariablesMissingError(result.missing);
  return result.text;
}
