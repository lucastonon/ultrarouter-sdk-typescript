// Generated file: vendored context runtime. Do not edit by hand.
/**
 * Token-count estimation from character length: about 4 characters per token, a
 * documented, deterministic approximation for when exact token counts are not available.
 *
 * This module is shipped verbatim in the public SDK: keep its comments free of internal
 * references.
 */

/** Characters per token assumed by the estimate. */
export const CHARS_PER_TOKEN_ESTIMATE = 4;

/** Estimate the token count of a character length (ceil(chars / 4), never negative). */
export function estimateTokensFromChars(chars: number): number {
  if (!Number.isFinite(chars) || chars <= 0) return 0;
  return Math.ceil(chars / CHARS_PER_TOKEN_ESTIMATE);
}

/** Estimate the token count of a string via the chars/4 heuristic. */
export function estimateTokensFromText(text: string): number {
  return estimateTokensFromChars(text.length);
}
