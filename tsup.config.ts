import { defineConfig } from 'tsup';

/**
 * Dual ESM+CJS build with type declarations. The core entry is
 * `src/index.ts`; there are ZERO runtime dependencies, so the bundle is just the
 * hand-written fetch-based SDK. Target ES2022 (Node ≥ 20 / Bun / Deno / edge —
 * all fetch-based). `esm` emits `.js`, `cjs` emits `.cjs` (see package.json exports).
 *
 * `learning` is a SEPARATE entry too — the starter outcome adapters and the order-desk
 * demonstration environment (`@ultrarouter/sdk/learning`), kept out of the client bundle.
 *
 * `context` is a SEPARATE entry — the pure `@ultrarouter/sdk/context`
 * runtime. It is code-split from the core entry (importing the client never pulls it), and
 * its only dependency, `zod`, is BUNDLED via `noExternal` so the PUBLISHED SDK still adds
 * zero runtime dependencies. `node:crypto` (the deterministic default hasher) stays an
 * external builtin.
 */
export default defineConfig({
  // The SDK core (`index`), the `ur` CLI, the context runtime entry and the learning starters entry.
  // The bin runs the CJS output (`dist/cli/index.cjs`) so `node` executes it as CommonJS
  // regardless of the package `type`.
  entry: {
    index: 'src/index.ts',
    'cli/index': 'src/cli/index.ts',
    context: 'src/context.ts',
    learning: 'src/learning.ts',
  },
  format: ['esm', 'cjs'],
  target: 'es2022',
  // `exactOptionalPropertyTypes` is off only for declaration emission: the generated context
  // runtime is written for that setting (see tsconfig.context.json), and the flag changes type
  // checking, not the emitted `.d.ts` shape. `npm run typecheck` keeps it on for the client.
  dts: {
    entry: { index: 'src/index.ts', context: 'src/context.ts', learning: 'src/learning.ts' },
    compilerOptions: { exactOptionalPropertyTypes: false },
  },
  // Bundle zod into the context entry so `@ultrarouter/sdk/context` has no runtime deps.
  noExternal: ['zod'],
  clean: true,
  treeshake: true,
  sourcemap: true,
  outExtension({ format }) {
    return { js: format === 'cjs' ? '.cjs' : '.js' };
  },
});
