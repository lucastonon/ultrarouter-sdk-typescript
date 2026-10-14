// Generated file: vendored context runtime. Do not edit by hand.
/**
 * Native-delivery FEATURES — the frozen v1 vocabulary:
 * "consume the labs' features; never re-implement them".
 *
 * A feature says FOUR things, all as DATA:
 *   1. which manifest entries it can carry (`selector` — memory class / kind / slot);
 *   2. which delivery CHANNEL it carries them through (`channel`);
 *   3. the provider feature/tool TOKEN the request will name (`token`, frozen verbatim
 *      from the specification);
 *   4. what the model actually SEES up front (`disclosure`) and what the placement
 *      requires (`placement`, `requiresOptIn`).
 *
 * Nothing here branches on a provider: the model × feature × beta-header gating lives in
 * the separate compatibility TABLE (`./table.ts`) and the planner (`./plan.ts`) walks
 * both as data. Adding a feature is a row in {@link NATIVE_FEATURES} (+ its rows in the
 * compatibility table) — never a new `if`.
 *
 * This module is PURE: no IO, no clock, no RNG, no provider import.
 */

/** Where a module is delivered. `inline` is the ONE documented fallback. */
export const NATIVE_DELIVERY_CHANNELS = [
  'deferred_tool',
  'memory',
  'compaction_window',
  'mid_conversation_system',
  'inline',
] as const;
export type NativeDeliveryChannel = (typeof NATIVE_DELIVERY_CHANNELS)[number];

/** A channel a native FEATURE may declare (everything except the inline fallback). */
export type NativeFeatureChannel = Exclude<NativeDeliveryChannel, 'inline'>;

/** The closed v1 feature vocabulary (the specification names exactly these). */
export const NATIVE_FEATURE_IDS = [
  'tool_search_deferred_loading',
  'server_compaction',
  'context_editing',
  'memory_tool',
  'mid_conversation_system',
] as const;
export type NativeFeatureId = (typeof NATIVE_FEATURE_IDS)[number];

const FEATURE_ID_SET: ReadonlySet<string> = new Set(NATIVE_FEATURE_IDS);

/** Whether `value` is one of the closed v1 feature ids. */
export function isNativeFeatureId(value: string): value is NativeFeatureId {
  return FEATURE_ID_SET.has(value);
}

/**
 * What the model sees up front on this channel.
 *
 *   - `full` — the module is delivered in the request as material the model reads now.
 *   - `descriptor` — the module delivered IS a compact descriptor, and the material it
 *     NAMES (the SOP/tool body) is fetched by the model on demand through the provider's
 *     own tool search. That deferred material was never a manifest module, so the PLAN
 *     still carries the same bytes for the module itself as the inline fallback would —
 *     which is why fallback parity can assert facts AND bytes. The saving comes from the
 *     provider not expanding what the descriptor points at.
 */
export const NATIVE_DISCLOSURES = ['full', 'descriptor'] as const;
export type NativeDisclosure = (typeof NATIVE_DISCLOSURES)[number];

/**
 * Which manifest entries a feature can carry. Every declared field must match (AND);
 * an omitted field does not constrain. Matching is on the entry's DECLARED labels —
 * the planner never infers a module's role from its content.
 */
export interface NativeModuleSelector {
  readonly memoryClasses?: readonly string[];
  readonly kinds?: readonly string[];
  readonly slots?: readonly string[];
}

/**
 * A placement restriction, as DATA. Evaluated against the conversation the delivery
 * would be appended to; an unsatisfied rule sends the entry to the inline fallback
 * (fail closed — a missing conversation can never satisfy a rule).
 */
export interface NativePlacementRule {
  /** The insertion point may NEVER be the first message of the conversation. */
  readonly neverFirst?: boolean;
  /** The message immediately BEFORE the insertion point must carry this role. */
  readonly requiresPrecedingRole?: string;
}

/** One native delivery feature. */
export interface NativeFeature {
  readonly id: NativeFeatureId;
  readonly channel: NativeFeatureChannel;
  readonly selector: NativeModuleSelector;
  /**
   * The provider feature/tool token the request names, FROZEN verbatim from the
   * specification. Changing it is a data edit here, never a code change.
   */
  readonly token: string;
  readonly disclosure: NativeDisclosure;
  /** True ⇒ the APP must have opted in by naming this feature (the specification: the memory tool
   * is used "where the app opted in"). An absent opt-in takes the fallback. */
  readonly requiresOptIn: boolean;
  readonly placement?: NativePlacementRule;
  /** One line explaining the mapping (surfaced in the plan's `unsupported` reasons). */
  readonly description: string;
}

/**
 * The kinds a module must declare to be delivered as a deferred-loading tool. A module
 * is a descriptor because it SAYS so, never because the planner guessed
 * (planning loads descriptors only).
 */
export const NATIVE_DESCRIPTOR_KINDS = ['sop_descriptor', 'tool_descriptor'] as const;

/** The slot that marks turn-scoped OPERATOR text. */
export const NATIVE_OPERATOR_SLOT = 'operator';

/**
 * The FOUR frozen v1 mappings, in PRIORITY order: an entry matched
 * by several features is delivered through the FIRST one in this list that its target
 * actually supports. Order is part of the contract — it is what makes the plan
 * deterministic.
 */
export const NATIVE_FEATURES: readonly NativeFeature[] = Object.freeze([
  {
    id: 'tool_search_deferred_loading',
    channel: 'deferred_tool',
    selector: { kinds: [...NATIVE_DESCRIPTOR_KINDS] },
    token: 'tool_search_tool_regex_20251119',
    disclosure: 'descriptor',
    requiresOptIn: false,
    description:
      'SOP/tool descriptors are delivered as `defer_loading: true` tools behind tool search; the body loads on demand',
  },
  {
    id: 'server_compaction',
    channel: 'compaction_window',
    selector: { memoryClasses: ['episodic'] },
    token: 'compact-2026-01-12',
    disclosure: 'full',
    requiresOptIn: false,
    description:
      'episodic modules are placed in the compaction window so server-side compaction owns the history',
  },
  {
    id: 'context_editing',
    channel: 'compaction_window',
    selector: { memoryClasses: ['episodic'] },
    token: 'context-management-2025-06-27',
    disclosure: 'full',
    requiresOptIn: false,
    description:
      'episodic modules are placed where server-side context editing can clear stale tool uses',
  },
  {
    id: 'memory_tool',
    channel: 'memory',
    selector: { memoryClasses: ['procedural'] },
    token: 'memory_20250818',
    disclosure: 'full',
    requiresOptIn: true,
    description: 'procedural modules are delivered through the memory tool where the app opted in',
  },
  {
    id: 'mid_conversation_system',
    channel: 'mid_conversation_system',
    selector: { slots: [NATIVE_OPERATOR_SLOT] },
    token: 'mid_conversation_system',
    disclosure: 'full',
    requiresOptIn: false,
    placement: { neverFirst: true, requiresPrecedingRole: 'user' },
    description:
      'turn-scoped operator text is delivered as a mid-conversation system message (model-gated; must follow a user turn, never first)',
  },
]);

/** Look a feature up by id in a feature table (default: the frozen v1 set). */
export function findNativeFeature(
  id: string,
  features: readonly NativeFeature[] = NATIVE_FEATURES,
): NativeFeature | null {
  return features.find((feature) => feature.id === id) ?? null;
}

/** The labels a selector is matched against (the manifest-entry subset it reads). */
export interface NativeSelectableEntry {
  readonly kind: string;
  readonly memoryClass: string;
  readonly slot: string;
}

/** Whether a selector admits an entry. Every declared field must match (AND). Pure. */
export function selectorMatches(
  selector: NativeModuleSelector,
  entry: NativeSelectableEntry,
): boolean {
  if (selector.memoryClasses !== undefined && !selector.memoryClasses.includes(entry.memoryClass)) {
    return false;
  }
  if (selector.kinds !== undefined && !selector.kinds.includes(entry.kind)) return false;
  if (selector.slots !== undefined && !selector.slots.includes(entry.slot)) return false;
  return true;
}

/** One turn of the conversation a delivery would be appended to (roles only — the
 * placement rules read the SHAPE of the conversation, never its content). */
export interface NativeConversationTurn {
  readonly role: string;
}

/** Why a placement rule was not satisfied (a closed, reportable vocabulary). */
export const NATIVE_PLACEMENT_DETAILS = ['never_first', 'preceding_role'] as const;
export type NativePlacementDetail = (typeof NATIVE_PLACEMENT_DETAILS)[number];

/** The verdict of one placement check. */
export type NativePlacementVerdict =
  | { readonly ok: true }
  | { readonly ok: false; readonly detail: NativePlacementDetail; readonly message: string };

/**
 * Evaluate a placement rule against the conversation the delivery is appended to.
 *
 * FAIL CLOSED: the insertion point is the END of `conversation`, so an ABSENT or EMPTY
 * conversation satisfies NOTHING — a rule is never skipped because its evidence is
 * missing. `neverFirst` is checked before `requiresPrecedingRole` so an empty
 * conversation always reports `never_first`.
 */
export function placementSatisfied(
  rule: NativePlacementRule | undefined,
  conversation: readonly NativeConversationTurn[] | undefined,
): NativePlacementVerdict {
  if (rule === undefined) return { ok: true };
  const turns = conversation ?? [];
  if (rule.neverFirst === true && turns.length === 0) {
    return {
      ok: false,
      detail: 'never_first',
      message:
        'the delivery would be the FIRST message of the conversation; this feature may never be placed first',
    };
  }
  if (rule.requiresPrecedingRole !== undefined) {
    const preceding = turns.length > 0 ? turns[turns.length - 1] : undefined;
    if (preceding === undefined || preceding.role !== rule.requiresPrecedingRole) {
      return {
        ok: false,
        detail: 'preceding_role',
        message: `the delivery must follow a "${rule.requiresPrecedingRole}" turn (the preceding turn is ${
          preceding === undefined ? 'absent' : `"${preceding.role}"`
        })`,
      };
    }
  }
  return { ok: true };
}
