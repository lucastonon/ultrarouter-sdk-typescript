// A harness that writes a PASSING structured result and then exits non-zero (a later step failed
// after the result file was written). The process failed, so the run must not pass.
import { announce, finish } from './lib.mjs';
announce();
finish({ status: 'passed', coverage: 'application', sample: 10, passed: 10, failed: 0 }, 1);
