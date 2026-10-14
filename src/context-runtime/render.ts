// Generated file: vendored context runtime. Do not edit by hand.
/**
 * Render + exit. `render` turns a compiled manifest + bodies into provider
 * messages via a profile serializer. `toMessages` is the EXIT:
 * for a LIFTED manifest it rebuilds the exact original `messages` (byte-identical — the
 * "leave in one file" guarantee); for a compiled manifest it renders bodies via the
 * default serializer. Pure — no gateway feature requires a manifest to leave.
 */

import type { LiftExt, LiftMessageRecord } from './lift.js';
import type { Manifest, ManifestEntry } from './manifest.js';
import { defaultRenderSerializer, type ChatMessage, type RenderSerializer } from './messages.js';

/** Render a compiled manifest into provider messages using a serializer (default: the
 * ultrarouter serializer). `bodies` maps `moduleId` → body text. Pure. */
export function render(
  manifest: Manifest,
  bodies: ReadonlyMap<string, string>,
  serializer: RenderSerializer = defaultRenderSerializer,
): readonly ChatMessage[] {
  return serializer({ manifest, bodies });
}

/** A raised, typed error when `toMessages` is asked to exit a manifest that carries
 * neither lift reconstruction data nor supplied bodies. */
export class ContextExitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ContextExitError';
  }
}

function liftExtOf(manifest: Manifest): LiftExt | null {
  const ext = manifest.ext;
  if (ext === undefined) return null;
  const lift = (ext as { lift?: unknown }).lift;
  if (lift === null || typeof lift !== 'object') return null;
  const messages = (lift as { messages?: unknown }).messages;
  if (!Array.isArray(messages)) return null;
  return lift as LiftExt;
}

function entryText(entry: ManifestEntry): string {
  const ext = entry.ext;
  if (ext === undefined) return '';
  const text = (ext as { text?: unknown }).text;
  return typeof text === 'string' ? text : '';
}

function entryMessageIndex(entry: ManifestEntry): number | null {
  const ext = entry.ext;
  if (ext === undefined) return null;
  const index = (ext as { messageIndex?: unknown }).messageIndex;
  return typeof index === 'number' ? index : null;
}

/**
 * Exit a manifest back to messages. A LIFTED manifest reconstructs the exact original
 * input: each message's string content is rebuilt by concatenating its segments' texts
 * in range order (proving the segments are lossless), and non-content keys are restored
 * in their original order — byte-identical for `toMessages(fromMessages(m))`. A
 * COMPILED manifest is rendered from `bodies` via the default serializer. Pure.
 */
export function toMessages(
  manifest: Manifest,
  bodies?: ReadonlyMap<string, string>,
): readonly ChatMessage[] {
  const lift = liftExtOf(manifest);
  if (lift !== null) {
    return reconstructFromLift(manifest, lift);
  }
  if (bodies !== undefined) {
    return render(manifest, bodies);
  }
  throw new ContextExitError('toMessages needs a lifted manifest or a bodies map to exit');
}

function reconstructFromLift(manifest: Manifest, lift: LiftExt): readonly ChatMessage[] {
  const byMessage = new Map<number, ManifestEntry[]>();
  for (const entry of manifest.entries) {
    const index = entryMessageIndex(entry);
    if (index === null) continue;
    const list = byMessage.get(index) ?? [];
    list.push(entry);
    byMessage.set(index, list);
  }

  const records = [...lift.messages].sort(
    (left: LiftMessageRecord, right: LiftMessageRecord) => left.index - right.index,
  );
  const messages: ChatMessage[] = [];
  for (const record of records) {
    const segments = (byMessage.get(record.index) ?? []).sort(
      (left, right) => (left.range?.start ?? 0) - (right.range?.start ?? 0),
    );
    const content = record.contentIsString
      ? segments.map((entry) => entryText(entry)).join('')
      : record.rawContent;
    const message: Record<string, unknown> = {};
    for (const key of record.keyOrder) {
      // Define, never assign: an own `__proto__` key must come back as an own property.
      Object.defineProperty(message, key, {
        value: key === 'content' ? content : record.scaffold[key],
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }
    messages.push(message as ChatMessage);
  }
  return messages;
}
