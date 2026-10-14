/**
 * The learned-module placement rule: where a learned-context module is inserted into a message list.
 * It is the same rule the gateway applies on proxied requests, so a caller that calls its model
 * directly places the module exactly where a proxied request would.
 *
 * The rule mirrors the gateway's implementation and is pinned to it by a shared golden
 * (`test/learned/placement-golden.json`, generated from the gateway's own function and kept current by
 * a drift check on the gateway side).
 *
 * Exported from both `@ultrarouter/sdk/context` (no client needed) and `@ultrarouter/sdk`.
 */

/** The role the learned block is injected under — a DATA `user` message, exactly as the seam splices. */
export const LEARNED_MESSAGE_ROLE = 'user';

/** The learned block the placement inserts: a DATA `user` message carrying the rendered module body. */
export interface LearnedMessage {
  /** Always `user`: learned context is data, never an instruction. */
  readonly role: typeof LEARNED_MESSAGE_ROLE;
  /** The rendered learned-module body. */
  readonly content: string;
}

/**
 * The CACHE-SAFE placement index ("cache-placed after the stable prefix"). The learned
 * block is inserted immediately AFTER the leading run of `system` messages, so (a) the provider's
 * stable prefix stays byte-identical, and (b) the learned block — itself stable for a call type —
 * EXTENDS that prefix rather than invalidating it. A conversation with no leading system message
 * places the block FIRST (index 0), still ahead of every volatile turn.
 */
export function learnedPlacementIndex(messages: readonly { readonly role?: unknown }[]): number {
  let index = 0;
  while (index < messages.length && messages[index]?.role === 'system') index += 1;
  return index;
}

/**
 * Insert the learned block into a customer's messages at {@link learnedPlacementIndex} — the SAME
 * splice the gateway inject seam performs (`[...before, { role: 'user', content: body },...after]`).
 * PURE: returns a NEW array and never mutates the input. When `content` is null/empty (a holdout, or
 * no learned module) the messages pass through UNCHANGED (byte-identical) — the runtime never adds a
 * module the platform withheld.
 */
export function applyLearnedContext<M extends { readonly role?: unknown }>(
  messages: readonly M[],
  content: string | null | undefined,
): (M | LearnedMessage)[] {
  if (content === null || content === undefined || content === '') return [...messages];
  const at = learnedPlacementIndex(messages);
  return [...messages.slice(0, at), { role: LEARNED_MESSAGE_ROLE, content }, ...messages.slice(at)];
}
