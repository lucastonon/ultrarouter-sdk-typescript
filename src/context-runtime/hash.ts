// Generated file: vendored context runtime. Do not edit by hand.
/**
 * Hashing for the context runtime. The ultrarouter-default profile hashes over the
 * ONE canonical-JSON primitive (`canonicalJson`) and its ONE
 * hex-hash primitive (`sha256Hex`) — never a forked serializer
 * ("never fork a canonical-JSON impl"). Parent profiles
 * declare THEIR OWN serializer on the profile (`manifestEncoder`) for byte parity;
 * this module is only the default path + the shared hex primitive.
 */

import { canonicalJson } from './_core/canonical-json.js';
import { sha256Hex } from './_core/sha256-hex.js';

export { canonicalJson, sha256Hex };

/**
 * The ultrarouter-default content digest: sha256 hex over the canonical JSON
 * of a value. Deterministic and pure — two structurally-equal values digest
 * identically regardless of key order.
 */
export function hashContextValue(value: unknown): string {
  return sha256Hex(canonicalJson(value));
}
