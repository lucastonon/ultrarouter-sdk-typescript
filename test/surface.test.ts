// Every dedicated client method, driven over real HTTP against the local mock gateway, whose
// responses are schema-valid for the published OpenAPI document (test/mock-gateway.test.ts). This
// proves each method builds the right request and parses the current response shapes end to end.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { MemoryOutcomeStore, UltraRouter, diffStats } from '../src/index.js';
import { ModelUnpricedError } from '../src/errors.js';
// @ts-expect-error -- plain ESM test helper without type declarations
import { MOCK_ORACLE_SECRET, startMockGateway } from './support/mock-gateway.mjs';

interface Gateway {
  url: string;
  requests: { method: string; path: string; body: unknown; headers: Record<string, string> }[];
  close: () => Promise<void>;
}

let gw: Gateway;
let ur: UltraRouter;

beforeAll(async () => {
  gw = (await startMockGateway()) as Gateway;
  ur = new UltraRouter({
    apiKey: 'ur_sk_test_surface',
    baseURL: gw.url,
    defaultModel: 'openai/gpt-5.2-mini',
    maxRetries: 0,
  });
});
afterAll(async () => {
  await gw.close();
});

const last = () => gw.requests.at(-1)!;

describe('OpenAI-compatible surface', () => {
  it('chat.completions.create (non-streaming)', async () => {
    const res = await ur.chat.completions.create({
      messages: [{ role: 'user', content: 'hello' }],
    });
    expect(res.object).toBe('chat.completion');
    expect(res.choices[0]?.message.content).toContain('hello');
    expect(res.ur.request_id).toMatch(/^req_/);
    expect(last().body).toMatchObject({ model: 'openai/gpt-5.2-mini' });
  });

  it('chat.completions.create (streaming) ends with usage and the ur block', async () => {
    const stream = await ur.chat.completions.create({
      stream: true,
      messages: [{ role: 'user', content: 'stream it' }],
    });
    let text = '';
    let final;
    for await (const chunk of stream) {
      text += chunk.choices[0]?.delta.content ?? '';
      if (chunk.ur !== undefined) final = chunk;
    }
    expect(text).toContain('stream it');
    expect(final?.usage?.total_tokens).toBeGreaterThan(0);
    expect(final?.ur?.model_served).toBe('openai/gpt-5.2-mini');
  });

  it('chat.completions.create with tools and json_schema', async () => {
    const tools = await ur.chat.completions.create({
      messages: [{ role: 'user', content: 'weather in Oslo?' }],
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
    expect(tools.choices[0]?.finish_reason).toBe('tool_calls');
    const structured = await ur.chat.completions.create({
      messages: [{ role: 'user', content: 'a person' }],
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'person',
          schema: {
            type: 'object',
            properties: { name: { type: 'string' }, age: { type: 'integer' } },
          },
        },
      },
    });
    expect(JSON.parse(structured.choices[0]?.message.content ?? '{}')).toHaveProperty('age');
  });

  it('a model without a price is a typed ModelUnpricedError', async () => {
    await expect(
      ur.chat.completions.create({
        model: 'example/unpriced-model',
        messages: [{ role: 'user', content: 'x' }],
      }),
    ).rejects.toBeInstanceOf(ModelUnpricedError);
  });

  it('embeddings.create', async () => {
    const res = await ur.embeddings.create({
      model: 'openai/text-embedding-3-small',
      input: ['a', 'b'],
    });
    expect(res.data).toHaveLength(2);
    expect(Array.isArray(res.data[0]?.embedding)).toBe(true);
  });

  it('models.list and models.retrieve', async () => {
    const list = await ur.models.list({ capability: 'tools' });
    expect(list.data.every((m) => m.capabilities.tools === true)).toBe(true);
    expect(list.data[0]?.origin_jurisdiction).toBeDefined();
    const detail = await ur.models.retrieve('openai/gpt-5.2-mini');
    expect(detail.id).toBe('openai/gpt-5.2-mini');
    expect(detail.offers.length).toBeGreaterThan(0);
  });
});

describe('ur.* resources', () => {
  it('ur.key.get', async () => {
    const key = await ur.ur.key.get();
    expect(key.scopes).toContain('gateway:invoke');
  });

  it('ur.callTypes.create / list / get / update / enqueueEval / listEvals / recommendations', async () => {
    const created = await ur.ur.callTypes.create({
      slug: 'support-reply',
      config: { router_mode: 'off' },
    });
    expect(created.slug).toBe('support-reply');
    const list = await ur.ur.callTypes.list();
    expect(list.data.map((c) => c.slug)).toContain('support-reply');
    const got = await ur.ur.callTypes.get('support-reply');
    expect(got.id).toBe(created.id);
    const updated = await ur.ur.callTypes.update('support-reply', {
      case_precedents_enabled: true,
    });
    expect(updated.config?.case_precedents_enabled).toBe(true);
    expect(updated.current_config_version).toBe(2);
    const enqueued = await ur.ur.callTypes.enqueueEval('support-reply');
    expect(enqueued).toHaveProperty('enqueued');
    expect((await ur.ur.callTypes.listEvals('support-reply')).object).toBeDefined();
    expect(await ur.ur.callTypes.recommendations('support-reply')).toBeTypeOf('object');
  });

  it('ur.callTypes.prompts.* and verifiedMemory.*', async () => {
    expect(await ur.ur.callTypes.prompts.list('ct_1')).toBeTypeOf('object');
    expect(
      await ur.ur.callTypes.prompts.create('ct_1', {
        template: 'Hi {{name}}',
        variables: [{ name: 'name', required: true }],
      }),
    ).toBeTypeOf('object');
    expect(await ur.ur.callTypes.prompts.get('ct_1', 1)).toBeTypeOf('object');
    expect(await ur.ur.callTypes.prompts.activate('ct_1', 1, { gateway_apply: true })).toBeTypeOf(
      'object',
    );
    expect(await ur.ur.callTypes.prompts.deactivate('ct_1')).toBeTypeOf('object');
    expect(await ur.ur.callTypes.prompts.proposal('ct_1')).toBeTypeOf('object');
    expect((await ur.ur.callTypes.verifiedMemory.get('ct_1')).object).toBeDefined();
    expect(
      (await ur.ur.callTypes.verifiedMemory.enable('ct_1', { target_precision: 0.95 })).object,
    ).toBeDefined();
    expect((await ur.ur.callTypes.verifiedMemory.disable('ct_1')).object).toBe(
      'verified_memory_disable',
    );
  });

  it('ur.requests.feedback and ur.generation.get', async () => {
    const fb = await ur.ur.requests.feedback('req_1', { rating: 1, tags: ['helpful'] });
    expect(fb).toMatchObject({ request_id: 'req_1', rating: 1, tags: ['helpful'] });
    const gen = await ur.ur.generation.get('req_1');
    expect(gen.id).toBe('req_1');
    expect(gen.cost.total_micro_usd).toBeGreaterThan(0);
  });

  it('ur.autopilot.status', async () => {
    expect((await ur.ur.autopilot.status()).object).toBe('audit_readiness');
  });

  it('ur.bench.*', async () => {
    expect(await ur.ur.bench.status('suite-a')).toBeTypeOf('object');
    expect(await ur.ur.bench.freeze('suite-a', { max_items: 10 })).toBeTypeOf('object');
    const run = await ur.ur.bench.run({
      suite: 'suite-a',
      max_cost_usd: 1,
      wait: true,
      pollIntervalMs: 1,
    });
    expect('status' in run && run.status).toBe('complete');
    expect((await ur.ur.bench.get('br_mock_1')).id).toBe('br_mock_1');
    expect(await ur.ur.bench.report('br_mock_1')).toBeTypeOf('object');
    expect(await ur.ur.bench.report('br_mock_1', { format: 'md' })).toContain('# Bench report');
    expect(await ur.ur.bench.expect('suite-a', [])).toBeTypeOf('object');
    expect(await ur.ur.bench.record({ suite: 'suite-a' }, [])).toBeTypeOf('object');
    expect(await ur.ur.bench.record({ run: 'br_mock_1' }, [])).toBeTypeOf('object');
    expect(await ur.ur.bench.baseline('br_mock_1')).toBeTypeOf('object');
    expect((await ur.ur.bench.gate('br_mock_1')).verdict).toBeDefined();
  });

  it('ur.artifactTypes / artifacts / outcomes', async () => {
    expect(
      await ur.ur.artifactTypes.upsert({
        name: 'reply',
        archetype: 'answer',
        objective: { metric: 'accepted_without_edit' },
      } as never),
    ).toBeTypeOf('object');
    const art = await ur.ur.artifacts.create({ key: 'ticket-1' });
    expect(art.key).toBe('ticket-1');
    expect((await ur.ur.artifacts.get(art.id)).id).toBe(art.id);
    expect((await ur.ur.artifacts.list({ limit: 5 })).data).toBeDefined();
    const stats = diffStats('draft text', 'final text');
    expect(
      await ur.ur.artifacts.final(art.id, {
        diff_stats: stats,
        final_hash: stats.final_hash,
      } as never),
    ).toBeTypeOf('object');
    const receipt = await ur.ur.outcomes.record(art.id, {
      channel: 'mechanical',
      kind: 'schema_valid',
    });
    expect(receipt.status).toBe('delivered');
    const viaRequest = await ur.recordOutcome(
      { request: 'req_1' },
      { channel: 'mechanical', kind: 'schema_valid' },
    );
    expect(viaRequest.status).toBe('delivered');
    expect(await ur.ur.outcomes.batch([])).toBeTypeOf('object');
    expect((await ur.ur.outcomes.pending({ state: 'overdue' })).data).toBeDefined();
    expect(await ur.ur.outcomes.flush()).toMatchObject({ pending: 0 });
  });

  it('withArtifact binds chat to the artifact and flushes outcomes', async () => {
    const store = new MemoryOutcomeStore();
    const scoped = new UltraRouter({
      apiKey: 'ur_sk_test_surface',
      baseURL: gw.url,
      defaultModel: 'openai/gpt-5.2-mini',
      outcomeStore: store,
    });
    const res = await scoped.withArtifact('ticket-2', async (scope) => {
      const out = await scope.chat.completions.create({
        messages: [{ role: 'user', content: 'draft' }],
      });
      await scope.record({ channel: 'mechanical', kind: 'schema_valid' });
      return out;
    });
    expect('ur' in res && res.ur.artifact_id).toBeTruthy();
    expect(store.list()).toHaveLength(0);
  });

  it('ur.imports.*', async () => {
    const imp = await ur.ur.imports.create({
      format: 'usage_summary',
      mode: 'preview',
      records: [],
    } as never);
    expect(imp.id).toBeDefined();
    expect(await ur.ur.imports.get(imp.id)).toBeTypeOf('object');
    expect((await ur.ur.imports.list()).data).toBeDefined();
    expect(await ur.ur.imports.cancel(imp.id)).toBeTypeOf('object');
  });

  it('ur.reviewer.* (signed deliveries verified by the mock)', async () => {
    expect(await ur.ur.reviewer.setup()).toBeTypeOf('object');
    expect(await ur.ur.reviewer.test('happy')).toBeTypeOf('object');
    const event = {
      event_id: 'rev-1',
      artifact_key: 'ticket-1',
      artifact_version: 1,
      decision: 'approved' as const,
      effective_at: '2026-01-01T00:00:00.000Z',
    };
    const sent = await ur.ur.reviewer.send([event]);
    expect(sent.accepted).toBe(1);
    await ur.ur.reviewer.record({ ...event, event_id: 'rev-2' });
    const flushed = await ur.ur.reviewer.flush();
    expect(flushed).toBeTypeOf('object');
    expect(await ur.ur.reviewer.deadLetters()).toEqual([]);
    expect(await ur.ur.reviewer.health()).toBeTypeOf('object');
  });

  it('ur.flywheel.* and ur.improvementReads', async () => {
    expect((await ur.ur.flywheel.status()).object).toBeDefined();
    expect(await ur.ur.flywheel.calibration()).toBeTypeOf('object');
    expect(await ur.ur.flywheel.sources()).toBeTypeOf('object');
    expect(await ur.ur.flywheel.sourceChecks.issue({ call_type_id: 'ct_1' })).toBeTypeOf('object');
    expect(
      await ur.ur.flywheel.sourceChecks.answer('chk_1', {
        verdicts: [{ probe_id: 'p1', kind: 'resolved_true' }],
      }),
    ).toBeTypeOf('object');
    expect(await ur.ur.improvementReads.list()).toBeTypeOf('object');
  });

  it('ur.flywheel.experiments.* (enrol, outcome + dry run, evaluate)', async () => {
    const execution = await ur.ur.flywheel.experiments.enrol('fxp_1', {
      phase: 'screen',
      pair_key: 'idea-a',
      slot: 0,
    });
    expect(execution.object).toBe('flywheel_experiment_execution');
    expect(last().path).toBe('/v1/flywheel/experiments/fxp_1/executions');
    expect(last().body).toMatchObject({ phase: 'screen', pair_key: 'idea-a', slot: 0 });

    const outcomeParams = {
      terminal: 'delivered' as const,
      reason_codes: [],
      reason_vocab: 'rv_1',
      receipts: [
        {
          ordinal: 0,
          stage: 'writer',
          call_type: 'ct_writer',
          request_id: 'req_1',
          extractor_version: 'ex_1',
          numbers: { post_length: 120 },
        },
      ],
      final_content_hash: 'fch_1',
      request_ids: ['req_1'],
    };
    const recorded = await ur.ur.flywheel.experiments.outcome('fxp_1', 'fxe_1', outcomeParams);
    expect(recorded.object).toBe('flywheel_experiment_execution_outcome');
    expect(last().path).toBe('/v1/flywheel/experiments/fxp_1/executions/fxe_1/outcome');

    const dry = await ur.ur.flywheel.experiments.outcome('fxp_1', 'fxe_1', outcomeParams, {
      dryRun: true,
    });
    expect(dry.object).toBe('flywheel_experiment_execution_outcome_dry_run');
    expect(gw.requests.at(-1)!.path).toBe(
      '/v1/flywheel/experiments/fxp_1/executions/fxe_1/outcome',
    );

    expect((await ur.ur.flywheel.experiments.evaluateScreen('fxp_1')).object).toBeDefined();
    expect(last().path).toBe('/v1/flywheel/experiments/fxp_1/screen/evaluate');
    expect((await ur.ur.flywheel.experiments.evaluateTest('fxp_1')).object).toBeDefined();
    expect(last().path).toBe('/v1/flywheel/experiments/fxp_1/test/evaluate');
  });

  it('ur.oracles.* including the signed pull transport', async () => {
    const reg = await ur.ur.oracles.register({ kind: 'customer_ci', spec: {} } as never);
    expect(reg.secret).toBe(MOCK_ORACLE_SECRET);
    expect(await ur.ur.oracles.get('orc_mock_1')).toBeTypeOf('object');
    expect(
      await ur.ur.oracles.qualify('orc_mock_1', { examples: [{ input: 'q', output: 'a' }] }),
    ).toBeTypeOf('object');
    expect(await ur.ur.oracles.test('orc_mock_1')).toBeTypeOf('object');
    const claim = await ur.ur.oracles.claimJobs(
      'orc_mock_1',
      { max: 5 },
      { secret: reg.secret ?? '' },
    );
    expect(claim).toBeTypeOf('object');
    expect(
      await ur.ur.oracles.submitVerdicts('orc_mock_1', { verdicts: [] } as never, {
        secret: reg.secret ?? '',
      }),
    ).toBeTypeOf('object');
    await expect(
      ur.ur.oracles.claimJobs('orc_mock_1', {}, { secret: 'wrong' }),
    ).rejects.toMatchObject({ status: 403 });
    expect(await ur.ur.oracles.revoke('orc_mock_1')).toBeTypeOf('object');
  });
});

describe('preflight, useLearned, getPrompt and request()', () => {
  it('preflight with a cluster key returns a grant from the header', async () => {
    const res = await ur.preflight(
      { call_type: 'support', artifact_key: 'a-1' },
      { noCache: true },
    );
    expect(res.grant?.grant_id).toMatch(/^grant_/);
    expect(res.knowledge?.placement).toBe('after_stable_prefix');
  });

  it('a case-module call type needs messages', async () => {
    const without = await ur.preflight({ call_type: 'invoice-triage' }, { noCache: true });
    expect(without.knowledge_reason).toBe('case_query_missing');
    const withMessages = await ur.preflight(
      {
        call_type: 'invoice-triage',
        messages: [{ role: 'user', content: 'Is INV-9 a duplicate?' }],
      },
      { noCache: true },
    );
    expect(withMessages.knowledge?.module.content).toContain('INV-9');
    expect(last().body).toMatchObject({
      messages: [{ role: 'user', content: 'Is INV-9 a duplicate?' }],
    });
  });

  it('useLearned applies the module and records an outcome quoting the grant', async () => {
    const session = await ur.useLearned(
      { call_type: 'support', artifact_key: 'ticket-3' },
      { noCache: true },
    );
    const applied = session.apply([
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'q' },
    ]);
    expect(applied[1]?.role).toBe('user');
    const receipt = await session.record({ channel: 'mechanical', kind: 'schema_valid' });
    expect(receipt.status).toBe('delivered');
    const artifactCreate = gw.requests.filter((r) => r.path === '/v1/artifacts').at(-1);
    expect(artifactCreate?.body).toMatchObject({ key: 'ticket-3', attestation: 'applied' });
  });

  it('getPrompt returns null for a code-owned call type', async () => {
    expect(await ur.getPrompt('support', { noCache: true })).toBeNull();
  });

  it('request() reaches an operation without a dedicated method', async () => {
    const plans = await ur.request('get', '/v1/flywheel/plans');
    expect(plans).toBeTypeOf('object');
    expect(last().path).toBe('/v1/flywheel/plans');
  });
});
