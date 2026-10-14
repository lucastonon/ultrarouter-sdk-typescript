// Generated file: vendored context runtime. Do not edit by hand.
/**
 * Ports — the TWO seams that keep single-use authorization a property of the
 * STORE, not a claim of a pure function. Both are TYPE-LEVEL
 * interfaces the caller implements; this pure, IO-free package ships NO implementation
 * that touches a store, a clock or a network.
 *
 *   - `SopLoadPort` loads a full SOP body. The planning plane (`catalog`/`eligible`/
 *     `describe`) NEVER calls it — bodies are loaded only at the gated phase boundary
 *     via {@link loadPhaseBody}, so a recording fake proves "planning loads zero
 *     bodies".
 *   - `AuthorizationReceiptPort` records a single-use, execution-bound receipt
 *     `{spec_hash, phase, args_hash, exec_id}`. {@link authorizePhase} is PURE: it
 *     builds the receipt and asks the port to record it; the port (an atomic store —
 *     e.g. a unique insert) decides whether the receipt is fresh or a duplicate. The
 *     pure function makes NO single-use claim of its own — a reused receipt is refused
 *     because the store says `duplicate`.
 */

import { hashContextValue } from '../hash.js';

import { sopRefusal, type SopRefusal } from './refusals.js';
import type { ExecutableSopSpec } from './spec.js';

/** A reference to the SOP body a phase needs at execution. */
export interface SopLoadRef {
  readonly specId: string;
  readonly specHash: string;
  readonly phase: string;
}

/** Loads a full SOP body. The caller's implementation is the ONLY thing that touches
 * a store; the pure package calls it only at the gated phase boundary. May be sync or
 * async depending on the backing store. */
export interface SopLoadPort {
  load(ref: SopLoadRef): unknown;
}

/** A single-use, execution-bound authorization receipt. */
export interface AuthorizationReceipt {
  /** The spec's content digest (`compiledHash`). */
  readonly specHash: string;
  readonly phase: string;
  /** Content digest of the exact phase arguments. */
  readonly argsHash: string;
  /** The execution this authorization is bound to. */
  readonly execId: string;
}

/** The store's verdict on recording a receipt. `recorded` = fresh (authorized);
 * `duplicate` = this exact receipt was already used (single-use violation). */
export type SopReceiptOutcome = 'recorded' | 'duplicate';

/** Records a single-use, execution-bound receipt. The implementation MUST make the
 * record-or-reject atomic (e.g. a unique insert) so two concurrent identical requests
 * cannot both be told `recorded` — single use is enforced HERE, not by the pure
 * {@link authorizePhase}. */
export interface AuthorizationReceiptPort {
  record(receipt: AuthorizationReceipt): SopReceiptOutcome;
}

/** The input to authorize one phase execution. */
export interface AuthorizePhaseInput {
  readonly spec: ExecutableSopSpec;
  readonly phase: string;
  /** The exact phase arguments (content-hashed into the receipt). */
  readonly args: unknown;
  readonly execId: string;
}

/** The outcome of {@link authorizePhase}. */
export type AuthorizePhaseResult =
  | { readonly ok: true; readonly receipt: AuthorizationReceipt }
  | {
      readonly ok: false;
      readonly refusal: SopRefusal;
      readonly receipt: AuthorizationReceipt | null;
    };

/**
 * Authorize one phase execution. PURE: builds the execution-bound receipt
 * `{spec_hash, phase, args_hash, exec_id}` and asks the port to record it. An unknown
 * phase is refused WITHOUT recording; a `duplicate` verdict from the store is the
 * `SOP_RECEIPT_REUSED` refusal (single use enforced BY the store). Never throws.
 */
export function authorizePhase(
  input: AuthorizePhaseInput,
  port: AuthorizationReceiptPort,
): AuthorizePhaseResult {
  if (!input.spec.phases.some((phase) => phase.id === input.phase)) {
    return {
      ok: false,
      refusal: sopRefusal(
        'SOP_PHASE_INVALID',
        `phase "${input.phase}" is not declared by SOP "${input.spec.id}"`,
        { detail: 'unknown_phase', path: 'phase' },
      ),
      receipt: null,
    };
  }
  const receipt: AuthorizationReceipt = {
    specHash: input.spec.compiledHash,
    phase: input.phase,
    argsHash: hashContextValue(input.args),
    execId: input.execId,
  };
  const outcome = port.record(receipt);
  if (outcome === 'duplicate') {
    return {
      ok: false,
      refusal: sopRefusal(
        'SOP_RECEIPT_REUSED',
        `phase "${input.phase}" of SOP "${input.spec.id}" was already authorized for this execution and arguments`,
      ),
      receipt,
    };
  }
  return { ok: true, receipt };
}

/** Load a phase's full body via the caller's {@link SopLoadPort}, at the gated phase
 * boundary. This is the ONLY package path that calls `load`; planning never does.
 * Validates the phase exists first. Pure dispatcher — it touches no store itself. */
export function loadPhaseBody(port: SopLoadPort, spec: ExecutableSopSpec, phase: string): unknown {
  if (!spec.phases.some((declared) => declared.id === phase)) {
    throw new Error(`phase "${phase}" is not declared by SOP "${spec.id}"`);
  }
  return port.load({ specId: spec.id, specHash: spec.compiledHash, phase });
}
