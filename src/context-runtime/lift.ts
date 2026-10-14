// Generated file: vendored context runtime. Do not edit by hand.
/**
 * Lift — `fromMessages`. Turns a raw OpenAI `messages` array into
 * a labelled manifest using the SAME segmenter code as the gateway (the core library
 * `segment`, imported through its narrow pure subpath — NEVER a copy). the labels
 * this returns ARE the gateway segmenter's labels (same code path). The manifest carries
 * the per-message reconstruction record so {@link import('./render.js').toMessages} can
 * rebuild the exact input — the exit guarantee: leaving is a pure function.
 */

import { segment } from './_core/compression/segment.js';
import type {
  PromptMessage,
  SegmentHint,
  SegmentKind,
  Segments,
} from './_core/compression/segment-types.js';

import { hashContextValue, sha256Hex } from './hash.js';
import { ManifestSchema, scaffoldSubject, type Manifest, type ManifestEntry } from './manifest.js';
import { encodeUltrarouterManifest } from './profile.js';

/** One label the lift exposes — the gateway segmenter's classification for a message. */
export interface LiftLabel {
  readonly messageIndex: number;
  readonly kind: SegmentKind;
  readonly eligible: boolean;
  readonly range?: { readonly start: number; readonly end: number };
}

/** The result of a lift: a labelled manifest + the raw segmenter labels + diagnostics. */
export interface LiftedManifest {
  readonly manifest: Manifest;
  readonly labels: readonly LiftLabel[];
  readonly unparseable: boolean;
  readonly warnings?: readonly string[];
}

/** How a message's content is reconstructed at the exit. `string` content is rebuilt
 * from its segment texts (proving losslessness); anything else is re-emitted verbatim. */
export interface LiftMessageRecord {
  readonly index: number;
  readonly keyOrder: readonly string[];
  readonly scaffold: Record<string, unknown>;
  readonly contentIsString: boolean;
  readonly rawContent: unknown;
}

/** The reconstruction record stored on a lifted manifest's `ext.lift`. */
export interface LiftExt {
  readonly messages: readonly LiftMessageRecord[];
}

const SLOT_BY_KIND: Readonly<Record<SegmentKind, string>> = {
  system_instructions: 'instruction',
  user_question: 'instruction',
  reference_context: 'reference',
  few_shot_examples: 'exemplar',
  tool_schemas: 'reference',
  tool_results: 'reference',
  history: 'reference',
  output_contract: 'instruction',
};

const MEMORY_CLASS_BY_KIND: Readonly<Record<SegmentKind, string>> = {
  system_instructions: 'procedural',
  user_question: 'working',
  reference_context: 'semantic',
  few_shot_examples: 'episodic',
  tool_schemas: 'procedural',
  tool_results: 'working',
  history: 'episodic',
  output_contract: 'procedural',
};

function estimateTokens(text: string | null): number {
  if (text === null) return 0;
  return Math.ceil(text.length / 4);
}

/**
 * Lift an OpenAI `messages` array into a labelled manifest via the gateway segmenter.
 * `hints` are the SDK `ur.segments` labels (same input the gateway honours). Pure.
 */
export function fromMessages(
  messages: readonly PromptMessage[],
  hints?: readonly SegmentHint[],
): LiftedManifest {
  const segments: Segments = segment({
    messages,
    ...(hints !== undefined ? { segments: hints } : {}),
  });

  const labels: LiftLabel[] = [];
  const entries: ManifestEntry[] = [];
  const messageRecords = new Map<number, LiftMessageRecord>();

  let order = 0;
  for (const part of segments.parts) {
    if (part.origin !== 'message') continue; // fromMessages labels messages only
    const messageIndex = part.messageIndex;
    const text = part.text;
    const start = part.spanStart ?? 0;
    const end = part.spanEnd ?? text?.length ?? 0;

    labels.push({
      messageIndex,
      kind: part.kind,
      eligible: part.eligible,
      ...(text !== null ? { range: { start, end } } : {}),
    });

    entries.push({
      moduleId: `seg:${String(order)}`,
      version: '1',
      kind: part.kind,
      memoryClass: MEMORY_CLASS_BY_KIND[part.kind],
      // The heuristic lift never asserts authority; the witness uses the declared
      // manifest for trust. Reference/exemplar data is treated as untrusted-by-default.
      trustClass:
        part.kind === 'system_instructions' || part.kind === 'user_question'
          ? 'approved_derived'
          : 'untrusted',
      privacyClass: 'workspace_private',
      contentHash: sha256Hex(text ?? ''),
      order,
      mandatory: part.kind === 'system_instructions' || part.kind === 'user_question',
      tokenEstimate: estimateTokens(text),
      slot: SLOT_BY_KIND[part.kind],
      range: { messageIndex, start, end },
      ext: { origin: 'message', messageIndex, role: part.role, text },
    });
    order += 1;

    if (!messageRecords.has(messageIndex)) {
      const source = messages[messageIndex];
      const record = buildMessageRecord(messageIndex, source);
      messageRecords.set(messageIndex, record);
    }
  }

  const liftExt: LiftExt = {
    messages: [...messageRecords.values()].sort((left, right) => left.index - right.index),
  };
  const ext = { lift: liftExt } as unknown as Record<string, unknown>;
  const envelopeHash = hashContextValue({ lift: liftExt.messages.map((record) => record.index) });
  const scaffoldHash = hashContextValue(scaffoldSubject(entries));
  const encoderInput = {
    envelopeId: 'lift',
    stage: 'lift',
    entries,
    refused: [],
    budgets: {
      tokensAdmitted: entries.reduce((sum, entry) => sum + entry.tokenEstimate, 0),
      tokenLimit: null,
      admitted: entries.length,
      refused: 0,
    },
    envelopeHash,
    scaffoldHash,
    ext,
  };
  // fromMessages has no envelope/contract; the ctx-free default encoder needs neither.
  const encoded = encodeUltrarouterManifest(encoderInput);

  const manifest = ManifestSchema.parse({ ...encoderInput, manifestHash: encoded.hash });

  return {
    manifest,
    labels,
    unparseable: segments.unparseable,
    ...(segments.warnings !== undefined ? { warnings: segments.warnings } : {}),
  };
}

function buildMessageRecord(index: number, source: PromptMessage | undefined): LiftMessageRecord {
  if (source === undefined) {
    return {
      index,
      keyOrder: ['role', 'content'],
      scaffold: {},
      contentIsString: false,
      rawContent: null,
    };
  }
  const keyOrder = Object.keys(source);
  const scaffold: Record<string, unknown> = {};
  for (const key of keyOrder) {
    // Define, never assign: an own `__proto__` key (as `JSON.parse` produces) must stay an
    // own property, not re-parent the record, or the exit could not restore it.
    if (key !== 'content') {
      Object.defineProperty(scaffold, key, {
        value: source[key],
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }
  }
  const contentIsString = typeof source.content === 'string';
  return {
    index,
    keyOrder,
    scaffold,
    contentIsString,
    rawContent: source.content,
  };
}
