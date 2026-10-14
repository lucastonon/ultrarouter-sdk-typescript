// Generated file: vendored context runtime. Do not edit by hand.
/**
 * Segmentation types: the typed parts a chat request is parsed into before any
 * transform. Type declarations and constants only — pure, no IO.
 *
 * A message is kept as an opaque record so segmentation and reassembly round-trip the
 * FULL OpenAI message (role, tool_calls, name, multi-part content, provider extras)
 * byte-for-byte; only the string `content` of a segment is ever transformed.
 *
 * This module is shipped verbatim in the public SDK: keep its comments free of internal
 * references.
 */

/**
 * The eight typed segment kinds every request is parsed into before any transform.
 * Only `reference_context` and `history` are ever lossy-eligible; the rest are
 * untouchable. `tool_schemas` / `output_contract` come from the top-level `tools` /
 * `response_format` fields (not a message): they are represented so a labeler can
 * assert them, but never reassembled.
 */
export const SEGMENT_KINDS = [
  'system_instructions',
  'user_question',
  'reference_context',
  'few_shot_examples',
  'tool_schemas',
  'tool_results',
  'history',
  'output_contract',
] as const;

export type SegmentKind = (typeof SEGMENT_KINDS)[number];

/**
 * The message-origin segment kinds an SDK may LABEL explicitly via `ur.segments`.
 * `tool_schemas` / `output_contract` are excluded: they come from the top-level `tools` /
 * `response_format` fields, not a message.
 */
export const HINTABLE_SEGMENT_KINDS = [
  'system_instructions',
  'user_question',
  'reference_context',
  'few_shot_examples',
  'tool_results',
  'history',
] as const;

export type HintableSegmentKind = (typeof HINTABLE_SEGMENT_KINDS)[number];

/**
 * An SDK-provided segment label for one message (`ur.segments` is an INPUT to the
 * segmentation heuristics). When present for a message index it overrides the
 * role/delimiter heuristics for that message; lossy-eligibility follows the hinted kind
 * (only `reference_context` / `history` are eligible).
 */
export interface SegmentHint {
  /** Index into the request `messages` array this label applies to. */
  readonly index: number;
  /** The segment kind the SDK asserts for that message. */
  readonly kind: HintableSegmentKind;
  /**
   * OPTIONAL span start (char offset) within the message content. When BOTH `start` and
   * `end` are present, the hint refines to the SPAN `[start, end)`: the segmenter splits the
   * message at the boundary and applies `kind` (with its lossy-eligibility) to the span
   * ONLY; the regions outside the span are protected by default. Absent ⇒ a whole-message
   * hint.
   */
  readonly start?: number | undefined;
  /** OPTIONAL span end (char offset, exclusive) within the message content. */
  readonly end?: number | undefined;
}

/** Where a segment came from — a chat message, or a top-level request field. */
export type SegmentOrigin = 'message' | 'tools' | 'response_format';

/** An opaque OpenAI-shaped chat message; only string `content` is ever transformed. */
export interface PromptMessage {
  readonly role?: string;
  readonly content?: unknown;
  readonly [key: string]: unknown;
}

/** The request surface segmentation reads (messages + the untouchable top-level fields). */
export interface SegmentableRequest {
  readonly messages: readonly PromptMessage[];
  readonly tools?: readonly unknown[] | undefined;
  readonly responseFormat?: unknown;
  /** SDK-provided per-message segment labels; they override the heuristics when present. */
  readonly segments?: readonly SegmentHint[] | undefined;
}

/**
 * One typed segment. `message`/`messageIndex` carry provenance so a transformed request
 * round-trips back to OpenAI messages; `text` is the extracted string content (null for
 * multi-part / non-string content, which is never transformed). `eligible` marks the two
 * lossy-eligible kinds.
 */
export interface Segment {
  readonly kind: SegmentKind;
  /** Lossy-eligible? Only `reference_context` and `history` are. */
  readonly eligible: boolean;
  readonly origin: SegmentOrigin;
  /** Index into the original `messages` array; -1 for `tools`/`response_format`. */
  readonly messageIndex: number;
  readonly role: string | null;
  /** Extracted string content; null when content is multi-part / null / a non-message. */
  readonly text: string | null;
  /** The original message (round-trip); null for `tools`/`response_format` origins. */
  readonly message: PromptMessage | null;
  /** A `no_compress_fields` protection matched: excluded from dedupe/boilerplate/windowing. */
  readonly protected: boolean;
  /** This is a dedupe reference-note replacement (excluded from further dedupe). */
  readonly note: boolean;
  /** History-windowed away: not reassembled. */
  readonly dropped: boolean;
  /**
   * When a message was SPLIT by a span hint, the `[spanStart, spanEnd)` char range of the
   * ORIGINAL message content this sub-segment covers. Sub-segments of the same
   * `messageIndex` reassemble in order (their `text` re-concatenates to the message
   * content). Undefined for a whole-message segment (the common case: no split).
   */
  readonly spanStart?: number | undefined;
  readonly spanEnd?: number | undefined;
}

/** The result of {@link import('./segment.js').segment}. */
export interface Segments {
  readonly parts: readonly Segment[];
  /** True when the request could not be confidently parsed: lossless-only fail-safe. */
  readonly unparseable: boolean;
  /**
   * Structured, CONTENT-FREE diagnostics for span hints that FAILED CLOSED (an
   * invalid/inverted/out-of-range span was ignored; the message kept its heuristic
   * classification with no eligibility widening). Each entry names the message index and
   * the reason only, never content. Absent/empty ⇒ no ignored hints.
   */
  readonly warnings?: readonly string[];
}
