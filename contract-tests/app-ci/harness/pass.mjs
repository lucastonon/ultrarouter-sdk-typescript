// A passing APPLICATION harness (both baseline + candidate pass). Emits application coverage.
import { announce, finish } from './lib.mjs';
announce();
finish(
  {
    status: 'passed',
    coverage: 'application',
    sample: 40,
    passed: 40,
    failed: 0,
    costUsd: 0.012,
    latencyMs: 820,
  },
  0,
);
