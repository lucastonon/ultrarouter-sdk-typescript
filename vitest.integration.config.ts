import { defineConfig } from 'vitest/config';

/**
 * The integration suite: runs against a REAL ultrarouter gateway and is skipped unless both
 * `ULTRAROUTER_API_KEY` and `ULTRAROUTER_BASE_URL` are set. Use a test key (`ur_sk_test_…`): it makes
 * a handful of small model calls.
 */
export default defineConfig({
  test: {
    include: ['test/integration/**/*.test.ts'],
    environment: 'node',
    testTimeout: 120_000,
    hookTimeout: 60_000,
  },
});
