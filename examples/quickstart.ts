/**
 * Quickstart: one chat completion through the gateway.
 *
 * Run: ULTRAROUTER_API_KEY=ur_sk_test_... npx tsx examples/quickstart.ts
 */
import UltraRouter from '@ultrarouter/sdk';

// Reads ULTRAROUTER_API_KEY (or UR_API_KEY) and ULTRAROUTER_BASE_URL (or UR_BASE_URL) from the environment.
const ur = new UltraRouter({ defaultModel: 'openai/gpt-5.2-mini' });

const completion = await ur.chat.completions.create({
  messages: [
    { role: 'system', content: 'You are a concise assistant.' },
    { role: 'user', content: 'Name one prime number.' },
  ],
});

console.log(completion.choices[0]?.message.content);
// Every response carries the ultrarouter `ur` block: the request id, the model that served it, and the cost.
console.log(completion.ur.request_id, completion.ur.model_served, completion.ur.cost_usd);
