/**
 * The order desk: a tiny, deterministic tool environment for examples and tests. A scenario has
 * stock per SKU and orders; an agent processes the orders the task names with four tools
 * (`lookup_order`, `check_stock`, `reserve_stock`, `set_order_status`), and a state-based verifier
 * decides pass or fail from the final state alone.
 *
 * It is a demonstration that the integration works end to end. It is not evidence that learning
 * improves an agent.
 */

import type { JsonSchemaLite } from './business-rules.js';
import { ORDER_DESK } from './order-desk-data.js';
import { evidenceHash } from './verifier.js';

/** One order-desk tool as the environment declares it. */
export interface OrderDeskToolSpec {
  /** The tool name. */
  name: string;
  /** What it does. */
  description: string;
  /** Its JSON-Schema parameters. */
  parameters: JsonSchemaLite & Record<string, unknown>;
}

/** One order in a scenario. */
export interface OrderDeskOrder {
  /** The SKU ordered. */
  sku: string;
  /** The quantity ordered. */
  quantity: number;
  /** The initial status. */
  status: string;
}

/** One scenario: the task text, the starting stock and the orders. */
export interface OrderDeskScenario {
  /** The scenario id (`s1` …). */
  id: string;
  /** The task, naming the orders to process in order. */
  task: string;
  /** Units in stock per SKU. */
  stock: Record<string, number>;
  /** The orders by id. */
  orders: Record<string, OrderDeskOrder>;
}

/** The whole environment: tools, rules and scenarios (the shared fixture's shape). */
export interface OrderDeskEnvironment {
  /** The fixture schema version. */
  schema_version: number;
  /** Always `order-desk`. */
  name: string;
  /** The demonstration notice. */
  notice: string;
  /** The tools. */
  tools: OrderDeskToolSpec[];
  /** The tool and verifier rules, in words. */
  rules: Record<string, string>;
  /** The scenarios. */
  scenarios: OrderDeskScenario[];
}

/** An OpenAI-style function tool definition (what `chat.completions.create` takes in `tools`). */
export interface OrderDeskFunctionTool {
  /** Always `function`. */
  type: 'function';
  /** The function. */
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

/** A tool's answer: `{ ok: true, … }` or `{ ok: false, error, … }`. */
export type OrderDeskToolResult = { ok: boolean; error?: string } & Record<string, unknown>;

/** One order's state during an episode. */
export interface OrderDeskOrderState extends OrderDeskOrder {
  /** Units reserved for the order (0 until `reserve_stock` succeeds). */
  reserved: number;
}

/** One order's check by the verifier. */
export interface OrderDeskOrderCheck {
  /** The order id. */
  orderId: string;
  /** What the verifier expected: `reserved` (full quantity) or `backordered` (nothing reserved). */
  expected: 'reserved' | 'backordered';
  /** The order's final status. */
  status: string;
  /** Units reserved at the end. */
  reserved: number;
  /** Whether the order passed. */
  pass: boolean;
}

/** The verifier's verdict for one episode. */
export interface OrderDeskVerdict {
  /** `pass` when every named order passed and every SKU's stock is consistent, else `fail`. */
  verdict: 'pass' | 'fail';
  /**
   * One reason per failing order (`<order>: expected <state>, got <status>/<reserved>`), then one
   * per inconsistent SKU (`<sku>: expected stock <n>, got <m>`).
   */
  reasons: string[];
  /** `sha256:<hex>` over the canonical JSON of the final state. */
  evidenceHash: string;
  /** Every named order's check, in task order. */
  orders: OrderDeskOrderCheck[];
}

/** The tools as OpenAI-style function definitions, ready for `tools: …`. */
export function orderDeskTools(): OrderDeskFunctionTool[] {
  return ORDER_DESK.tools.map((t) => ({
    type: 'function',
    function: {
      name: t.name,
      description: t.description,
      parameters: JSON.parse(JSON.stringify(t.parameters)) as Record<string, unknown>,
    },
  }));
}

/** The scenarios, in fixture order. */
export function orderDeskScenarios(): OrderDeskScenario[] {
  return ORDER_DESK.scenarios.map((s) => JSON.parse(JSON.stringify(s)) as OrderDeskScenario);
}

const STATUSES = ['reserved', 'backordered'];
const TOOL_NAMES = ORDER_DESK.tools.map((t) => t.name);

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Exactly the listed keys, each a string (or, for `quantity`, an integer ≥ 1). */
function args(raw: unknown, keys: readonly string[]): Record<string, string | number> | null {
  if (!isObject(raw)) return null;
  if (Object.keys(raw).some((k) => !keys.includes(k))) return null;
  for (const key of keys) {
    const value = raw[key];
    if (key === 'quantity') {
      if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) return null;
    } else if (typeof value !== 'string') return null;
  }
  return raw as Record<string, string | number>;
}

const INVALID: OrderDeskToolResult = { ok: false, error: 'INVALID_ARGUMENTS' };
const UNKNOWN_ORDER: OrderDeskToolResult = { ok: false, error: 'UNKNOWN_ORDER' };

/**
 * One episode of the order desk: a fresh copy of a scenario's state, the four tools, and the
 * verifier. Deterministic: the same calls always give the same results and the same verdict.
 */
export class OrderDesk {
  /** The scenario this episode runs. */
  readonly scenario: OrderDeskScenario;
  /** The demonstration notice. */
  readonly notice: string = ORDER_DESK.notice;
  private readonly stock: Record<string, number>;
  private readonly orders: Record<string, OrderDeskOrderState>;
  private readonly log: { tool: string; ok: boolean }[] = [];

  /** Start an episode of `scenario` (a scenario id such as `s1`, or an index into the scenarios). */
  constructor(scenario: string | number) {
    const all = ORDER_DESK.scenarios;
    const found =
      typeof scenario === 'number'
        ? all[((Math.trunc(scenario) % all.length) + all.length) % all.length]
        : all.find((s) => s.id === scenario);
    if (found === undefined) throw new Error(`unknown order-desk scenario '${String(scenario)}'`);
    this.scenario = JSON.parse(JSON.stringify(found)) as OrderDeskScenario;
    this.stock = { ...found.stock };
    this.orders = Object.fromEntries(
      Object.entries(found.orders).map(([id, o]) => [id, { ...o, reserved: 0 }]),
    );
  }

  /** The task text to give the agent. */
  get task(): string {
    return this.scenario.task;
  }

  /** The order ids the task names, in the order it names them. */
  namedOrders(): string[] {
    const task = this.scenario.task;
    return Object.keys(this.scenario.orders)
      .filter((id) => task.includes(id))
      .sort((a, b) => task.indexOf(a) - task.indexOf(b));
  }

  /** The current state: stock per SKU and each order with its reserved units. */
  state(): { stock: Record<string, number>; orders: Record<string, OrderDeskOrderState> } {
    return JSON.parse(JSON.stringify({ stock: this.stock, orders: this.orders })) as {
      stock: Record<string, number>;
      orders: Record<string, OrderDeskOrderState>;
    };
  }

  /** The tool calls made so far: name and whether it succeeded. */
  calls(): { tool: string; ok: boolean }[] {
    return this.log.map((c) => ({ ...c }));
  }

  /**
   * Run one tool. Unknown tools and invalid arguments answer an error and change nothing.
   *
   * - `lookup_order` → `{ ok, order_id, sku, quantity, status }` (`UNKNOWN_ORDER`).
   * - `check_stock` → `{ ok, sku, in_stock }` (`UNKNOWN_SKU`).
   * - `reserve_stock` → `{ ok: true }` when `quantity` ≤ stock: the stock drops by `quantity` and the
   *   order's reserved units become `quantity`; else `{ ok: false, error: 'INSUFFICIENT_STOCK',
   *   in_stock }` with nothing changed (`UNKNOWN_ORDER`, `SKU_MISMATCH` when the SKU is not the
   *   order's, `ALREADY_RESERVED` when the order already has a reservation).
   * - `set_order_status` → `{ ok: true }` for `reserved` or `backordered` (`UNKNOWN_ORDER`).
   */
  call(tool: string, rawArgs: unknown): OrderDeskToolResult {
    const result = this.dispatch(tool, rawArgs);
    this.log.push({ tool, ok: result.ok });
    return result;
  }

  /**
   * {@link call} with JSON arguments and a JSON answer (what a chat tool loop passes around). An
   * unknown tool answers `UNKNOWN_TOOL` before its arguments are read; unparseable arguments answer
   * `INVALID_ARGUMENTS`.
   */
  callJson(tool: string, argumentsJson: string): string {
    let parsed: unknown;
    try {
      parsed = JSON.parse(argumentsJson === '' ? '{}' : argumentsJson);
    } catch {
      parsed = undefined;
    }
    return JSON.stringify(this.call(tool, parsed));
  }

  private dispatch(tool: string, raw: unknown): OrderDeskToolResult {
    if (!TOOL_NAMES.includes(tool)) return { ok: false, error: 'UNKNOWN_TOOL' };
    switch (tool) {
      case 'lookup_order': {
        const a = args(raw, ['order_id']);
        if (a === null) return INVALID;
        const order = this.orders[a.order_id as string];
        if (order === undefined) return UNKNOWN_ORDER;
        return {
          ok: true,
          order_id: a.order_id,
          sku: order.sku,
          quantity: order.quantity,
          status: order.status,
        };
      }
      case 'check_stock': {
        const a = args(raw, ['sku']);
        if (a === null) return INVALID;
        const units = this.stock[a.sku as string];
        if (units === undefined) return { ok: false, error: 'UNKNOWN_SKU' };
        return { ok: true, sku: a.sku, in_stock: units };
      }
      case 'reserve_stock': {
        const a = args(raw, ['order_id', 'sku', 'quantity']);
        if (a === null) return INVALID;
        const order = this.orders[a.order_id as string];
        if (order === undefined) return UNKNOWN_ORDER;
        if (order.sku !== a.sku) return { ok: false, error: 'SKU_MISMATCH' };
        if (order.reserved > 0) return { ok: false, error: 'ALREADY_RESERVED' };
        const quantity = a.quantity as number;
        const units = this.stock[order.sku] ?? 0;
        if (quantity > units) return { ok: false, error: 'INSUFFICIENT_STOCK', in_stock: units };
        this.stock[order.sku] = units - quantity;
        order.reserved = quantity;
        return { ok: true };
      }
      case 'set_order_status': {
        const a = args(raw, ['order_id', 'status']);
        if (a === null || !STATUSES.includes(a.status as string)) return INVALID;
        const order = this.orders[a.order_id as string];
        if (order === undefined) return UNKNOWN_ORDER;
        order.status = a.status as string;
        return { ok: true };
      }
      default:
        return { ok: false, error: 'UNKNOWN_TOOL' };
    }
  }

  /**
   * The state-based verifier. Orders are handled in the order the task names them: an order is
   * expected `reserved` with its full quantity when the stock left after the earlier orders covers
   * it, otherwise `backordered` with nothing reserved. The task passes when every named order does
   * AND each SKU's final stock equals its starting stock minus the units reserved for it.
   */
  verify(): OrderDeskVerdict {
    const left: Record<string, number> = { ...this.scenario.stock };
    const checks: OrderDeskOrderCheck[] = [];
    for (const id of this.namedOrders()) {
      const initial = this.scenario.orders[id] as OrderDeskOrder;
      const final = this.orders[id] as OrderDeskOrderState;
      const available = left[initial.sku] ?? 0;
      const expected = available >= initial.quantity ? 'reserved' : 'backordered';
      if (expected === 'reserved') left[initial.sku] = available - initial.quantity;
      const pass =
        expected === 'reserved'
          ? final.status === 'reserved' && final.reserved === initial.quantity
          : final.status === 'backordered' && final.reserved === 0;
      checks.push({ orderId: id, expected, status: final.status, reserved: final.reserved, pass });
    }
    const reasons = checks
      .filter((c) => !c.pass)
      .map((c) => `${c.orderId}: expected ${c.expected}, got ${c.status}/${String(c.reserved)}`);
    const reserved: Record<string, number> = {};
    for (const order of Object.values(this.orders)) {
      reserved[order.sku] = (reserved[order.sku] ?? 0) + order.reserved;
    }
    for (const [sku, start] of Object.entries(this.scenario.stock)) {
      const expectedStock = start - (reserved[sku] ?? 0);
      const actual = this.stock[sku] ?? 0;
      if (actual !== expectedStock) {
        reasons.push(`${sku}: expected stock ${String(expectedStock)}, got ${String(actual)}`);
      }
    }
    return {
      verdict: reasons.length === 0 ? 'pass' : 'fail',
      reasons,
      evidenceHash: evidenceHash({ scenario: this.scenario.id, ...this.state() }),
      orders: checks,
    };
  }
}

/** Start an order-desk episode (a scenario id such as `s1`, or an index into the scenarios). */
export function createOrderDesk(scenario: string | number): OrderDesk {
  return new OrderDesk(scenario);
}
