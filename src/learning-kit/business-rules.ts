/**
 * A starter structured-output and business-rule validator: check a model's output against a schema
 * (a zod schema, or a small JSON-Schema subset) and your own rules, and get a `pass` / `fail`
 * verdict with the reasons. Deterministic: a validator always decides, so it never answers
 * `unknown`.
 */

import { evidenceHash } from './verifier.js';

/**
 * Anything with zod's `safeParse` shape. zod itself is not a dependency: pass your own zod schema
 * (or any library with the same method).
 */
export interface SafeParseSchema<T> {
  /** Validate `value`; on failure, `error.issues` lists what is wrong. */
  safeParse(value: unknown):
    | { success: true; data: T }
    | {
        success: false;
        error: { issues: readonly { path: readonly PropertyKey[]; message: string }[] };
      };
}

/**
 * The JSON-Schema subset {@link validateOutput} understands: `type` (`object`, `array`, `string`,
 * `number`, `integer`, `boolean`, `null`, or a list of them), `properties`, `required`,
 * `additionalProperties: false`, `items`, `enum`, `const`, `minimum`, `maximum`, `minLength`,
 * `maxLength`, `pattern`, `minItems` and `maxItems`. Other keywords are ignored.
 */
export interface JsonSchemaLite {
  /** The allowed JSON type or types. */
  type?: string | readonly string[];
  /** Object property schemas. */
  properties?: Readonly<Record<string, JsonSchemaLite>>;
  /** Object properties that must be present. */
  required?: readonly string[];
  /** `false` refuses properties not listed in `properties`. */
  additionalProperties?: boolean;
  /** The schema of every array item. */
  items?: JsonSchemaLite;
  /** The allowed values. */
  enum?: readonly unknown[];
  /** The one allowed value. */
  const?: unknown;
  /** The smallest allowed number. */
  minimum?: number;
  /** The largest allowed number. */
  maximum?: number;
  /** The shortest allowed string. */
  minLength?: number;
  /** The longest allowed string. */
  maxLength?: number;
  /** A regular expression a string must match. */
  pattern?: string;
  /** The fewest allowed array items. */
  minItems?: number;
  /** The most allowed array items. */
  maxItems?: number;
}

/**
 * One business rule over the validated value. `check` returns `true` (or nothing) when the rule
 * holds; `false` or a string (the reason) when it does not.
 */
export interface BusinessRule<T> {
  /** A short name, used as the reason when `check` returns `false`. */
  name: string;
  /** The rule. */
  check: (value: T) => boolean | string | void | null | undefined;
}

/** A validator's verdict: `pass` or `fail`, the reasons, the evidence hash and the parsed value. */
export interface RuleVerdict<T> {
  /** `pass` when the output is valid and every rule holds, else `fail`. */
  verdict: 'pass' | 'fail';
  /** Why it failed (`path: message` for schema problems, the rule name or reason for rules). */
  reasons: string[];
  /** `sha256:<hex>` over the canonical JSON of the parsed value (or the raw text when unparseable). */
  evidenceHash: string;
  /** The parsed (and, with a zod schema, transformed) value, or `undefined` when invalid. */
  value: T | undefined;
}

function typeOf(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'number') return Number.isInteger(value) ? 'integer' : 'number';
  return typeof value;
}

function typeMatches(value: unknown, allowed: string): boolean {
  const actual = typeOf(value);
  return actual === allowed || (allowed === 'number' && actual === 'integer');
}

/** Validate `value` against a {@link JsonSchemaLite}; returns `path: problem` strings. */
export function checkJsonSchemaLite(value: unknown, schema: JsonSchemaLite, path = '$'): string[] {
  const problems: string[] = [];
  if (schema.type !== undefined) {
    const types = typeof schema.type === 'string' ? [schema.type] : schema.type;
    if (!types.some((t) => typeMatches(value, t))) {
      return [`${path}: expected ${types.join(' or ')}, got ${typeOf(value)}`];
    }
  }
  if (schema.const !== undefined && JSON.stringify(value) !== JSON.stringify(schema.const)) {
    problems.push(`${path}: must equal ${JSON.stringify(schema.const)}`);
  }
  if (
    schema.enum !== undefined &&
    !schema.enum.some((v) => JSON.stringify(v) === JSON.stringify(value))
  ) {
    problems.push(
      `${path}: must be one of ${schema.enum.map((v) => JSON.stringify(v)).join(', ')}`,
    );
  }
  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum)
      problems.push(`${path}: must be >= ${String(schema.minimum)}`);
    if (schema.maximum !== undefined && value > schema.maximum)
      problems.push(`${path}: must be <= ${String(schema.maximum)}`);
  }
  if (typeof value === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength)
      problems.push(`${path}: must be at least ${String(schema.minLength)} characters`);
    if (schema.maxLength !== undefined && value.length > schema.maxLength)
      problems.push(`${path}: must be at most ${String(schema.maxLength)} characters`);
    if (schema.pattern !== undefined && !new RegExp(schema.pattern, 'u').test(value))
      problems.push(`${path}: must match ${schema.pattern}`);
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems)
      problems.push(`${path}: must have at least ${String(schema.minItems)} items`);
    if (schema.maxItems !== undefined && value.length > schema.maxItems)
      problems.push(`${path}: must have at most ${String(schema.maxItems)} items`);
    if (schema.items !== undefined) {
      const items = schema.items;
      value.forEach((item, i) =>
        problems.push(...checkJsonSchemaLite(item, items, `${path}[${String(i)}]`)),
      );
    }
  }
  if (typeOf(value) === 'object') {
    const obj = value as Record<string, unknown>;
    for (const key of schema.required ?? []) {
      if (!Object.prototype.hasOwnProperty.call(obj, key))
        problems.push(`${path}.${key}: is required`);
    }
    const props = schema.properties ?? {};
    for (const [key, child] of Object.entries(obj)) {
      const sub = props[key];
      if (sub !== undefined) problems.push(...checkJsonSchemaLite(child, sub, `${path}.${key}`));
      else if (schema.additionalProperties === false)
        problems.push(`${path}.${key}: is not allowed`);
    }
  }
  return problems;
}

function isSafeParseSchema<T>(schema: unknown): schema is SafeParseSchema<T> {
  return (
    typeof schema === 'object' &&
    schema !== null &&
    typeof (schema as { safeParse?: unknown }).safeParse === 'function'
  );
}

/**
 * Validate a structured output and apply business rules. `output` is the model's text (parsed as
 * JSON) or an already-parsed value. Schema problems are checked first; rules run only on a valid
 * value. A rule that throws counts as failed, with the error name as its reason.
 */
export function validateOutput<T = unknown>(
  output: unknown,
  schema: SafeParseSchema<T> | JsonSchemaLite,
  rules: readonly BusinessRule<T>[] = [],
): RuleVerdict<T> {
  let parsed: unknown = output;
  if (typeof output === 'string') {
    try {
      parsed = JSON.parse(output);
    } catch {
      return {
        verdict: 'fail',
        reasons: ['invalid_json'],
        evidenceHash: evidenceHash({ text: output }),
        value: undefined,
      };
    }
  }
  let value: T;
  if (isSafeParseSchema<T>(schema)) {
    const result = schema.safeParse(parsed);
    if (!result.success) {
      const reasons = result.error.issues.map(
        (issue) =>
          `$${issue.path.map((p) => (typeof p === 'number' ? `[${String(p)}]` : `.${String(p)}`)).join('')}: ${issue.message}`,
      );
      return { verdict: 'fail', reasons, evidenceHash: evidenceHash(parsed), value: undefined };
    }
    value = result.data;
  } else {
    const problems = checkJsonSchemaLite(parsed, schema);
    if (problems.length > 0) {
      return {
        verdict: 'fail',
        reasons: problems,
        evidenceHash: evidenceHash(parsed),
        value: undefined,
      };
    }
    value = parsed as T;
  }
  const reasons: string[] = [];
  for (const rule of rules) {
    let outcome: boolean | string | void | null | undefined;
    try {
      outcome = rule.check(value);
    } catch (err) {
      reasons.push(`${rule.name}: ${err instanceof Error ? err.name : 'error'}`);
      continue;
    }
    if (outcome === false) reasons.push(rule.name);
    else if (typeof outcome === 'string') reasons.push(`${rule.name}: ${outcome}`);
  }
  return {
    verdict: reasons.length === 0 ? 'pass' : 'fail',
    reasons,
    evidenceHash: evidenceHash(value),
    value,
  };
}
