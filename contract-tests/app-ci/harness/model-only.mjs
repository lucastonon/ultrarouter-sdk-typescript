// A passing DIRECT MODEL-CALL comparison (coverage: model_call_only). Even when it passes, it can
// never render the application-level success headline — the decision maps it to `Needs evidence`.
import { announce, finish } from './lib.mjs';
announce();
finish({ status: 'passed', coverage: 'model_call_only', sample: 20, passed: 20, failed: 0 }, 0);
