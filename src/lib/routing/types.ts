export type LngLat = [lng: number, lat: number];

export type RouteSource = "ors" | "demo";

export type RouteEstimate = {
  source: RouteSource;
  durationS: number;
  distanceM: number;
  /** Per-segment figures when the route has waypoints. */
  segments: { durationS: number; distanceM: number }[];
};

export type RouteFailure =
  | "not_configured" // no ORS key: only DEMO fixtures are available
  | "no_fixture" // DEMO mode and no fixture for this pair
  | "budget" // per-search call limit reached
  | "quota" // provider rate limit or quota
  | "error"; // network or provider failure

export type RouteResult = { ok: true; route: RouteEstimate } | { ok: false; reason: RouteFailure };

export const ROUTE_SOURCE_LABEL: Record<RouteSource, string> = {
  ors: "Estimate: openrouteservice (OpenStreetMap data), no live traffic",
  demo: "DEMO estimate",
};

export const ROUTE_FAILURE_MESSAGE: Record<RouteFailure, string> = {
  not_configured: "Live route estimates aren't set up yet, so only DEMO estimates are available.",
  no_fixture: "There is no DEMO estimate for this trip.",
  budget: "Couldn't calculate detours right now.",
  quota: "Couldn't calculate detours right now.",
  error: "Couldn't calculate detours right now.",
};

export type GeocodeResult =
  | { ok: true; lat: number; lng: number; label: string }
  | { ok: false; reason: "not_configured" | "not_found" | "quota" | "error" };

export const GEOCODE_FAILURE_MESSAGE: Record<Exclude<GeocodeResult, { ok: true }>["reason"], string> = {
  not_configured: "Address lookup isn't set up yet (no openrouteservice key).",
  not_found: "We couldn't find that address. Check the street, suburb and number.",
  quota: "Address lookup is busy. Try again later.",
  error: "Address lookup failed. Try again later.",
};
