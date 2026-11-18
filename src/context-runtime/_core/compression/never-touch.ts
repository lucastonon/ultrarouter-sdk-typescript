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

// ─────────────── linear scanners ───────────────
//
// Three of the patterns were QUADRATIC on adversarial text: they restart at every word boundary of a long run and
// rescan the rest of it (`a.a.a…` for emails, `1.1.1…` for currency words, `a-a-a…` or `----` for mixed ids), and
// every protected message is scanned, so a long run of such text would stall the caller. Each is now a LINEAR scan
// that returns exactly the spans the original regex did (kept below as the reference; the two are checked equal on
// seeded strings).

/** The original patterns, the reference the scanners equal (never run on request text). */
export const NEVER_TOUCH_REFERENCE_PATTERNS = {
  email: /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/gi,
  currencyWord: /\b\d[\d.,]*\s?(?:USD|EUR|BRL|GBP|JPY|reais|d[óo]lares|euros)\b/gi,
  mixedId: /\b(?=[\w-]*\d)(?=[\w-]*[A-Za-z])[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*\b/g,
  // Three more, each replaced below by a linear form that matches exactly what it matches.
  inlineJson: /\{[^{}\n]*:[^{}\n]*\}/g,
  legalCitation:
    /\b(?:section|sec\.|clause|article|art\.|cl[áa]usula|artigo|art[íi]culo)\s*\.?\s*[\dIVXLCDM]+(?:\.\d+)*/gi,
  namedEntity: /\b[A-ZÀ-Ý][A-Za-zÀ-ÿ'’]+(?:\s+[A-ZÀ-Ý][A-Za-zÀ-ÿ'’]+)+\b/g,
} as const;

/**
 * The linear forms of two reference patterns above, used in the table below. Each matches exactly what its reference
 * matches. The third, the named entity, has no linear regex form (even without its trailing `\b` it is quadratic on
 * `A'A'A'…`), so it is the scanner `scanNamedEntities`.
 */
export const NEVER_TOUCH_LINEAR_FORMS = {
  inlineJson: /\{(?=[^{}\n]*:)[^{}\n]*\}/g,
  legalCitation:
    /\b(?:section|sec\.|clause|article|art\.|cl[áa]usula|artigo|art[íi]culo)\s*(?:\.\s*)?[\dIVXLCDM]+(?:\.\d+)*/gi,
} as const;

/** A step counter a test passes in to prove a scan is linear (one step per position visited). */
export interface ScanSteps {
  steps: number;
}

const isWordCode = (c: number): boolean =>
  (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95;
const isDigitCode = (c: number): boolean => c >= 48 && c <= 57;
const isAlnumCode = (c: number): boolean =>
  (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122);
const isLetterCode = (c: number): boolean => (c >= 65 && c <= 90) || (c >= 97 && c <= 122);
/** `\b` at `i` (ASCII `\w`, as in a regex without the `u` flag), over UTF-16 code units like the regex. */
const wordBoundaryAt = (t: string, i: number): boolean =>
  (i > 0 && isWordCode(t.charCodeAt(i - 1))) !== (i < t.length && isWordCode(t.charCodeAt(i)));

/**
 * The ONE email scan, for every email shape (one skeleton, not one per shape). Each shape is `\b` + a greedy local
 * part over a class without `@` + `@` + a domain; shapes differ only in the local class (`isLocal`) and the domain
 * (`domainEnd`). The local run can only end at the `@` closing it, and the domain after that `@` does not depend on
 * where the local part began, so `domainEnd(at)` — the match end of `@<domain>` at `at`, or -1 — is asked once per `@`
 * and memoised here. Linear when `domainEnd` reads only the domain run after its `@` (the runs after different `@`s
 * are disjoint: no domain class holds `@`). PURE.
 */
export function scanEmailShape(
  t: string,
  isLocal: (c: number) => boolean,
  domainEnd: (at: number) => number,
  counter?: ScanSteps,
): [number, number][] {
  const n = t.length;
  if (!t.includes('@')) return [];
  // runEnd[i]: the end of the local-class run starting at i.
  const runEnd = new Int32Array(n + 1);
  runEnd[n] = n;
  for (let i = n - 1; i >= 0; i -= 1)
    runEnd[i] = isLocal(t.charCodeAt(i)) ? (runEnd[i + 1] ?? n) : i;
  if (counter !== undefined) counter.steps += n;
  const memo = new Map<number, number>();
  const domainAt = (at: number): number => {
    const known = memo.get(at);
    if (known !== undefined) return known;
    const end = domainEnd(at);
    memo.set(at, end);
    return end;
  };
  const out: [number, number][] = [];
  for (let p = 0; p < n;) {
    if (counter !== undefined) counter.steps += 1;
    const at = runEnd[p] ?? p;
    if (at > p && at < n && t.charCodeAt(at) === 64 && wordBoundaryAt(t, p)) {
      const end = domainAt(at);
      if (end !== -1) {
        out.push([p, end]);
        p = end;
        continue;
      }
    }
    p += 1;
  }
  return out;
}

/**
 * Emails, as `\b[\w.+-]+@[\w-]+\.[\w.-]+\b` (`scanEmailShape`): the domain is the sticky `@[\w-]+\.[\w.-]+\b` at
 * each `@`, whose first run cannot hold the `.` it needs, so it backtracks over its own run only. Linear. PURE.
 */
export function scanEmails(t: string): [number, number][] {
  const domain = /@[\w-]+\.[\w.-]+\b/iy;
  return scanEmailShape(
    t,
    (c) => isWordCode(c) || c === 46 || c === 43 || c === 45,
    (at) => {
      domain.lastIndex = at;
      const m = domain.exec(t);
      return m === null ? -1 : at + m[0].length;
    },
  );
}

const CURRENCY_WORD = /(?:USD|EUR|BRL|GBP|JPY|reais|d[óo]lares|euros)\b/iy;

/**
 * Currency words after a number, as `\b\d[\d.,]*\s?(?:USD|…)\b`: `[\d.,]*` is greedy and none of its characters is a
 * blank or a letter, so the word can only start where the run ends (after one optional blank); that is decided once
 * per run end. Linear. PURE.
 */
export function scanCurrencyWords(t: string): [number, number][] {
  const n = t.length;
  const isNum = (c: number): boolean => isDigitCode(c) || c === 46 || c === 44;
  const runEnd = new Int32Array(n + 1);
  runEnd[n] = n;
  for (let i = n - 1; i >= 0; i -= 1) runEnd[i] = isNum(t.charCodeAt(i)) ? (runEnd[i + 1] ?? n) : i;
  const wordEnd = new Map<number, number>();
  const wordAt = (e: number): number => {
    const known = wordEnd.get(e);
    if (known !== undefined) return known;
    let end = -1;
    // `\s?` is greedy: one blank first, then (on failure) none.
    if (e < n && /\s/.test(t[e] ?? '')) {
      CURRENCY_WORD.lastIndex = e + 1;
      const m = CURRENCY_WORD.exec(t);
      if (m !== null) end = e + 1 + m[0].length;
    }
    if (end === -1) {
      CURRENCY_WORD.lastIndex = e;
      const m = CURRENCY_WORD.exec(t);
      if (m !== null) end = e + m[0].length;
    }
    wordEnd.set(e, end);
    return end;
  };
  const out: [number, number][] = [];
  for (let p = 0; p < n;) {
    if (isDigitCode(t.charCodeAt(p)) && wordBoundaryAt(t, p)) {
      const end = wordAt(runEnd[p] ?? p);
      if (end !== -1) {
        out.push([p, end]);
        p = end;
        continue;
      }
    }
    p += 1;
  }
  return out;
}

/**
 * Mixed-alnum ids, as `\b(?=[\w-]*\d)(?=[\w-]*[A-Za-z])[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*\b`. The two lookaheads read the
 * [\w-] run from the start, so each is one array lookup (the next digit and the next letter in the run, filled right to
 * left). The body is greedy alnum groups joined by single `-`, filled right to left too; when the closing `\b` fails
 * (an `_` follows), the regex backs off to the last `-` inside the body, which is the only place a `\b` can hold
 * there. Linear. PURE.
 */
export function scanMixedIds(t: string): [number, number][] {
  const n = t.length;
  const inRun = (c: number): boolean => isWordCode(c) || c === 45;
  const nextDigit = new Int32Array(n + 1).fill(-1);
  const nextLetter = new Int32Array(n + 1).fill(-1);
  const bodyEnd = new Int32Array(n + 2);
  const lastDash = new Int32Array(n + 1).fill(-1); // the last `-` before i
  for (let i = n - 1; i >= 0; i -= 1) {
    const c = t.charCodeAt(i);
    if (inRun(c)) {
      nextDigit[i] = isDigitCode(c) ? i : (nextDigit[i + 1] ?? -1);
      nextLetter[i] = isLetterCode(c) ? i : (nextLetter[i + 1] ?? -1);
    }
    if (isAlnumCode(c)) {
      const c1 = i + 1 < n ? t.charCodeAt(i + 1) : -1;
      const c2 = i + 2 < n ? t.charCodeAt(i + 2) : -1;
      if (isAlnumCode(c1)) bodyEnd[i] = bodyEnd[i + 1] ?? i + 1;
      else if (c1 === 45 && isAlnumCode(c2)) bodyEnd[i] = bodyEnd[i + 2] ?? i + 1;
      else bodyEnd[i] = i + 1;
    }
  }
  for (let i = 1; i <= n; i += 1)
    lastDash[i] = t.charCodeAt(i - 1) === 45 ? i - 1 : (lastDash[i - 1] ?? -1);
  const out: [number, number][] = [];
  for (let p = 0; p < n;) {
    const c = t.charCodeAt(p);
    if (
      isAlnumCode(c) &&
      wordBoundaryAt(t, p) &&
      (nextDigit[p] ?? -1) !== -1 &&
      (nextLetter[p] ?? -1) !== -1
    ) {
      const greedy = bodyEnd[p] ?? p + 1;
      let end = -1;
      if (wordBoundaryAt(t, greedy)) end = greedy;
      else {
        // Back off: a `\b` inside the body holds only before a `-` (alnum then `-`).
        const dash = lastDash[greedy] ?? -1;
        if (dash > p) end = dash;
      }
      if (end !== -1) {
        out.push([p, end]);
        p = end;
        continue;
      }
    }
    p += 1;
  }
  return out;
}

/** `[A-Za-zÀ-ÿ'’]`, a name word's class (UTF-16 code units, no `i` flag: `À-ÿ` is U+00C0–U+00FF, `×` and `÷` included). */
const isNameCode = (c: number): boolean =>
  (c >= 65 && c <= 90) ||
  (c >= 97 && c <= 122) ||
  (c >= 0xc0 && c <= 0xff) ||
  c === 39 ||
  c === 0x2019;
/** `[A-ZÀ-Ý]`, a name word's first character (U+00C0–U+00DD, `×` included). */
const isCapitalCode = (c: number): boolean => (c >= 65 && c <= 90) || (c >= 0xc0 && c <= 0xdd);
/** JavaScript's `\s`: WhiteSpace and LineTerminator (with or without the `u` flag). */
const isBlankCode = (c: number): boolean =>
  (c >= 9 && c <= 13) ||
  c === 32 ||
  c === 0xa0 ||
  c === 0x1680 ||
  (c >= 0x2000 && c <= 0x200a) ||
  c === 0x2028 ||
  c === 0x2029 ||
  c === 0x202f ||
  c === 0x205f ||
  c === 0x3000 ||
  c === 0xfeff;

/**
 * Named entities, as `\b[A-ZÀ-Ý][A-Za-zÀ-ÿ'’]+(?:\s+[A-ZÀ-Ý][A-Za-zÀ-ÿ'’]+)+\b` (the reference's EXACT spans), in
 * linear time. The regex, with or without its trailing `\b`, is quadratic on `A'A'A'…`, `AéAé…`, `A’A’…`,
 * `Ab'Ab'…`: every capital after a non-word letter is a `\b` start that reads to the end of the run and fails (1.3 s at
 * 64,000 characters).
 *
 * How the pattern backtracks: a word is a capital and a run of the class; a word followed by another word must have
 * taken its WHOLE class run (the next character must be a blank) and the whole blank run between them (a capital must
 * follow). So from a start the words are fixed — each word's run, one blank run, the next word — and the only choices
 * are how many further words to take (as many as possible first) and, in the last word taken, where it ends (its
 * whole run first, then shorter, at least two characters): the first of those positions where `\b` holds ends the
 * match. `tail[e]`, for the end `e` of a whole word run, is where `(?:\s+[A-ZÀ-Ý][A-Za-zÀ-ÿ'’]+)*\b` ends from `e` in
 * that order (-1 when nowhere); it depends only on `e`, so it is filled once, right to left, and every start reads it.
 * Each position is visited a bounded number of times. PURE.
 *
 * Coverage: these are the ORIGINAL pattern's spans (equal on 2,000,000 seeded and 5,380,840 exhaustive strings). A
 * form without the trailing `\b` would pin a superset the scanner does not: a word that continues past `\b` into a
 * letter outside `\w` (`Maria José today` pins `Maria Jos`, not `Maria José`; `Zé Sá` pins nothing), about 2.6% of the
 * seeded strings. Widening each word to its whole class run would restore that superset; these spans are kept by
 * choice.
 */
export function scanNamedEntities(t: string, counter?: ScanSteps): [number, number][] {
  const n = t.length;
  // runEnd[i]: the end of the name-class run starting at i; blankEnd[i]: the end of the blank run starting at i.
  const runEnd = new Int32Array(n + 1);
  const blankEnd = new Int32Array(n + 1);
  runEnd[n] = n;
  blankEnd[n] = n;
  for (let i = n - 1; i >= 0; i -= 1) {
    const c = t.charCodeAt(i);
    runEnd[i] = isNameCode(c) ? (runEnd[i + 1] ?? n) : i;
    blankEnd[i] = isBlankCode(c) ? (blankEnd[i + 1] ?? n) : i;
  }
  // lastBoundary[i]: the largest b <= i where `\b` holds, or -1.
  const lastBoundary = new Int32Array(n + 1);
  for (let i = 0; i <= n; i += 1)
    lastBoundary[i] = wordBoundaryAt(t, i) ? i : i > 0 ? (lastBoundary[i - 1] ?? -1) : -1;
  if (counter !== undefined) counter.steps += 2 * n;
  /** A word starts at s: a capital, then at least one more character of the class. */
  const wordAt = (s: number): boolean =>
    s < n && isCapitalCode(t.charCodeAt(s)) && (runEnd[s] ?? s) >= s + 2;
  /** After the whole run ending at e: one blank run, then a word; its start, or -1. */
  const nextWord = (e: number): number => {
    const b = blankEnd[e] ?? e;
    return b > e && wordAt(b) ? b : -1;
  };
  /** Inside the word at s, short of its whole run: the largest end (at least two characters) where `\b` holds. */
  const shorterEnd = (s: number): number => {
    const b = lastBoundary[(runEnd[s] ?? s) - 1] ?? -1;
    return b >= s + 2 ? b : -1;
  };
  const tail = new Int32Array(n + 1);
  for (let e = n; e >= 0; e -= 1) {
    const s = e < n ? nextWord(e) : -1;
    let r = -1;
    if (s !== -1) {
      r = tail[runEnd[s] ?? s] ?? -1;
      if (r === -1) r = shorterEnd(s);
    }
    if (r === -1 && wordBoundaryAt(t, e)) r = e;
    tail[e] = r;
  }
  if (counter !== undefined) counter.steps += n;
  const out: [number, number][] = [];
  for (let p = 0; p < n;) {
    if (counter !== undefined) counter.steps += 1;
    if (wordAt(p) && wordBoundaryAt(t, p)) {
      // At least one more word must follow the first (`(?:…)+`).
      const s = nextWord(runEnd[p] ?? p);
      if (s !== -1) {
        let end = tail[runEnd[s] ?? s] ?? -1;
        if (end === -1) end = shorterEnd(s);
        if (end !== -1) {
          out.push([p, end]);
          p = end;
          continue;
        }
      }
    }
    p += 1;
  }
  return out;
}

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
const PATTERNS: readonly (
  | { readonly category: PinCategory; readonly re: RegExp }
  | { readonly category: PinCategory; readonly scan: (text: string) => readonly [number, number][] }
)[] = [
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
  // `\{[^{}\n]*:[^{}\n]*\}` splits a long run of colons every way before failing (38 ms at 8,000 characters). The
  // same matches: a lookahead finds the colon, then one run must end at the `}`.
  { category: 'structure', re: NEVER_TOUCH_LINEAR_FORMS.inlineJson },
  // URLs (http/https/www) — greedy to the next whitespace/quote/bracket.
  { category: 'url', re: /\b(?:https?:\/\/|www\.)[^\s<>"'`]+/gi },
  // Emails.
  { category: 'email', scan: (t) => scanEmails(t) },
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
  { category: 'currency', scan: (t) => scanCurrencyWords(t) },
  // ISO dates and common numeric dates.
  { category: 'date', re: /\b\d{4}-\d{2}-\d{2}\b/g },
  { category: 'date', re: /\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/g },
  // Legal citations: Section/Clause/Article/the section sign (en) + Cláusula/Artigo/Artículo (pt/es).
  {
    category: 'legal_citation',
    // `\s*\.?\s*` splits a blank run every way; `\s*(?:\.\s*)?` matches the same strings unambiguously.
    re: NEVER_TOUCH_LINEAR_FORMS.legalCitation,
  },
  { category: 'legal_citation', re: /§\s*[\dIVXLCDM]+(?:\.\d+)*/g },
  // Mixed-alnum identifiers (contain BOTH a letter and a digit, len ≥ 4): ORD-4471,
  // SKU123, INV-2024-01. Pinned before bare numbers so the whole id is one span.
  { category: 'id', scan: (t) => scanMixedIds(t) },
  // Bare numbers (integers/decimals with thousands separators).
  { category: 'number', re: /\d+(?:[.,]\d+)*/g },
  // Capitalized multi-word spans (proper nouns / named entities), en/pt/es accents: a linear scanner with the
  // original pattern's exact spans (the regex restarts at every capital of a class run, `A'A'A'…`, and reads the rest
  // of it, with or without its trailing `\b`).
  { category: 'named_entity', scan: (t) => scanNamedEntities(t) },
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
  for (const pattern of PATTERNS) {
    if ('re' in pattern) collect(text, pattern.category, pattern.re, spans);
    else
      for (const [start, end] of pattern.scan(text))
        spans.push({ start, end, category: pattern.category });
  }
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
