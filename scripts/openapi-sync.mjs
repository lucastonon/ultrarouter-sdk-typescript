#!/usr/bin/env node
/**
 * openapi-sync — install a published ultrarouter OpenAPI document as `openapi/openapi.yaml`.
 *
 *   node scripts/openapi-sync.mjs <path-to-openapi.yaml>   # write the synced artifact
 *   node scripts/openapi-sync.mjs --check                   # verify the committed artifact
 *
 * The synced file is EXACTLY a two-line header followed by the byte-identical source document:
 *
 *   # ultrarouter public API specification (OpenAPI). Synced artifact: do not hand-edit.
 *   # spec-sha256: <lowercase hex sha256 of the body bytes that follow this header>
 *
 * `--check` recomputes the digest over the body and fails (exit 1) when the header is missing,
 * malformed, or does not match — so a hand edit to the spec is caught by `npm run check`.
 * After syncing, run `npm run codegen` to regenerate `src/generated/types.ts`.
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TARGET = resolve(ROOT, 'openapi/openapi.yaml');
const HEADER_LINE_1 =
  '# ultrarouter public API specification (OpenAPI). Synced artifact: do not hand-edit.';
const DIGEST_PREFIX = '# spec-sha256: ';

/** Lowercase hex sha256 of a buffer. */
export function sha256Hex(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

/** Build the synced artifact bytes (header + body) for a source document. */
export function withHeader(body) {
  const header = `${HEADER_LINE_1}\n${DIGEST_PREFIX}${sha256Hex(body)}\n`;
  return Buffer.concat([Buffer.from(header, 'utf8'), body]);
}

/**
 * Split a synced artifact into its declared digest and body, or explain why it is malformed.
 * @returns {{ ok: true, digest: string, body: Buffer } | { ok: false, reason: string }}
 */
export function parseSynced(bytes) {
  const first = bytes.indexOf(0x0a);
  const second = first === -1 ? -1 : bytes.indexOf(0x0a, first + 1);
  if (first === -1 || second === -1) return { ok: false, reason: 'missing the two-line header' };
  const line1 = bytes.subarray(0, first).toString('utf8');
  const line2 = bytes.subarray(first + 1, second).toString('utf8');
  if (line1 !== HEADER_LINE_1) return { ok: false, reason: `unexpected header line 1: ${line1}` };
  if (!line2.startsWith(DIGEST_PREFIX))
    return { ok: false, reason: 'header line 2 is not a spec-sha256 line' };
  const digest = line2.slice(DIGEST_PREFIX.length);
  if (!/^[0-9a-f]{64}$/.test(digest))
    return { ok: false, reason: 'spec-sha256 is not 64 lowercase hex chars' };
  return { ok: true, digest, body: bytes.subarray(second + 1) };
}

function main(argv) {
  if (argv[0] === '--check') {
    const parsed = parseSynced(readFileSync(TARGET));
    if (!parsed.ok) {
      console.error(`openapi-sync --check: FAIL — ${parsed.reason}`);
      return 1;
    }
    const actual = sha256Hex(parsed.body);
    if (actual !== parsed.digest) {
      console.error(
        `openapi-sync --check: FAIL — body sha256 ${actual} does not match the header ${parsed.digest}.\n` +
          'The spec was edited by hand. Re-sync it from a published document instead.',
      );
      return 1;
    }
    console.log(`openapi-sync --check: ok (spec-sha256 ${actual})`);
    return 0;
  }
  const source = argv[0];
  if (source === undefined || source.startsWith('-')) {
    console.error('usage: node scripts/openapi-sync.mjs <path-to-openapi.yaml> | --check');
    return 1;
  }
  const body = readFileSync(resolve(source));
  if (body.subarray(0, HEADER_LINE_1.length).toString('utf8') === HEADER_LINE_1) {
    console.error(
      'openapi-sync: the source already carries a synced header; pass the raw document.',
    );
    return 1;
  }
  writeFileSync(TARGET, withHeader(body));
  console.log(
    `openapi-sync: wrote openapi/openapi.yaml (spec-sha256 ${sha256Hex(body)}). Now run: npm run codegen`,
  );
  return 0;
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
