import { createHash } from "node:crypto";
import type { GeocodeResult, LngLat, RouteEstimate, RouteFailure } from "./types";

const DEFAULT_BASE = "https://api.openrouteservice.org";
const TIMEOUT_MS = 8000;

export type OrsConfig = { key: string; base: string };

/** Server-side only. Returns null when no key is set (everything then runs as DEMO). */
export function orsConfig(env: Record<string, string | undefined> = process.env): OrsConfig | null {
  const key = env.ORS_API_KEY?.trim();
  if (!key) return null;
  return { key, base: (env.ORS_BASE_URL?.trim() || DEFAULT_BASE).replace(/\/+$/, "") };
}

/** Rounds to 3 decimals (about 100 m) so near-identical trips share a cache entry. */
export function routeCacheKey(points: LngLat[], profile = "driving-car"): string {
  const r = points.map(([lng, lat]) => `${lat.toFixed(3)},${lng.toFixed(3)}`).join("|");
  return createHash("sha256").update(`${profile}|${r}`).digest("hex");
}

type Num = number | undefined;
type OrsDirections = {
  routes?: { summary?: { distance?: Num; duration?: Num }; segments?: { distance?: Num; duration?: Num }[] }[];
};

export function parseOrsDirections(body: unknown): RouteEstimate | null {
  const route = (body as OrsDirections | null)?.routes?.[0];
  const d = route?.summary?.duration;
  const m = route?.summary?.distance;
  if (typeof d !== "number" || typeof m !== "number" || !Number.isFinite(d) || !Number.isFinite(m)) return null;
  const segments = (route?.segments ?? []).map((s) => ({
    durationS: Math.round(s.duration ?? 0),
    distanceM: Math.round(s.distance ?? 0),
  }));
  return { source: "ors", durationS: Math.round(d), distanceM: Math.round(m), segments };
}

export async function orsDirections(
  cfg: OrsConfig,
  points: LngLat[],
  fetchFn: typeof fetch = fetch,
): Promise<{ ok: true; route: RouteEstimate } | { ok: false; reason: RouteFailure }> {
  try {
    const res = await fetchFn(`${cfg.base}/v2/directions/driving-car`, {
      method: "POST",
      headers: { Authorization: cfg.key, "Content-Type": "application/json" },
      body: JSON.stringify({ coordinates: points }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
    if (res.status === 429 || res.status === 403) return { ok: false, reason: "quota" };
    if (!res.ok) return { ok: false, reason: "error" };
    const route = parseOrsDirections(await res.json());
    return route ? { ok: true, route } : { ok: false, reason: "error" };
  } catch {
    return { ok: false, reason: "error" };
  }
}

type OrsGeocode = {
  features?: { geometry?: { coordinates?: number[] }; properties?: { label?: string } }[];
};

export function parseOrsGeocode(body: unknown): GeocodeResult {
  const f = (body as OrsGeocode | null)?.features?.[0];
  const c = f?.geometry?.coordinates;
  if (!c || c.length < 2 || !Number.isFinite(c[0]) || !Number.isFinite(c[1])) return { ok: false, reason: "not_found" };
  return { ok: true, lng: c[0], lat: c[1], label: f?.properties?.label ?? "" };
}

/** Geocodes a free-text address, restricted to Australia and biased to Western Melbourne. */
export async function orsGeocode(
  cfg: OrsConfig,
  text: string,
  fetchFn: typeof fetch = fetch,
): Promise<GeocodeResult> {
  const q = new URLSearchParams({
    text,
    "boundary.country": "AU",
    "focus.point.lon": "144.82",
    "focus.point.lat": "-37.8",
    size: "1",
  });
  try {
    const res = await fetchFn(`${cfg.base}/geocode/search?${q}`, {
      headers: { Authorization: cfg.key },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
    if (res.status === 429 || res.status === 403) return { ok: false, reason: "quota" };
    if (!res.ok) return { ok: false, reason: "error" };
    return parseOrsGeocode(await res.json());
  } catch {
    return { ok: false, reason: "error" };
  }
}
