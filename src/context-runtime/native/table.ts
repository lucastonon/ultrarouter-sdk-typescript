// Generated file: vendored context runtime. Do not edit by hand.
/**
 * Compatibility TABLE — model × feature × beta header, as DATA.
 *
 * This is the load-bearing shape of native delivery: a provider/model/feature combination is
 * supported because a ROW SAYS SO, never because code inferred it. Adding a provider,
 * a model or a feature is a row; there is no branch anywhere in the runtime that names
 * a provider.
 *
 * TWO rules make the table safe:
 *
 *   1. **Absence is the fallback.** A pair with no row takes the ONE documented
 *      fallback (inline catalog + `native_delivery:'unavailable'`). Absence means
 *      "not declared in v1" — NOT "the provider cannot do it" — and the runtime treats
 *      the two identically, because only a declared row is evidence.
 *   2. **A declared gate must actually be sent.** A row's `betaHeader` is the gate value
 *      the caller must already be sending (`anthropic-beta`). If the caller does not
 *      offer it, the feature takes the fallback — never an optimistic assumption that
 *      the gate is on.
 *
 * The rows below are CONSERVATIVE BY CONSTRUCTION: they cover the one provider the specification
 * freezes for v1 (the Anthropic Messages API), for the current-generation
 * Messages models in the model catalog, with the
 * gate tokens the specification names verbatim. Widening the table is a reviewed row edit against
 * the provider's published matrix — never an inference in code.
 *
 * PURE: no IO, no clock, no RNG, no provider import.
 */

import type { NativeFeatureId } from './features.js';

/** One row of the compatibility table: this model, this feature, behind this gate. */
export interface NativeCompatibilityRow {
  /** The provider slug (e.g. `anthropic`). */
  readonly provider: string;
  /** The PROVIDER-NATIVE model id (no `provider/` prefix — see {@link nativeModelId}). */
  readonly model: string;
  readonly feature: NativeFeatureId;
  /**
   * The gate value the caller must be sending for this pair (`anthropic-beta`), or
   * `null` when the pair is gated by the MODEL alone. Frozen from the specification.
   */
  readonly betaHeader: string | null;
}

/** The Anthropic Messages models this table declares (model catalog, prefix-stripped). */
const CLAUDE_OPUS_4_8 = 'claude-opus-4-8';
const CLAUDE_SONNET_4_6 = 'claude-sonnet-4-6';
const CLAUDE_SONNET_5 = 'claude-sonnet-5';
const CLAUDE_HAIKU_4_5 = 'claude-haiku-4-5';

/** The gate values, frozen verbatim from the specification. */
const GATE_TOOL_SEARCH = 'tool_search_tool_regex_20251119';
const GATE_COMPACTION = 'compact-2026-01-12';
const GATE_CONTEXT_MANAGEMENT = 'context-management-2025-06-27';

/**
 * The v1 compatibility table.
 *
 * `mid_conversation_system` carries NO gate value: the specification names none, so the
 * pair is gated by the MODEL alone — which is why it is declared for the three larger
 * models and NOT for `claude-haiku-4-5`. A haiku target therefore takes the fallback for
 * turn-scoped operator text and for the memory tool: model gating expressed as missing
 * rows rather than a condition.
 */
export const NATIVE_COMPATIBILITY: readonly NativeCompatibilityRow[] = Object.freeze([
  // ─── anthropic · claude-opus-4-8 ───
  {
    provider: 'anthropic',
    model: CLAUDE_OPUS_4_8,
    feature: 'tool_search_deferred_loading',
    betaHeader: GATE_TOOL_SEARCH,
  },
  {
    provider: 'anthropic',
    model: CLAUDE_OPUS_4_8,
    feature: 'server_compaction',
    betaHeader: GATE_COMPACTION,
  },
  {
    provider: 'anthropic',
    model: CLAUDE_OPUS_4_8,
    feature: 'context_editing',
    betaHeader: GATE_CONTEXT_MANAGEMENT,
  },
  {
    provider: 'anthropic',
    model: CLAUDE_OPUS_4_8,
    feature: 'memory_tool',
    betaHeader: GATE_CONTEXT_MANAGEMENT,
  },
  {
    provider: 'anthropic',
    model: CLAUDE_OPUS_4_8,
    feature: 'mid_conversation_system',
    betaHeader: null,
  },

  // ─── anthropic · claude-sonnet-4-6 ───
  {
    provider: 'anthropic',
    model: CLAUDE_SONNET_4_6,
    feature: 'tool_search_deferred_loading',
    betaHeader: GATE_TOOL_SEARCH,
  },
  {
    provider: 'anthropic',
    model: CLAUDE_SONNET_4_6,
    feature: 'server_compaction',
    betaHeader: GATE_COMPACTION,
  },
  {
    provider: 'anthropic',
    model: CLAUDE_SONNET_4_6,
    feature: 'context_editing',
    betaHeader: GATE_CONTEXT_MANAGEMENT,
  },
  {
    provider: 'anthropic',
    model: CLAUDE_SONNET_4_6,
    feature: 'memory_tool',
    betaHeader: GATE_CONTEXT_MANAGEMENT,
  },
  {
    provider: 'anthropic',
    model: CLAUDE_SONNET_4_6,
    feature: 'mid_conversation_system',
    betaHeader: null,
  },

  // ─── anthropic · claude-sonnet-5 ───
  {
    provider: 'anthropic',
    model: CLAUDE_SONNET_5,
    feature: 'tool_search_deferred_loading',
    betaHeader: GATE_TOOL_SEARCH,
  },
  {
    provider: 'anthropic',
    model: CLAUDE_SONNET_5,
    feature: 'server_compaction',
    betaHeader: GATE_COMPACTION,
  },
  {
    provider: 'anthropic',
    model: CLAUDE_SONNET_5,
    feature: 'context_editing',
    betaHeader: GATE_CONTEXT_MANAGEMENT,
  },
  {
    provider: 'anthropic',
    model: CLAUDE_SONNET_5,
    feature: 'memory_tool',
    betaHeader: GATE_CONTEXT_MANAGEMENT,
  },
  {
    provider: 'anthropic',
    model: CLAUDE_SONNET_5,
    feature: 'mid_conversation_system',
    betaHeader: null,
  },

  // ─── anthropic · claude-haiku-4-5 (no memory tool, no mid-conversation system) ───
  {
    provider: 'anthropic',
    model: CLAUDE_HAIKU_4_5,
    feature: 'tool_search_deferred_loading',
    betaHeader: GATE_TOOL_SEARCH,
  },
  {
    provider: 'anthropic',
    model: CLAUDE_HAIKU_4_5,
    feature: 'server_compaction',
    betaHeader: GATE_COMPACTION,
  },
  {
    provider: 'anthropic',
    model: CLAUDE_HAIKU_4_5,
    feature: 'context_editing',
    betaHeader: GATE_CONTEXT_MANAGEMENT,
  },
]);

/** Who the delivery is aimed at. `betaHeaders` are the gate values the caller WILL send. */
export interface NativeDeliveryTarget {
  /** The provider slug (`anthropic`). */
  readonly provider: string;
  /** The model id — either provider-native (`claude-sonnet-5`) or the catalog's
   * provider-prefixed form (`anthropic/claude-sonnet-5`); see {@link nativeModelId}. */
  readonly model: string;
  /** The gate values the caller is sending. Omitted ⇒ none (every gated feature falls back). */
  readonly betaHeaders?: readonly string[];
}

/**
 * The provider-native model id the table is keyed on. A `<provider>/` prefix for THIS
 * target's provider is stripped (the model catalog's `<provider>/<model>` convention);
 * anything else is used VERBATIM, so a foreign prefix can never be mistaken for a
 * supported model. Pure.
 */
export function nativeModelId(provider: string, model: string): string {
  const prefix = `${provider}/`;
  return model.startsWith(prefix) ? model.slice(prefix.length) : model;
}

/**
 * The row for one (provider, model, feature) triple, or `null` when the table declares
 * none — the fallback case. This is the ONLY way support is decided.
 */
export function findNativeCompatibility(
  target: Pick<NativeDeliveryTarget, 'provider' | 'model'>,
  feature: NativeFeatureId,
  table: readonly NativeCompatibilityRow[] = NATIVE_COMPATIBILITY,
): NativeCompatibilityRow | null {
  const model = nativeModelId(target.provider, target.model);
  return (
    table.find(
      (row) => row.provider === target.provider && row.model === model && row.feature === feature,
    ) ?? null
  );
}

/** Whether the caller is sending the gate a row requires (a `null` gate needs nothing). */
export function gateSatisfied(row: NativeCompatibilityRow, target: NativeDeliveryTarget): boolean {
  if (row.betaHeader === null) return true;
  return (target.betaHeaders ?? []).includes(row.betaHeader);
}
