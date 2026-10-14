/**
 * Feedback, generation stats and key info for a served request.
 *
 * Run:
 *
 *   ULTRAROUTER_API_KEY=ur_sk_test_... npx tsx examples/feedback-and-generation.ts
 *
 * See docs/feedback-and-generation.md.
 */
import UltraRouter from '@ultrarouter/sdk';

const ur = new UltraRouter({ defaultModel: 'openai/gpt-5.2-mini' });

// Check the key first: which scopes it has and what it spent this period.
const key = await ur.ur.key.get();
console.log(`key "${key.name}" (${key.mode}) scopes: ${key.scopes.join(', ')}`);

const res = await ur.chat.completions.create({
  messages: [{ role: 'user', content: 'Summarise our refund policy in one sentence.' }],
});
const requestId = res.ur.request_id;
console.log(`request ${requestId}: ${res.choices[0]?.message.content ?? ''}`);

// A thumbs-down with tags and a comment.
const feedback = await ur.ur.requests.feedback(requestId, {
  rating: -1,
  tags: ['missed_exception'],
  comment: 'Did not mention the 30-day window.',
});
console.log(`feedback ${feedback.id} recorded (rating ${String(feedback.rating)})`);

// Tokens, cost, timing and routing for the same request.
const stats = await ur.ur.generation.get(requestId);
console.log(
  `${stats.model_served ?? 'n/a'}: ${String(stats.tokens.total)} tokens, ${String(stats.cost.total_usd)} USD, ${String(stats.timing.latency_ms)} ms`,
);
