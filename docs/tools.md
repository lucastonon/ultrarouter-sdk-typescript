# Tools (function calling)

Tools let the model ask your code to do something: look up an order, call an API, run a query.
You describe each tool with a JSON Schema; the model replies with `tool_calls` instead of text; you
run the tools and send their results back as `tool` messages; the model then answers. The request
and response shapes are the OpenAI ones.

## The full round trip

```ts
import UltraRouter, { type ChatMessage } from '@ultrarouter/sdk';

const ur = new UltraRouter({ defaultModel: 'openai/gpt-5.2-mini' });

const tools = [
  {
    type: 'function',
    function: {
      name: 'get_weather',
      description: 'Current weather for a city.',
      parameters: {
        type: 'object',
        properties: { city: { type: 'string' }, unit: { type: 'string', enum: ['c', 'f'] } },
        required: ['city'],
      },
    },
  },
];

interface ToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

const messages: ChatMessage[] = [{ role: 'user', content: 'Is it cold in Oslo right now?' }];
const first = await ur.chat.completions.create({ messages, tools, tool_choice: 'auto' });
const assistant = first.choices[0]?.message;
const calls = (assistant?.tool_calls ?? []) as ToolCall[];

if (calls.length > 0) {
  // Keep the assistant turn that asked for the tools, then answer each call.
  messages.push({ role: 'assistant', content: assistant?.content ?? null, tool_calls: calls });
  for (const call of calls) {
    const args = JSON.parse(call.function.arguments) as { city: string };
    const result = { city: args.city, temperature_c: -3 }; // your real tool runs here
    messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result) });
  }
  const final = await ur.chat.completions.create({ messages, tools });
  console.log(final.choices[0]?.message.content);
} else {
  console.log(assistant?.content);
}
```

## Choosing how tools are used

| `tool_choice`                                             | Effect                                 |
| --------------------------------------------------------- | -------------------------------------- |
| `'auto'` (default when tools are present)                 | The model decides.                     |
| `'none'`                                                  | The model answers in text.             |
| `'required'`                                              | The model must call at least one tool. |
| `{ type: 'function', function: { name: 'get_weather' } }` | The model must call that tool.         |

## Parsing arguments safely

`function.arguments` is a JSON string produced by the model. Parse it inside `try`/`catch` and
validate it (with your own checks or a schema library) before acting on it; the model can produce
arguments that are valid JSON but not what you expect.

## Streaming tool calls

With `stream: true`, tool calls arrive as fragments in `choices[0].delta.tool_calls`. Accumulate
them by `index` until the chunk whose `finish_reason` is `tool_calls`:

```ts
import UltraRouter from '@ultrarouter/sdk';

const ur = new UltraRouter({ defaultModel: 'openai/gpt-5.2-mini' });
const stream = await ur.chat.completions.create({
  stream: true,
  messages: [{ role: 'user', content: 'Weather in Lima?' }],
  tools: [
    {
      type: 'function',
      function: {
        name: 'get_weather',
        parameters: { type: 'object', properties: { city: { type: 'string' } } },
      },
    },
  ],
});

interface Fragment {
  index: number;
  id?: string;
  function?: { name?: string; arguments?: string };
}
const calls = new Map<number, { id: string; name: string; arguments: string }>();
for await (const chunk of stream) {
  for (const frag of (chunk.choices[0]?.delta.tool_calls ?? []) as Fragment[]) {
    const current = calls.get(frag.index) ?? { id: '', name: '', arguments: '' };
    current.id ||= frag.id ?? '';
    current.name += frag.function?.name ?? '';
    current.arguments += frag.function?.arguments ?? '';
    calls.set(frag.index, current);
  }
}
console.log([...calls.values()]);
```

## When a model cannot use tools

If the selected model cannot honour tools, the gateway refuses the request with
`capability_unsupported` (HTTP 400) rather than silently dropping them. Pick a model whose
`capabilities` include tools (`ur.models.list({ capability: 'tools' })`).

```ts
import UltraRouter, { isUltraRouterError } from '@ultrarouter/sdk';

const ur = new UltraRouter();
try {
  await ur.chat.completions.create({
    model: 'example/no-tools',
    messages: [{ role: 'user', content: 'hi' }],
    tools: [{ type: 'function', function: { name: 'noop', parameters: { type: 'object' } } }],
  });
} catch (err) {
  if (isUltraRouterError(err, 'capability_unsupported')) console.log('choose a tool-capable model');
  else throw err;
}
```

## Related

- [Chat completions](./chat-completions.md) · [Structured outputs](./structured-outputs.md)
- [Streaming](./streaming.md) · [Models](./models.md)
- Runnable example: [`examples/tools.ts`](../examples/tools.ts)
