// A passing APPLICATION harness that REQUIRES the bound candidate on the candidate revision: if the
// reference did not reach it, the run is a NAMED `missing_evaluator`, not a silent pass.
import { announce, boundCandidate, finish } from './lib.mjs';
announce();
if (process.env.UR_APP_CI_REVISION === 'candidate' && !boundCandidate()) {
  finish({ status: 'missing_evaluator', coverage: 'application' }, 1);
}
finish(
  {
    status: 'passed',
    coverage: 'application',
    sample: 48,
    passed: 48,
    failed: 0,
    costUsd: 0.014,
    latencyMs: 790,
  },
  0,
);
