# Structured outputs

Ask the model for JSON with `response_format`. There are two modes:

- `{ type: 'json_schema', json_schema: { name, schema, strict? } }` — JSON that matches your JSON
  Schema. Prefer this whenever the model supports it.
- `{ type: 'json_object' }` — any valid JSON object (describe the shape in the prompt).

The content still arrives as a string in `choices[0].message.content`; parse it with `JSON.parse`.

## JSON Schema

```ts
import UltraRouter from '@ultrarouter/sdk';

const ur = new UltraRouter({ defaultModel: 'openai/gpt-5.2-mini' });

const schema = {
  type: 'object',
  properties: {
    sentiment: { type: 'string', enum: ['positive', 'neutral', 'negative'] },
    score: { type: 'number' },
    topics: { type: 'array', items: { type: 'string' } },
  },
  required: ['sentiment', 'score', 'topics'],
  additionalProperties: false,
};

const res = await ur.chat.completions.create({
  messages: [{ role: 'user', content: 'Review: "Fast delivery, but the box was damaged."' }],
  response_format: { type: 'json_schema', json_schema: { name: 'review', strict: true, schema } },
});

const review = JSON.parse(res.choices[0]?.message.content ?? '{}') as {
  sentiment: string;
  score: number;
  topics: string[];
};
console.log(review.sentiment, review.score, review.topics);
```

`strict: true` asks providers that support strict schema adherence to enforce it. Even so, parse
defensively and validate the result if a wrong shape would be costly.

## JSON object mode

```ts
import UltraRouter from '@ultrarouter/sdk';

const ur = new UltraRouter({ defaultModel: 'openai/gpt-5.2-mini' });
const res = await ur.chat.completions.create({
  messages: [
    { role: 'system', content: 'Reply with a JSON object: {"result": string}.' },
    { role: 'user', content: 'Translate "thank you" to Spanish.' },
  ],
  response_format: { type: 'json_object' },
});
console.log(JSON.parse(res.choices[0]?.message.content ?? '{}'));
```

## When a model cannot honour the format

A model that does not support `json_schema` is refused with `capability_unsupported` before
dispatch; the gateway never silently downgrades `json_schema` to plain text. Choose a model whose
capabilities include it:

```ts
import UltraRouter from '@ultrarouter/sdk';

const ur = new UltraRouter();
const models = await ur.models.list({ capability: 'json_schema' });
console.log(models.data.map((m) => m.id));
```

## Tips

- Keep schemas small and explicit: `required` on every property you need,
  `additionalProperties: false`, and `enum` for closed sets.
- Ask for a summary field rather than free text inside a large object.
- Combine with a `call_type` so the gateway can evaluate requests of the same kind together.

## Related

- [Chat completions](./chat-completions.md) · [Tools](./tools.md) · [Models](./models.md)
- Runnable example: [`examples/structured-output.ts`](../examples/structured-output.ts)
