/**
 * Streaming: print a chat completion as it is generated, then read the final `ur` block.
 *
 * Run: ULTRAROUTER_API_KEY=ur_sk_test_... npx tsx examples/streaming.ts
 */
import UltraRouter from '@ultrarouter/sdk';

const ur = new UltraRouter({ defaultModel: 'openai/gpt-5.2-mini' });

const stream = await ur.chat.completions.create({
  stream: true,
  messages: [{ role: 'user', content: 'Write one sentence about the sea.' }],
});

let text = '';
for await (const chunk of stream) {
  const delta = chunk.choices[0]?.delta.content ?? '';
  text += delta;
  process.stdout.write(delta);
  // The final chunk carries token usage and the ultrarouter `ur` block.
  if (chunk.ur !== undefined) {
    process.stdout.write('\n');
    console.log(`request ${chunk.ur.request_id} served by ${chunk.ur.model_served}`);
    console.log(
      `tokens: ${String(chunk.usage?.total_tokens)}, cost: $${String(chunk.ur.cost_usd)}`,
    );
  }
}

if (text === '') throw new Error('expected streamed text');
