// Shared helpers for the stub application-harness commands. A stub harness mimics a
// CUSTOMER's application test/replay command: it records WHICH env it saw (so the suite can prove
// the bound candidate reached the CANDIDATE revision and NOT the baseline) and writes its structured
// result to $UR_APP_CI_OUTPUT — the bounded channel the CLI reads, never stdout.
import { appendFileSync, writeFileSync } from 'node:fs';

/** Record `<revision> <candidateRef|none>` into $UR_APP_CI_MARKER, one line per invocation. */
export function announce() {
  const marker = process.env.UR_APP_CI_MARKER;
  const revision = process.env.UR_APP_CI_REVISION ?? 'unknown';
  const ref = process.env.UR_APP_CI_CANDIDATE_REF ?? 'none';
  if (marker) appendFileSync(marker, `${revision} ${ref}\n`);
  const dump = process.env.UR_APP_CI_ENV_DUMP;
  if (dump) writeFileSync(dump, JSON.stringify(Object.keys(process.env).sort()));
}

/** Write the structured harness result to $UR_APP_CI_OUTPUT (if set) and exit with `code`. */
export function finish(result, code) {
  const out = process.env.UR_APP_CI_OUTPUT;
  if (out) writeFileSync(out, JSON.stringify(result));
  process.exit(code);
}

/** True when this invocation is the candidate revision AND the candidate was actually bound. */
export function boundCandidate() {
  return (
    process.env.UR_APP_CI_REVISION === 'candidate' &&
    (process.env.UR_APP_CI_CANDIDATE_REF ?? '') !== ''
  );
}
