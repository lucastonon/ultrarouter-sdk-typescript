/**
 * The learning-status vocabulary for `ur.flywheel.status()` and `ur.flywheel.calibration()`, aliased
 * from the generated `FlywheelStatusResponse` schema.
 *
 * `status()` reads `GET /v1/flywheel/status`: the usage quantities (kept separate, never merged),
 * integration health (channels and the history-import summary) and the `learning` block.
 * `calibration()` returns that same `learning` block: the calibration availability the gateway
 * declares. While a workspace is still collecting evidence the gateway reports it as unavailable;
 * the SDK never fabricates a track record.
 */

import type { components } from './generated/types.js';

type Schemas = components['schemas'];

/** `ur.flywheel.status()` → GET /v1/flywheel/status. */
export type FlywheelStatus = Schemas['FlywheelStatusResponse'];

/** The four SEPARATED Flywheel usage quantities + caps + storage + COGS. */
export type FlywheelUsage = Schemas['FlywheelUsageBlock'];

/**
 * `ur.flywheel.calibration()` → the `learning` block of GET /v1/flywheel/status: the flywheel
 * class + calibration AVAILABILITY (never a fabricated track record). Explicitly
 * unavailable while the workspace is still collecting evidence.
 */
export type FlywheelCalibration = FlywheelStatus['learning'];
