// The headline acceptance: a raw-model PASS with an application SCHEMA FAILURE must BLOCK. End-to-end against the REAL built bin + a stub gateway (the compare gate
// says `pass`) + a stub GitHub API, driving a real git fixture through the customer harness:
// 1. offline replay (raw model compare) = pass, BUT the candidate APPLICATION test fails a schema
// check ⇒ Regression found ⇒ Check Run `failure` ⇒ exit 2 (branch protection blocks).
// 2. a DIRECT model-call comparison (coverage: model_call_only) that PASSES can never claim
// application coverage ⇒ Needs evidence (a labeled non-success).
// 3. secrets in a debug excerpt are REDACTED; the "up to 3" debug cap holds; no keys in the comment.
import { makeGitFixture, writeConfig, runBin, makeChecker, HARNESS_DIR, join } from './lib.mjs';
import { startStubGitHub } from './stub-github.mjs';
import { startStubGateway, gateFixture } from './stub-gateway.mjs';

async function main() {
  const { check, done } = makeChecker('raw-model pass + application schema failure must BLOCK');
  const gh = await startStubGitHub();
  // The offline compare gate PASSES for both workflows' bound run ids (the "raw-model pass").
  const gw = await startStubGateway({
    br_e2e_app: gateFixture('pass'),
    br_e2e_model: gateFixture('pass'),
  });

  const fx = makeGitFixture({
    baseFiles: { 'prompts/checkout/system.txt': 'v1', 'prompts/reco/system.txt': 'v1' },
    headFiles: { 'prompts/checkout/system.txt': 'v2', 'prompts/reco/system.txt': 'v2' },
  });
  const configPath = writeConfig(fx.dir, {
    repository: 'acme/app',
    datasetSplit: 'holdout-a',
    evidenceEpoch: 'epoch-2026-09',
    workflows: [
      {
        id: 'wf_checkout',
        objective: 'checkout-accuracy',
        evaluatorVersion: 'eval.v3',
        coverage: 'application',
        gateRunId: 'br_e2e_app',
        testCommand: `node ${join(HARNESS_DIR, 'schema-regress.mjs')}`,
        surfaces: [{ kind: 'prompt', paths: ['prompts/checkout/**'] }],
      },
      {
        id: 'wf_reco',
        objective: 'reco-quality',
        evaluatorVersion: 'eval.v1',
        coverage: 'model_call_only',
        gateRunId: 'br_e2e_model',
        testCommand: `node ${join(HARNESS_DIR, 'model-only.mjs')}`,
        surfaces: [{ kind: 'prompt', paths: ['prompts/reco/**'] }],
      },
    ],
  });

  try {
    const r = await runBin(
      [
        'app-ci',
        '--config',
        configPath,
        '--repo',
        'acme/app',
        '--base',
        fx.baseSha,
        '--head',
        fx.headSha,
        '--pr',
        '11',
        '--changed-file',
        'prompts/checkout/system.txt',
        '--changed-file',
        'prompts/reco/system.txt',
        '--base-url',
        gw.url,
        '--api-key',
        'ur_sk_test_x',
        '--github-api',
        gh.url,
        '--github-token',
        'trusted-publish-token',
        '--json',
      ],
      { cwd: fx.dir },
    );

    const checkout = r.json?.workflows?.find((w) => w.workflow_id === 'wf_checkout');
    const reco = r.json?.workflows?.find((w) => w.workflow_id === 'wf_reco');

    // 1. The headline acceptance — a raw-model pass + app schema failure BLOCKS.
    check(
      'raw-model pass + candidate application schema failure ⇒ Regression found (failure)',
      checkout?.headline === 'regression_found' &&
        checkout?.conclusion === 'failure' &&
        checkout?.gate_verdict === 'pass' &&
        checkout?.reasons?.includes('application_test_failed') === true,
      `headline=${checkout?.headline} gate=${checkout?.gate_verdict} reasons=${JSON.stringify(checkout?.reasons)}`,
    );
    check('the overall run BLOCKS (exit 2)', r.code === 2, `code=${r.code}`);
    check(
      'the published Check Run conclusion is `failure` (branch protection blocks; never neutral)',
      gh.state.checkRuns.some(
        (c) => c.name === 'ultrarouter app-ci / wf_checkout' && c.conclusion === 'failure',
      ),
      `checks=${JSON.stringify(gh.state.checkRuns.map((c) => [c.name, c.conclusion]))}`,
    );

    // 2. A direct model-call comparison cannot claim application coverage.
    check(
      'a passing model_call_only comparison ⇒ Needs evidence (never Ready for controlled rollout)',
      reco?.headline === 'needs_evidence' &&
        reco?.reasons?.includes('model_call_only_no_application_coverage') === true &&
        reco?.conclusion === 'action_required',
      `headline=${reco?.headline} reasons=${JSON.stringify(reco?.reasons)}`,
    );

    // 3. Redaction + the 3-excerpt cap + no keys in the comment.
    const checkoutComment = gh.state.comments.find((c) => c.body.includes('ur-app-ci:wf_checkout'));
    const body = checkoutComment?.body ?? '';
    check(
      'a leaked key in a debug excerpt is REDACTED (raw ur_sk never appears)',
      body.length > 0 &&
        !body.includes('ur_sk_live_ABCDEF0123456789abcd') &&
        body.includes('[redacted] must be masked'),
      'the raw key leaked or was not present to redact',
    );
    check(
      'an Authorization header in an excerpt is redacted WHOLE — scheme and token',
      body.includes('Authorization: [redacted]') &&
        !body.includes(['SYNTHETIC', 'REVIEW', 'TOKEN', '42'].join('_')) &&
        !body.includes('[redacted] SYNTHETIC'),
      'the bearer token (or its tail) reached the comment',
    );
    check(
      'the "up to 3" debug-excerpt cap holds (the 4th line is dropped)',
      !body.includes('FOURTH debug line'),
      'a 4th debug excerpt leaked past the cap',
    );
    check(
      'the comment SEPARATES application tests / offline replay / live evidence',
      body.includes('**Application tests**') &&
        body.includes('**Offline replay') &&
        body.includes('**Live evidence**'),
      'a stage section is missing',
    );
    check(
      'the comment carries the signed-evidence hash + a next action',
      body.includes('**Evidence**') && body.includes('**Next**'),
      'evidence/next missing',
    );
  } finally {
    fx.cleanup();
    gh.close();
    gw.close();
  }
  done();
}

main().catch((e) => {
  console.error('fatal', e);
  process.exit(1);
});
