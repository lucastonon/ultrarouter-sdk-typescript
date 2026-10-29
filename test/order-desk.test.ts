// The order-desk demonstration environment: the embedded data equals the shared fixture (whose bytes
// are pinned, because the Python SDK carries an identical copy), the tool semantics follow the
// fixture's rules, and the state-based verifier decides every scenario — including a full agent loop
// through the client against the mock gateway's scripted tool policy.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { UltraRouter } from '../src/client.js';
import {
  ORDER_DESK,
  OrderDesk,
  createOrderDesk,
  orderDeskScenarios,
  orderDeskTools,
} from '../src/learning.js';
import type { ChatMessage } from '../src/types.js';
// @ts-expect-error -- plain ESM test helper without type declarations
import { startMockGateway } from './support/mock-gateway.mjs';

const fixturePath = (name: string) => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
const sha256 = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');

describe('the shared fixtures', () => {
  // The Python SDK carries byte-identical copies (tests/fixtures/outcome_verdicts.json,
  // tests/fixtures/toy_env.json). A change edits both SDKs together and updates these pins.
  it('are byte-for-byte the agreed files', () => {
    expect(sha256(fixturePath('outcome-verdicts.json'))).toBe(
      'e55e452d5e5374ad07ac13ab7e9b44978425151d902a620edc2586a4e9633e1e',
    );
    expect(sha256(fixturePath('toy-env.json'))).toBe(
      'd4f15f727ea39962a1198411b605a7ba00e718db1d358f27d397499095915864',
    );
  });

  it('the embedded environment equals the toy-env fixture', () => {
    const fixture = JSON.parse(readFileSync(fixturePath('toy-env.json'), 'utf8')) as unknown;
    expect(ORDER_DESK).toEqual(fixture);
    expect(JSON.stringify(ORDER_DESK)).toBe(JSON.stringify(fixture));
  });
});

/** The correct policy, applied directly to the environment (no model). */
function solve(desk: OrderDesk): void {
  for (const id of desk.namedOrders()) {
    const order = desk.call('lookup_order', { order_id: id });
    const stock = desk.call('check_stock', { sku: order.sku });
    if ((stock.in_stock as number) >= (order.quantity as number)) {
      expect(
        desk.call('reserve_stock', { order_id: id, sku: order.sku, quantity: order.quantity }),
      ).toEqual({
        ok: true,
      });
      desk.call('set_order_status', { order_id: id, status: 'reserved' });
    } else {
      desk.call('set_order_status', { order_id: id, status: 'backordered' });
    }
  }
}

describe('the tools', () => {
  it('declares the four tools as OpenAI function definitions', () => {
    const tools = orderDeskTools();
    expect(tools.map((t) => t.function.name)).toEqual([
      'lookup_order',
      'check_stock',
      'reserve_stock',
      'set_order_status',
    ]);
    expect(tools.every((t) => t.type === 'function')).toBe(true);
    tools[0]!.function.parameters.mutated = true;
    expect(orderDeskTools()[0]!.function.parameters).not.toHaveProperty('mutated');
  });

  it('lookup_order and check_stock read the state', () => {
    const desk = createOrderDesk('s3');
    expect(desk.call('lookup_order', { order_id: 'C-300' })).toEqual({
      ok: true,
      order_id: 'C-300',
      sku: 'SKU-GREEN',
      quantity: 3,
      status: 'new',
    });
    expect(desk.call('check_stock', { sku: 'SKU-GREEN' })).toEqual({
      ok: true,
      sku: 'SKU-GREEN',
      in_stock: 4,
    });
    expect(desk.call('lookup_order', { order_id: 'Z-999' })).toEqual({
      ok: false,
      error: 'UNKNOWN_ORDER',
    });
    expect(desk.call('check_stock', { sku: 'SKU-NONE' })).toEqual({
      ok: false,
      error: 'UNKNOWN_SKU',
    });
  });

  it('reserve_stock: reserves within stock, refuses beyond it and changes nothing', () => {
    const desk = createOrderDesk('s3');
    expect(
      desk.call('reserve_stock', { order_id: 'C-300', sku: 'SKU-GREEN', quantity: 3 }),
    ).toEqual({ ok: true });
    expect(desk.state().stock['SKU-GREEN']).toBe(1);
    expect(desk.state().orders['C-300']?.reserved).toBe(3);
    const before = desk.state();
    expect(
      desk.call('reserve_stock', { order_id: 'C-301', sku: 'SKU-GREEN', quantity: 3 }),
    ).toEqual({
      ok: false,
      error: 'INSUFFICIENT_STOCK',
      in_stock: 1,
    });
    expect(desk.state()).toEqual(before);
    expect(desk.call('reserve_stock', { order_id: 'C-301', sku: 'SKU-RED', quantity: 1 })).toEqual({
      ok: false,
      error: 'SKU_MISMATCH',
    });
    expect(desk.state()).toEqual(before);
  });

  it('set_order_status sets reserved or backordered only', () => {
    const desk = createOrderDesk('s1');
    expect(desk.call('set_order_status', { order_id: 'A-100', status: 'backordered' })).toEqual({
      ok: true,
    });
    expect(desk.state().orders['A-100']?.status).toBe('backordered');
    expect(desk.call('set_order_status', { order_id: 'A-100', status: 'shipped' })).toEqual({
      ok: false,
      error: 'INVALID_ARGUMENTS',
    });
    expect(desk.call('set_order_status', { order_id: 'X-1', status: 'reserved' })).toEqual({
      ok: false,
      error: 'UNKNOWN_ORDER',
    });
  });

  it('refuses invalid arguments and unknown tools without changing anything', () => {
    const desk = createOrderDesk('s1');
    const before = desk.state();
    for (const [tool, args] of [
      ['reserve_stock', { order_id: 'A-100', sku: 'SKU-RED', quantity: 0 }],
      ['reserve_stock', { order_id: 'A-100', sku: 'SKU-RED', quantity: 1.5 }],
      ['reserve_stock', { order_id: 'A-100', sku: 'SKU-RED' }],
      ['lookup_order', { order_id: 'A-100', extra: 1 }],
      ['lookup_order', { order_id: 100 }],
      ['lookup_order', 'A-100'],
    ] as const) {
      expect(desk.call(tool, args)).toEqual({ ok: false, error: 'INVALID_ARGUMENTS' });
    }
    expect(desk.call('cancel_order', {})).toEqual({ ok: false, error: 'UNKNOWN_TOOL' });
    expect(desk.callJson('lookup_order', '{oops')).toBe('{"ok":false,"error":"INVALID_ARGUMENTS"}');
    expect(desk.state()).toEqual(before);
    expect(desk.calls().every((c) => !c.ok)).toBe(true);
  });

  it('episodes are independent copies; scenarios resolve by id or index', () => {
    const a = createOrderDesk('s1');
    a.call('set_order_status', { order_id: 'A-100', status: 'reserved' });
    expect(createOrderDesk('s1').state().orders['A-100']?.status).toBe('new');
    expect(new OrderDesk(0).scenario.id).toBe('s1');
    expect(new OrderDesk(7).scenario.id).toBe('s2');
    expect(() => createOrderDesk('s99')).toThrow(/unknown order-desk scenario/);
    expect(orderDeskScenarios().map((s) => s.id)).toEqual(['s1', 's2', 's3', 's4', 's5', 's6']);
  });
});

describe('the verifier', () => {
  it('names orders in task order', () => {
    expect(createOrderDesk('s3').namedOrders()).toEqual(['C-300', 'C-301']);
    expect(createOrderDesk('s6').namedOrders()).toEqual(['F-600', 'F-601']);
  });

  const expected: Record<string, string[]> = {
    s1: ['reserved'],
    s2: ['backordered'],
    s3: ['reserved', 'backordered'],
    s4: ['backordered'],
    s5: ['reserved'],
    s6: ['reserved', 'backordered'],
  };
  for (const [id, want] of Object.entries(expected)) {
    it(`${id}: the correct policy passes (${want.join(', ')})`, () => {
      const desk = createOrderDesk(id);
      solve(desk);
      const v = desk.verify();
      expect(v.verdict).toBe('pass');
      expect(v.reasons).toEqual([]);
      expect(v.orders.map((o) => o.expected)).toEqual(want);
      expect(v.evidenceHash).toMatch(/^sha256:[0-9a-f]{64}$/);
    });
  }

  it('fails an untouched episode, an over-eager one and a timid one, with reasons', () => {
    expect(createOrderDesk('s1').verify()).toMatchObject({
      verdict: 'fail',
      reasons: ['A-100: expected reserved, got new/0'],
    });
    const eager = createOrderDesk('s3');
    eager.call('reserve_stock', { order_id: 'C-300', sku: 'SKU-GREEN', quantity: 3 });
    eager.call('set_order_status', { order_id: 'C-300', status: 'reserved' });
    eager.call('set_order_status', { order_id: 'C-301', status: 'reserved' });
    expect(eager.verify().reasons).toEqual(['C-301: expected backordered, got reserved/0']);
    const timid = createOrderDesk('s5');
    timid.call('set_order_status', { order_id: 'E-500', status: 'backordered' });
    expect(timid.verify().verdict).toBe('fail');
    // Reserved but never marked: the status decides.
    const unmarked = createOrderDesk('s1');
    unmarked.call('reserve_stock', { order_id: 'A-100', sku: 'SKU-RED', quantity: 2 });
    expect(unmarked.verify().reasons).toEqual(['A-100: expected reserved, got new/2']);
  });

  it('the same final state gives the same evidence hash', () => {
    const a = createOrderDesk('s1');
    const b = createOrderDesk('s1');
    solve(a);
    solve(b);
    expect(a.verify().evidenceHash).toBe(b.verify().evidenceHash);
    expect(createOrderDesk('s1').verify().evidenceHash).not.toBe(a.verify().evidenceHash);
  });
});

describe('a tool loop through the client against the mock gateway', () => {
  interface Gateway {
    url: string;
    close: () => Promise<void>;
  }
  let gw: Gateway;
  beforeAll(async () => {
    gw = (await startMockGateway()) as Gateway;
  });
  afterAll(async () => {
    await gw.close();
  });

  for (const scenario of ['s1', 's2', 's3', 's4', 's5', 's6']) {
    it(`${scenario}: the scripted policy finishes the episode and the verifier passes it`, async () => {
      const ur = new UltraRouter({
        apiKey: 'ur_sk_test_desk',
        baseURL: gw.url,
        defaultModel: 'openai/gpt-5.2-mini',
        maxRetries: 0,
      });
      const desk = createOrderDesk(scenario);
      const messages: ChatMessage[] = [{ role: 'user', content: desk.task }];
      const requestIds: string[] = [];
      for (let step = 0; step < 20; step += 1) {
        const res = await ur.chat.completions.create(
          { messages, tools: orderDeskTools() },
          { episodeKey: `desk-${scenario}` },
        );
        requestIds.push(res.requestId);
        const message = res.choices[0]!.message;
        messages.push(message as ChatMessage);
        const calls = (message.tool_calls ?? []) as {
          id: string;
          function: { name: string; arguments: string };
        }[];
        if (calls.length === 0) break;
        for (const call of calls) {
          messages.push({
            role: 'tool',
            tool_call_id: call.id,
            content: desk.callJson(call.function.name, call.function.arguments),
          });
        }
      }
      expect(desk.verify().verdict).toBe('pass');
      expect(new Set(requestIds).size).toBe(requestIds.length);
    });
  }
});
