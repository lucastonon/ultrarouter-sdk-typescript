# Contributing to `@ultrarouter/sdk`

Thanks for helping. This guide covers setup, the checks every change must pass, and the conventions
that keep the SDK, its docs and the published API specification in step. [AGENTS.md](./AGENTS.md)
has the same rules in a compact form.

## Setup

```bash
git clone https://github.com/lucastonon/ultrarouter-sdk-typescript.git
cd ultrarouter-sdk-typescript
npm ci            # Node.js 20 or newer
npm run check     # the full gate (the ci workflow runs the same list on manual dispatch)
```

`npm run check` runs, in order: the spec header check, formatting, type-checking, the unit tests,
the build, the hermetic contract batteries, the doctests (every TypeScript/JavaScript block and
every offline-runnable CLI shell block in README, AGENTS.md and `docs/`; skips are marked and
listed), the examples, the generated-docs check, the size budgets, the pack smoke test (including
Deno when it is installed) and the leak scan (tree, full history and tarball). Every
step runs offline against a local mock gateway (`test/support/mock-gateway.mjs`) except the smoke
test, which installs the packed tarball and a few dev tools from the npm registry.

## Making a change

1. Write the code under `src/` (the `ur` CLI lives in `src/cli/`).
2. Add or update tests under `test/`. A new API method also gets a row in
   `scripts/lib/coverage-map.mjs` naming the test that proves it.
3. Give every new public export TSDoc (enforced by `test/tsdoc.test.ts`).
4. Update the guide in `docs/` and, if useful, an example in `examples/`. Every `ts` code block must
   be a complete program that `npm run doctest` can run, and every `bash` block must run in the
   doctest sandbox (`test/doctest/sandbox/`) or carry `<!-- doctest: skip — reason -->`.
5. Run `npm run docs:gen` to refresh the API reference, the coverage table and `llms*.txt`.
6. Add an entry under **Unreleased** in [CHANGELOG.md](./CHANGELOG.md).
7. Run `npm run check`.

## Generated and synced files

| Path                                                                                                        | Produced by                                      | Edit by hand? |
| ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------ | ------------- |
| `openapi/openapi.yaml`                                                                                      | `node scripts/openapi-sync.mjs <published spec>` | No            |
| `src/generated/types.ts` (gitignored)                                                                       | `npm run codegen`                                | No            |
| `src/context-runtime/**`                                                                                    | the gateway project's vendoring tool             | No            |
| `test/learned/placement-golden.json`, `test/prompt/render-golden.json`, `test/pack/release-checklist.ur.md` | the gateway project's golden generators          | No            |
| `docs/api/**`, `docs/api-coverage.md`, `llms.txt`, `llms-full.txt`                                          | `npm run docs:gen`                               | No            |
| `test/fixtures/queue-retention-cases.json`                                                                  | shared byte-for-byte with the Python SDK         | Both together |
| `test/fixtures/outcome-verdicts.json`, `test/fixtures/toy-env.json`                                         | shared byte-for-byte with the Python SDK         | Both together |

To update the API: sync the new specification, run `npm run codegen`, fix what `npm run typecheck`
reports (the hand-written types in `src/types.ts` must declare every field the schema declares), add
coverage for new operations, and run `npm run check`.

## Style

- TypeScript strict mode; Prettier formatting (`npm run format`).
- Zero runtime dependencies. Node-only APIs belong in `src/cli/` or behind a lazy import.
- Errors are `UltraRouterError` with a stable `code`; never throw bare strings.
- Docs are factual: no savings or performance claims (`npm run docs:check` enforces the wording
  rules), and nothing internal in any published file (`npm run leak-scan`).

## Commit messages

Use [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `docs:`,
`test:`, `build:`, `chore:`).

## Releases

Maintainers publish from GitHub: create a release for a `vX.Y.Z` tag and the `publish` workflow runs
`npm run check` and publishes to npm with provenance. Pushing a tag alone does not publish.
