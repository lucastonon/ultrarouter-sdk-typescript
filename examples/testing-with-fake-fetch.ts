/**
 * Testing your app: inject a fake `fetch` so unit tests never touch the network. Assert on the
 * request your code sends and script the response it receives (including errors).
 *
 * Run: npx tsx examples/testing-with-fake-fetch.ts  (no API key or network needed)
 */
import assert from 'node:assert/strict';
import UltraRouter, { UltraRouterError, type FetchLike } from '@ultrarouter/sdk';

// The code under test.
async function summarize(ur: UltraRouter, text: string): Promise<string> {
  const res = await ur.chat.completions.create({
    model: 'openai/gpt-5.2-mini',
    call_type: 'summarize',
    messages: [{ role: 'user', content: `Summarize: ${text}` }],
  });
  return res.choices[0]?.message.content ?? '';
}

// A fake gateway: records requests and returns canned responses.
const seen: { url: string; body: unknown }[] = [];
const fakeFetch: FetchLike = async (url, init) => {
  seen.push({ url: String(url), body: JSON.parse(String(init?.body)) });
  return Response.json({
    id: 'chatcmpl_test',
    object: 'chat.completion',
    created: 0,
    model: 'openai/gpt-5.2-mini',
    choices: [
      {
        index: 0,
        message: { role: 'assistant', content: 'A short summary.' },
        finish_reason: 'stop',
      },
    ],
    usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 },
    ur: {
      request_id: 'req_test',
      call_type: 'summarize',
      model_served: 'openai/gpt-5.2-mini',
      provider: 'openai',
      routing: { mode: 'off', fallback_used: false },
      compression: { applied: 'off' },
      cost_usd: 0,
      byok: false,
    },
  });
};

const ur = new UltraRouter({
  apiKey: 'ur_sk_test_fake',
  baseURL: 'https://gateway.test',
  fetch: fakeFetch,
  maxRetries: 0,
});
assert.equal(await summarize(ur, 'a long text'), 'A short summary.');
assert.equal(seen[0]?.url, 'https://gateway.test/v1/chat/completions');
assert.deepEqual((seen[0]?.body as { call_type: string }).call_type, 'summarize');

// Simulate a gateway error envelope.
const failing = new UltraRouter({
  apiKey: 'ur_sk_test_fake',
  baseURL: 'https://gateway.test',
  maxRetries: 0,
  fetch: async () =>
    Response.json(
      {
        error: {
          code: 'context_length',
          message: 'prompt too long',
          request_id: 'req_x',
          retryable: false,
        },
      },
      { status: 400 },
    ),
});
await assert.rejects(
  summarize(failing, 'x'),
  (err: unknown) => err instanceof UltraRouterError && err.code === 'context_length',
);

console.log('all assertions passed');
