/**
 * Models: list the catalog your key can use, filter it, and inspect one model's offers.
 *
 * Run: ULTRAROUTER_API_KEY=ur_sk_test_... npx tsx examples/models.ts
 */
import UltraRouter from '@ultrarouter/sdk';

const ur = new UltraRouter();

const all = await ur.models.list();
for (const m of all.data) {
  console.log(
    `${m.id.padEnd(32)} ctx=${String(m.context_length)} in=$${String(m.pricing.input_usd_per_1m)}/1M out=$${String(m.pricing.output_usd_per_1m)}/1M`,
  );
}

const withTools = await ur.models.list({ capability: 'tools' });
console.log(`${String(withTools.data.length)} models support tools`);

const first = all.data[0];
if (first !== undefined) {
  // The id is provider-prefixed; the SDK keeps the `/` when it builds the URL.
  const detail = await ur.models.retrieve(first.id);
  console.log(detail.id, 'weights:', detail.weights, 'origin:', detail.origin_jurisdiction);
  console.log('offers:', detail.offers.length);
}
