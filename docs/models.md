# Models

The model catalog is what your API key can use through the gateway: each model's id, context
window, capabilities, pricing and provenance. Model ids are provider-prefixed
(`openai/gpt-5.2-mini`); the ids in these docs are illustrative, and the catalog you see depends on
your gateway and workspace.

## List models

```ts
import UltraRouter from '@ultrarouter/sdk';

const ur = new UltraRouter();
const { data } = await ur.models.list();

for (const m of data) {
  console.log(m.id, m.context_length, m.pricing.input_usd_per_1m, m.pricing.output_usd_per_1m);
}
```

Filter by provider or capability (`GET /v1/models?provider=…&capability=…`):

```ts
import UltraRouter from '@ultrarouter/sdk';

const ur = new UltraRouter();
const openai = await ur.models.list({ provider: 'openai' });
const toolCapable = await ur.models.list({ capability: 'tools' });
console.log(
  openai.data.length,
  toolCapable.data.map((m) => m.id),
);
```

### Model fields

| Field                  | Meaning                                                                                |
| ---------------------- | -------------------------------------------------------------------------------------- |
| `id`, `name`           | The provider-prefixed id and a display name.                                           |
| `provider`             | The provider slug.                                                                     |
| `context_length`       | The context window in tokens, or `null` when unknown.                                  |
| `capabilities`         | Capability flags such as `tools`, `json_schema`, `vision`, `embeddings`.               |
| `pricing`              | Per 1M tokens, in USD (`input_usd_per_1m`, `output_usd_per_1m`) and integer micro-USD. |
| `active`               | Whether the model is currently served.                                                 |
| `origin_jurisdiction`  | The developing lab's jurisdiction (ISO 3166-1 alpha-2), or `unknown`.                  |
| `hosting_jurisdiction` | Where this offer runs, or `unknown`.                                                   |
| `hosting_region`       | The provider-published serving region, or `null`.                                      |
| `weights`              | `open`, `closed` or `unknown`.                                                         |
| `workspace_custom`     | `true` for a model served by one of your workspace's custom providers.                 |

A model with no price cannot be called: the gateway refuses it with `model_unpriced`. See
[errors](./errors.md#model_unpriced).

## Retrieve one model

`ur.models.retrieve(id)` returns one logical model with every provider offer that serves it
(`GET /v1/models/{id}`). The SDK keeps the `/` in the id when it builds the URL.

```ts
import UltraRouter from '@ultrarouter/sdk';

const ur = new UltraRouter();
const model = await ur.models.retrieve('openai/gpt-5.2-mini');

console.log(model.id, model.context_length, model.weights, model.origin_jurisdiction);
for (const offer of model.offers) {
  console.log(offer.provider, offer.hosting_jurisdiction, offer.hosting_region);
}
```

An unknown id rejects with `not_found` (HTTP 404).

## Related

- [Chat completions](./chat-completions.md) · [Embeddings](./embeddings.md)
- [Errors](./errors.md)
- Runnable example: [`examples/models.ts`](../examples/models.ts)
