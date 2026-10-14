// A harness that FAILS LOUDLY if the baseline revision can see the bound candidate. A baseline that
// sees the treatment is not a baseline — the asymmetry is the whole comparison.
import { announce, finish } from './lib.mjs';
announce();
const ref = process.env.UR_APP_CI_CANDIDATE_REF ?? '';
if (process.env.UR_APP_CI_REVISION === 'baseline' && ref !== '') {
  finish(
    { status: 'error', coverage: 'application', debugFailures: ['baseline saw the candidate'] },
    1,
  );
}
finish({ status: 'passed', coverage: 'application', sample: 10, passed: 10, failed: 0 }, 0);
