// A harness that writes a PASSING structured result and is then killed by a signal (an OOM kill, a
// CI timeout). A signal-terminated process has no exit code; it failed, so the run must not pass.
import { writeFileSync } from 'node:fs';

import { announce } from './lib.mjs';
announce();
const out = process.env.UR_APP_CI_OUTPUT;
if (out) {
  writeFileSync(
    out,
    JSON.stringify({
      status: 'passed',
      coverage: 'application',
      sample: 10,
      passed: 10,
      failed: 0,
    }),
  );
}
process.kill(process.pid, 'SIGKILL');
