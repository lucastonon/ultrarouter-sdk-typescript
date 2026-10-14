// Shared helpers for the stub application-harness commands (contract-tests/app-ci). A stub harness
// mimics a CUSTOMER's application test/replay command: it (optionally) drops a MARKER file to prove
// it executed, dumps its process env to prove no platform secrets reached it, and writes a
// structured JSON result to $UR_APP_CI_OUTPUT (the bounded channel the CLI reads — never stdout).
import { writeFileSync } from 'node:fs';

/** Drop the exec marker + env dump if the CLI-passed env vars name their paths. */
export function announce() {
  const marker = process.env.UR_APP_CI_MARKER;
  const revision = process.env.UR_APP_CI_REVISION ?? 'unknown';
  if (marker) writeFileSync(marker, `${revision}\n`, { flag: 'a' });
  const dump = process.env.UR_APP_CI_ENV_DUMP;
  if (dump) writeFileSync(dump, JSON.stringify(Object.keys(process.env).sort()), { flag: 'w' });
}

/** Write the structured harness result to $UR_APP_CI_OUTPUT (if set) and exit with `code`. */
export function finish(result, code) {
  const out = process.env.UR_APP_CI_OUTPUT;
  if (out) writeFileSync(out, JSON.stringify(result), { flag: 'w' });
  process.exit(code);
}
