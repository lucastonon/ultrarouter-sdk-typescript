import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { UltraRouter } from '../src/client.js';
import type { CompanyKnowledgeList } from '../src/resources.js';
import type { FetchLike } from '../src/types.js';

const page = JSON.parse(
  readFileSync(new URL('./fixtures/company-knowledge.json', import.meta.url), 'utf8'),
) as CompanyKnowledgeList;

function recorder(status = 200) {
  const calls: { url: URL; init: RequestInit | undefined }[] = [];
  const fetch: FetchLike = async (url, init) => {
    const parsed = new URL(String(url));
    calls.push({ url: parsed, init });
    const response =
      status !== 200
        ? {
            error: {
              code: status === 403 ? 'permission' : 'not_found',
              message: 'knowledge unavailable',
              retryable: false,
            },
          }
        : parsed.pathname === '/v1/knowledge'
          ? {
              ...page,
              has_more: calls.length === 1,
              next_cursor: calls.length === 1 ? 'opaque+/=' : null,
            }
          : { object: 'knowledge_item', item: page.data[0] };
    return Response.json(response, { status });
  };
  return {
    calls,
    client: new UltraRouter({
      apiKey: 'ur_sk_test_example',
      baseURL: 'https://gateway.example.com',
      fetch,
      maxRetries: 0,
    }),
  };
}

describe('company knowledge', () => {
  it('encodes filters and an opaque continuation without changing read-only requests', async () => {
    const { client, calls } = recorder();
    const query = {
      q: 'capacity & pending?',
      kind: 'lesson' as const,
      call_type_id: 'ct_example',
      version_id: 'epb_example',
      include_history: false,
      limit: 2,
    };
    const first = await client.ur.knowledge.list(query);
    expect(first.data[0]).toMatchObject({ current: true, active: false, state: 'candidate' });
    expect(first.data[1]).toMatchObject({ kind: 'fact', content_projection: 'derived_statistics' });
    const next = await client.ur.knowledge.list({ ...query, cursor: first.next_cursor! });
    expect(next.next_cursor).toBeNull();
    expect(Object.fromEntries(calls[1]!.url.searchParams)).toEqual({
      q: 'capacity & pending?',
      kind: 'lesson',
      call_type_id: 'ct_example',
      version_id: 'epb_example',
      include_history: 'false',
      limit: '2',
      cursor: 'opaque+/=',
    });
    expect(calls.every(({ init }) => init?.method === 'GET' && init.body === undefined)).toBe(true);
  });

  it('encodes the complete namespaced id and preserves detail provenance', async () => {
    const { client, calls } = recorder();
    const result = await client.ur.knowledge.get('lesson:epb_example:L1');
    expect(calls[0]!.url.pathname).toBe('/v1/knowledge/lesson%3Aepb_example%3AL1');
    expect(result.item.id).toBe('lesson:epb_example:L1');
    expect(result.item.content_hash).toBe('a'.repeat(64));
    expect(client.ur.knowledge).not.toHaveProperty('export');
  });

  it('rejects reserved export, malformed and path-steering ids before transport', async () => {
    const { client, calls } = recorder();
    for (const id of [
      'export',
      '../export',
      'fact:a/b',
      'lesson:epb_1:L1?x=1',
      'fact:' + 'x'.repeat(451),
    ]) {
      await expect(client.ur.knowledge.get(id)).rejects.toMatchObject({
        code: 'invalid_request',
        status: 0,
      });
    }
    expect(calls).toHaveLength(0);
  });

  it.each([403, 404])('preserves a %i refusal without retry or alternate route', async (status) => {
    const { client, calls } = recorder(status);
    await expect(client.ur.knowledge.get('fact:kf_missing')).rejects.toMatchObject({ status });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url.pathname).toBe('/v1/knowledge/fact%3Akf_missing');
  });
});
