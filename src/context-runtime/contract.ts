// Generated file: vendored context runtime. Do not edit by hand.
/**
 * `Contract`. Per stage: which module kinds are mandatory,
 * allowed, forbidden; the budgets; per-kind / per-facet caps (`limits`); the pin
 * policy; the slot vocabulary. `orderRule` is round-tripped for parent parity but the
 * compiler orders by `profile.orderRule` — a contract cannot
 * silently re-order a workload; that is a ratchet-gated profile change.
 */

import { z } from 'zod';

import { EnvelopeBudgetsSchema } from './envelope.js';

/**
 * A per-kind or per-facet cap. `max` admits at most that many matching modules
 * (for example per-kind caps such as 3, 8 or 25, and
 * per-facet caps such as `facet:'polarity'`). A limit with a `kind` counts
 * that kind; a limit with `facet`(+optional `facetValue`) counts modules whose facet
 * matches. `LIMIT_EXCEEDED` is emitted when a candidate would exceed a cap.
 */
export const LimitSchema = z.object({
  kind: z.string().min(1).optional(),
  facet: z.string().min(1).optional(),
  facetValue: z.string().min(1).optional(),
  max: z.number().int().nonnegative(),
  label: z.string().min(1).optional(),
});
export type Limit = z.infer<typeof LimitSchema>;

/** How the compiler treats envelope pins. `strict`: every pin must resolve + match its
 * kind/hash or the run is inadmissible. `none`: the profile does not use pins. */
export const PIN_POLICIES = ['strict', 'none'] as const;
export type PinPolicy = (typeof PIN_POLICIES)[number];

export const ContractSchema = z.object({
  stage: z.string().min(1),
  requiredKinds: z.array(z.string().min(1)),
  optionalKinds: z.array(z.string().min(1)),
  forbiddenKinds: z.array(z.string().min(1)),
  budgets: EnvelopeBudgetsSchema,
  limits: z.array(LimitSchema),
  /** Round-tripped for parity; `profile.orderRule` is authoritative for ordering. */
  orderRule: z.enum(['selection', 'volatility']).optional(),
  pinPolicy: z.enum(PIN_POLICIES),
  slots: z.array(z.string().min(1)),
  ext: z.record(z.string(), z.unknown()).optional(),
});
export type Contract = z.infer<typeof ContractSchema>;
