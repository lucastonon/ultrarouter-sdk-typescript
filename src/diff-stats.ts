/**
 * `diffStats(draft, final)`: a pure, deterministic draft-to-final diff summary. It is the client side
 * of recording a human-approved final without corrections consent: instead of a body, the SDK sends
 * these client-computed `diff_stats` and a `final_hash`, and the gateway stores the row as
 * metadata-only. The draft and the final never leave the process; only lengths, an edit ratio, a
 * changed-span count and a content hash do.
 *
 * Zero dependencies and edge-portable (a pure SHA-256 over the UTF-8 bytes). The diff is a character
 * LCS bounded by a common prefix/suffix trim and a cell cap, so it stays fast on large outputs and
 * degrades conservatively (it can only report more change, never less).
 */

/** The client-computed diff statistics sent on the no-consent final path. */
export interface DiffStats {
  /** Normalized character edit ratio ∈ [0,1]. `0` = byte-identical, `1` = no shared content. */
  edit_ratio: number;
  /** The number of maximal contiguous changed character regions (`0` when identical). */
  changed_spans: number;
  /** Raw character lengths of the draft and final. */
  lengths: { draft: number; final: number };
  /** The SHA-256 hex digest of the FINAL content (the metadata-only path stores this verbatim). */
  final_hash: string;
}

/** The largest character LCS table we compute exactly before degrading (keeps `diffStats` bounded). */
const MAX_LCS_CELLS = 4_000_000;

/**
 * Compute the pure diff statistics between a `draft` and its human-approved `final`.
 * Deterministic and side-effect-free. The `final_hash` is a SHA-256 hex digest of the
 * final's UTF-8 bytes; `edit_ratio` and `changed_spans` come from a character-level
 * diff (common prefix/suffix trim, then a bounded LCS over the differing middle).
 */
export function diffStats(draft: string, final: string): DiffStats {
  const lengths = { draft: draft.length, final: final.length };
  const final_hash = sha256Hex(final);
  if (draft === final) {
    return { edit_ratio: 0, changed_spans: 0, lengths, final_hash };
  }

  // Trim the common prefix + suffix (cheap, and the classic diff fast path).
  const prefix = commonPrefixLength(draft, final);
  const suffix = commonSuffixLength(draft, final, prefix);
  const midDraft = draft.slice(prefix, draft.length - suffix);
  const midFinal = final.slice(prefix, final.length - suffix);

  let matchedMiddle: number;
  let middleSpans: number;
  if (midDraft.length === 0 || midFinal.length === 0) {
    // One side is empty in the middle — a single pure insert or delete: one changed span.
    matchedMiddle = 0;
    middleSpans = midDraft.length === 0 && midFinal.length === 0 ? 0 : 1;
  } else if (midDraft.length * midFinal.length <= MAX_LCS_CELLS) {
    const aligned = lcsChangedSpans(midDraft, midFinal);
    matchedMiddle = aligned.matched;
    middleSpans = aligned.spans;
  } else {
    // Degrade conservatively on pathologically large inputs: report the middle as ONE
    // fully-changed span (undercounts matches ⇒ over-reports change, never under-reports).
    matchedMiddle = 0;
    middleSpans = 1;
  }

  const matched = prefix + suffix + matchedMiddle;
  const total = lengths.draft + lengths.final;
  const edit_ratio = total === 0 ? 0 : clamp01((total - 2 * matched) / total);
  return { edit_ratio, changed_spans: middleSpans, lengths, final_hash };
}

/** Clamp a number into [0,1] (guards floating-point drift at the extremes). */
function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/** The length of the longest common leading run of characters. */
function commonPrefixLength(a: string, b: string): number {
  const max = Math.min(a.length, b.length);
  let i = 0;
  while (i < max && a.charCodeAt(i) === b.charCodeAt(i)) i += 1;
  return i;
}

/** The length of the longest common trailing run of characters, disjoint from the prefix. */
function commonSuffixLength(a: string, b: string, prefix: number): number {
  const max = Math.min(a.length, b.length) - prefix;
  let i = 0;
  while (i < max && a.charCodeAt(a.length - 1 - i) === b.charCodeAt(b.length - 1 - i)) i += 1;
  return i;
}

/**
 * A bounded character LCS that returns the matched-character count AND the number of
 * maximal contiguous changed regions (change hunks). Backtracks the DP table so both
 * are exact for inputs within {@link MAX_LCS_CELLS}.
 */
function lcsChangedSpans(a: string, b: string): { matched: number; spans: number } {
  const n = a.length;
  const m = b.length;
  // DP table of LCS lengths (n+1) x (m+1). Uint32 keeps it compact.
  const dp = new Uint32Array((n + 1) * (m + 1));
  const width = m + 1;
  for (let i = n - 1; i >= 0; i -= 1) {
    const ai = a.charCodeAt(i);
    const rowBase = i * width;
    const nextRowBase = (i + 1) * width;
    for (let j = m - 1; j >= 0; j -= 1) {
      dp[rowBase + j] =
        ai === b.charCodeAt(j)
          ? dp[nextRowBase + j + 1]! + 1
          : Math.max(dp[nextRowBase + j]!, dp[rowBase + j + 1]!);
    }
  }
  const matched = dp[0]!;
  // Backtrack the alignment, emitting `true` for a matched char and `false` for a change,
  // counting the number of `false` runs (each a contiguous changed region).
  let i = 0;
  let j = 0;
  let spans = 0;
  let inChange = false;
  while (i < n && j < m) {
    if (a.charCodeAt(i) === b.charCodeAt(j)) {
      inChange = false;
      i += 1;
      j += 1;
    } else {
      if (!inChange) {
        spans += 1;
        inChange = true;
      }
      // Move in the direction the DP says preserves the LCS (delete from `a` or `b`).
      if (dp[(i + 1) * width + j]! >= dp[i * width + j + 1]!) i += 1;
      else j += 1;
    }
  }
  // Any unconsumed tail on either side is one trailing changed region.
  if (i < n || j < m) {
    if (!inChange) spans += 1;
  }
  return { matched, spans };
}

// ─────────────────────────────── SHA-256 (pure, edge-portable) ───────────────────────────────

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

/** SHA-256 hex digest of a string's UTF-8 bytes. Pure; no WebCrypto, no `node:crypto`. */
export function sha256Hex(input: string): string {
  const bytes = new TextEncoder().encode(input);
  const bitLen = bytes.length * 8;
  // Pad: message + 0x80 + zeros + 64-bit big-endian length, to a multiple of 64 bytes.
  const withOne = bytes.length + 1;
  const padded = new Uint8Array(Math.ceil((withOne + 8) / 64) * 64);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  // 64-bit length; JS bit ops are 32-bit, so write the low 32 bits (inputs << 2^32 bytes).
  const dv = new DataView(padded.buffer);
  dv.setUint32(padded.length - 4, bitLen >>> 0);
  dv.setUint32(padded.length - 8, Math.floor(bitLen / 0x100000000));

  const h = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  const w = new Uint32Array(64);
  for (let off = 0; off < padded.length; off += 64) {
    for (let t = 0; t < 16; t += 1) w[t] = dv.getUint32(off + t * 4);
    for (let t = 16; t < 64; t += 1) {
      const w15 = w[t - 15]!;
      const w2 = w[t - 2]!;
      const s0 = rotr(w15, 7) ^ rotr(w15, 18) ^ (w15 >>> 3);
      const s1 = rotr(w2, 17) ^ rotr(w2, 19) ^ (w2 >>> 10);
      w[t] = (w[t - 16]! + s0 + w[t - 7]! + s1) >>> 0;
    }
    let a = h[0]!;
    let b = h[1]!;
    let c = h[2]!;
    let d = h[3]!;
    let e = h[4]!;
    let f = h[5]!;
    let g = h[6]!;
    let hh = h[7]!;
    for (let t = 0; t < 64; t += 1) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (hh + S1 + ch + K[t]! + w[t]!) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) >>> 0;
      hh = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }
    h[0] = (h[0]! + a) >>> 0;
    h[1] = (h[1]! + b) >>> 0;
    h[2] = (h[2]! + c) >>> 0;
    h[3] = (h[3]! + d) >>> 0;
    h[4] = (h[4]! + e) >>> 0;
    h[5] = (h[5]! + f) >>> 0;
    h[6] = (h[6]! + g) >>> 0;
    h[7] = (h[7]! + hh) >>> 0;
  }
  let hex = '';
  for (let i = 0; i < 8; i += 1) hex += h[i]!.toString(16).padStart(8, '0');
  return hex;
}

/** 32-bit right rotate. */
function rotr(x: number, n: number): number {
  return ((x >>> n) | (x << (32 - n))) >>> 0;
}
