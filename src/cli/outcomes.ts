/**
 * `ur outcomes import <jsonl|csv>` + `ur outcomes pending` — the CLI over the outcome ledger.
 * Both are thin shells over the published `ur.outcomes.*` methods: `import` drives `ur.outcomes.batch` (the idempotent direct-backfill route, keyed
 * by target), `pending` drives `ur.outcomes.pending`. NO second HTTP client and NO
 * re-implemented retry/idempotency — the idempotency is the server's, keyed on
 * `source_event_id`, so a re-import of the same file is all duplicates (re-runs are free).
 * When a row omits `source_event_id` the CLI derives a DETERMINISTIC one from
 * the row's content (FNV-1a — never `Math.random`), so idempotency holds without the caller
 * threading ids by hand.
 *
 * Provenance is the SERVER's: the surface only ever sends the closed set of
 * KNOWN `BatchOutcomeInput` fields, so a stray `source` / `learning_use` / `producer` column
 * in the file is DROPPED, never forwarded — the CLI cannot manufacture provenance. Bodies are
 * never sent by this path — outcome values are typed numeric/diff-stats only.
 *
 * IO is INJECTED (`client`, `readFile`, `log`/`err`) so both flows are unit-testable with no
 * process/network. Exit-code contract (the CLI's contract): 0 on full success (every row
 * accepted/duplicate); 2 on a PARTIAL REJECTION with the rejected rows LISTED (client-side
 * parse errors + server `rejected`/`conflict` rows); 2 fail-closed on a read/API error; 1 on
 * a usage error (no file).
 */

import type { UltraRouter } from '../client.js';
import { UltraRouterError } from '../errors.js';
import type {
  BatchOutcomeInput,
  BatchOutcomesResponse,
  PendingClaimsResponse,
  PendingOutcomesQuery,
} from '../outcomes.js';

import { EXIT } from './gate.js';

// ─── outcome-input vocabulary (mirrors the generated BatchOutcomeInput schema) ──────────────

/** The closed batch outcome channel vocabulary (the generated schema). */
const OUTCOME_CHANNELS: ReadonlySet<string> = new Set([
  'mechanical',
  'correction',
  'behavioral',
  'resolution',
  'computable',
  'proxy',
]);

/**
 * The KNOWN `BatchOutcomeInput` fields the CLI will forward. Anything NOT in this set is
 * dropped from an imported row — critically `source` / `producer` / `learning_use` /
 * `latency_class`, which are the server's to assign, can never be smuggled in.
 */
const STRING_FIELDS = [
  'kind',
  'request_id',
  'artifact_id',
  'artifact_key',
  'claim_id',
  'claim_key',
  'alternative_id',
  'evidence_hash',
  'observed_at',
  'source_event_id',
  'supersedes_event_id',
  'tool_error_class',
] as const;

/** A parse/validation problem for one source row — a client-side rejection (listed, exit 2). */
export interface OutcomeRowError {
  /** The 1-based source line (JSONL) or record index (CSV, after the header). */
  readonly line: number;
  readonly message: string;
}

/** The result of parsing an import file: the valid rows + the per-row rejections. */
export interface OutcomeParseResult {
  readonly inputs: BatchOutcomeInput[];
  readonly errors: OutcomeRowError[];
}

// ─── CSV (RFC-4180-ish, pure, zero-dep) ─────────────────────────────────────────────────────

/**
 * Parse CSV into rows of string cells. Handles quoted fields with embedded commas, escaped
 * quotes (`""`), and embedded newlines; tolerates both LF and CRLF line endings. Pure and
 * deterministic. Fully-blank lines are dropped (they carry no record).
 */
export function parseCsv(raw: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let sawAny = false; // did this row see any field content or delimiter?
  const push = (): void => {
    row.push(field);
    field = '';
  };
  const endRow = (): void => {
    push();
    // Drop a fully-blank line (a single empty cell and nothing else).
    if (!(row.length === 1 && row[0] === '')) rows.push(row);
    row = [];
    sawAny = false;
  };
  for (let i = 0; i < raw.length; i += 1) {
    const c = raw[i];
    if (inQuotes) {
      if (c === '"') {
        if (raw[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      sawAny = true;
    } else if (c === ',') {
      push();
      sawAny = true;
    } else if (c === '\n') {
      endRow();
    } else if (c === '\r') {
      // swallow; a following \n closes the row (CRLF), else a lone CR closes it
      if (raw[i + 1] !== '\n') endRow();
    } else {
      field += c;
      sawAny = true;
    }
  }
  if (sawAny || field !== '' || row.length > 0) endRow();
  return rows;
}

// ─── row → BatchOutcomeInput ────────────────────────────────────────────────────────────────

/** FNV-1a (64-bit) hex of a UTF-8 string — a deterministic content id (never Math.random). */
function fnv1a64Hex(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const mask = (1n << 64n) - 1n;
  for (const b of bytes) {
    hash = ((hash ^ BigInt(b)) * prime) & mask;
  }
  return hash.toString(16).padStart(16, '0');
}

/** Canonical (sorted-key) JSON of a row — the digest input for a derived source_event_id. */
function canonicalRow(value: Record<string, unknown>): string {
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${JSON.stringify(value[k])}`).join(',')}}`;
}

/**
 * Coerce one raw row (a JSONL object, or a CSV record keyed by header) into a
 * `BatchOutcomeInput`, applying `map` (`target ⇐ source`). Only KNOWN fields survive; empty
 * strings are omitted; `artifact_version`/`confidence` coerce to numbers; `value` parses from
 * JSON. Returns a validation error string when `channel`/`kind` are missing or invalid.
 */
export function rowToOutcomeInput(
  raw: Record<string, unknown>,
  map: ReadonlyMap<string, string>,
): { input: BatchOutcomeInput } | { error: string } {
  /** Read a field's raw value, honoring an explicit `--map target=source` remap. */
  const read = (target: string): unknown => {
    const source = map.get(target);
    return source !== undefined ? raw[source] : raw[target];
  };
  const asText = (v: unknown): string | undefined => {
    if (v === undefined || v === null) return undefined;
    const s = typeof v === 'string' ? v : String(v);
    return s === '' ? undefined : s;
  };

  const channel = asText(read('channel'));
  if (channel === undefined) return { error: 'missing `channel`' };
  if (!OUTCOME_CHANNELS.has(channel)) {
    return {
      error: `unknown channel '${channel}' (expected one of ${[...OUTCOME_CHANNELS].join(', ')})`,
    };
  }
  const kind = asText(read('kind'));
  if (kind === undefined) return { error: 'missing `kind`' };

  const out: Record<string, unknown> = { channel, kind };
  for (const field of STRING_FIELDS) {
    if (field === 'kind') continue;
    const text = asText(read(field));
    if (text !== undefined) out[field] = text;
  }
  const version = asText(read('artifact_version'));
  if (version !== undefined) {
    const n = Number(version);
    if (!Number.isInteger(n) || n <= 0)
      return { error: `artifact_version '${version}' is not a positive integer` };
    out.artifact_version = n;
  }
  const confidence = asText(read('confidence'));
  if (confidence !== undefined) {
    const n = Number(confidence);
    if (!Number.isFinite(n) || n <= 0 || n >= 1)
      return { error: `confidence '${confidence}' is not in (0,1)` };
    out.confidence = n;
  }
  const value = read('value');
  if (value !== undefined && value !== null && value !== '') {
    if (typeof value === 'object') out.value = value;
    else {
      try {
        out.value = JSON.parse(String(value));
      } catch {
        return { error: 'value is not valid JSON' };
      }
    }
  }

  // Idempotency (the guarantee): a caller-supplied source_event_id is respected verbatim; an
  // omitted one is DERIVED from the row content so re-importing the same file is all duplicates.
  if (out.source_event_id === undefined) {
    out.source_event_id = `ur-import-${fnv1a64Hex(canonicalRow(out))}`;
  }
  return { input: out as BatchOutcomeInput };
}

/** Parse a JSONL or CSV import file into batch inputs + per-row rejections. */
export function parseOutcomeFile(
  raw: string,
  opts: { format: 'jsonl' | 'csv'; map: ReadonlyMap<string, string> },
): OutcomeParseResult {
  const inputs: BatchOutcomeInput[] = [];
  const errors: OutcomeRowError[] = [];

  if (opts.format === 'csv') {
    const rows = parseCsv(raw);
    const header = rows[0];
    if (header === undefined) return { inputs, errors };
    for (let r = 1; r < rows.length; r += 1) {
      const cells = rows[r] ?? [];
      const record: Record<string, unknown> = {};
      for (let c = 0; c < header.length; c += 1) record[header[c] ?? `col${String(c)}`] = cells[c];
      const result = rowToOutcomeInput(record, opts.map);
      if ('error' in result) errors.push({ line: r, message: result.error });
      else inputs.push(result.input);
    }
    return { inputs, errors };
  }

  // JSONL — one JSON object per non-empty line.
  const lines = raw.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const line = (lines[i] ?? '').trim();
    if (line === '') continue;
    let obj: unknown;
    try {
      obj = JSON.parse(line);
    } catch (e) {
      errors.push({
        line: i + 1,
        message: `invalid JSON: ${e instanceof Error ? e.message : String(e)}`,
      });
      continue;
    }
    if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) {
      errors.push({ line: i + 1, message: 'each JSONL line must be a JSON object' });
      continue;
    }
    const result = rowToOutcomeInput(obj as Record<string, unknown>, opts.map);
    if ('error' in result) errors.push({ line: i + 1, message: result.error });
    else inputs.push(result.input);
  }
  return { inputs, errors };
}

/** Detect the import format from the file extension (JSON array/JSONL default; `.csv` = CSV). */
export function detectOutcomeFormat(file: string, override: string | undefined): 'jsonl' | 'csv' {
  if (override === 'csv' || override === 'jsonl') return override;
  return /\.csv$/i.test(file) ? 'csv' : 'jsonl';
}

// ─── ur outcomes import ─────────────────────────────────────────────────────────────────────

/** Resolved `ur outcomes import` options (parsed from argv). */
export interface OutcomesImportOptions {
  readonly file: string | undefined;
  /** `--format jsonl|csv` (default: inferred from the file extension). */
  readonly format?: 'jsonl' | 'csv';
  /** `--map target=source` pairs (repeatable) — remap a column/key onto an outcome field. */
  readonly map: ReadonlyMap<string, string>;
  readonly json: boolean;
}

/** Injected IO for a read-only outcome CLI flow (no filesystem). */
export interface OutcomesReadDeps {
  readonly client: UltraRouter;
  readonly log: (line: string) => void;
  readonly err: (line: string) => void;
}

/** Injected IO for `ur outcomes import` (adds the file reader). */
export interface OutcomesImportDeps extends OutcomesReadDeps {
  readonly readFile: (path: string) => string;
}

/** The result of an `ur outcomes import` invocation. */
export interface OutcomesImportResult {
  readonly exitCode: number;
  readonly response?: BatchOutcomesResponse;
  /** Client-side rejections (parse/validation) — surfaced for tests + the exit decision. */
  readonly parseErrors: readonly OutcomeRowError[];
}

/**
 * Run `ur outcomes import`. Read → parse (JSONL/CSV) → `ur.outcomes.batch` → decide the exit
 * code. A PARTIAL REJECTION (any client-side parse error OR any server `rejected`/`conflict`
 * row) is exit 2 with each rejected row LISTED (never summarized away); all accepted/duplicate
 * is exit 0. Fail-closed (exit 2) on a read error or API error.
 */
export async function runOutcomesImport(
  deps: OutcomesImportDeps,
  opts: OutcomesImportOptions,
): Promise<OutcomesImportResult> {
  if (opts.file === undefined) {
    deps.err('ur outcomes import: an import file path is required (<jsonl|csv>)');
    return { exitCode: EXIT.USAGE, parseErrors: [] };
  }

  let raw: string;
  try {
    raw = deps.readFile(opts.file);
  } catch (e) {
    deps.err(`ur outcomes import: cannot read '${opts.file}': ${errMessage(e)}`);
    return { exitCode: EXIT.GATE, parseErrors: [] }; // fail closed
  }

  const format = detectOutcomeFormat(opts.file, opts.format);
  const { inputs, errors } = parseOutcomeFile(raw, { format, map: opts.map });

  if (inputs.length === 0) {
    // Nothing valid to send — list every rejection and fail closed (never a silent success).
    for (const e of errors) deps.err(`  rejected row (line ${String(e.line)}): ${e.message}`);
    deps.err(`ur outcomes import: no valid outcome rows in '${opts.file}' (${format})`);
    return { exitCode: EXIT.GATE, parseErrors: errors };
  }

  let response: BatchOutcomesResponse;
  try {
    response = await deps.client.ur.outcomes.batch(inputs);
  } catch (e) {
    deps.err(`ur outcomes import: ${errMessage(e)}`);
    return { exitCode: EXIT.GATE, parseErrors: errors }; // fail closed on any API error
  }

  const serverRejected = response.data.filter(
    (row) => row.status === 'rejected' || row.status === 'conflict',
  );

  if (opts.json) {
    deps.log(JSON.stringify({ ...response, parse_errors: errors }, null, 2));
  } else {
    deps.log(
      `ultrarouter outcomes import — ${String(inputs.length)} sent · ` +
        `accepted ${String(response.accepted)}  duplicate ${String(response.duplicate)}  ` +
        `conflict ${String(response.conflict)}  rejected ${String(response.rejected)}` +
        (errors.length > 0 ? `  parse-rejected ${String(errors.length)}` : ''),
    );
    for (const e of errors) deps.err(`  rejected row (line ${String(e.line)}): ${e.message}`);
    for (const row of serverRejected) {
      deps.err(
        `  rejected row (${row.key ?? 'unkeyed'}): ${row.status} — ${row.reason ?? 'no reason given'}`,
      );
    }
  }

  // Partial rejection (client parse errors OR server rejected/conflict rows) ⇒ exit 2.
  const partialRejection = errors.length > 0 || serverRejected.length > 0;
  return { exitCode: partialRejection ? EXIT.GATE : EXIT.PASS, response, parseErrors: errors };
}

// ─── ur outcomes pending ────────────────────────────────────────────────────────────────────

/** Resolved `ur outcomes pending` options. */
export interface OutcomesPendingOptions {
  /** `--state pending|overdue` (default: both). */
  readonly state?: 'pending' | 'overdue';
  readonly archetype?: string;
  readonly since?: string;
  readonly limit?: number;
  readonly cursor?: string;
  readonly json: boolean;
}

/** The result of an `ur outcomes pending` invocation. */
export interface OutcomesPendingResult {
  readonly exitCode: number;
  readonly response?: PendingClaimsResponse;
}

/**
 * Run `ur outcomes pending` — list claims awaiting resolution (optionally `--state overdue`).
 * A pure read: exit 0 on success, exit 2 fail-closed on any API error.
 */
export async function runOutcomesPending(
  deps: OutcomesReadDeps,
  opts: OutcomesPendingOptions,
): Promise<OutcomesPendingResult> {
  const query: PendingOutcomesQuery = {
    ...(opts.state !== undefined ? { state: opts.state } : {}),
    ...(opts.archetype !== undefined ? { archetype: opts.archetype } : {}),
    ...(opts.since !== undefined ? { since: opts.since } : {}),
    ...(opts.limit !== undefined ? { limit: opts.limit } : {}),
    ...(opts.cursor !== undefined ? { cursor: opts.cursor } : {}),
  };
  let response: PendingClaimsResponse;
  try {
    response = await deps.client.ur.outcomes.pending(query);
  } catch (e) {
    deps.err(`ur outcomes pending: ${errMessage(e)}`);
    return { exitCode: EXIT.GATE }; // fail closed
  }

  if (opts.json) {
    deps.log(JSON.stringify(response, null, 2));
  } else {
    const label = opts.state ?? 'pending/overdue';
    deps.log(`ultrarouter pending claims (${label}) — ${String(response.data.length)} shown`);
    for (const claim of response.data) {
      deps.log(
        `  ${claim.state.padEnd(8)} ${claim.artifact_key} · ${claim.archetype}/${claim.claim_key} ` +
          `(claim ${claim.id})${claim.resolves_by !== null ? `  resolves_by ${claim.resolves_by}` : ''}`,
      );
    }
    if (response.next_cursor !== null && response.next_cursor !== undefined) {
      deps.log(`  … more: --cursor ${response.next_cursor}`);
    }
  }
  return { exitCode: EXIT.PASS, response };
}

/** A stable message for any thrown value (UltraRouterError carries a code + message). */
function errMessage(e: unknown): string {
  if (e instanceof UltraRouterError) return `${e.code}: ${e.message}`;
  if (e instanceof Error) return e.message;
  return String(e);
}

export { EXIT };
