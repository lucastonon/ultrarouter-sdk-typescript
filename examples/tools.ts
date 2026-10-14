/**
 * Tools (function calling): the model asks for a tool call, your code runs the tool, and you send
 * the result back so the model can answer.
 *
 * Run: ULTRAROUTER_API_KEY=ur_sk_test_... npx tsx examples/tools.ts
 */
import UltraRouter, { type ChatMessage } from '@ultrarouter/sdk';

const ur = new UltraRouter({ defaultModel: 'openai/gpt-5.2-mini' });

const tools = [
  {
    type: 'function',
    function: {
      name: 'get_order_status',
      description: 'Look up the shipping status of an order.',
      parameters: {
        type: 'object',
        properties: { order_id: { type: 'string' } },
        required: ['order_id'],
      },
    },
  },
];

// Your implementation of the tool.
function getOrderStatus(orderId: string): { order_id: string; status: string } {
  return { order_id: orderId, status: 'shipped' };
}

const messages: ChatMessage[] = [{ role: 'user', content: 'Where is order 4711?' }];

const first = await ur.chat.completions.create({ messages, tools, tool_choice: 'auto' });
const reply = first.choices[0]?.message;
const calls = (reply?.tool_calls ?? []) as {
  id: string;
  function: { name: string; arguments: string };
}[];

if (calls.length === 0) {
  console.log('No tool call; the model answered directly:', reply?.content);
} else {
  // 1. Keep the assistant turn that requested the tools.
  messages.push({ role: 'assistant', content: reply?.content ?? null, tool_calls: calls });
  // 2. Run each tool and append its result as a `tool` message.
  for (const call of calls) {
    const args = JSON.parse(call.function.arguments) as { order_id: string };
    const result = getOrderStatus(args.order_id);
    console.log(`tool ${call.function.name}(${call.function.arguments}) ->`, result);
    messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result) });
  }
  // 3. Ask again with the tool results; the model now answers in text.
  const second = await ur.chat.completions.create({ messages, tools });
  console.log('answer:', second.choices[0]?.message.content);
}
