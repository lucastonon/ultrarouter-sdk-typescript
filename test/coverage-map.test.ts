// The API coverage map (scripts/lib/coverage-map.mjs → docs/api-coverage.md) must stay complete
// and truthful: every published operation is mapped, every mapped method exists on the client, and
// every listed test file exists and exercises that method.
import { existsSync, readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { UltraRouter } from '../src/client.js';
// @ts-expect-error -- plain ESM script without type declarations
import { COVERAGE } from '../scripts/lib/coverage-map.mjs';
// @ts-expect-error -- plain ESM script without type declarations
import { loadSpec } from '../scripts/lib/openapi-validate.mjs';

type Coverage = Record<string, { methods: string[]; tests: string[]; cli?: string }>;
const coverage = COVERAGE as Coverage;
const spec = loadSpec() as { paths: Record<string, Record<string, { operationId?: string }>> };

const operationIds: string[] = [];
for (const item of Object.values(spec.paths)) {
  for (const method of ['get', 'post', 'put', 'patch', 'delete']) {
    const id = item[method]?.operationId;
    if (id !== undefined) operationIds.push(id);
  }
}

const client = new UltraRouter({ apiKey: 'ur_sk_test_coverage', baseURL: 'http://coverage.test' });

function resolve(path: string): unknown {
  let node: unknown = client;
  for (const part of path.split('.')) node = (node as Record<string, unknown> | undefined)?.[part];
  return node;
}

describe('API coverage map', () => {
  it('maps every operation in the published document, and nothing else', () => {
    expect(Object.keys(coverage).sort()).toEqual([...operationIds].sort());
  });

  for (const [opId, entry] of Object.entries(coverage)) {
    for (const method of entry.methods) {
      it(`${opId}: ${method}() exists on the client`, () => {
        expect(typeof resolve(method)).toBe('function');
      });
    }
    for (const test of entry.tests) {
      it(`${opId}: ${test} exists and exercises it`, () => {
        expect(existsSync(new URL(`../${test}`, import.meta.url))).toBe(true);
        const source = readFileSync(new URL(`../${test}`, import.meta.url), 'utf8');
        const needles =
          entry.methods.length > 0
            ? entry.methods.map((m) => m.split('.').slice(-2).join('.'))
            : [opId];
        // A CLI-only operation is exercised when the file drives every word of the command.
        const cliWords = entry.cli?.split(' ').slice(1);
        const hit =
          needles.some((n) => source.includes(n)) ||
          (cliWords !== undefined && cliWords.every((w) => source.includes(w)));
        expect(
          hit,
          `${test} mentions none of ${needles.join(', ')}${cliWords !== undefined ? ` or '${cliWords.join(' ')}'` : ''}`,
        ).toBe(true);
      });
    }
  }
});
