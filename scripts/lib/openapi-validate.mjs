/**
 * A small OpenAPI 3.0 schema validator for tests: it checks `type`, `nullable`, `enum`, `required`,
 * `properties`, `additionalProperties: false`, `items`, `anyOf` / `oneOf` / `allOf` and `$ref`, which
 * is the subset the published document uses for response shapes. It reports every mismatch with a
 * JSON path. Used to prove the mock gateway answers with schema-valid bodies.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

let cached;
/** The parsed OpenAPI document (`openapi/openapi.yaml`). */
export function loadSpec() {
  if (cached === undefined) {
    const yaml = require('js-yaml');
    cached = yaml.load(readFileSync(join(ROOT, 'openapi', 'openapi.yaml'), 'utf8'));
  }
  return cached;
}

function resolveRef(spec, ref) {
  const parts = ref.replace(/^#\//, '').split('/');
  let node = spec;
  for (const p of parts) node = node?.[p];
  if (node === undefined) throw new Error(`unresolvable $ref ${ref}`);
  return node;
}

function typeOf(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (Number.isInteger(value)) return 'integer';
  return typeof value;
}

/**
 * Validate `value` against `schema`. Returns a list of `path: problem` strings (empty when valid).
 * @param {unknown} value
 * @param {Record<string, unknown>} schema
 * @param {string} [path]
 * @returns {string[]}
 */
export function validate(value, schema, path = '$') {
  const spec = loadSpec();
  if (schema === undefined || schema === null) return [];
  if (typeof schema.$ref === 'string') return validate(value, resolveRef(spec, schema.$ref), path);
  if (value === null) {
    if (schema.nullable === true) return [];
    // A schema that is ONLY `{ nullable: true }` (an "unknown or null" branch) also accepts null.
    if (
      schema.type === undefined &&
      schema.anyOf === undefined &&
      schema.oneOf === undefined &&
      schema.allOf === undefined &&
      schema.properties === undefined
    )
      return [];
    if (Array.isArray(schema.anyOf) && schema.anyOf.some((s) => s?.nullable === true)) return [];
    if (Array.isArray(schema.enum) && schema.enum.includes(null)) return [];
    if (schema.type === undefined && !Array.isArray(schema.anyOf) && !Array.isArray(schema.oneOf))
      return [];
    if (schema.type !== undefined) return [`${path}: is null but not nullable`];
  }
  const errors = [];
  if (Array.isArray(schema.allOf))
    for (const s of schema.allOf) errors.push(...validate(value, s, path));
  for (const key of ['anyOf', 'oneOf']) {
    if (Array.isArray(schema[key])) {
      const ok = schema[key].some((s) => validate(value, s, path).length === 0);
      if (!ok) errors.push(`${path}: matches none of ${key}`);
    }
  }
  if (Array.isArray(schema.enum) && value !== null && !schema.enum.includes(value)) {
    errors.push(`${path}: ${JSON.stringify(value)} is not one of ${JSON.stringify(schema.enum)}`);
  }
  const t = schema.type;
  if (t !== undefined && value !== null && value !== undefined) {
    const actual = typeOf(value);
    const ok = t === actual || (t === 'number' && actual === 'integer');
    if (!ok) {
      errors.push(`${path}: expected ${t}, got ${actual}`);
      return errors;
    }
  }
  if ((t === 'object' || schema.properties !== undefined) && typeOf(value) === 'object') {
    const obj = value;
    for (const req of schema.required ?? []) {
      if (!(req in obj)) errors.push(`${path}: missing required property '${req}'`);
    }
    const props = schema.properties ?? {};
    for (const [k, v] of Object.entries(obj)) {
      if (k in props) errors.push(...validate(v, props[k], `${path}.${k}`));
      else if (schema.additionalProperties === false)
        errors.push(`${path}: unexpected property '${k}'`);
      else if (typeof schema.additionalProperties === 'object')
        errors.push(...validate(v, schema.additionalProperties, `${path}.${k}`));
    }
  }
  if (
    (t === 'array' || schema.items !== undefined) &&
    Array.isArray(value) &&
    schema.items !== undefined
  ) {
    value.forEach((item, i) =>
      errors.push(...validate(item, schema.items, `${path}[${String(i)}]`)),
    );
  }
  return errors;
}

/** The success response schema of an operation (`200` / `201` / `202` JSON), or undefined. */
export function responseSchema(method, pathTemplate, status) {
  const op = loadSpec().paths?.[pathTemplate]?.[method.toLowerCase()];
  if (op === undefined) throw new Error(`no operation ${method} ${pathTemplate} in the spec`);
  const res = op.responses?.[String(status)] ?? op.responses?.default;
  return res?.content?.['application/json']?.schema;
}

/** The JSON request-body schema of an operation, or undefined. */
export function requestSchema(method, pathTemplate) {
  const op = loadSpec().paths?.[pathTemplate]?.[method.toLowerCase()];
  return op?.requestBody?.content?.['application/json']?.schema;
}
