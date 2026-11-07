import { haversineKm } from "../geo/distance";
import { getRoute, type RouteBudget, type RouteEstimate, type RouteFailure, type RouteSource } from "../routing";
import type { LngLat } from "../routing/types";

/** PLAN §9 constants. */
export const WAIT_ALLOWANCE_MIN = 20;
export const HANDLING_MIN = 5;
export const MAX_ROUTED_CANDIDATES = 5;
/** Generous straight-line bound: 1.5 km of straight-line detour per allowed detour minute (~90 km/h). */
const PREFILTER_KM_PER_MIN = 1.5;
/** Fastest plausible average speed, used only to rule out the impossible (never shown as a time). */
const MAX_PLAUSIBLE_KMH = 110;

const MIN = 60_000;

export type Point = { lat: number; lng: number };

export type Journey = {
  origin: Point;
  destination: Point;
  departAt: Date;
  maxDetourMin: number;
};

/** What the engine needs from a published request (a row of `public_requests`; approximate points only). */
export type Candidate = {
  id: string;
  species: string;
  urgency: string;
  carrierRequirements: string | null;
  pickup: Point;
  dropoff: Point;
  windowStart: Date;
  windowEnd: Date;
  deadline: Date | null;
};

/** The signed-in volunteer's declared capabilities. `null` means unknown: no capability filtering. */
export type Capabilities = { speciesOk: string[]; hasCarrier: boolean } | null;

const URGENCY_RANK: Record<string, number> = { urgent: 0, soon: 1, routine: 2 };

export function fitsCapabilities(c: Candidate, caps: Capabilities): boolean {
  if (!caps) return true;
  if (!caps.speciesOk.includes(c.species)) return false;
  if (c.carrierRequirements && !caps.hasCarrier) return false;
  return true;
}

/** Straight-line extra distance of O → P → Q → D over O → D. Used only to rank and prefilter. */
export function straightLineDetourKm(j: Journey, c: Candidate): number {
  return (
    haversineKm(j.origin, c.pickup) +
    haversineKm(c.pickup, c.dropoff) +
    haversineKm(c.dropoff, j.destination) -
    haversineKm(j.origin, j.destination)
  );
}

/**
 * Free prefilter (PLAN §9.2). Only rules out candidates that cannot possibly fit, using straight-line
 * figures as bounds (never as travel times). Returns the best few by straight-line detour.
 */
export function prefilter(
  candidates: Candidate[],
  j: Journey,
  caps: Capabilities,
  limit = MAX_ROUTED_CANDIDATES,
): Candidate[] {
  const boundKm = j.maxDetourMin * PREFILTER_KM_PER_MIN;
  const now = j.departAt.getTime();
  return candidates
    .filter((c) => fitsCapabilities(c, caps))
    .map((c) => ({ c, km: straightLineDetourKm(j, c) }))
    .filter(({ c, km }) => {
      if (km > boundKm) return false;
      // Even at an implausibly fast average speed, could we reach the pickup before its window closes?
      const minToPickup = (haversineKm(j.origin, c.pickup) / MAX_PLAUSIBLE_KMH) * 60 * MIN;
      if (now + minToPickup > c.windowEnd.getTime()) return false;
      if (c.deadline) {
        const minToDrop =
          ((haversineKm(j.origin, c.pickup) + haversineKm(c.pickup, c.dropoff)) / MAX_PLAUSIBLE_KMH) * 60 * MIN;
        if (now + minToDrop > c.deadline.getTime()) return false;
      }
      return true;
    })
    .sort((a, b) => a.km - b.km || a.c.id.localeCompare(b.c.id))
    .slice(0, limit)
    .map(({ c }) => c);
}

export type InfeasibleReason = "window_missed" | "wait_too_long" | "deadline_missed" | "detour_too_large";

export type Evaluation =
  | {
      feasible: true;
      detourMin: number;
      waitMin: number;
      handlingMin: number;
      arrivePickup: Date;
      pickupAt: Date;
      arriveDropoff: Date;
    }
  | { feasible: false; reason: InfeasibleReason; detourMin: number };

const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * Pure arithmetic (PLAN §9.3–4). `baselineS` is O → D; `viaS` is O → P → Q → D with per-segment
 * durations `[O→P, P→Q, Q→D]`. The order is fixed, so drop-off always follows pickup.
 */
export function evaluate(
  j: Journey,
  c: Candidate,
  baselineS: number,
  viaSegmentsS: [number, number, number],
): Evaluation {
  const total = viaSegmentsS[0] + viaSegmentsS[1] + viaSegmentsS[2];
  const detourMin = round1(Math.max(0, total - baselineS) / 60);
  if (detourMin > j.maxDetourMin) return { feasible: false, reason: "detour_too_large", detourMin };

  const arrivePickup = new Date(j.departAt.getTime() + viaSegmentsS[0] * 1000);
  if (arrivePickup > c.windowEnd) return { feasible: false, reason: "window_missed", detourMin };

  const waitMs = Math.max(0, c.windowStart.getTime() - arrivePickup.getTime());
  if (waitMs > WAIT_ALLOWANCE_MIN * MIN) return { feasible: false, reason: "wait_too_long", detourMin };

  const pickupAt = new Date(arrivePickup.getTime() + waitMs);
  const leavePickup = new Date(pickupAt.getTime() + HANDLING_MIN * MIN);
  const arriveDropoff = new Date(leavePickup.getTime() + viaSegmentsS[1] * 1000);
  if (c.deadline && arriveDropoff > c.deadline) return { feasible: false, reason: "deadline_missed", detourMin };

  return {
    feasible: true,
    detourMin,
    waitMin: Math.round(waitMs / MIN),
    handlingMin: HANDLING_MIN * 2,
    arrivePickup,
    pickupAt,
    arriveDropoff,
  };
}

/** Feasible first, then urgency, then detour minutes (PLAN §9.5). */
export function orderMatches<T extends { candidate: Candidate; evaluation: Evaluation }>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    const fa = a.evaluation.feasible ? 0 : 1;
    const fb = b.evaluation.feasible ? 0 : 1;
    return (
      fa - fb ||
      (URGENCY_RANK[a.candidate.urgency] ?? 3) - (URGENCY_RANK[b.candidate.urgency] ?? 3) ||
      a.evaluation.detourMin - b.evaluation.detourMin
    );
  });
}

export type Match = { candidate: Candidate; evaluation: Evaluation; source: RouteSource };

export type MatchOutcome =
  | { ok: true; source: RouteSource; baselineMin: number; matches: Match[]; couldntCheck: number; considered: number }
  | { ok: false; reason: RouteFailure };

type Db = Parameters<typeof getRoute>[0];

const ll = (p: Point): LngLat => [p.lng, p.lat];

/**
 * Route-match a journey: one baseline call, then one call per prefiltered candidate (≤ 5), all within
 * `budget`. If the baseline can't be calculated nothing is guessed; the caller shows nearby results only.
 * Candidates whose own route can't be calculated are counted, not faked.
 */
export async function matchJourney(
  db: Db,
  j: Journey,
  candidates: Candidate[],
  caps: Capabilities,
  budget: RouteBudget,
): Promise<MatchOutcome> {
  const base = await getRoute(db, [ll(j.origin), ll(j.destination)], budget);
  if (!base.ok) return { ok: false, reason: base.reason };

  const shortlist = prefilter(candidates, j, caps);
  const results = await Promise.all(
    shortlist.map(async (c) => ({
      c,
      r: await getRoute(db, [ll(j.origin), ll(c.pickup), ll(c.dropoff), ll(j.destination)], budget),
    })),
  );

  const matches: Match[] = [];
  let couldntCheck = 0;
  for (const { c, r } of results) {
    if (!r.ok || r.route.segments.length !== 3) {
      couldntCheck += 1;
      continue;
    }
    const s = r.route.segments;
    const evaluation = evaluate(j, c, base.route.durationS, [s[0].durationS, s[1].durationS, s[2].durationS]);
    matches.push({ candidate: c, evaluation, source: sourceOf(r.route) });
  }
  return {
    ok: true,
    source: base.route.source,
    baselineMin: Math.round(base.route.durationS / 60),
    matches: orderMatches(matches).filter((m) => m.evaluation.feasible),
    couldntCheck,
    considered: shortlist.length,
  };
}

const sourceOf = (r: RouteEstimate): RouteSource => r.source;
