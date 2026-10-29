/**
 * Plug-and-play learning 5/8: a delayed outcome from another system. The agent finishes now; your
 * warehouse system confirms hours later, with a signed webhook, whether the agent handled the order
 * right. The receiver verifies the HMAC signature and timestamp, deduplicates redeliveries by event
 * id, and reports with `source: 'webhook'`. Here the "warehouse" is simulated in-process: it
 * delivers once, retries the same event, and an attacker sends a forged copy.
 *
 * The secret comes from ULTRAROUTER_WEBHOOK_SECRET (shared with the sender; never logged).
 *
 * The example resolves or creates order-desk (config:read/write) and sends its slug on every call.
 * Enable learning separately for its ct_... ID after full workspace learning consent.
 *
 * Run: ULTRAROUTER_API_KEY=ur_sk_test_... ULTRAROUTER_BASE_URL=http://localhost:8080 \
 *      ULTRAROUTER_WEBHOOK_SECRET=change-me npx tsx examples/learning/05-delayed-webhook.ts
 * Expected output:
 *   request req_… finished; the outcome arrives later by webhook
 *   delivery: 200 reported · redelivery: 200 duplicate · forged: 401 bad_signature
 *   receipts for the request: 1 (resolved_true applied)
 */
import { createServer, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';

import UltraRouter, { type ChatMessage } from '@ultrarouter/sdk';
import { createOrderDesk, createWebhookReceiver, signWebhook } from '@ultrarouter/sdk/learning';

const secret = process.env.ULTRAROUTER_WEBHOOK_SECRET;
if (secret === undefined || secret === '') throw new Error('set ULTRAROUTER_WEBHOOK_SECRET');

const ur = new UltraRouter({
  defaultModel: process.env.ULTRAROUTER_MODEL ?? 'openai/gpt-5.2-mini',
});
// Keep traffic and learning controls on the same call type (config:read/write required).
const callTypes = await ur.ur.callTypes.list();
const callType =
  callTypes.data.find((ct) => ct.slug === 'order-desk') ??
  (await ur.ur.callTypes.create({ slug: 'order-desk' }));

// 1. The agent's turn: one call; keep its request id with your order reference.
const desk = createOrderDesk('s4');
const messages: ChatMessage[] = [{ role: 'user', content: `${desk.task} Reply with one line.` }];
const res = await ur.chat.completions.create({ call_type: callType.slug, messages });
const pending = { orderId: 'D-400', requestId: res.requestId };
console.log(`request ${pending.requestId} finished; the outcome arrives later by webhook`);

// 2. Your webhook endpoint: the receiver needs the raw body, exactly as received.
const receiver = createWebhookReceiver({ reporter: ur.ur.outcomes });
const readBody = async (req: IncomingMessage): Promise<string> => {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
};
const server = createServer((req, res) => {
  void readBody(req).then(async (rawBody) => {
    const result = await receiver.handle({ headers: req.headers, rawBody });
    res.writeHead(result.httpStatus, { 'content-type': 'application/json' });
    const reason = result.status === 'rejected' ? result.reason : undefined;
    res.end(JSON.stringify({ status: result.status, reason }));
  });
});
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
const endpoint = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}/hooks/warehouse`;

// 3. Later: the warehouse resolves the order and confirms the agent's handling was right (a signed
//    event), retries the same event, and a forged copy arrives with the wrong secret.
const event = JSON.stringify({
  event_id: `wh_${pending.orderId}_resolved`,
  request_id: pending.requestId,
  verdict: 'pass',
  observed_at: new Date().toISOString(),
});
const deliver = async (key: string): Promise<string> => {
  const headers = { 'content-type': 'application/json', ...(await signWebhook(key, event)) };
  const answer = await fetch(endpoint, { method: 'POST', headers, body: event });
  const body = (await answer.json()) as { status: string; reason?: string };
  return `${String(answer.status)} ${body.reason ?? body.status}`;
};
const first = await deliver(secret);
const retry = await deliver(secret);
const forged = await deliver('not-the-secret');
server.close();
console.log(`delivery: ${first} · redelivery: ${retry} · forged: ${forged}`);

// 4. The gateway holds exactly one outcome for the request.
const receipts = await ur.ur.outcomes.receiptsForRequest(pending.requestId);
const webhookReceipt = receipts.data.find((r) => r.kind === 'resolved_true');
const final =
  webhookReceipt === undefined
    ? undefined
    : await ur.ur.outcomes.waitForReceipt(webhookReceipt.id, { timeoutMs: 30_000 });
console.log(
  `receipts for the request: ${String(receipts.data.length)} (${webhookReceipt?.kind ?? 'none'} ${final?.status ?? 'missing'})`,
);
if (
  !first.startsWith('200 reported') ||
  !retry.startsWith('200 duplicate') ||
  forged !== '401 bad_signature' ||
  receipts.data.length !== 1 ||
  final?.status !== 'applied'
) {
  process.exitCode = 1;
}
