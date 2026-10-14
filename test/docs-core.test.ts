// The core guides must stay complete: the errors guide documents every gateway error code, and the
// configuration guide documents every constructor option.
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { GATEWAY_ERROR_CODES } from '../src/errors.js';

const read = (path: string): string => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

/** The property names of `export interface UltraRouterOptions { … }` in src/types.ts. */
function optionNames(): string[] {
  const source = read('src/types.ts');
  const start = source.indexOf('export interface UltraRouterOptions {');
  expect(start).toBeGreaterThan(-1);
  const body = source.slice(start, source.indexOf('\n}\n', start));
  return [...body.matchAll(/^ {2}([A-Za-z]+)\??:/gm)].map((m) => m[1] ?? '');
}

describe('docs/errors.md', () => {
  const doc = read('docs/errors.md');
  for (const code of GATEWAY_ERROR_CODES) {
    it(`documents \`${code}\``, () => {
      expect(doc).toContain(`\`${code}\``);
    });
  }
  it('documents the client-side codes', () => {
    for (const code of ['connection', 'timeout', 'aborted', 'invalid_response', 'http_<status>']) {
      expect(doc).toContain(`\`${code}\``);
    }
  });
});

describe('docs/configuration.md', () => {
  const doc = read('docs/configuration.md');
  const names = optionNames();
  it('finds the options to check', () => {
    expect(names.length).toBeGreaterThanOrEqual(12);
  });
  for (const name of names) {
    it(`documents the \`${name}\` option`, () => {
      expect(doc).toContain(`\`${name}\``);
    });
  }
  it('documents the environment variables', () => {
    for (const v of [
      'ULTRAROUTER_API_KEY',
      'UR_API_KEY',
      'ULTRAROUTER_BASE_URL',
      'UR_BASE_URL',
      'UR_BENCH',
    ]) {
      expect(doc).toContain(v);
    }
  });
});
