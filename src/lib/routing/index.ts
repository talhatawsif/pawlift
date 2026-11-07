import type { SupabaseClient } from "@supabase/supabase-js";
import { demoRoute } from "./demo";
import { orsConfig, orsDirections, orsGeocode, routeCacheKey } from "./ors";
import type { GeocodeResult, LngLat, RouteResult } from "./types";

export * from "./types";

/** Hard cap on provider calls per search (PLAN §9.7). Cache hits and DEMO fixtures don't count. */
export const MAX_ROUTING_CALLS_PER_SEARCH = 6;

export class RouteBudget {
  private used = 0;
  constructor(private readonly max = MAX_ROUTING_CALLS_PER_SEARCH) {}
  take(): boolean {
    if (this.used >= this.max) return false;
    this.used += 1;
    return true;
  }
  get callsUsed() {
    return this.used;
  }
}

/** "live" only when a key is configured; otherwise everything is DEMO and nothing claims to be live. */
export function routingMode(): "live" | "demo" {
  return orsConfig() ? "live" : "demo";
}

type Db = Pick<SupabaseClient, "rpc">;

/**
 * Route through the given points. Without an ORS key: DEMO fixtures only (never straight-line times).
 * With a key: 24 h cache (via RPC, signed-in user), then one provider call; failures are returned, not faked.
 */
export async function getRoute(db: Db, points: LngLat[], budget: RouteBudget): Promise<RouteResult> {
  const cfg = orsConfig();
  if (!cfg) {
    const route = demoRoute(points);
    return route ? { ok: true, route } : { ok: false, reason: "no_fixture" };
  }
  const key = routeCacheKey(points);
  const cached = await db.rpc("get_cached_route", { p_key: key });
  const c = cached.data as { duration_s: number; distance_m: number; legs: { durationS: number; distanceM: number }[] | null } | null;
  if (!cached.error && c) {
    return {
      ok: true,
      route: { source: "ors", durationS: c.duration_s, distanceM: c.distance_m, segments: c.legs ?? [] },
    };
  }
  if (!budget.take()) return { ok: false, reason: "budget" };
  const res = await orsDirections(cfg, points);
  if (res.ok) {
    await db.rpc("put_cached_route", {
      p_key: key,
      p_provider: "ors",
      p_duration_s: res.route.durationS,
      p_distance_m: res.route.distanceM,
      p_legs: res.route.segments,
    });
  }
  return res;
}

/** Address geocoding for coordinators. No key → honest "not set up"; no DEMO substitute. */
export async function geocodeAddress(text: string): Promise<GeocodeResult> {
  const cfg = orsConfig();
  if (!cfg) return { ok: false, reason: "not_configured" };
  return orsGeocode(cfg, text);
}
