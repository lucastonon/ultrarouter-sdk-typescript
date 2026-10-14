/**
 * Structured outputs: ask for JSON that matches a JSON Schema and parse it.
 *
 * Run: ULTRAROUTER_API_KEY=ur_sk_test_... npx tsx examples/structured-output.ts
 */
import UltraRouter, { isUltraRouterError } from '@ultrarouter/sdk';

const ur = new UltraRouter({ defaultModel: 'openai/gpt-5.2-mini' });

interface Ticket {
  category: 'billing' | 'shipping' | 'other';
  urgent: boolean;
  summary: string;
}

try {
  const res = await ur.chat.completions.create({
    messages: [{ role: 'user', content: 'My invoice is wrong and I need it fixed today.' }],
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: 'ticket',
        strict: true,
        schema: {
          type: 'object',
          properties: {
            category: { type: 'string', enum: ['billing', 'shipping', 'other'] },
            urgent: { type: 'boolean' },
            summary: { type: 'string' },
          },
          required: ['category', 'urgent', 'summary'],
          additionalProperties: false,
        },
      },
    },
  });
  const ticket = JSON.parse(res.choices[0]?.message.content ?? '{}') as Ticket;
  console.log(ticket.category, ticket.urgent, ticket.summary);
} catch (err) {
  // A model that cannot honour json_schema is refused before dispatch, never silently downgraded.
  if (isUltraRouterError(err, 'capability_unsupported'))
    console.error('pick a model that supports json_schema');
  throw err;
}
