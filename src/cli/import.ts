/**
 * `ur import <file>` — the history importer. Reads a
 * usage-only export or intact traces from a file (a JSON array of records, or JSONL) and drives
 * the EXISTING `POST /v1/imports` route through the typed client — NO new server surface.
 * `--preview` (or `--mode preview`) returns the capability report with NOTHING stored; the
 * default commits. IO is INJECTED (`client`, `readFile`, `log`/`err`) so the flow is
 * unit-testable with no process/network. Fails CLOSED: any API/pipeline error — or a terminal
 * `failed` import — resolves to exit 2 (a broken import is never a silent success).
 */

import type { UltraRouter } from '../client.js';
import { UltraRouterError } from '../errors.js';
import type { Import } from '../imports.js';

import { EXIT } from './gate.js';

/** The resolved `ur import` options (parsed from argv). */
export interface ImportRunOptions {
  /** The export file path (a JSON array of records, or JSONL). */
  readonly file: string | undefined;
  /** The pinned adapter format id (e.g. `usage_summary`, `openai_chat_jsonl`). */
  readonly format: string;
  /** The pinned adapter version (defaults to the latest for the format). */
  readonly formatVersion: string | undefined;
  /** `--preview` — return the capability report with NOTHING stored (default: commit). */
  readonly preview: boolean;
  /** Resume an existing import id (idempotent per record content hash). */
  readonly resumeId: string | undefined;
  /** Bind the history to a call type (`ct_*` id) so its verdicts can count toward that call type. Intact traces only. */
  readonly callTypeId?: string | undefined;
  readonly json: boolean;
}

/** Injected IO for {@link runImport} (the entry wires the real client + fs; tests inject fakes). */
export interface ImportRunDeps {
  readonly client: UltraRouter;
  /** Read the export file's raw text. */
  readonly readFile: (path: string) => string;
  readonly log: (line: string) => void;
  readonly err: (line: string) => void;
}

/** The result of a `ur import` invocation. */
export interface ImportRunResult {
  readonly exitCode: number;
  /** The created/previewed import (absent on a usage/read error before the POST). */
  readonly import?: Import;
}

/** The upload payload — records (a JSON array) OR JSONL (raw text). */
type ImportPayload = { records: unknown[] } | { jsonl: string };

/**
 * Parse the export file into the import payload. A file whose first non-space character is `[`
 * is a JSON array (sent as `records`); anything else is treated as JSONL (sent as `jsonl`). A
 * malformed JSON array throws — the caller fails closed.
 */
export function parseImportPayload(raw: string): ImportPayload {
  if (raw.trimStart().startsWith('[')) {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error('expected a JSON array of records');
    return { records: parsed };
  }
  return { jsonl: raw };
}

/** Render the capability report as a compact human summary (never a body). */
function renderImport(imp: Import): string {
  const r = imp.report;
  const lines = [
    `ultrarouter import ${imp.id} — ${imp.format}@${imp.format_version} (${imp.import_class})`,
    `  status: ${imp.status}${imp.corrections_consent ? '' : '  (no corrections_consent — usage-only/metadata)'}`,
    `  records: ${String(imp.record_count)}  accepted: ${String(imp.accepted_count)}  ` +
      `duplicate: ${String(imp.duplicate_count)}  rejected: ${String(imp.rejected_count)}  ` +
      `unsupported: ${String(imp.unsupported_count)}`,
  ];
  if (typeof r.class_truth === 'string') lines.push(`  ${r.class_truth}`);
  if (typeof r.bodies_stored === 'number') {
    lines.push(
      `  bodies_stored: ${String(r.bodies_stored)}  replayable: ${String(r.replayable ?? false)}`,
    );
  }
  if (typeof r.spend_micro_usd === 'number') {
    lines.push(`  usage-only spend: $${(r.spend_micro_usd / 1_000_000).toFixed(2)}`);
  }
  return lines.join('\n');
}

/**
 * Run the `ur import` flow. Read the export file → POST /v1/imports (preview or commit)
 * via `client.ur.imports.create` → print the capability report (or `--json`) → exit code.
 * Fail-closed: a read error, an API error, or a terminal `failed` import is exit 2; a usage error
 * (no file) is exit 1.
 */
export async function runImport(
  deps: ImportRunDeps,
  opts: ImportRunOptions,
): Promise<ImportRunResult> {
  if (opts.file === undefined) {
    deps.err('ur import: an export file path is required');
    return { exitCode: EXIT.USAGE };
  }

  let payload: ImportPayload;
  try {
    payload = parseImportPayload(deps.readFile(opts.file));
  } catch (e) {
    deps.err(`ur import: cannot read '${opts.file}': ${errMessage(e)}`);
    return { exitCode: EXIT.GATE }; // fail closed
  }

  try {
    const imp = await deps.client.ur.imports.create({
      format: opts.format,
      ...(opts.formatVersion !== undefined ? { format_version: opts.formatVersion } : {}),
      mode: opts.preview ? 'preview' : 'commit',
      ...(opts.resumeId !== undefined ? { import_id: opts.resumeId } : {}),
      ...(opts.callTypeId !== undefined ? { call_type_id: opts.callTypeId } : {}),
      ...payload,
    });
    deps.log(opts.json ? JSON.stringify(imp, null, 2) : renderImport(imp));
    // A terminal `failed` import is fail-closed (exit 2) — the upload did not complete.
    return { exitCode: imp.status === 'failed' ? EXIT.GATE : EXIT.PASS, import: imp };
  } catch (e) {
    deps.err(`ur import: ${errMessage(e)}`);
    return { exitCode: EXIT.GATE }; // fail closed on any API/pipeline error
  }
}

/** A stable message for any thrown value (UltraRouterError carries a code + message). */
function errMessage(e: unknown): string {
  if (e instanceof UltraRouterError) return `${e.code}: ${e.message}`;
  if (e instanceof Error) return e.message;
  return String(e);
}

export { EXIT };
