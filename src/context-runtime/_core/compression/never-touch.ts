// Generated file: vendored context runtime. Do not edit by hand.
/**
 * The hard never-touch rule engine. Pure and IO-free. Given a
 * segment's text it returns the character spans that a lossy transform may NEVER
 * remove or alter — the safety floor beneath the extractive pruner. The pruner only
 * ever removes whole low-signal sentences that overlap NO pinned span, so every
 * pinned category survives a lossy pass BYTE-IDENTICAL (proven by the never-touch
 * byte-preservation units).
 *
 * The categories: fenced/inline code, JSON/YAML/table structure, numbers,
 * dates, ISO/UUID ids, URLs, emails, currency amounts, legal citations, and a
 * CONSERVATIVE named-entity heuristic (capitalized multi-word spans + a small
 * gazetteer). The named-entity rule is deliberately heuristic — the design goal is
 * NO pruning inside a pinned span, so OVER-pinning (keeping more than strictly
 * necessary) is the safe direction and is preferred throughout.
 */

/** One protected character span `[start, end)` and the category that pinned it. */
export interface PinnedSpan {
  readonly start: number;
  readonly end: number;
  readonly category: PinCategory;
}

/** The never-touch categories. */
export type PinCategory =
  | 'code_fence'
  | 'code_inline'
  | 'table'
  | 'structure'
  | 'url'
  | 'email'
  | 'uuid'
  | 'currency'
  | 'number'
  | 'id'
  | 'date'
  | 'legal_citation'
  | 'named_entity';

/**
 * A small gazetteer of proper nouns that the capitalized-multi-word heuristic would
 * miss on their own (single-token brand / product names). Deliberately tiny and
 * documented as heuristic — the point is to bias toward pinning, never to be
 * exhaustive. Matched case-insensitively as a whole word.
 */
const GAZETTEER = ['LumaShop', 'ultrarouter', 'OpenRouter'] as const;

/**
 * Each category as a global regex. Order does not matter — all matches are merged.
 * The patterns are intentionally simple/linear (no nested quantifiers) so scanning
 * an 8k-token context stays well inside the 40 ms budget.
 */
const PATTERNS: readonly { readonly category: PinCategory; readonly re: RegExp }[] = [
  // Fenced code block ```…``` (lang tag optional), non-greedy. First so inline code
  // inside a fence is subsumed by the merge.
  { category: 'code_fence', re: /```[\s\S]*?```/g },
  // Inline code `…` (single line).
  { category: 'code_inline', re: /`[^`\n]+`/g },
  // Markdown/ASCII table rows: a line carrying two or more pipe separators.
  { category: 'table', re: /^[^\n]*\|[^\n]*\|[^\n]*$/gm },
  // YAML-ish `key: value` lines (single-token key, non-empty value) + inline JSON
  // objects with a colon. Over-pins some prose `Note: …` lines — the safe direction.
  { category: 'structure', re: /^[ \t]*[A-Za-z_][\w.-]*:[ \t]+\S[^\n]*$/gm },
  { category: 'structure', re: /\{[^{}\n]*:[^{}\n]*\}/g },
  // URLs (http/https/www) — greedy to the next whitespace/quote/bracket.
  { category: 'url', re: /\b(?:https?:\/\/|www\.)[^\s<>"'`]+/gi },
  // Emails.
  { category: 'email', re: /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/gi },
  // UUIDs (RFC-4122 shape).
  {
    category: 'uuid',
    re: /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi,
  },
  // Currency amounts: a symbol/prefix then digits, OR digits then a currency word.
  {
    category: 'currency',
    re: /(?:R\$|US\$|[$€£¥])\s?\d[\d.,]*/g,
  },
  {
    category: 'currency',
    re: /\b\d[\d.,]*\s?(?:USD|EUR|BRL|GBP|JPY|reais|d[óo]lares|euros)\b/gi,
  },
  // ISO dates and common numeric dates.
  { category: 'date', re: /\b\d{4}-\d{2}-\d{2}\b/g },
  { category: 'date', re: /\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/g },
  // Legal citations: Section/Clause/Article/the section sign (en) + Cláusula/Artigo/Artículo (pt/es).
  {
    category: 'legal_citation',
    re: /\b(?:section|sec\.|clause|article|art\.|cl[áa]usula|artigo|art[íi]culo)\s*\.?\s*[\dIVXLCDM]+(?:\.\d+)*/gi,
  },
  { category: 'legal_citation', re: /§\s*[\dIVXLCDM]+(?:\.\d+)*/g },
  // Mixed-alnum identifiers (contain BOTH a letter and a digit, len ≥ 4): ORD-4471,
  // SKU123, INV-2024-01. Pinned before bare numbers so the whole id is one span.
  { category: 'id', re: /\b(?=[\w-]*\d)(?=[\w-]*[A-Za-z])[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*\b/g },
  // Bare numbers (integers/decimals with thousands separators).
  { category: 'number', re: /\d+(?:[.,]\d+)*/g },
  // Capitalized multi-word spans (proper nouns / named entities), en/pt/es accents.
  {
    category: 'named_entity',
    re: /\b[A-ZÀ-Ý][A-Za-zÀ-ÿ'’]+(?:\s+[A-ZÀ-Ý][A-Za-zÀ-ÿ'’]+)+\b/g,
  },
];

/** Whole-word gazetteer regex (case-insensitive), built once. */
const GAZETTEER_RE = new RegExp(
  `\\b(?:${GAZETTEER.map((g) => g.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\b`,
  'gi',
);

/** Collect every raw match span for one pattern (bounded scan; empty matches skipped). */
function collect(text: string, category: PinCategory, re: RegExp, out: PinnedSpan[]): void {
  re.lastIndex = 0;
  for (let m = re.exec(text); m !== null; m = re.exec(text)) {
    if (m[0] === '') {
      re.lastIndex += 1; // never loop forever on a zero-width match
      continue;
    }
    out.push({ start: m.index, end: m.index + m[0].length, category });
  }
}

/** Merge overlapping/adjacent spans into a sorted, non-overlapping list. */
function mergeSpans(spans: PinnedSpan[]): PinnedSpan[] {
  if (spans.length <= 1) return spans;
  spans.sort((a, b) => a.start - b.start || a.end - b.end);
  const merged: PinnedSpan[] = [];
  for (const span of spans) {
    const last = merged[merged.length - 1];
    if (last !== undefined && span.start <= last.end) {
      if (span.end > last.end) {
        // Keep the earlier category label; extend the span.
        merged[merged.length - 1] = { start: last.start, end: span.end, category: last.category };
      }
    } else {
      merged.push(span);
    }
  }
  return merged;
}

/**
 * Compute the never-touch spans for a piece of text. Returns a sorted,
 * merged, non-overlapping list of protected `[start, end)` ranges. A lossy transform
 * must not alter any byte inside these spans; the baseline pruner enforces this by
 * only removing whole sentences that overlap NONE of them.
 */
export function pinNeverTouchSpans(text: string): PinnedSpan[] {
  if (text === '') return [];
  const spans: PinnedSpan[] = [];
  for (const { category, re } of PATTERNS) collect(text, category, re, spans);
  collect(text, 'named_entity', GAZETTEER_RE, spans);
  return mergeSpans(spans);
}

/** Whether a `[start, end)` range overlaps ANY pinned span (byte-preservation test). */
export function overlapsPinnedSpan(
  spans: readonly PinnedSpan[],
  start: number,
  end: number,
): boolean {
  for (const span of spans) {
    if (span.start < end && start < span.end) return true;
  }
  return false;
}
