# GitHub Action

This repository is also a GitHub Action (`action.yml` at the repository root). It installs the
[`ur` CLI](./cli.md) from the npm registry and runs one of three gates.

> **Availability:** `@ultrarouter/sdk` is not published to the npm registry yet, so the action's
> install step cannot succeed today. Until it is, run the `ur` CLI in your workflow from a build of
> this repository (check it out, `npm ci && npm run build && npm pack`, then
> `npm install --global ./ultrarouter-sdk-<version>.tgz`) and call `ur` directly with the same
> arguments the action would pass.

The three gates:

| `mode`            | What it does                                                                                                                                                                                                                              | Fails the job when                                                                                                              |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `bench` (default) | Runs a [Bench](./bench.md) suite (optionally capturing traffic from your tests first) and reads the baseline-compare gate.                                                                                                                | The verdict is `fail`, or `inconclusive` without `allow-inconclusive`, or anything errors.                                      |
| `app-ci`          | Runs your application's own test or replay command on the baseline and candidate revisions of every workflow the change touches, and publishes one PR comment and one Check Run per workflow.                                             | Any workflow is not `Ready for controlled rollout` (a regression, missing evidence, or an unmapped change), or anything errors. |
| `flywheel-pr`     | Turns a screened flywheel candidate into a reviewable change (attached to a PR, a new draft PR, or a downloadable patch), runs the same application check with the candidate bound, and reports whether a controlled rollout is unlocked. | The bound application check is not a success, or anything errors.                                                               |

Every mode fails closed: a broken gate or missing evidence never produces a green check, the action
never merges a pull request, and it never starts a rollout or adopts a candidate.

- [Quick start](#quick-start)
- [Inputs](#inputs) · [Outputs](#outputs)
- [Permissions (least privilege)](#permissions-least-privilege)
- [`mode: bench`](#mode-bench) · [`mode: app-ci`](#mode-app-ci) · [`mode: flywheel-pr`](#mode-flywheel-pr)
- [Fork pull requests and secrets](#fork-pull-requests-and-secrets)
- [The fail-closed dispatch guard](#the-fail-closed-dispatch-guard)
- [Pinning versions](#pinning-versions)
- [Troubleshooting](#troubleshooting)

## Quick start

```yaml
# .github/workflows/bench-gate.yml
name: bench gate
on: pull_request

permissions:
  contents: read

jobs:
  bench:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: lucastonon/ultrarouter-sdk-typescript@v0.0.1
        with:
          mode: bench
          suite: checkout
          api-key: ${{ secrets.ULTRAROUTER_TEST_KEY }}
          capture: npm ci && npm run test:e2e
          baseline: bench:main
          sdk-version: '0.0.1'
```

## Inputs

All inputs are strings (GitHub passes action inputs as strings), and none is marked required at
the action level: the dispatch guard checks the ones each mode needs.

**Inputs are data.** No step of the action places an input inside shell source: each input reaches
the step as an environment variable, is validated (an exact `sdk-version`, positive numbers,
`request`/`task`, `true`/`false`, a suite or baseline that cannot be read as a flag) and is passed to
`ur` as a single argument. A `$(…)`, a backtick or a `;` in an input is never evaluated. The one
exception is deliberate: **`capture` is a shell command** and is executed (once, by `ur bench run
--capture`), so never fill it from pull-request text. The action's own third-party steps are
pinned to full commit SHAs.

### Shared

| Input                | Default                | Description                                                                                                                                               |
| -------------------- | ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `mode`               | `bench`                | Which gate to run: `bench`, `app-ci` or `flywheel-pr`.                                                                                                    |
| `api-key`            | `''`                   | Your ultrarouter API key. Store it as a secret. Use a test key (`ur_sk_test_…`) for Bench. Passed to the CLI as `UR_API_KEY`.                             |
| `base-url`           | (required; no default) | The gateway base URL; point it at your own deployment to self-host (there is no hosted gateway). Passed as `UR_BASE_URL`.                                 |
| `allow-inconclusive` | `false`                | When `true`, an inconclusive gate (Bench verdict, or the app-ci offline gate) passes instead of failing the job.                                          |
| `sdk-version`        | `0.1.0` (this release) | The `@ultrarouter/sdk` version to install for the CLI. Defaults to the version of the action release you reference, so a pinned action runs a pinned CLI. |

### `mode: bench`

| Input          | Default      | Description                                                                                                                                                                                                                               |
| -------------- | ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `suite`        | `''`         | The Bench suite slug. Required for this mode.                                                                                                                                                                                             |
| `baseline`     | `bench:main` | A run id (`br_…`) or a symbolic ref that resolves to the suite's pinned baseline. The gate compares against it.                                                                                                                           |
| `budget`       | `3`          | The run's cost cap in USD.                                                                                                                                                                                                                |
| `capture`      | `''`         | A shell command that drives your app or tests through the gateway with Bench capture on (`UR_BENCH` and `UR_BENCH_RUN` are exported for it). It is executed: pass only a command you control. Omit it if you capture traffic another way. |
| `cost-ceiling` | `''`         | An absolute per-unit cost ceiling in USD; a breach fails the gate.                                                                                                                                                                        |
| `paired-mode`  | `request`    | The paired-run mode: `request` or `task` (whole traces).                                                                                                                                                                                  |
| `pin-baseline` | `false`      | On a `pass`, make this run the suite's new baseline.                                                                                                                                                                                      |
| `run-tag`      | `''`         | The run tag; defaults to the commit SHA.                                                                                                                                                                                                  |

### `mode: app-ci` (also used by `flywheel-pr`)

| Input                    | Default                 | Description                                                                                                                                                                               |
| ------------------------ | ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `config`                 | `ur-app-ci.config.json` | Path to the [app-ci config file](./cli.md#the-app-ci-config-file). Required for `app-ci` and `flywheel-pr`.                                                                               |
| `base-sha`               | `''`                    | The baseline commit. Default: the pull request base (`github.event.pull_request.base.sha`).                                                                                               |
| `head-sha`               | `''`                    | The candidate commit. Default: `github.sha`. It must be the commit `actions/checkout` checked out (set its `ref:` to the same SHA), or the step fails with `candidate_revision_mismatch`. |
| `pr-number`              | `''`                    | The pull request to comment on. Default: the event's pull request.                                                                                                                        |
| `changed-from`           | `''`                    | A file with one changed path per line. Default: `git diff --name-only base..head`, which needs both commits (`fetch-depth: 0`); if they are missing the step fails instead of passing.    |
| `fork`                   | `''`                    | `true` forces fork mode (detection and comment only; the harness never runs), `false` disables it, empty auto-detects a fork pull request. Applies to `app-ci` and `flywheel-pr`.         |
| `asserted-evidence-hash` | `''`                    | One or more previously sealed evidence hashes (`[workflow=]<hash>`, whitespace-separated); a mismatch marks the result stale.                                                             |
| `github-token`           | `${{ github.token }}`   | The token used to publish the comment and the Check Run (needs `checks: write` and `pull-requests: write`). It is never passed to your harness.                                           |

### `mode: flywheel-pr`

| Input           | Default         | Description                                                                                                                                                                             |
| --------------- | --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `candidate`     | `''`            | Path to the screened candidate export JSON. Required for this mode. Only `screened` candidates are accepted; an adopted one is refused by name.                                         |
| `change-shape`  | `gateway_owned` | `gateway_owned` (a candidate reference in the app-ci config, plus a linked payload diff) or `code_owned` (a file diff on a configured context or prompt surface).                       |
| `module-path`   | `''`            | Where a `code_owned` candidate writes its module (must match a configured surface).                                                                                                     |
| `delivery-mode` | `auto`          | `auto` (attach to the event PR if there is one, else open a draft PR), `attach`, `open_pr` or `patch`. Without repository write access every value resolves to `patch`.                 |
| `apply-changes` | `false`         | Opt in to writing (a commit, a branch and a PR, or the patch file). By default the action shows the diff and the destination branch and runs the check without touching the repository. |
| `base-branch`   | `main`          | The branch a newly opened PR targets.                                                                                                                                                   |
| `patch-out`     | `''`            | Directory for the downloadable patch (default: the workspace).                                                                                                                          |

## Outputs

The action declares no `outputs:`. Its results are:

- the **job status** (the gate's exit code: success only when the gate passes);
- for `app-ci` and `flywheel-pr`, one **Check Run** per workflow (named `ultrarouter app-ci / <workflow id>`) and one **PR comment** per workflow, updated in place on re-runs;
- the CLI's **`--json` result** in the step log (`ur.bench.gate.v1`, `ur.app-ci.v1` or `ur.flywheel-pr.v1`; see [JSON output schemas](./cli.md#json-output-schemas));
- for `flywheel-pr` with `apply-changes: true`, a branch and draft PR, or a patch file in `patch-out` that you can upload with `actions/upload-artifact`.

## Permissions (least privilege)

A composite action cannot declare `permissions:`; set them on the workflow or the job. Grant only
what the mode needs:

| Mode                                         | `permissions:`                                                               |
| -------------------------------------------- | ---------------------------------------------------------------------------- |
| `bench`                                      | `contents: read`                                                             |
| `app-ci`                                     | `contents: read`, `checks: write`, `pull-requests: write`                    |
| `flywheel-pr` (default, plan and check only) | `contents: read`, `checks: write`, `pull-requests: write`                    |
| `flywheel-pr` with `apply-changes: true`     | the above plus `contents: write` (to create the candidate branch and commit) |

`contents: write` is a separate opt-in and the `app-ci` gate never needs it. Without it,
`flywheel-pr` does not fail: it produces a downloadable patch and runs the identical check.

## `mode: bench`

```yaml
name: bench gate
on: pull_request

permissions:
  contents: read

jobs:
  bench:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: lucastonon/ultrarouter-sdk-typescript@v0.0.1
        with:
          mode: bench
          suite: checkout
          api-key: ${{ secrets.ULTRAROUTER_TEST_KEY }}
          base-url: https://gateway.example.com
          capture: npm ci && npm run test:e2e
          baseline: bench:main
          budget: '3'
          cost-ceiling: '0.002'
          paired-mode: request
          allow-inconclusive: 'false'
          sdk-version: '0.0.1'
```

The step runs `ur bench run <suite> --gate --json --baseline <baseline> --budget <budget> --mode
<paired-mode>` (plus `--capture`, `--cost-ceiling`, `--run-tag`, `--allow-inconclusive` and
`--pin-baseline` when set). Your `capture` command sees `UR_BENCH`, `UR_BENCH_RUN`, `UR_API_KEY`
and `UR_BASE_URL`, so an app that uses this SDK captures traffic with no code change.

To advance the baseline after merges, run the same step on `push` to `main` with
`pin-baseline: 'true'`.

## `mode: app-ci`

```yaml
name: app ci
on: pull_request

permissions:
  contents: read
  checks: write
  pull-requests: write

jobs:
  app-ci:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0 # the baseline revision is checked out in a git worktree
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
      - run: npm ci
      - uses: lucastonon/ultrarouter-sdk-typescript@v0.0.1
        with:
          mode: app-ci
          config: ur-app-ci.config.json
          api-key: ${{ secrets.ULTRAROUTER_API_KEY }} # only needed for workflows with a gateRunId
          sdk-version: '0.0.1'
```

The step runs `ur app-ci --config <config> --json` with the base SHA, head SHA and PR number taken
from the event (or from `base-sha`, `head-sha` and `pr-number`). See
[`ur app-ci`](./cli.md#ur-app-ci) for how the outcome is decided, the config file and the harness
contract. Make the Check Run a required status check in your branch protection rules to block
merges on a regression or on missing evidence.

## `mode: flywheel-pr`

The candidate file is the screened candidate exported from the ultrarouter dashboard. Commit it, or
fetch it in an earlier step, and run the gate by hand or on a schedule:

```yaml
name: flywheel candidate
on:
  workflow_dispatch:
    inputs:
      candidate:
        description: Path to the screened candidate JSON
        required: true
        default: .ultrarouter/candidate.json

permissions:
  contents: write # only because apply-changes is true below
  checks: write
  pull-requests: write

jobs:
  candidate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - run: npm ci
      - uses: lucastonon/ultrarouter-sdk-typescript@v0.0.1
        with:
          mode: flywheel-pr
          config: ur-app-ci.config.json
          candidate: ${{ inputs.candidate }}
          change-shape: gateway_owned
          delivery-mode: open_pr
          apply-changes: 'true'
          base-branch: main
          api-key: ${{ secrets.ULTRAROUTER_API_KEY }}
          sdk-version: '0.0.1'
```

Without `apply-changes: 'true'` the run prints the plan (the diff and the destination branch) and
runs the check, writing nothing. Without `contents: write` (or with `delivery-mode: patch`) it
writes a patch file instead; upload it so a human can apply it:

```yaml
- uses: actions/upload-artifact@v4
  if: always()
  with:
    name: ultrarouter-candidate-patch
    path: ./*.patch
```

The PR is opened as a draft and is never merged by the action. The rollout section of the comment
shows whether the gateway unlocked a controlled rollout and, if not, every blocker by name; the
rollout itself is started by a person in the dashboard. Record a human decision with
[`ur flywheel-pr decision`](./cli.md#ur-flywheel-pr-decision).

## Fork pull requests and secrets

Never run untrusted pull-request code with secrets, and do not use `pull_request_target` to check
out and run a fork's code.

- **Default:** on a fork pull request the `app-ci` and `flywheel-pr` modes auto-detect the fork (or
  set `fork: 'true'`) and run in detection-only mode: they map the changed paths, never execute your
  harness, and post a `Needs evidence` comment and check. On `pull_request` from a fork GitHub gives the job no
  secrets and a read-only token, so the comment may not be publishable; the job still fails closed.
- **Two jobs:** if you need the harness to run on fork changes, run it in an untrusted
  `pull_request` job with no secrets, upload its result, and publish from a separate trusted job.

Even on trusted runs, the CLI removes `GITHUB_TOKEN`, `UR_API_KEY`, `ULTRAROUTER_API_KEY`,
`NPM_TOKEN` and the Python index tokens from your harness's environment; the publication token is
used only to post the comment and the check.

## The fail-closed dispatch guard

The first step of the action always runs (it has no `if:`) and validates `mode`. An unknown value,
an empty value, or the legacy values `request` / `task` (moved to `paired-mode`) fail the job with
an explanatory error, as does a missing prerequisite (`suite` for `bench`, `config` for `app-ci`,
`config` and `candidate` for `flywheel-pr`). The action therefore can never finish successfully
having run no gate, so a required check can never turn green with zero evidence. The contract
batteries execute this guard on every change to `action.yml`.

## Pinning versions

- Reference the action by a release tag (`@v0.0.1`) or, for the strictest supply-chain posture, by
  the full commit SHA of that release.
- `sdk-version` defaults to the version of the action release you reference, so the CLI is pinned
  with it. Override it only to test another CLI version (`latest` makes runs non-reproducible).
- The action installs Node.js 22 (`actions/setup-node`) and runs `npm install -g
@ultrarouter/sdk@<sdk-version>`.

## Troubleshooting

| Symptom                                                                | Cause and fix                                                                                                                                           |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `::error::ur action (mode: bench) requires a non-empty 'suite' input.` | Set `suite`. The same pattern applies to `config` and `candidate`.                                                                                      |
| `'mode: request' is no longer valid`                                   | `mode` selects the gate; move `request`/`task` to `paired-mode` and set `mode: bench`.                                                                  |
| The Bench gate fails with `--gate requires --baseline <ref>`           | Set `baseline` (the default `bench:main` resolves to the pinned baseline; pin one first with `ur bench baseline <run-id>` or `pin-baseline: 'true'`).   |
| `Needs evidence` with `missing_evaluator`                              | A workflow names a `suite` but no `gateRunId`; add the compare run id, or remove `suite`.                                                               |
| `Needs evidence` with `gate_error:no api key…`                         | A workflow has a `gateRunId` but no `api-key` was given.                                                                                                |
| `Needs evidence` with `baseline_no_replay`                             | The baseline revision could not be checked out; use `fetch-depth: 0` in `actions/checkout`.                                                             |
| `candidate_revision_mismatch` / `candidate_worktree_modified`          | The checkout is not `head-sha`, or a tracked file was changed after checkout. Check out the same SHA you pass (`ref:`), and commit or drop local edits. |
| `Needs configuration`                                                  | A changed path matches no surface in the config; add it to a workflow's `surfaces`, or to a workflow that ignores it deliberately.                      |
| `Needs evidence` with `fork_no_execution`                              | A fork pull request: expected (the harness never runs with secrets on forks).                                                                           |
| No comment appears                                                     | The job lacks `pull-requests: write` / `checks: write`, there is no pull request number, or the token is read-only (fork).                              |
| `flywheel-pr` produced a patch instead of a PR                         | No `contents: write`, an unreadable permission probe, or `delivery-mode: patch`. This is the intended safe path.                                        |
| The rollout section says `authorization_unavailable`                   | The gateway's rollout decision could not be read (no `api-key` / `base-url`, or an error). CI never unlocks a rollout without it.                       |

See also: [CLI reference](./cli.md), [Bench](./bench.md), [Troubleshooting](./troubleshooting.md).
