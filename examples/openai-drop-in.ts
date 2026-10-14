/**
 * OpenAI drop-in: keep using the official `openai` client, pointed at the gateway.
 *
 * Run: npm i openai && ULTRAROUTER_API_KEY=ur_sk_test_... npx tsx examples/openai-drop-in.ts
 */
import OpenAI from 'openai';
import UltraRouter from '@ultrarouter/sdk';

const ur = new UltraRouter();

// Option 1: let the SDK construct the OpenAI client (base URL with /v1, API key, default headers).
const openai = ur.asOpenAI(OpenAI);
const res = await openai.chat.completions.create({
  model: 'openai/gpt-5.2-mini',
  messages: [{ role: 'user', content: 'Say hi.' }],
});
console.log(res.choices[0]?.message.content);

// Option 2: take the configuration and build the client yourself.
const config = ur.asOpenAI();
console.log('baseURL:', config.baseURL);
const custom = new OpenAI({ ...config, maxRetries: 1 });
const models = await custom.models.list();
console.log('models:', models.data.length);
