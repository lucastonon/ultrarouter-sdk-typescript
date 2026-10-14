import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // The integration suite talks to a real gateway; it has its own config (vitest.integration.config.ts).
    exclude: ['test/integration/**', 'node_modules/**', 'dist/**'],
    environment: 'node',
  },
});
