# Doctest sandbox

`npm run doctest` copies this directory into a fresh temporary directory for every documented shell
block and runs the block there, with `ur` and `npx` resolving to the built CLI and the API pointed at
the local mock gateway. The files are the inputs the documented commands read (`outcomes.jsonl`,
`tickets.csv`, `usage.jsonl`, `src/prompts/*.ts`, and `knowledge/release-checklist.ur.md`, copied from
`test/pack/`). `package.json`'s test scripts stand in for an application's tests during a Bench
capture.
