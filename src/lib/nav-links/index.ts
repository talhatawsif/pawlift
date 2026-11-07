import type { Point } from "../matching";

export type NavApp = "google" | "apple" | "waze";

/**
 * Deep links for previewing a trip in a navigation app. Points are the journey's own places and the
 * request's APPROXIMATE pickup and drop-off points (suburb level). Exact addresses are shared only
 * with the confirmed volunteer after claiming (Batch 4). Waze takes one destination, so it opens the first stop.
 */
export function navLink(app: NavApp, origin: Point, stops: Point[], destination: Point): string {
  const all = [origin, ...stops, destination];
  const c = (p: Point) => `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`;
  if (app === "google") {
    const via = stops.map(c).join("|");
    const q = new URLSearchParams({ api: "1", origin: c(origin), destination: c(destination), travelmode: "driving" });
    if (via) q.set("waypoints", via);
    return `https://www.google.com/maps/dir/?${q.toString()}`;
  }
  if (app === "apple") {
    const [from, ...rest] = all;
    const q = new URLSearchParams({ saddr: c(from), daddr: rest.map(c).join("+to:"), dirflg: "d" });
    return `https://maps.apple.com/?${q.toString().replace(/%2B/g, "+").replace(/%3A/g, ":")}`;
  }
  const first = stops[0] ?? destination;
  return `https://waze.com/ul?ll=${encodeURIComponent(c(first))}&navigate=yes`;
}

/** Turn-by-turn link to a single stop, for the confirmed volunteer's own device. Uses the exact point, else the address text. */
export function stopLink(app: NavApp, stop: { lat: number | null; lng: number | null; address: string | null }): string | null {
  const q = stop.lat != null && stop.lng != null ? `${stop.lat.toFixed(5)},${stop.lng.toFixed(5)}` : stop.address;
  if (!q) return null;
  if (app === "google") return `https://www.google.com/maps/dir/?${new URLSearchParams({ api: "1", destination: q, travelmode: "driving" })}`;
  if (app === "apple") return `https://maps.apple.com/?${new URLSearchParams({ daddr: q, dirflg: "d" })}`;
  return stop.lat != null && stop.lng != null
    ? `https://waze.com/ul?ll=${encodeURIComponent(q)}&navigate=yes`
    : `https://waze.com/ul?q=${encodeURIComponent(q)}&navigate=yes`;
}
