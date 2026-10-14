# Security policy

## Supported versions

| Version | Supported                               |
| ------- | --------------------------------------- |
| 0.0.x   | Yes — fixes ship as new patch releases. |

Before 1.0.0 only the latest release receives fixes.

## Reporting a vulnerability

Please report security issues privately. Do not open a public issue for a vulnerability.

- Use GitHub's private vulnerability reporting on this repository
  (**Security → Report a vulnerability**), or
- email the maintainers through the contact listed at https://ultrarouter.dev.

Include the SDK version, your runtime (Node.js, Bun, Deno or an edge runtime and its version), a
minimal reproduction, and the impact you observed. Never include real API keys, prompts or customer
data in a report; redact them.

We acknowledge reports within three business days, keep you informed while we investigate, and
credit you in the release notes unless you prefer otherwise.

## Scope

In scope: this SDK (`@ultrarouter/sdk`), its `ur` CLI and the GitHub Action in this repository.
Issues in the ultrarouter gateway service itself should be reported the same way; we route them.

## How the SDK handles secrets

- The API key is sent only as a `Bearer` token to the base URL you configure. It is never logged.
- Reviewer events and oracle pull-transport requests are signed with HMAC-SHA256 over the exact
  bytes sent, using WebCrypto.
- Path parameters are percent-encoded; model ids are encoded per segment and `.` / `..` segments
  are refused, so an id cannot re-target a request.
- The `ur app-ci` / `flywheel-pr` commands never run a fork pull request's code with secrets, and
  scrub API keys and tokens from the environment of the commands they run. Text they publish to a
  pull request (comments, Check Runs) has credentials removed: a credential-bearing header line
  (`Authorization` with any scheme, `Cookie` / `Set-Cookie` with every pair, `X-API-Key`, `*-Token`,
  `*-Secret`, quoted or not) loses its whole value; assignments, query parameters, JSON fields and
  CLI flags with such names lose their value; known token formats, URL passwords and email addresses
  are removed wherever they appear. They also run a harness only on the checkout the evidence
  names: a checkout that is not the claimed head stops the run before anything is published.
- The GitHub Action treats every input as data (environment variables, validated, passed as single
  arguments; never interpolated into shell source). The `capture` input is the one command it
  executes, by design: never fill it from pull-request text.
- `npm run leak-scan` checks the tree, the full git history and the npm tarball for credentials,
  absolute local paths and committed secret files before every release. History paths come from
  git's own path listing (binary, empty and deleted files included), and every historical text
  blob is scanned.
- Keep API keys on the server. Do not ship them to browsers or mobile apps.
