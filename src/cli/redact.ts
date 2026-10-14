/**
 * Secret redaction for text that leaves the runner: PR comments, Check Run summaries and debug
 * excerpts. Untrusted harness output can carry credentials (an `Authorization` header echoed in a
 * failure message, a cookie jar, a token in a URL); GitHub's log masking does not apply to bodies sent
 * through the API, so they are removed here, before publication.
 *
 * Credential-bearing NAMES are recognised as whole tokens, case-insensitively: `Authorization`,
 * `Proxy-Authorization`, `Cookie`, `Set-Cookie`, every `*-Token` / `*_token`, `*-Secret`, `*-Signature`,
 * `*-Password`, `*-Credential(s)`, `*-Session(-Id)`, `*-JWT`, and the API-key family (`X-API-Key`,
 * `api-key`, `apikey`, `api_key`, `secret_key`, `private_key`, `access_key`, `subscription-key`, …).
 * `max_tokens`, `token_count` or `Content-Type` are not credential names. What is removed depends on
 * the form the name appears in:
 *
 * - a HEADER LINE, `Name: value` (the name unquoted, then a colon): the WHOLE value, to the end of the
 *   line — every `;`-separated cookie pair, every quoted parameter, any authorization scheme;
 * - an ASSIGNMENT or QUERY PARAMETER, `name=value`: that value only (a quoted value whole, an unquoted
 *   one up to the next `&`, `;`, `,`, blank or closing bracket), so `?token=x&page=2` keeps `page=2`;
 * - a QUOTED FIELD, `"name": "value"` (JSON, a Python dict, escaped JSON inside a JSON string): the
 *   value (a quoted string whole; an array or object to the end of the line; a bare value up to the
 *   next `,` `}` `]`);
 * - a CLI FLAG, `--name value` or `--name=value`: the value.
 *
 * Then, wherever they appear: a bare `Bearer` / `Basic` / `Token` / `Digest` credential; known token
 * shapes (ultrarouter, OpenAI, Anthropic, GitHub, npm, PyPI, Slack, AWS, Google, Stripe, Hugging
 * Face, JSON Web Tokens, private-key blocks); the password in `scheme://user:password@host`; email
 * addresses.
 *
 * Quoted values are escape-aware at every nesting level: in JSON serialized into a JSON string (and
 * again), the delimiter is the quote preceded by the same backslash run that opened the value, and an
 * escaped quote inside the value (a longer run) never closes it. A value whose end cannot be found
 * is removed to the end of the line.
 *
 * Pure, deterministic, idempotent (redacting twice gives the same text; a literal `[redacted]` in the
 * input never shields the credential after it) and linear in the input length (line boundaries are
 * computed once; every pattern starts only at a token boundary). Over-redaction is the safe direction.
 */

const REDACTED = '[redacted]';

/** The last segment of a credential-bearing name (the whole name may carry any prefix segments). */
const CREDENTIAL_SEGMENT = [
  String.raw`auth(?:entication|orization)?`,
  String.raw`cookies?`,
  String.raw`(?:api|app|access|auth|client|secret|private|signing|encryption|master|account|subscription|functions|license|session)[-_.]?key`,
  'token',
  'secret',
  String.raw`passw(?:or)?d`,
  'pwd',
  'passphrase',
  'signature',
  String.raw`credentials?`,
  String.raw`[a-z]*sess(?:ion)?[-_]?id`,
  'session',
  'sid',
  'jwt',
].join('|');

/**
 * A whole credential-bearing name: optional leading dashes (a CLI flag), any prefix segments
 * (`x-`, `x-amz-security-`, `client_`), then a credential segment, bounded on both sides so it is a
 * complete token (`max_tokens` and `tokenizer` are not matches).
 */
const CREDENTIAL_NAME = new RegExp(
  String.raw`(?<![A-Za-z0-9_.-])[-_.]*(?:[A-Za-z0-9]+[-_.]+)*(?:${CREDENTIAL_SEGMENT})(?![A-Za-z0-9_.-])`,
  'gi',
);

/** A bare credential with its scheme: any `Bearer` value; a `Basic` / `Token` / `Digest` value that looks encoded. */
const BEARER_CREDENTIAL = /\bBearer\s+[^\s"'<>`]+/gi;
const SCHEME_CREDENTIAL =
  /\b(?:Basic|Token|Digest)\s+(?=[A-Za-z0-9._~+/=-]*[0-9+/=._~-])[A-Za-z0-9._~+/=-]{8,}/gi;

/** Known token shapes. */
const TOKEN_SHAPES: readonly RegExp[] = [
  /\bur_sk_(?:live|test)_[A-Za-z0-9]+/g,
  /\bsk-(?:ant-|proj-|svcacct-|admin-)?[A-Za-z0-9_-]{16,}/g,
  /\bgh[pousr]_[A-Za-z0-9]{20,}/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}/g,
  /\bnpm_[A-Za-z0-9]{20,}/g,
  /\bpypi-[A-Za-z0-9_-]{20,}/g,
  /\bxox[abposr]-[A-Za-z0-9-]+/g,
  /\bxapp-[0-9]+-[A-Za-z0-9-]+/g,
  /\b(?:AKIA|ASIA|AGPA|AIDA|AROA|AIPA|ANPA|ANVA)[0-9A-Z]{16}\b/g,
  /\bAIza[0-9A-Za-z_-]{30,}/g,
  /\b(?:sk|rk|pk)_(?:live|test)_[0-9A-Za-z]{16,}/g,
  /\bhf_[A-Za-z0-9]{20,}/g,
  // Anchored at the start of a token run (not every `-eyJ` inside one), so a long dotless run of
  // look-alikes is scanned once instead of once per occurrence.
  /(?<![A-Za-z0-9_-])eyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g,
];

/**
 * `scheme://user:password@host` → the password. Like {@link EMAIL}, it may only start where its first
 * character class does not continue, so untrusted output cannot make the scan quadratic.
 */
const URL_PASSWORD = /(?<![a-z0-9+.-])([a-z][a-z0-9+.-]*:\/\/[^\s:/@]+):[^\s@/]+@/gi;

/** Email addresses (the local part starts at a boundary of its own character class: linear time). */
const EMAIL = /(?<![A-Za-z0-9._%+-])[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

/**
 * The line boundaries of one text, computed once: `end(from)` is the index of the first `\r` / `\n`
 * at or after `from` (or the text length). A binary search, so redacting many fields on one long line
 * never rescans it.
 */
class LineIndex {
  private readonly breaks: number[] = [];
  readonly length: number;

  constructor(text: string) {
    this.length = text.length;
    for (let i = 0; i < text.length; i += 1) {
      const c = text.charCodeAt(i);
      if (c === 10 || c === 13) this.breaks.push(i);
    }
  }

  end(from: number): number {
    let lo = 0;
    let hi = this.breaks.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if ((this.breaks[mid] ?? Infinity) < from) lo = mid + 1;
      else hi = mid;
    }
    return this.breaks[lo] ?? this.length;
  }
}

/** The quote that opens at `at` — a `"` or `'`, possibly escaped (`\"`, `\\\"`) — or `''`. */
function quoteAt(text: string, at: number): string {
  let i = at;
  while (text[i] === '\\') i += 1;
  return text[i] === '"' || text[i] === "'" ? text.slice(at, i + 1) : '';
}

/** The quote (possibly escaped) that ends right before `at`, or `''`. */
function quoteBefore(text: string, at: number): string {
  const q = text[at - 1];
  if (q !== '"' && q !== "'") return '';
  let i = at - 1;
  while (i > 0 && text[i - 1] === '\\') i -= 1;
  return text.slice(i, at);
}

/**
 * The end (exclusive) of a quoted value opened by `quote` at `start`, and whether its closing
 * delimiter was found. A value opened with `k` backslashes before its quote sits at encoding level
 * `n` (`k = 2^n - 1`: a plain quote, `\"` inside a JSON string, `\\\"` inside a JSON string inside a
 * JSON string, …). At that level a quote preceded by `r` backslashes closes the value exactly when
 * `r ≡ k (mod 2^(n+1))`; any other run is an escaped quote, or an escaped backslash, inside the value.
 * Any other `k`, or no closing quote on the line, ends the value at the end of the line.
 */
function quotedEnd(
  text: string,
  lines: LineIndex,
  start: number,
  quote: string,
): { end: number; closed: boolean } {
  const lineEnd = lines.end(start);
  const k = quote.length - 1;
  const level = Math.log2(k + 1);
  if (!Number.isInteger(level)) return { end: lineEnd, closed: false };
  const modulus = 2 ** (level + 1);
  const q = quote.charAt(k);
  const contentStart = start + quote.length;
  let i = contentStart;
  while (i < lineEnd) {
    const at = text.indexOf(q, i);
    if (at === -1 || at >= lineEnd) break;
    let r = 0;
    while (at - 1 - r >= contentStart && text[at - 1 - r] === '\\') r += 1;
    if (r % modulus === k) return { end: at + 1, closed: true };
    i = at + 1;
  }
  return { end: lineEnd, closed: false };
}

/** The end (exclusive) of a bare value starting at `start`: up to the first `stop` character. */
function bareEnd(text: string, lines: LineIndex, start: number, stop: RegExp): number {
  const end = lines.end(start);
  // A value that is already `[redacted]…` is scanned past its own brackets (idempotence).
  let i = text.startsWith(REDACTED, start) ? start + REDACTED.length : start;
  if (i === start && (text[i] === '[' || text[i] === '{')) return end; // an array or an object
  while (i < end && !stop.test(text[i] ?? '')) i += 1;
  // Trailing blanks are not part of the value.
  while (i > start && (text[i - 1] === ' ' || text[i - 1] === '\t')) i -= 1;
  return i;
}

/** Stops an unquoted assignment / query-parameter value. */
const ASSIGNMENT_STOP = /[\s&;,"'<>)}]/;
/** Stops a bare quoted-field (JSON) value. */
const FIELD_STOP = /[,}\]]/;

/** Where a value starts and ends, and how it is rewritten. */
interface ValueSpan {
  readonly start: number;
  readonly end: number;
  readonly replacement: string;
}

/** A quoted value (rewritten keeping its quotes), or a bare one ending at `stop`. */
function valueSpan(text: string, lines: LineIndex, start: number, stop: RegExp): ValueSpan | null {
  const quote = quoteAt(text, start);
  if (quote !== '') {
    const { end, closed } = quotedEnd(text, lines, start, quote);
    return { start, end, replacement: closed ? `${quote}${REDACTED}${quote}` : REDACTED };
  }
  const end = bareEnd(text, lines, start, stop);
  return end > start ? { start, end, replacement: REDACTED } : null;
}

/** Skip blanks (not line breaks) from `at`. */
function skipBlanks(text: string, at: number): number {
  let i = at;
  while (text[i] === ' ' || text[i] === '\t') i += 1;
  return i;
}

/**
 * The value that belongs to the credential name matched at `start`/`end`, by form (see the module
 * comment), or null when the name is not followed by a value (prose such as "Token budget").
 */
function credentialValue(
  text: string,
  lines: LineIndex,
  start: number,
  end: number,
): ValueSpan | null {
  // A quoted name must close with the same (possibly escaped) quote that opened it.
  const open = quoteBefore(text, start);
  const quotedName = open !== '' && text.startsWith(open, end);
  const afterName = quotedName ? end + open.length : end;
  const sepAt = skipBlanks(text, afterName);
  const sep = text[sepAt];
  const next = text[sepAt + 1];
  const isSeparator =
    (sep === ':' && next !== ':') || (sep === '=' && next !== '=' && next !== '>');
  if (isSeparator) {
    const valueAt = skipBlanks(text, sepAt + 1);
    const lineEnd = lines.end(valueAt);
    if (valueAt >= lineEnd) return null;
    if (quotedName) return valueSpan(text, lines, valueAt, FIELD_STOP);
    if (sep === ':') {
      // A header line: the whole value, to the end of the line.
      return { start: valueAt, end: lineEnd, replacement: REDACTED };
    }
    return valueSpan(text, lines, valueAt, ASSIGNMENT_STOP);
  }
  // A CLI flag followed by its value: `--api-key VALUE`.
  if (text[start] === '-' && sepAt > end && sep !== undefined && /[^\s-]/.test(sep)) {
    const quote = quoteAt(text, sepAt);
    if (quote !== '') return valueSpan(text, lines, sepAt, ASSIGNMENT_STOP);
    let i = sepAt;
    while (i < text.length && !/\s/.test(text[i] ?? '')) i += 1;
    return { start: sepAt, end: i, replacement: REDACTED };
  }
  return null;
}

/** Remove the value of every credential-bearing header, field, assignment and flag. */
function redactCredentialFields(text: string): string {
  const lines = new LineIndex(text);
  let out = '';
  let copied = 0;
  CREDENTIAL_NAME.lastIndex = 0;
  for (;;) {
    const m = CREDENTIAL_NAME.exec(text);
    if (m === null) break;
    const value = credentialValue(text, lines, m.index, m.index + m[0].length);
    if (value === null) continue;
    out += text.slice(copied, value.start) + value.replacement;
    copied = value.end;
    CREDENTIAL_NAME.lastIndex = Math.max(value.end, m.index + m[0].length);
  }
  return out + text.slice(copied);
}

/**
 * Remove every credential from `text` (see the module comment for exactly what). Idempotent:
 * redacting twice gives the same text.
 */
export function redactSecrets(text: string): string {
  let out = redactCredentialFields(text);
  out = out.replace(BEARER_CREDENTIAL, REDACTED);
  out = out.replace(SCHEME_CREDENTIAL, REDACTED);
  for (const re of TOKEN_SHAPES) out = out.replace(re, REDACTED);
  out = out.replace(URL_PASSWORD, `$1:${REDACTED}@`);
  out = out.replace(EMAIL, '[email redacted]');
  return out;
}
