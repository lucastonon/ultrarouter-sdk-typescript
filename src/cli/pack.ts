/**
 * The `ur pack validate` command core, with injected IO so it is unit-testable without a process or
 * network. A pack is untrusted data: `validate` parses it and checks the schema, the recomputed
 * digests, the tenant (with `--workspace`) and the export consent (with `--require-export-consent`),
 * printing named refusals. Exit codes: **0** valid, **2** refused or unreadable, **1** usage error.
 */

import { parsePack, validatePack, type PackRefusalCode } from '../pack.js';

/** `ur pack` exit codes. */
export const PACK_EXIT = { OK: 0, USAGE: 1, FAIL: 2 } as const;

/** The injected IO for `ur pack` (the entry supplies the real file system and stdio). */
export interface PackCliDeps {
  /** Read a file as UTF-8 (throws when it cannot be read). */
  readonly readFile: (path: string) => string;
  /** Write a line to stdout. */
  readonly log: (line: string) => void;
  /** Write a line to stderr. */
  readonly err: (line: string) => void;
}

/** Options for `ur pack validate <file>`. */
export interface PackValidateOptions {
  /** The `*.ur.md` file to validate. */
  readonly file: string;
  /** Refuse a pack that belongs to a different workspace. */
  readonly workspace?: string;
  /** Refuse a pack whose consent block does not grant export. */
  readonly requireExportConsent: boolean;
  /** Print a JSON result instead of text. */
  readonly json: boolean;
}

function printRefusals(
  deps: PackCliDeps,
  refusals: readonly PackRefusalCode[],
  json: boolean,
): void {
  if (json) {
    deps.err(JSON.stringify({ ok: false, refusals }, null, 2));
  } else {
    deps.err(`pack refused (${String(refusals.length)}):`);
    for (const r of refusals) deps.err(`  - ${r}`);
  }
}

/**
 * `ur pack validate <file> [--workspace <id>] [--require-export-consent] [--json]`: read the pack,
 * parse it, recompute its digests and check it, failing closed with named refusals.
 */
export function runPackValidate(
  deps: PackCliDeps,
  opts: PackValidateOptions,
): { exitCode: number } {
  let text: string;
  try {
    text = deps.readFile(opts.file);
  } catch (e) {
    deps.err(`error: cannot read ${opts.file}: ${e instanceof Error ? e.message : String(e)}`);
    return { exitCode: PACK_EXIT.FAIL };
  }

  let doc;
  try {
    doc = parsePack(text);
  } catch (e) {
    // parsePack throws one named PackRefusedError on a structural failure.
    const reason = (e as { reason?: string }).reason ?? 'MALFORMED_BODY';
    printRefusals(deps, [reason as PackRefusalCode], opts.json);
    return { exitCode: PACK_EXIT.FAIL };
  }

  const validation = validatePack(doc, {
    ...(opts.workspace !== undefined ? { workspace: opts.workspace } : {}),
    ...(opts.requireExportConsent ? { requireExportConsent: true } : {}),
  });
  if (!validation.ok) {
    printRefusals(deps, validation.refusals, opts.json);
    return { exitCode: PACK_EXIT.FAIL };
  }

  deps.log(
    opts.json
      ? JSON.stringify({ ok: true, id: doc.id, kind: doc.kind, content_hash: doc.contentHash })
      : `valid: ${doc.id} (${doc.kind}) @ ${doc.contentHash.slice(0, 12)}…`,
  );
  return { exitCode: PACK_EXIT.OK };
}
