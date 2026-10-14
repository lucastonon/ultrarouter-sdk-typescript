// The REPAIR loop harness: the candidate revision FAILS while the repo is at the un-repaired head,
// and PASSES once the repair marker file exists in the working tree. The baseline always passes.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { announce, boundCandidate, finish } from './lib.mjs';
announce();
if (process.env.UR_APP_CI_REVISION !== 'candidate') {
  finish({ status: 'passed', coverage: 'application', sample: 48, passed: 48, failed: 0 }, 0);
}
if (!boundCandidate()) finish({ status: 'missing_evaluator', coverage: 'application' }, 1);
const repaired = existsSync(join(process.cwd(), 'context', 'refund', 'REPAIRED'));
if (!repaired) {
  finish(
    {
      status: 'failed',
      coverage: 'application',
      sample: 48,
      passed: 41,
      failed: 7,
      debugFailures: [
        'refund.channel enum rejected the learned exemplar for EU orders',
        'leaked token ur_sk_live_ABCDEF0123456789abcd must be masked before it reaches the comment',
      ],
    },
    1,
  );
}
finish({ status: 'passed', coverage: 'application', sample: 48, passed: 48, failed: 0 }, 0);
