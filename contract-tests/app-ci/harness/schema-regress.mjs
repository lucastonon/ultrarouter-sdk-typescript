// The harness: the BASELINE application test passes; the CANDIDATE fails an
// application-level SCHEMA check (even though the offline raw-model compare gate is `pass`). A debug
// excerpt embeds a fake key and another an Authorization header to prove the comment path REDACTS
// whole credentials (scheme included). A 4th debug line
// proves the "up to 3" cap holds.
import { announce, finish } from './lib.mjs';
announce();
const revision = process.env.UR_APP_CI_REVISION ?? 'unknown';
if (revision === 'candidate') {
  finish(
    {
      status: 'failed',
      coverage: 'application',
      sample: 40,
      passed: 37,
      failed: 3,
      debugFailures: [
        'schema validation failed: order.total is required',
        'leaked token ur_sk_live_ABCDEF0123456789abcd must be masked before it reaches the comment',
        // A synthetic credential echoed in a failure message, assembled at runtime.
        `upstream 401: Authorization: Bearer ${['SYNTHETIC', 'REVIEW', 'TOKEN', '42'].join('_')}`,
        'a FOURTH debug line that must be dropped by the up-to-3 cap',
      ],
    },
    1,
  );
} else {
  finish({ status: 'passed', coverage: 'application', sample: 40, passed: 40, failed: 0 }, 0);
}
