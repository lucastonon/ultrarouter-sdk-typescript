/**
 * Canonical JSON keeps a key named `__proto__`. `JSON.parse` turns `{"__proto__": …}` into an OWN
 * property; canonicalization must keep it (sorted among its siblings, at every depth) instead of
 * re-parenting the sorted object and dropping the key — otherwise two different values collapse onto
 * one canonical form and one hash, and implementations in other languages (where `__proto__` is an
 * ordinary key) disagree. The inputs live in `fixtures/canonical-json.json` as JSON text.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { canonicalJson, hashContextValue } from '../../src/context.js';

interface Case {
  readonly name: string;
  readonly value_json: string;
}
const fixture = JSON.parse(
  readFileSync(new URL('./fixtures/canonical-json.json', import.meta.url), 'utf8'),
) as { cases: Case[] };

/** The expected canonical text, built independently: parse, then sort own keys recursively. */
function reference(text: string): string {
  const walk = (v: unknown): string => {
    if (v === null || typeof v !== 'object') return JSON.stringify(v);
    if (Array.isArray(v)) return `[${v.map(walk).join(',')}]`;
    const keys = Object.keys(v).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${walk((v as Record<string, unknown>)[k])}`).join(',')}}`;
  };
  return walk(JSON.parse(text));
}

describe('canonicalJson keeps own __proto__ keys', () => {
  it('has the nested cases', () => {
    expect(fixture.cases.length).toBeGreaterThanOrEqual(8);
  });

  for (const c of fixture.cases) {
    it(c.name, () => {
      const value: unknown = JSON.parse(c.value_json);
      const json = canonicalJson(value);
      expect(json).toBe(reference(c.value_json));
      expect(json).toContain('"__proto__"');
      expect(hashContextValue(value)).toBe(createHash('sha256').update(json, 'utf8').digest('hex'));
    });
  }

  it('pins the exact bytes of the headline case', () => {
    expect(canonicalJson(JSON.parse('{"z":1,"__proto__":2,"a":3}'))).toBe(
      '{"__proto__":2,"a":3,"z":1}',
    );
    expect(canonicalJson(JSON.parse('{"__proto__":{"review":"different"}}'))).not.toBe(
      canonicalJson({}),
    );
  });

  it('values that differ only under __proto__ hash differently', () => {
    const [a, b] = fixture.cases.filter((c) => c.name.startsWith('values differing'));
    expect(hashContextValue(JSON.parse(a!.value_json))).not.toBe(
      hashContextValue(JSON.parse(b!.value_json)),
    );
  });
});
