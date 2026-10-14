/**
 * The typed escape hatch: call any operation in the OpenAPI document, with typed parameters and
 * results, through the same transport as every other method.
 *
 * Run:
 *
 *   ULTRAROUTER_API_KEY=ur_sk_test_... npx tsx examples/typed-request.ts
 *
 * See docs/typed-requests.md.
 */
import UltraRouter, { type OperationResponse } from '@ultrarouter/sdk';

const ur = new UltraRouter();

const plans = await ur.request('get', '/v1/flywheel/plans');
console.log(`${String(plans.plans.length)} learning plan(s)`);

const candidates = await ur.request('get', '/v1/flywheel/candidates');
console.log(`${String(candidates.candidates.length)} candidate(s)`);

const grant: OperationResponse<'mintExposureGrant'> = await ur.request(
  'post',
  '/v1/flywheel/grants',
  {
    body: { call_type: 'support-reply', artifact_key: 'ticket-4821' },
  },
);
console.log(`grant ${grant.grant_id} in arm ${grant.arm}`);

const evals = await ur.request('get', '/v1/call-types/{id}/evals', {
  path: { id: 'support-reply' },
});
console.log(`${String(evals.data.length)} eval run(s)`);
