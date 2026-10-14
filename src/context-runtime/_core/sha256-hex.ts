/// <reference types="node" />
// Generated file: vendored context runtime. Do not edit by hand.
import { createHash } from 'node:crypto';

/**
 * SHA-256 hex digest of a UTF-8 string. Deterministic and pure; `node:crypto` gives a
 * synchronous digest (WebCrypto's is asynchronous only).
 *
 * This module is shipped verbatim in the public SDK: keep its comments free of internal
 * references.
 */
export function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}
