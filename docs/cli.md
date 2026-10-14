# The `ur` CLI

The package ships a command-line tool, `ur`, for the jobs that belong in a terminal or a CI
pipeline: gating a build on a Bench comparison, running your application tests as a pull-request
check, carrying a flywheel candidate into a reviewable change, importing history and outcomes,
reading learning status, linting prompt files and validating knowledge packs.

Every command fails closed: when the CLI cannot read what it needs, it exits non-zero instead of
reporting success.

- [Install and run](#install-and-run)
- [Configuration: API key and base URL](#configuration-api-key-and-base-url)
- [Exit codes](#exit-codes)
- [`ur bench run`](#ur-bench-run) · [`ur bench baseline`](#ur-bench-baseline) · [`ur bench gate`](#ur-bench-gate)
- [`ur app-ci`](#ur-app-ci) (and [the config file](#the-app-ci-config-file), [the harness contract](#the-harness-contract))
- [`ur flywheel-pr`](#ur-flywheel-pr) · [`ur flywheel-pr decision`](#ur-flywheel-pr-decision)
- [`ur import`](#ur-import)
- [`ur outcomes import`](#ur-outcomes-import) · [`ur outcomes pending`](#ur-outcomes-pending)
- [`ur flywheel status`](#ur-flywheel-status) · [`ur flywheel calibration`](#ur-flywheel-calibration)
- [`ur context lint`](#ur-context-lint)
- [`ur pack validate`](#ur-pack-validate)
- [`ur --help`, `ur --version`](#ur---help-and-ur---version)
- [JSON output schemas](#json-output-schemas)

## Install and run

`ur` is the `bin` of `@ultrarouter/sdk` and needs Node.js 20 or later.

Run it without installing (name the package: `npx ur` alone would look for a package called `ur`):

```bash
npx --package=@ultrarouter/sdk@0.0.1 ur --help
```

Or install it, in a project (then run it through `npx ur` or a package script) or globally:

<!-- doctest: skip — installs from the npm registry -->

```bash
npm install --save-dev @ultrarouter/sdk
npx ur --version

npm install --global @ultrarouter/sdk
ur --version
```

In GitHub Actions, the [GitHub Action](./github-action.md) installs and runs `ur` for you.

## Configuration: API key and base URL

Commands that call the gateway read the same settings as the SDK client. A flag always wins over
the environment.

| Setting  | Flag               | Environment (first match wins)             | Default                                           |
| -------- | ------------------ | ------------------------------------------ | ------------------------------------------------- |
| API key  | `--api-key <key>`  | `ULTRAROUTER_API_KEY`, then `UR_API_KEY`   | none (required by commands that call the gateway) |
| Base URL | `--base-url <url>` | `ULTRAROUTER_BASE_URL`, then `UR_BASE_URL` | `https://api.ultrarouter.dev`                     |

Point `--base-url` at your own deployment to self-host. Commands that only read local files
(`ur context lint`, `ur pack validate`) never call the gateway.

`--base-url` and `--api-key` are accepted by every command that calls the gateway, and their value
is never mistaken for a positional argument.

## Exit codes

Exit codes are the contract, so a CI step can branch on them:

| Code | Meaning                                                                                                                                                                              |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `0`  | Success, or a gate that passed.                                                                                                                                                      |
| `1`  | A usage error: a missing or invalid flag or argument. Nothing was sent.                                                                                                              |
| `2`  | A gate that did not pass (`fail`, or `inconclusive` without `--allow-inconclusive`), a partial rejection, or any API, network, file or pipeline error. A broken gate is never green. |

## `ur bench run`

Run a [Bench](./bench.md) suite and, with `--gate`, fail the build when the current configuration
regresses against the suite's baseline.

```text
ur bench run <suite> [--capture <cmd>] [--budget N] [--gate] [--baseline <ref>] [--json]
                     [--allow-inconclusive] [--cost-ceiling <usd>] [--mode request|task]
                     [--selection selection|noninferiority] [--pin-baseline] [--run-tag <tag>]
                     [--base-url <url>] [--api-key <key>] [--wait-timeout <ms>]
```

What it does, in order:

1. **Capture** (optional, `--capture <cmd>`): runs `<cmd>` in a shell with `UR_BENCH=<suite>` and
   `UR_BENCH_RUN=<run tag>` added to its environment. Use it to drive your app or tests through the
   gateway with Bench capture on (the SDK client picks these variables up automatically). A
   non-zero exit of the command fails the gate closed: you cannot gate on partial evidence.
2. **Freeze** the suite into immutable dataset cards.
3. **Run** the suite and wait for it to finish. With `--baseline` the run is a _compare_ run: the
   current configuration is the single arm, compared against the baseline.
4. **Gate** (with `--gate`): read the baseline-compare gate and exit by its verdict.
5. **Pin** (with `--pin-baseline`): after a `pass`, make this run the suite's new baseline.

| Flag                                    | Default                          | Description                                                                                                                                                   |
| --------------------------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `<suite>`                               | required                         | The suite slug.                                                                                                                                               |
| `--capture <cmd>`                       | none                             | A shell command to run with Bench capture on before freezing.                                                                                                 |
| `--budget N`                            | `1`                              | The run's cost cap in USD.                                                                                                                                    |
| `--gate`                                | off                              | Read the compare gate and exit by its verdict. Requires `--baseline`.                                                                                         |
| `--baseline <ref>`                      | none                             | A run id (`br_…`) to compare against, or a symbolic ref (for example `bench:main`) that resolves to the suite's pinned baseline. Makes the run a compare run. |
| `--json`                                | off                              | Print the `ur.bench.gate.v1` JSON result instead of the table.                                                                                                |
| `--allow-inconclusive`                  | off                              | Exit 0 on an `inconclusive` verdict.                                                                                                                          |
| `--cost-ceiling <usd>`                  | none                             | An absolute per-unit cost ceiling in USD; a breach fails the gate.                                                                                            |
| `--mode request\|task`                  | `request`                        | The paired-run mode: per request, or whole traces.                                                                                                            |
| `--selection selection\|noninferiority` | `noninferiority` in compare mode | The selection mode for the run.                                                                                                                               |
| `--pin-baseline`                        | off                              | After a `pass`, pin this run as the suite baseline.                                                                                                           |
| `--run-tag <tag>`                       | the commit SHA                   | The run tag stamped as `UR_BENCH_RUN`. Defaults to the first 12 characters of `GITHUB_SHA`, then the short `git` SHA, then `local-<timestamp>`.               |
| `--wait-timeout <ms>`                   | `120000`                         | How long to wait for the run to finish before failing closed.                                                                                                 |

Without `--gate`, the command exits 0 once the run completes (nothing is evaluated).

Every flag and combination is checked **before** anything runs, so a mistake never costs a capture
run or the evaluation budget: `--gate` needs `--baseline`, `--pin-baseline` and
`--allow-inconclusive` need `--gate`, `--cost-ceiling` needs `--baseline`, and an unknown flag, a
flag without its value, a repeated flag or a malformed number is a usage error (exit 1, no capture,
no request). The capture command runs once, through your shell, with `UR_BENCH` and `UR_BENCH_RUN`
set; a non-zero exit — including being killed by a signal — fails the gate (exit 2).

```bash
ur bench run checkout --capture "npm run test:e2e" --gate --baseline bench:main --budget 3
```

```text
ultrarouter bench gate — suite 'checkout' @ 9f2c4a1b7d3e
  run br_01J… vs baseline br_01H… [ref bench:main]

  ✓ ct_checkout: PASS
      quality pass [0.0100, 0.0300] vs bar -0.0500 (Δ 5.0pp; MDE 2.30pp)
      cost    pass [0.2500, 0.3500] vs bar 0.1000
      pairs   40 eligible / 0 missing-artifact / 0 unpaired (40 clusters)

  ✓ OVERALL PASS — exit 0
```

The pairing row is always shown, so a run that degraded toward `inconclusive` (few eligible pairs)
is never mistaken for a clean pass.

## `ur bench baseline`

Pin a completed run as its suite's baseline and print the result as JSON.

```text
ur bench baseline <run-id> [--base-url <url>] [--api-key <key>]
```

```bash
ur bench baseline br_01J0000000000000000000000
```

```json
{
  "object": "bench_baseline",
  "suite": "checkout",
  "suite_id": "bs_…",
  "baseline_run_id": "br_01J0000000000000000000000",
  "previous_baseline_run_id": "br_01H0000000000000000000000"
}
```

## `ur bench gate`

Read the gate of an existing compare run and exit by its verdict (the same table and JSON as
`ur bench run --gate`). Useful when the run was triggered elsewhere.

```text
ur bench gate <run-id> [--allow-inconclusive] [--json] [--base-url <url>] [--api-key <key>]
```

```bash
ur bench gate br_01J0000000000000000000000 --json
```

## `ur app-ci`

Run your own application test or replay command on the **baseline** and **candidate** revisions of
every workflow a change touches, combine the result with an optional offline compare gate, and
publish one idempotent PR comment and Check Run per workflow.

```text
ur app-ci [run] --config <path> [--repo owner/repo] [--base <sha>] [--head <sha>]
          [--changed-file <path>]... [--changed-from <file>] [--pr <n>] [--fork]
          [--no-secrets] [--allow-inconclusive] [--asserted-evidence-hash [wf=]<hash>]...
          [--github-api <url>] [--github-token <tok>] [--no-publish] [--json]
          [--base-url <url>] [--api-key <key>]
```

(`ur app-ci run …` and `ur app-ci …` are the same command.)

How a run decides:

1. **Detect.** Each changed path is matched against the `surfaces` globs of every workflow in the
   config. Matched workflows are evaluated; a path that matches no surface produces a separate
   `Needs configuration` outcome (an advisory non-success, never a pass).
2. **Pin the evidence.** For each affected workflow the CLI computes an evidence hash over every
   bound input: repository, base and head SHAs, the lockfile digest, the harness definition, the
   config file, the dataset split, the workflow, its objective, the evaluator version and the
   evidence epoch. With `--asserted-evidence-hash`, a mismatch marks the result stale.
3. **Run the harness** on both revisions (the baseline in a temporary `git worktree` of `--base`,
   the candidate in the current checkout), unless the run is a fork or the evidence is stale.
   Before this step, the current checkout must **be** `--head`: `HEAD` is that commit,
   and no tracked file differs from it except the config and the lockfile, whose content the
   evidence already binds by digest (untracked files such as build output do not count). Otherwise
   the command stops with a named error — `candidate_revision_mismatch`,
   `candidate_worktree_modified`, `candidate_revision_unavailable`, `candidate_revision_unknown` or
   `candidate_checkout_unavailable` — and exit 2, before anything runs or is published, so a comment
   or Check Run never attests to a revision that was not tested.
4. **Read the gate.** When the workflow names a `gateRunId`, read that compare run's gate.
5. **Decide** the headline and the Check Run conclusion, then **publish** (unless `--no-publish`
   or there is no `--pr`).

| Headline                     | Check Run conclusion | When                                                                                                                                                                                             |
| ---------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Ready for controlled rollout | `success`            | Fresh evidence, application coverage, the candidate passed, and the gate (if any) passed. The only success.                                                                                      |
| Regression found             | `failure`            | The candidate's application test failed, or the gate verdict is `fail`.                                                                                                                          |
| Needs evidence               | `action_required`    | Stale evidence, a fork run, missing or flaky results, a missing secret or evaluator, an unreadable gate, an `inconclusive` gate (without `--allow-inconclusive`), or `model_call_only` coverage. |
| Needs configuration          | `action_required`    | A changed path matched no configured surface.                                                                                                                                                    |

Missing evidence maps to `action_required`, never `neutral`: GitHub treats `neutral` as passing for
branch protection, so it would let an unevaluated change through. The command exits 0 only when
every outcome is `success`, and 2 otherwise.

| Flag                                   | Default                                                | Description                                                                                                                                                |
| -------------------------------------- | ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--config <path>`                      | required                                               | The [app-ci config file](#the-app-ci-config-file).                                                                                                         |
| `--repo owner/repo`                    | `repository` from the config, then `GITHUB_REPOSITORY` | The repository to publish to.                                                                                                                              |
| `--base <sha>`                         | `GITHUB_BASE_SHA`, then `HEAD~1`                       | The baseline revision.                                                                                                                                     |
| `--head <sha>`                         | `GITHUB_SHA`, then `HEAD`                              | The candidate revision. It must be the checked-out commit (see step 3); a short SHA is accepted.                                                           |
| `--changed-file <path>`                | none (repeatable)                                      | A changed path. When none is given, `--changed-from` is read (an empty file means "no changes"), then `git diff --name-only base..head`.                   |
| `--changed-from <file>`                | none                                                   | A file with one changed path per line.                                                                                                                     |
| `--pr <n>`                             | `GITHUB_PR_NUMBER`                                     | The pull request to comment on. Without it nothing is published.                                                                                           |
| `--fork`                               | off (also `UR_APP_CI_FORK=1`)                          | Fork mode: detection and comment only; the harness is never executed.                                                                                      |
| `--no-secrets`                         | off                                                    | Declare that the secrets your harness needs are absent: each revision is reported as `missing_secret` without running.                                     |
| `--allow-inconclusive`                 | off                                                    | Treat an `inconclusive` gate as passing.                                                                                                                   |
| `--asserted-evidence-hash [wf=]<hash>` | none (repeatable)                                      | A previously sealed evidence hash, for one workflow (`wf=`) or all; a mismatch marks the result stale.                                                     |
| `--github-api <url>`                   | `GITHUB_API_URL`, then `https://api.github.com`        | The GitHub REST API base.                                                                                                                                  |
| `--github-token <tok>`                 | `GITHUB_TOKEN`                                         | A token with `checks: write` and `pull-requests: write`. Used for publication only and never passed to your harness; without a token nothing is published. |
| `--no-publish`                         | off                                                    | Compute outcomes without commenting or creating Check Runs.                                                                                                |
| `--json`                               | off                                                    | Print the `ur.app-ci.v1` JSON result.                                                                                                                      |
| `--base-url`, `--api-key`              | env                                                    | Needed only for workflows with a `gateRunId`; without a key such a workflow is `Needs evidence`.                                                           |

<!-- doctest: skip — publishes to a pull request on GitHub; `contract-tests/app-ci` runs this command against a stub GitHub API -->

```bash
ur app-ci --config ur-app-ci.config.json --base "$BASE_SHA" --head "$HEAD_SHA" --pr 42
```

```text
ultrarouter app-ci — acme/app @ 4d1f…
  ✓ wf_checkout: Ready for controlled rollout (success)
  ✗ wf_search: Regression found (failure) — application_test_failed
  exit 2
```

**Change discovery fails closed.** Without `--changed-file` or `--changed-from`, both revisions
must exist in the checkout and `git diff base..head` must succeed. A missing base (no `--base`, no
pull-request base, no parent commit), a revision the checkout does not have (a shallow clone; use
`fetch-depth: 0`) or a git error exits 2 before any harness runs or anything is published; it is
never treated as "no changes", which would pass.

The PR comment has one section per evidence stage (application tests, offline replay, live
evidence), the sample size and quality interval, cost and latency, up to three redacted debug
failures, the evidence hash and the next action. Every untrusted string is escaped, and every
credential is removed from the debug excerpts and again from the final comment and Check Run body.
A credential-bearing header line — `Authorization` / `Proxy-Authorization` (any scheme), `Cookie` /
`Set-Cookie`, `X-API-Key` / `api-key`, any `*-Token`, `*-Secret`, `*-Signature` or session header —
loses its whole value, every `;`-separated cookie pair and quoted value included. An assignment or
query parameter with such a name (`token=…&page=2`), a JSON field (`"api_key": "…"`) and a CLI flag
(`--api-key …`) lose their own value; known token formats, URL passwords and email addresses are
removed wherever they appear. Quoted values are escape-aware at every nesting level: in a JSON
document serialized into a JSON string (once or several times), an escaped quote inside a value
never ends it, and a value whose end cannot be found is removed to the end of the line. The Check Run is named `ultrarouter app-ci / <workflow id>`, and the
comment carries a hidden marker so re-runs update it in place instead of adding comments.

### The app-ci config file

A JSON file you keep in the repository (by default the action looks for `ur-app-ci.config.json`).

```json
{
  "repository": "acme/app",
  "datasetSplit": "holdout-a",
  "evidenceEpoch": "2026-q1",
  "lockfile": "package-lock.json",
  "evidenceUrlTemplate": "https://ci.example.com/evidence/{hash}",
  "workflows": [
    {
      "id": "wf_checkout",
      "objective": "checkout-accuracy",
      "evaluatorVersion": "eval.v3",
      "coverage": "application",
      "testCommand": "npm run test:checkout",
      "gateRunId": "br_01J0000000000000000000000",
      "surfaces": [
        { "kind": "prompt", "paths": ["prompts/checkout/**"] },
        { "kind": "tool_schema", "paths": ["src/tools/checkout/*.json"] },
        { "kind": "context_module", "paths": ["context/checkout/**"] }
      ]
    }
  ]
}
```

| Field                          | Required        | Description                                                                                                                                                                                           |
| ------------------------------ | --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `repository`                   | no              | `owner/repo`; the default for `--repo`.                                                                                                                                                               |
| `datasetSplit`                 | yes             | The dataset split your harness evaluates (bound into the evidence hash).                                                                                                                              |
| `evidenceEpoch`                | yes             | A label you bump to invalidate all prior evidence deliberately.                                                                                                                                       |
| `lockfile`                     | no              | A dependency lockfile whose digest is bound into the evidence.                                                                                                                                        |
| `evidenceUrlTemplate`          | no              | A link for the comment; `{hash}` is replaced with the evidence hash.                                                                                                                                  |
| `workflows[]`                  | yes (non-empty) | The workflows a change can affect.                                                                                                                                                                    |
| `workflows[].id`               | yes             | A stable workflow id.                                                                                                                                                                                 |
| `workflows[].objective`        | yes             | What the workflow is judged on (bound into the evidence).                                                                                                                                             |
| `workflows[].evaluatorVersion` | yes             | The evaluator version (bound into the evidence).                                                                                                                                                      |
| `workflows[].coverage`         | yes             | `application` (your app's own test or replay, end to end) or `model_call_only` (a direct model-call comparison). A `model_call_only` workflow can never reach `Ready for controlled rollout`.         |
| `workflows[].testCommand`      | yes             | The shell command that runs your harness. It is untrusted input and is passed to a shell once, verbatim.                                                                                              |
| `workflows[].suite`            | no              | A Bench suite bound to the workflow. Without a `gateRunId` in CI, the workflow is `Needs evidence` (`missing_evaluator`).                                                                             |
| `workflows[].gateRunId`        | no              | A compare run (`br_…`) whose gate supplies the offline-replay verdict.                                                                                                                                |
| `workflows[].surfaces[]`       | yes (non-empty) | `{ kind, paths }`: `kind` is one of `prompt`, `model`, `tool_schema`, `retrieval_config`, `context_module`, `sop`; `paths` are globs (`*` within a segment, `**` across segments, `?` one character). |

### The harness contract

Your `testCommand` runs once per revision, in a shell, with:

| Variable                                                                                                                | Value                                                               |
| ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `UR_APP_CI_WORKFLOW`                                                                                                    | The workflow id.                                                    |
| `UR_APP_CI_REVISION`                                                                                                    | `baseline` or `candidate`.                                          |
| `UR_APP_CI_OUTPUT`                                                                                                      | A file path; write your structured result there as JSON (optional). |
| `UR_APP_CI_CANDIDATE_REF`, `UR_APP_CI_CANDIDATE_LEVER`, `UR_APP_CI_CANDIDATE_MODULE`, `UR_APP_CI_CANDIDATE_BODY_SHA256` | Set on the candidate revision only, and only by `ur flywheel-pr`.   |

`GITHUB_TOKEN`, `UR_APP_CI_GITHUB_TOKEN`, `UR_API_KEY`, `ULTRAROUTER_API_KEY`, `NPM_TOKEN`,
`PYPI_TOKEN` and `TEST_PYPI_TOKEN` are removed from the harness environment.

Exit code 0 means `passed` and anything else `failed`. A harness killed by a signal has no exit
code and is `failed` (reported like a shell, `128 + n`). The JSON result can name a more specific
status, but it can never turn an unsuccessful process into a pass: a non-zero exit with a reported
`passed` is `failed` (a result written before a later step failed does not count). The JSON result
is untrusted: only these keys are read, numbers must be finite, and `debugFailures` is capped at
three redacted excerpts.

```json
{
  "status": "passed",
  "coverage": "application",
  "sample": 40,
  "passed": 40,
  "failed": 0,
  "qualityPoint": 0.92,
  "qualityLow": 0.88,
  "qualityHigh": 0.95,
  "costUsd": 0.012,
  "latencyMs": 820,
  "debugFailures": ["order 17: total mismatch"]
}
```

`status` may be `passed`, `failed`, `flaky`, `missing_secret`, `missing_evaluator`, `no_replay` or
`error`; anything other than `passed` and `failed` makes the workflow `Needs evidence`. A harness
can narrow `coverage` to `model_call_only`, never widen it.

## `ur flywheel-pr`

Carry a **screened** flywheel candidate into your repository as a reviewable change, run the same
application check as `ur app-ci` with the candidate bound, and report whether a controlled rollout
is unlocked. The diff and the destination branch are always printed (to stderr) before anything is
written, nothing is written without `--apply`, nothing is ever merged, and CI never starts a
rollout.

```text
ur flywheel-pr [run] --config <path> --candidate <path>
          [--shape gateway_owned|code_owned] [--module-path <path>] [--mode auto|attach|open_pr|patch]
          [--apply] [--patch-out <dir>] [--branch <name>] [--base-branch <name>]
          [--base-branch-sha <sha>] [--no-repo-write] [--repo owner/repo] [--base <sha>] [--head <sha>]
          [--pr <n>] [--changed-file <path>]... [--changed-from <file>] [--fork] [--no-secrets]
          [--allow-inconclusive] [--asserted-evidence-hash [wf=]<hash>]...
          [--base-url <url>] [--api-key <key>] [--github-api <url>] [--github-token <tok>]
          [--no-publish] [--json]
```

**The candidate file** is the JSON export of a screened candidate:

```json
{
  "workspaceId": "ws_…",
  "leverKey": "learned_context",
  "moduleId": "lcm_…",
  "moduleVersion": "lcm1_…",
  "packHash": "lcp1_…",
  "rankerVersion": "lcr1_…",
  "k": 3,
  "keySpec": "sit1",
  "sourceSnapshot": "2026-01-10T00:00:00.000Z",
  "situationClass": "support/refund",
  "epoch": 4,
  "bodyHash": "<sha256 of body>",
  "state": "screened",
  "workflowId": "wf_refund",
  "body": "Learned from this workspace's own recorded outcomes: …"
}
```

The CLI recomputes the body hash and the candidate reference (`urcand1_…`) from these fields and
never trusts a reference from the file. It refuses, by name: `invalid_candidate_json`,
`missing_field`, `candidate_not_screened`, `adopted_is_not_ci`, `unknown_lever_state`,
`candidate_body_hash_mismatch` and `empty_candidate_body`.

**Change shapes**

- `gateway_owned` (default): the only change is `workflows[<id>].candidateRef` in the app-ci
  config; the module body it resolves to is shown as a linked diff but never committed. Any other
  changed config key is refused as out of surface.
- `code_owned`: the module body is written to `--module-path`, which must match one of the
  workflow's surfaces of the lever's kind (`learned_context` → `context_module`,
  `prompt_optimization` → `prompt`, `candidate_ranking` → `retrieval_config`, `custom_model` →
  `model`). A diff touching another surface is refused.

**Delivery** (`--mode`, resolved against a probe of your token's repository permission):

| Mode             | With write access                                                                                 | Without write access (denied or unreadable) |
| ---------------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| `auto` (default) | `attach` when `--pr` is given, else `open_pr`                                                     | `patch`                                     |
| `attach`         | commit onto the PR's head branch (requires `--pr`)                                                | `patch`                                     |
| `open_pr`        | create `ultrarouter/candidate/<ref>` (or `--branch`) from `--base-branch` and open a **draft** PR | `patch`                                     |
| `patch`          | write `ultrarouter-candidate-<ref>.patch` to `--patch-out` (default: the working directory)       | same                                        |

An unreadable permission probe is never read as consent to write. The patch path runs the identical
check and is a first-class result, not an error.

**The checked revision.** The check runs in the current checkout and its evidence names `--head`, so,
unless `--fork` is given, the checkout must be `--head` exactly as for [`ur app-ci`](#ur-app-ci)
(step 3). This is verified first: on `candidate_revision_mismatch` (or another
`candidate_*` reason) the command exits 2 before it plans, writes a branch, a commit, a pull request
or a patch, runs a harness, or publishes anything.

| Flag                                                                                                                                                                                     | Default                          | Description                                                                                                     |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `--config <path>`                                                                                                                                                                        | required                         | The [app-ci config file](#the-app-ci-config-file); the candidate's `workflowId` must be in it.                  |
| `--candidate <path>`                                                                                                                                                                     | required                         | The screened candidate JSON.                                                                                    |
| `--shape gateway_owned\|code_owned`                                                                                                                                                      | `gateway_owned`                  | The change shape.                                                                                               |
| `--module-path <path>`                                                                                                                                                                   | none                             | Where a `code_owned` candidate is written (required for that shape).                                            |
| `--mode auto\|attach\|open_pr\|patch`                                                                                                                                                    | `auto`                           | The requested delivery.                                                                                         |
| `--apply`                                                                                                                                                                                | off                              | Actually write (commit, branch, PR, or patch file). Without it the run plans and checks only.                   |
| `--patch-out <dir>`                                                                                                                                                                      | working directory                | Where the patch file is written.                                                                                |
| `--branch <name>`                                                                                                                                                                        | `ultrarouter/candidate/<ref>`    | The destination branch for `open_pr`.                                                                           |
| `--base-branch <name>`                                                                                                                                                                   | `main`                           | The branch a new PR targets.                                                                                    |
| `--base-branch-sha <sha>`                                                                                                                                                                | the base branch head             | The commit the new branch starts from.                                                                          |
| `--no-repo-write`                                                                                                                                                                        | off                              | Skip the permission probe and take the patch path.                                                              |
| `--repo`, `--base`, `--head`, `--pr`, `--changed-file`, `--changed-from`, `--fork`, `--no-secrets`, `--allow-inconclusive`, `--asserted-evidence-hash`, `--github-api`, `--github-token` | as for [`ur app-ci`](#ur-app-ci) | The bound application check.                                                                                    |
| `--base-url`, `--api-key`                                                                                                                                                                | env                              | Where the rollout decision is read. Without a base URL the rollout section reports `authorization_unavailable`. |
| `--no-publish`                                                                                                                                                                           | off                              | Do not comment or create Check Runs.                                                                            |
| `--json`                                                                                                                                                                                 | off                              | Print the `ur.flywheel-pr.v1` JSON result.                                                                      |

**The rollout decision** is made by the gateway: the CLI posts the facts only CI can observe (the
bound evidence, the application headline, the change shape) to
`POST /v1/flywheel/candidates/{ref}/rollout` and renders the answer. Each blocker is listed with
its own reason and family. A response that claims a rollout was started, or that is unlocked while
listing blockers, is refused; any unreadable answer becomes `authorization_unavailable`. Start the
rollout itself from the dashboard.

The exit code follows the bound application check (0 only when every outcome is `success`).

<!-- doctest: skip — works on a pull request and a git checkout; `contract-tests/flywheel-ci` runs these commands against a stub GitHub API -->

```bash
ur flywheel-pr --config ur-app-ci.config.json --candidate candidate.json --pr 42
ur flywheel-pr --config ur-app-ci.config.json --candidate candidate.json --mode patch --apply --patch-out ./out
```

## `ur flywheel-pr decision`

Record a human `accept`, `reject` or `revert` of a candidate, with an actor and a reason. The body
is signed (`x-ur-appci-signature: sha256=<hex HMAC of "<timestamp>.<body>">` keyed by the API key,
with `x-ur-appci-timestamp`) and carries a deterministic `callback_id`, so sending the same decision
twice is a visible `duplicate`, not a second decision.

```text
ur flywheel-pr decision --candidate <path> --decision accept|reject|revert
          --actor <id> --reason <text> [--surface pull_request|dashboard|cli]
          [--evidence-hash <hash>] [--decided-at <iso>] [--base-url <url>] [--api-key <key>]
```

| Flag                                     | Default        | Description                                                                                           |
| ---------------------------------------- | -------------- | ----------------------------------------------------------------------------------------------------- |
| `--candidate <path>`                     | required       | The candidate JSON (its reference is recomputed).                                                     |
| `--decision accept\|reject\|revert`      | required       | The decision.                                                                                         |
| `--actor <id>`                           | required       | Who decided (an opaque id).                                                                           |
| `--reason <text>`                        | required       | Why; a blank reason is refused.                                                                       |
| `--surface pull_request\|dashboard\|cli` | `pull_request` | Where the decision was made.                                                                          |
| `--evidence-hash <hash>`                 | empty          | The evidence object the decision refers to.                                                           |
| `--decided-at <iso>`                     | now            | When the decision was made.                                                                           |
| `--base-url`, `--api-key`                | env            | Both required; without them the command exits 2 (a decision that was not recorded is not a decision). |

```bash
ur flywheel-pr decision --candidate candidate.json --decision reject \
  --actor reviewer-17 --reason "refund wording conflicts with EU policy"
```

```json
{
  "schema": "ur.flywheel-pr.decision.v1",
  "candidate_ref": "urcand1_…",
  "callback_id": "urcb1_…",
  "decision": "reject",
  "actor_id": "reviewer-17",
  "status": "accepted"
}
```

Exit 0 when the status is `accepted` or `duplicate`, 2 otherwise.

## `ur import`

Import usage or trace history through `POST /v1/imports`. The file is a JSON array of records or
JSONL. Usage-only imports never create prompts, outputs or quality figures; intact traces may carry
bodies, which are stored only under corrections consent. See [Imports](./imports.md).

```text
ur import <file> --format <adapter> [--format-version <v>] [--preview | --mode preview]
          [--resume <import-id>] [--call-type <ct_id>] [--json] [--base-url <url>] [--api-key <key>]
```

| Flag                              | Default  | Description                                                                                                                                                      |
| --------------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `<file>`                          | required | A JSON array (first character `[`) or JSONL.                                                                                                                     |
| `--format <adapter>`              | required | The import adapter id, for example `usage_summary` or `openai_chat_jsonl`.                                                                                       |
| `--format-version <v>`            | latest   | Pin the adapter version.                                                                                                                                         |
| `--preview` (or `--mode preview`) | off      | Return the capability report and store nothing.                                                                                                                  |
| `--resume <import-id>`            | none     | Resume an existing import (idempotent per record content).                                                                                                       |
| `--call-type <ct_id>`             | none     | Bind intact-trace history to a call type (a `ct_*` id with a confirmed objective) so its verdicts can count toward that call type. Refused for usage-only files. |
| `--json`                          | off      | Print the import object as JSON.                                                                                                                                 |

```bash
ur import usage.jsonl --format usage_summary --preview
```

```text
ultrarouter import imp_… — usage_summary@1 (usage_only)
  status: preview  (no corrections_consent — usage-only/metadata)
  records: 120  accepted: 118  duplicate: 0  rejected: 2  unsupported: 0
```

Exit 0 on success, 2 on a read error, an API error or a `failed` import, 1 without a file or
`--format`.

## `ur outcomes import`

Backfill outcome events from JSONL or CSV through `POST /v1/outcomes/batch`. See
[Outcomes](./outcomes.md).

```text
ur outcomes import <jsonl|csv> [--format jsonl|csv] [--map <field>=<column>]... [--json]
          [--base-url <url>] [--api-key <key>]
```

| Flag                     | Default                            | Description                                                   |
| ------------------------ | ---------------------------------- | ------------------------------------------------------------- |
| `<file>`                 | required                           | One JSON object per line (JSONL), or CSV with a header row.   |
| `--format jsonl\|csv`    | from the extension (`.csv` is CSV) | The file format.                                              |
| `--map <field>=<column>` | none (repeatable)                  | Read an outcome field from a differently named column or key. |
| `--json`                 | off                                | Print the batch response plus `parse_errors` as JSON.         |

Each row needs `channel` (`mechanical`, `correction`, `behavioral`, `resolution`, `computable`,
`proxy`) and `kind`, plus a target (`request_id`, `artifact_id` or `artifact_key`). Only the known
outcome fields are forwarded (`request_id`, `artifact_id`, `artifact_key`, `claim_id`,
`claim_key`, `alternative_id`, `evidence_hash`, `observed_at`, `source_event_id`,
`supersedes_event_id`, `tool_error_class`, `artifact_version`, `confidence`, `value`); any other
column, including `source`, `producer` or `learning_use`, is dropped, because provenance is
assigned by the gateway. A row without `source_event_id` gets a deterministic one derived from its
content, so re-importing the same file produces duplicates, not new events.

```bash
ur outcomes import tickets.csv --map artifact_key=ticket_id --map kind=status_kind
```

```text
ultrarouter outcomes import — 2 sent · accepted 2  duplicate 0  conflict 0  rejected 0
```

Exit 0 when every row is accepted or a duplicate; 2 when any row was rejected (by parsing or by the
gateway, each listed on stderr) or on a read/API error; 1 without a file.

## `ur outcomes pending`

List claims that are still awaiting resolution (keyset-paginated).

```text
ur outcomes pending [--state pending|overdue] [--archetype <a>] [--since <iso>]
          [--limit <n>] [--cursor <c>] [--json] [--base-url <url>] [--api-key <key>]
```

| Flag                       | Default | Description                                   |
| -------------------------- | ------- | --------------------------------------------- |
| `--state pending\|overdue` | both    | Filter by state.                              |
| `--archetype <a>`          | all     | Filter by artifact archetype.                 |
| `--since <iso>`            | none    | Only claims created at or after this instant. |
| `--limit <n>`              | `50`    | Page size (1–200).                            |
| `--cursor <c>`             | none    | The `next_cursor` from the previous page.     |
| `--json`                   | off     | Print the response as JSON.                   |

```text
ultrarouter pending claims (overdue) — 1 shown
  overdue  ticket-4821 · answer/resolved (claim clm_…)  resolves_by 2026-01-12T00:00:00.000Z
  … more: --cursor cur_…
```

## `ur flywheel status`

Read usage, integration health and the learning block (`GET /v1/flywheel/status`).

```text
ur flywheel status [--json] [--base-url <url>] [--api-key <key>]
```

```text
ultrarouter flywheel status — workspace ws_… · period 2026-01
  captured: 1240 artifacts · 3310 accepted outcomes
  analysis units: reserved 0 / settled 0  · eval compute settled $0.00
  channels: mechanical(2900), resolution(410)
  imports: 2 total · 2 completed · 0 failed
  learning: unavailable (collecting) · calibration unavailable
```

## `ur flywheel calibration`

Print the learning block of the same status read: the flywheel class and whether calibration is
available, exactly as the gateway declares them. While the workspace is still collecting evidence
the gateway reports calibration as unavailable, and the CLI says so instead of inventing figures.

```text
ur flywheel calibration [--json] [--base-url <url>] [--api-key <key>]
```

```text
ultrarouter flywheel calibration
  flywheel class: unavailable (collecting)
  calibration available: no
  active levers: none
  (the server reports calibration unavailable — no lift is claimed while collecting)
```

## `ur context lint`

Scan prompt files for patterns the [context runtime](./context-runtime.md) is designed to replace.
It reads files only and never modifies them. Rules:

| Rule                      | Severity | Flags                                                                                          |
| ------------------------- | -------- | ---------------------------------------------------------------------------------------------- |
| `oversized_prompt`        | warn     | An instruction surface estimated above `--max-prompt-tokens` (default 2000; characters / 4).   |
| `untrusted_interpolation` | warn     | A `${…}` interpolation of a user-, document- or search-like identifier on an instruction line. |
| `inline_exemplars`        | info     | A line with several few-shot markers (`example`, `q:`, `a:`, `input:`, `output:`).             |

```text
ur context lint <path>... [--strict] [--max-warnings <n>] [--max-prompt-tokens <n>] [--json]
```

| Flag                      | Default  | Description                                                                |
| ------------------------- | -------- | -------------------------------------------------------------------------- |
| `<path>...`               | required | One or more files.                                                         |
| `--strict`                | off      | Fail (exit 2) when `warn` findings exceed `--max-warnings`.                |
| `--max-warnings <n>`      | `0`      | The `warn` budget under `--strict` (setting it also turns strict mode on). |
| `--max-prompt-tokens <n>` | `2000`   | The oversized-prompt threshold.                                            |
| `--json`                  | off      | Print the `ur.context-lint.v1` JSON result.                                |

<!-- doctest: exit 2 — the example file has one warning, so `--strict` fails, as the output below shows -->

```bash
ur context lint src/prompts/*.ts --strict
```

```text
ultrarouter context lint — 1 file(s) · 1 warning(s), 1 info
  src/prompts/support.ts:1  [warn] untrusted_interpolation — untrusted value `userInput` interpolated into an instruction surface; keep untrusted content in a fenced reference slot, never an instruction
  src/prompts/support.ts:2  [info] inline_exemplars — inline few-shot examples detected; move them into exemplar modules the runtime can admit and shed by budget
```

Advisory by default (exit 0). With `--strict`, exit 2 when the `warn` count exceeds the budget;
`info` findings never fail. An unreadable file exits 2; no paths exits 1.

## `ur pack validate`

Validate a [knowledge pack](./context-runtime.md) file (`*.ur.md`): its schema and
closed vocabularies, the trust and slot rules, and its recomputed `content_hash` and
`provenance_hash`, failing closed with named refusals.

```text
ur pack validate <file> [--workspace <id>] [--require-export-consent] [--json]
```

| Flag                       | Default  | Description                                                                         |
| -------------------------- | -------- | ----------------------------------------------------------------------------------- |
| `<file>`                   | required | The `*.ur.md` pack.                                                                 |
| `--workspace <id>`         | none     | Refuse a pack owned by a different workspace (`TENANT_MISMATCH`).                   |
| `--require-export-consent` | off      | Refuse a pack whose consent block does not grant export (`EXPORT_CONSENT_REVOKED`). |
| `--json`                   | off      | Print `{ ok, id, kind, content_hash }` (or `{ ok: false, refusals }` on stderr).    |

```bash
ur pack validate knowledge/release-checklist.ur.md --workspace ws_fixture --require-export-consent
```

```text
valid: pack_release_checklist (sop) @ 085a7b4f03fc…
```

A tampered pack is refused with `CONTENT_HASH_MISMATCH`; an unknown format token with
`UNSUPPORTED_FORMAT`. Exit 0 when valid, 2 when refused or unreadable, 1 without a file. Use it in
CI to gate a pack before it is merged.

## `ur --help` and `ur --version`

```bash
ur --help      # also: ur -h, ur help — prints the usage to stdout, exit 0
ur --version   # also: ur -v, ur version — prints the package version, exit 0
```

`ur` with no arguments prints the usage to stderr and exits 1, as does an unknown command.

## JSON output schemas

Commands with `--json` print one JSON document to stdout; human-readable progress goes to stderr,
so stdout stays machine-readable. Versioned documents carry a `schema` tag that changes only when
the structure changes.

| Command                                                                                                         | `schema`                     | Top-level fields                                                                                                                                                                                                                                                                                                                                |
| --------------------------------------------------------------------------------------------------------------- | ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ur bench run --json`, `ur bench gate --json`                                                                   | `ur.bench.gate.v1`           | `suite`, `run_tag`, `bench_run_id`, `baseline_run_id`, `baseline_ref`, `compare`, `verdict` (`pass`, `fail`, `inconclusive` or `error`), `exit_code`, `allow_inconclusive`, `gate` (the full gate object, or `null`), `error`                                                                                                                   |
| `ur app-ci --json`                                                                                              | `ur.app-ci.v1`               | `repository`, `base_sha`, `head_sha`, `fork`, `detection` (`affected_workflows`, `unmapped`, `needs_configuration`), `workflows[]` (`workflow_id`, `headline`, `conclusion`, `coverage`, `surfaces`, `evidence_hash`, `stale`, `gate_verdict`, `reasons`, `application`), `exit_code`                                                           |
| `ur flywheel-pr --json`                                                                                         | `ur.flywheel-pr.v1`          | `candidate`, `plan` (`shape`, `destination_branch`, `base_branch`, `changed_paths`, `classification`, `payload_hash`, `diff_sha256`), `delivery` (`mode`, `applied`, `reason`, `repository_write`, `pull_request`, `patch_path`, `merged: false`), `app_ci`, `rollout` (`unlocked`, `pressed: false`, `blockers`, `evidence_hash`), `exit_code` |
| `ur flywheel-pr decision`                                                                                       | `ur.flywheel-pr.decision.v1` | `candidate_ref`, `callback_id`, `decision`, `actor_id`, `status`, `reason`                                                                                                                                                                                                                                                                      |
| `ur context lint --json`                                                                                        | `ur.context-lint.v1`         | `files`, `warn_count`, `info_count`, `strict`, `max_warnings`, `findings[]` (`path`, `line`, `severity`, `rule`, `message`)                                                                                                                                                                                                                     |
| `ur import --json`, `ur outcomes pending --json`, `ur flywheel status --json`, `ur flywheel calibration --json` | none                         | The gateway's response object, unchanged.                                                                                                                                                                                                                                                                                                       |
| `ur outcomes import --json`                                                                                     | none                         | The batch response plus `parse_errors`.                                                                                                                                                                                                                                                                                                         |
| `ur pack validate --json`                                                                                       | none                         | `{ "ok": true, "id", "kind", "content_hash" }`.                                                                                                                                                                                                                                                                                                 |

`ur app-ci --json` and `ur flywheel-pr --json` contain aggregates and addresses only: no prompt,
response or module body, and no sealed evaluation case.
