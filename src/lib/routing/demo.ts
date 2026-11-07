import type { LngLat, RouteEstimate } from "./types";
import { haversineKm } from "../geo/distance";

/**
 * DEMO route fixtures. Hand-typed, NOT measured and NOT from any routing service.
 * Minutes are rough driving guesses for demo stories only; every result is labelled DEMO.
 * Points are approximate suburb centres.
 */
const PLACES: Record<string, LngLat> = {
  "St Albans": [144.8, -37.745],
  Melton: [144.58, -37.683],
  Geelong: [144.36, -38.15],
  Sunshine: [144.832, -37.788],
  Footscray: [144.9, -37.8],
  Werribee: [144.66, -37.9],
};

// [from, to, minutes, km] — symmetric.
const PAIRS: [string, string, number, number][] = [
  ["St Albans", "Geelong", 62, 78],
  ["St Albans", "Melton", 16, 22],
  ["St Albans", "Sunshine", 9, 5],
  ["St Albans", "Footscray", 17, 12],
  ["St Albans", "Werribee", 28, 33],
  ["Melton", "Geelong", 52, 74],
  ["Melton", "Sunshine", 28, 31],
  ["Melton", "Footscray", 35, 38],
  ["Melton", "Werribee", 26, 30],
  ["Sunshine", "Footscray", 11, 7],
  ["Sunshine", "Geelong", 55, 70],
  ["Sunshine", "Werribee", 24, 26],
  ["Footscray", "Geelong", 58, 76],
  ["Footscray", "Werribee", 25, 28],
  ["Werribee", "Geelong", 36, 47],
];

const MATCH_RADIUS_KM = 4;

function nearestPlace(p: LngLat): string | null {
  let best: string | null = null;
  let bestKm = MATCH_RADIUS_KM;
  for (const [name, c] of Object.entries(PLACES)) {
    const km = haversineKm({ lat: p[1], lng: p[0] }, { lat: c[1], lng: c[0] });
    if (km <= bestKm) {
      best = name;
      bestKm = km;
    }
  }
  return best;
}

function pairFixture(a: string, b: string): { durationS: number; distanceM: number } | null {
  if (a === b) return { durationS: 120, distanceM: 800 };
  const hit = PAIRS.find(([x, y]) => (x === a && y === b) || (x === b && y === a));
  return hit ? { durationS: hit[2] * 60, distanceM: hit[3] * 1000 } : null;
}

/** Returns a DEMO estimate, or null if any consecutive pair has no fixture. Never uses straight-line figures. */
export function demoRoute(points: LngLat[]): RouteEstimate | null {
  if (points.length < 2) return null;
  const names = points.map(nearestPlace);
  const segments: RouteEstimate["segments"] = [];
  for (let i = 0; i < names.length - 1; i++) {
    const a = names[i];
    const b = names[i + 1];
    if (!a || !b) return null;
    const f = pairFixture(a, b);
    if (!f) return null;
    segments.push(f);
  }
  return {
    source: "demo",
    durationS: segments.reduce((s, x) => s + x.durationS, 0),
    distanceM: segments.reduce((s, x) => s + x.distanceM, 0),
    segments,
  };
}
