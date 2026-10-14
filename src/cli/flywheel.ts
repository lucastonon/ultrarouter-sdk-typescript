/**
 * `ur flywheel status` + `ur flywheel calibration` — the CLI over the Flywheel
 * status. Thin shells over the published `ur.flywheel.status()` /
 * `ur.flywheel.calibration()`: the same single `GET /v1/flywheel/status` read the SDK uses
 * (calibration is the read's `learning` block; the CLI invents no calibration route and
 * fabricates no track record — while collecting, the server reports the class explicitly
 * unavailable and the CLI surfaces exactly that).
 *
 * IO is INJECTED so both reads are unit-testable with no process/network. Exit 0 on success;
 * exit 2 fail-closed on any API error (a status the CLI could not read is never a silent 0).
 */

import type { UltraRouter } from '../client.js';
import { UltraRouterError } from '../errors.js';

import { EXIT } from './gate.js';

/** Injected IO for the flywheel read commands. */
export interface FlywheelDeps {
  readonly client: UltraRouter;
  readonly log: (line: string) => void;
  readonly err: (line: string) => void;
}

/** The result of a flywheel read command. */
export interface FlywheelReadResult {
  readonly exitCode: number;
}

/**
 * Run `ur flywheel status` — the four separated usage quantities, integration health
 * (channels + imports), and the learning block. Exit 0 on success; exit 2 fail-closed.
 */
export async function runFlywheelStatus(
  deps: FlywheelDeps,
  opts: { json: boolean },
): Promise<FlywheelReadResult> {
  try {
    const status = await deps.client.ur.flywheel.status();
    if (opts.json) {
      deps.log(JSON.stringify(status, null, 2));
    } else {
      const u = status.usage;
      deps.log(
        `ultrarouter flywheel status — workspace ${status.workspace_id} · period ${u.period}`,
      );
      deps.log(
        `  captured: ${String(u.tracked_artifacts)} artifacts · ${String(u.accepted_outcomes)} accepted outcomes`,
      );
      deps.log(
        `  analysis units: reserved ${String(u.analysis_units.reserved)} / settled ${String(u.analysis_units.settled)}` +
          `  · eval compute settled $${(u.evaluation_compute_usd.settled_micro_usd / 1_000_000).toFixed(2)}`,
      );
      deps.log(
        `  channels: ${status.channels.map((c) => `${c.channel}(${String(c.accepted_outcomes)})`).join(', ') || 'none'}`,
      );
      deps.log(
        `  imports: ${String(status.imports.total)} total · ${String(status.imports.completed)} completed · ${String(status.imports.failed)} failed`,
      );
      deps.log(
        `  learning: ${status.learning.flywheel_class} (${status.learning.flywheel_class_reason})` +
          ` · calibration ${status.learning.calibration_available ? 'available' : 'unavailable'}`,
      );
    }
    return { exitCode: EXIT.PASS };
  } catch (e) {
    deps.err(`ur flywheel status: ${errMessage(e)}`);
    return { exitCode: EXIT.GATE }; // fail closed
  }
}

/**
 * Run `ur flywheel calibration` — the `learning` block of the same status read: the honest
 * flywheel-class + calibration AVAILABILITY the server declares (never a fabricated track
 * record; a collecting state never implies observed lift). Exit 0 on success; exit 2
 * fail-closed.
 */
export async function runFlywheelCalibration(
  deps: FlywheelDeps,
  opts: { json: boolean },
): Promise<FlywheelReadResult> {
  try {
    const cal = await deps.client.ur.flywheel.calibration();
    if (opts.json) {
      deps.log(JSON.stringify(cal, null, 2));
    } else {
      deps.log(`ultrarouter flywheel calibration`);
      deps.log(`  flywheel class: ${cal.flywheel_class} (${cal.flywheel_class_reason})`);
      deps.log(`  calibration available: ${cal.calibration_available ? 'yes' : 'no'}`);
      deps.log(
        `  active levers: ${cal.active_levers.length > 0 ? cal.active_levers.join(', ') : 'none'}`,
      );
      if (!cal.calibration_available) {
        deps.log(
          `  (the server reports calibration unavailable — no lift is claimed while ${cal.flywheel_class_reason})`,
        );
      }
    }
    return { exitCode: EXIT.PASS };
  } catch (e) {
    deps.err(`ur flywheel calibration: ${errMessage(e)}`);
    return { exitCode: EXIT.GATE }; // fail closed
  }
}

/** A stable message for any thrown value (UltraRouterError carries a code + message). */
function errMessage(e: unknown): string {
  if (e instanceof UltraRouterError) return `${e.code}: ${e.message}`;
  if (e instanceof Error) return e.message;
  return String(e);
}

export { EXIT };
