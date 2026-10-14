# Embeddings

`ur.embeddings.create(params, options?)` turns text into vectors (`POST /v1/embeddings`). The
request and response follow the OpenAI embeddings shape; the response also carries the `ur` block.

## Embed a batch

```ts
import UltraRouter from '@ultrarouter/sdk';

const ur = new UltraRouter();

const res = await ur.embeddings.create({
  model: 'openai/text-embedding-3-small',
  input: ['How do I reset my password?', 'Password reset steps', 'Shipping to Canada'],
});

for (const item of res.data) {
  const vector = item.embedding as number[];
  console.log(item.index, vector.length);
}
console.log(res.usage.total_tokens, res.ur.request_id);
```

`data[i].index` matches the position of the input. Send many inputs in one call rather than one
call per input.

## Parameters

| Parameter          | Type                  | Notes                                                                     |
| ------------------ | --------------------- | ------------------------------------------------------------------------- |
| `model`            | `string`              | An embedding model id. Optional when the client has `defaultModel`.       |
| `input`            | `string \| string[]`  | One text or a batch.                                                      |
| `dimensions`       | `number`              | Output dimensions, for models that support shortening.                    |
| `encoding_format`  | `'float' \| 'base64'` | `float` (default) returns `number[]`; `base64` returns a base64 string.   |
| `call_type`        | `string`              | A stable slug for this kind of request.                                   |
| `ur`               | `UrRequestOptions`    | Per-request controls (`trace_id`, `tags`, `max_cost_usd`, `artifact`, …). |
| `bench`            | Bench tag             | Tag the call for a Bench suite.                                           |
| `user`, `metadata` |                       | An end-user id; free-form metadata.                                       |

The `ur` response block on embeddings has no `compression` field.

## Base64 output

Base64 encoding returns little-endian float32 values packed into a string, which is smaller to
transfer. Decode it like this:

```ts
import UltraRouter from '@ultrarouter/sdk';

const ur = new UltraRouter();
const res = await ur.embeddings.create({
  model: 'openai/text-embedding-3-small',
  input: 'decode me',
  encoding_format: 'base64',
});

const b64 = res.data[0]?.embedding as string;
const bytes = Buffer.from(b64, 'base64');
const vector = new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
console.log(vector.length);
```

## Shorter vectors

```ts
import UltraRouter from '@ultrarouter/sdk';

const ur = new UltraRouter();
const res = await ur.embeddings.create({
  model: 'openai/text-embedding-3-small',
  input: 'compact vector',
  dimensions: 16,
});
console.log((res.data[0]?.embedding as number[]).length);
```

## Related

- [Models](./models.md) — find embedding models with `ur.models.list({ capability: 'embeddings' })`.
- [Configuration](./configuration.md) · [Errors](./errors.md)
- Runnable example: [`examples/embeddings.ts`](../examples/embeddings.ts)
