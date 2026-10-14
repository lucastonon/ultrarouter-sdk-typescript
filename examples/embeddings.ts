/**
 * Embeddings: embed a batch of texts and compare two of them with cosine similarity.
 *
 * Run: ULTRAROUTER_API_KEY=ur_sk_test_... npx tsx examples/embeddings.ts
 */
import UltraRouter from '@ultrarouter/sdk';

const ur = new UltraRouter();

const res = await ur.embeddings.create({
  model: 'openai/text-embedding-3-small',
  input: ['refund policy', 'how do I get my money back?', 'shipping times'],
});

const vectors = res.data.map((d) => d.embedding as number[]);
const cosine = (a: number[], b: number[]): number => {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += (a[i] ?? 0) * (b[i] ?? 0);
    na += (a[i] ?? 0) ** 2;
    nb += (b[i] ?? 0) ** 2;
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
};

console.log(`${String(vectors.length)} vectors of ${String(vectors[0]?.length)} dimensions`);
console.log('similarity(0, 1):', cosine(vectors[0] ?? [], vectors[1] ?? []).toFixed(3));
console.log('tokens:', res.usage.total_tokens, 'request:', res.ur.request_id);
