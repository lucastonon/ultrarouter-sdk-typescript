// Generated file: vendored context runtime. Do not edit by hand.
/**
 * Payload segmentation. Pure and IO-free. Parses every request
 * into typed segments BEFORE any transform, using role boundaries, RAG-style
 * delimiters, and few-shot markers (en/pt/es). Only `reference_context` and
 * `history` are marked lossy-eligible; everything else is untouchable.
 * An unparseable request (no message array) yields `unparseable:true` so the
 * gateway stays lossless-only / fail-safe.
 *
 * SDK-provided `ur.segments` hints override the heuristics for the messages
 * they label (see {@link segment}).
 */

import { pinNeverTouchSpans, type PinnedSpan } from './never-touch.js';
import type {
  PromptMessage,
  SegmentableRequest,
  SegmentHint,
  SegmentKind,
  Segments,
  Segment,
} from './segment-types.js';

/** RAG / reference delimiters that mark a user message as `reference_context` (multi-language). */
const RAG_DELIMITERS = [
  '<document',
  '</document',
  '<doc>',
  '</doc>',
  '<context',
  '</context',
  '<source',
  '"""',
  '```json', // a fenced JSON reference block
  '\n---\n',
  '[doc',
  'context:',
  'contexto:',
  'reference:',
  'referência:',
  'referencia:',
  'source:',
  'fonte:',
  'fuente:',
  'begin context',
  '<<<',
  '>>>',
];

/** Few-shot example markers (en/pt/es) at the START of a user message. */
const FEW_SHOT_MARKERS = [
  'example',
  'exemplo',
  'ejemplo',
  'q:',
  'a:',
  'input:',
  'output:',
  'few-shot',
];

/** Whether a user message's text carries a RAG/reference delimiter (⇒ reference_context). */
function hasRagDelimiter(text: string | null): boolean {
  if (text === null) return false;
  const t = text.toLowerCase();
  return RAG_DELIMITERS.some((d) => d !== '' && t.includes(d.toLowerCase()));
}

/** Whether a user message's text STARTS with a few-shot example marker. */
function looksLikeFewShot(text: string | null): boolean {
  if (text === null) return false;
  const t = text.trimStart().toLowerCase();
  return FEW_SHOT_MARKERS.some((m) => t.startsWith(m));
}

/** Extract the string content of a message (null for multi-part / null content). */
function textOf(message: PromptMessage): string | null {
  return typeof message.content === 'string' ? message.content : null;
}

/** Only `reference_context` / `history` are lossy-eligible. */
function eligibleForKind(kind: SegmentKind): boolean {
  return kind === 'reference_context' || kind === 'history';
}

/** Index → SDK-provided segment label; a later hint for the same index wins. */
function hintsByIndex(request: SegmentableRequest): Map<number, SegmentHint> {
  const map = new Map<number, SegmentHint>();
  if (!Array.isArray(request.segments)) return map;
  for (const hint of request.segments) {
    if (hint !== null && typeof hint === 'object' && Number.isInteger(hint.index)) {
      map.set(hint.index, hint);
    }
  }
  return map;
}

/** A UTF-16 high surrogate (the first unit of a code point > U+FFFF). */
function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}
/** A UTF-16 low surrogate (the second unit of a code point > U+FFFF). */
function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
}

/**
 * Whether `pos` is a CODE-POINT boundary in `text`. A position is a boundary unless it
 * falls BETWEEN the two UTF-16 units of a surrogate pair (an astral char / emoji). Splitting mid-pair
 * would emit a lone surrogate — a provider 400 / U+FFFD.
 */
function isCodePointBoundary(text: string, pos: number): boolean {
  if (pos <= 0 || pos >= text.length) return true;
  return !(isHighSurrogate(text.charCodeAt(pos - 1)) && isLowSurrogate(text.charCodeAt(pos)));
}

/**
 * Snap a span boundary OUTWARD TOWARD PROTECTION: to a code-point boundary (never
 * mid-surrogate) AND out of any never-touch pin it lands inside (so a fence/JSON/code block is never cut
 * by a span boundary). `dir = +1` snaps a START forward (the eligible region shrinks, the protected prefix
 * grows); `dir = -1` snaps an END backward (the protected suffix grows). Pins are non-overlapping, so the
 * loop converges; the code-point re-check after a pin snap keeps the result on a whole-char boundary.
 */
function snapOutward(text: string, pos: number, dir: 1 | -1, pins: readonly PinnedSpan[]): number {
  let p = Math.max(0, Math.min(text.length, pos));
  for (let guard = 0; guard < text.length + 2; guard += 1) {
    let moved = false;
    // Code-point boundary: a START moves forward off a low surrogate; an END moves back off a high one.
    if (!isCodePointBoundary(text, p)) {
      p = dir === 1 ? p + 1 : p - 1;
      moved = true;
    }
    // Never-touch pin: a boundary strictly INSIDE a pin snaps to the pin edge in the protection direction.
    for (const pin of pins) {
      if (p > pin.start && p < pin.end) {
        p = dir === 1 ? pin.end : pin.start;
        moved = true;
      }
    }
    if (!moved) break;
  }
  return Math.max(0, Math.min(text.length, p));
}

/** The outcome of parsing a hint's optional span. */
type ParsedSpan =
  | { readonly kind: 'whole' } // no offsets, or a full-coverage span ⇒ a whole-message hint
  | { readonly kind: 'span'; readonly start: number; readonly end: number } // a valid partial span
  | { readonly kind: 'invalid'; readonly reason: string }; // malformed ⇒ FAIL CLOSED (ignore the hint)

/**
 * Parse a hint's optional `[start, end)` span against `text`. FAILS CLOSED: an
 * invalid / inverted / out-of-range / surrogate-or-pin-collapsed span is `invalid` — the caller then
 * IGNORES the hint entirely (the message keeps its HEURISTIC classification, no eligibility widening),
 * never a request failure. A span with NO offsets, or a full-coverage span, is a whole-message
 * hint. A valid partial span is snapped OUTWARD to code-point + pin boundaries before splitting.
 */
function parseHintSpan(
  hint: SegmentHint,
  text: string | null,
  pins: readonly PinnedSpan[],
): ParsedSpan {
  const hasStart = hint.start !== undefined;
  const hasEnd = hint.end !== undefined;
  if (!hasStart && !hasEnd) return { kind: 'whole' };
  if (text === null) return { kind: 'invalid', reason: 'non_string_content' };
  if (hasStart !== hasEnd) return { kind: 'invalid', reason: 'partial_span' };
  const rawStart = hint.start as number;
  const rawEnd = hint.end as number;
  if (!Number.isInteger(rawStart) || !Number.isInteger(rawEnd)) {
    return { kind: 'invalid', reason: 'non_integer' };
  }
  const len = text.length;
  // Out-of-range is NEVER clamped-to-valid — it FAILS CLOSED (no eligibility widening on a bad offset).
  if (rawStart < 0 || rawEnd < 0 || rawStart > len || rawEnd > len) {
    return { kind: 'invalid', reason: 'out_of_range' };
  }
  if (rawStart >= rawEnd) return { kind: 'invalid', reason: 'inverted_or_empty' };
  // Snap OUTWARD (code-point + never-touch pins). A span the snapping collapses (e.g. a fence
  // spanning the whole region) is unsafe ⇒ fail closed.
  const start = snapOutward(text, rawStart, 1, pins);
  const end = snapOutward(text, rawEnd, -1, pins);
  if (start >= end) return { kind: 'invalid', reason: 'collapsed_on_boundary_snap' };
  if (start === 0 && end === len) return { kind: 'whole' };
  return { kind: 'span', start, end };
}

/** Whether a `response_format` value carries an output contract (json_object/json_schema). */
function hasOutputContract(responseFormat: unknown): boolean {
  if (responseFormat === null || typeof responseFormat !== 'object') return false;
  const type = (responseFormat as { type?: unknown }).type;
  return type === 'json_object' || type === 'json_schema';
}

function makeSegment(base: {
  kind: SegmentKind;
  eligible: boolean;
  origin: Segment['origin'];
  messageIndex: number;
  role: string | null;
  text: string | null;
  message: PromptMessage | null;
  protected?: boolean;
  spanStart?: number;
  spanEnd?: number;
}): Segment {
  return {
    kind: base.kind,
    eligible: base.eligible,
    origin: base.origin,
    messageIndex: base.messageIndex,
    role: base.role,
    text: base.text,
    message: base.message,
    protected: base.protected ?? false,
    note: false,
    dropped: false,
    ...(base.spanStart !== undefined ? { spanStart: base.spanStart } : {}),
    ...(base.spanEnd !== undefined ? { spanEnd: base.spanEnd } : {}),
  };
}

/**
 * Split message `i`'s content at a span-hint boundary into ordered sub-segments —
 * a protected `[0, start)` prefix (the message's heuristic kind), the hinted `[start, end)` span (its
 * kind + lossy-eligibility), and a protected `[end, len)` suffix. Everything OUTSIDE the span is
 * protected-by-default (never a model-visible rewrite); only the hinted span is eligibility-classified.
 * The sub-segments carry `spanStart`/`spanEnd` so reassembly re-concatenates them into the
 * original message content.
 */
function splitAtSpan(base: {
  heuristicKind: SegmentKind;
  hintKind: SegmentKind;
  span: { start: number; end: number };
  messageIndex: number;
  role: string | null;
  text: string;
  message: PromptMessage;
}): Segment[] {
  const { start, end } = base.span;
  const out: Segment[] = [];
  if (start > 0) {
    out.push(
      makeSegment({
        kind: base.heuristicKind,
        eligible: false,
        protected: true,
        origin: 'message',
        messageIndex: base.messageIndex,
        role: base.role,
        text: base.text.slice(0, start),
        message: base.message,
        spanStart: 0,
        spanEnd: start,
      }),
    );
  }
  out.push(
    makeSegment({
      kind: base.hintKind,
      eligible: eligibleForKind(base.hintKind),
      origin: 'message',
      messageIndex: base.messageIndex,
      role: base.role,
      text: base.text.slice(start, end),
      message: base.message,
      spanStart: start,
      spanEnd: end,
    }),
  );
  if (end < base.text.length) {
    out.push(
      makeSegment({
        kind: base.heuristicKind,
        eligible: false,
        protected: true,
        origin: 'message',
        messageIndex: base.messageIndex,
        role: base.role,
        text: base.text.slice(end),
        message: base.message,
        spanStart: end,
        spanEnd: base.text.length,
      }),
    );
  }
  return out;
}

/**
 * Segment a request into typed parts. Message classification:
 * system/developer → `system_instructions`; tool → `tool_results`; the LAST user
 * message → `user_question` (the live question, untouchable); an earlier user
 * message → `few_shot_examples` (marker), `reference_context` (RAG delimiter,
 * eligible), else `history` (eligible); assistant turns → `few_shot_examples` when
 * following a few-shot user turn, else `history` (eligible). Top-level `tools` and
 * `response_format` become the untouchable `tool_schemas` / `output_contract`
 * segments (never reassembled).
 *
 * When the request carries `ur.segments` hints, a hint for a message index
 * OVERRIDES the heuristic classification for that message (and its lossy-eligibility
 * follows the hinted kind) — an explicit developer label the segmenter trusts.
 */
export function segment(request: SegmentableRequest): Segments {
  const messages = request.messages;
  if (!Array.isArray(messages)) {
    return { parts: [], unparseable: true };
  }
  const hints = hintsByIndex(request);

  // The live question is the LAST user-role message (untouchable).
  let lastUserIndex = -1;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i]?.role === 'user') {
      lastUserIndex = i;
      break;
    }
  }

  const parts: Segment[] = [];
  const warnings: string[] = [];
  let prevKind: SegmentKind | null = null;
  for (let i = 0; i < messages.length; i += 1) {
    const message = messages[i];
    if (message === undefined) continue;
    const role = typeof message.role === 'string' ? message.role : null;
    const text = textOf(message);

    let kind: SegmentKind;
    let eligible = false;
    if (role === 'system' || role === 'developer') {
      kind = 'system_instructions';
    } else if (role === 'tool') {
      kind = 'tool_results';
    } else if (role === 'assistant') {
      // An assistant reply that follows a few-shot user turn is itself a few-shot example.
      if (prevKind === 'few_shot_examples') {
        kind = 'few_shot_examples';
      } else {
        kind = 'history';
        eligible = true;
      }
    } else if (role === 'user') {
      if (i === lastUserIndex) {
        kind = 'user_question';
      } else if (looksLikeFewShot(text)) {
        kind = 'few_shot_examples';
      } else if (hasRagDelimiter(text)) {
        kind = 'reference_context';
        eligible = true;
      } else {
        kind = 'history';
        eligible = true;
      }
    } else {
      // Unknown role — treat as untouchable history so it round-trips verbatim.
      kind = 'history';
      eligible = false;
    }

    // An explicit `ur.segments` hint refines this message. A span-carrying hint is parsed
    // FAIL-CLOSED: the never-touch pins are computed on the WHOLE message BEFORE slicing, then
    // the span is snapped OUTWARD to code-point + pin boundaries. An INVALID span is IGNORED entirely — the
    // message keeps its HEURISTIC classification (NO eligibility widening) + a structured warn.
    const hint = hints.get(i);
    const heuristicKind = kind;
    const parsed =
      hint !== undefined ? parseHintSpan(hint, text, pinNeverTouchSpans(text ?? '')) : undefined;

    if (hint !== undefined && parsed?.kind === 'invalid') {
      // FAIL CLOSED — do NOT apply the hinted kind/eligibility; keep the heuristic. Content-free warn.
      warnings.push(`segment_hint_ignored:index=${String(i)}:reason=${parsed.reason}`);
      parts.push(
        makeSegment({ kind, eligible, origin: 'message', messageIndex: i, role, text, message }),
      );
    } else if (hint !== undefined && parsed?.kind === 'span' && text !== null) {
      // A valid partial span: apply the hinted kind/eligibility to the span ONLY; protect the rest.
      kind = hint.kind;
      eligible = eligibleForKind(hint.kind);
      for (const sub of splitAtSpan({
        heuristicKind,
        hintKind: hint.kind,
        span: { start: parsed.start, end: parsed.end },
        messageIndex: i,
        role,
        text,
        message,
      })) {
        parts.push(sub);
      }
    } else {
      // No hint, or a whole-message hint (no offsets / full-coverage): apply the kind to the whole message.
      if (hint !== undefined) {
        kind = hint.kind;
        eligible = eligibleForKind(hint.kind);
      }
      parts.push(
        makeSegment({ kind, eligible, origin: 'message', messageIndex: i, role, text, message }),
      );
    }
    prevKind = kind;
  }

  if (Array.isArray(request.tools) && request.tools.length > 0) {
    parts.push(
      makeSegment({
        kind: 'tool_schemas',
        eligible: false,
        origin: 'tools',
        messageIndex: -1,
        role: null,
        text: null,
        message: null,
      }),
    );
  }
  if (hasOutputContract(request.responseFormat)) {
    parts.push(
      makeSegment({
        kind: 'output_contract',
        eligible: false,
        origin: 'response_format',
        messageIndex: -1,
        role: null,
        text: null,
        message: null,
      }),
    );
  }

  return warnings.length > 0
    ? { parts, unparseable: false, warnings }
    : { parts, unparseable: false };
}

/** Test seam: the marker and span-parse helpers, exposed for unit tests. */
export const _segmentInternals = {
  hasRagDelimiter,
  looksLikeFewShot,
  parseHintSpan,
  snapOutward,
  isCodePointBoundary,
};
