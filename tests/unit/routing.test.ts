import { describe, expect, it } from "vitest";
import { demoRoute } from "../../src/lib/routing/demo";
import {
  orsConfig, orsDirections, orsGeocode, parseOrsDirections, parseOrsGeocode, routeCacheKey,
} from "../../src/lib/routing/ors";
import { getRoute, RouteBudget } from "../../src/lib/routing";

const ST_ALBANS: [number, number] = [144.8, -37.745];
const GEELONG: [number, number] = [144.36, -38.15];
const fakeDb = (cached: unknown = null) => ({
  calls: [] as string[],
  rpc(fn: string) {
    this.calls.push(fn);
    return Promise.resolve({ data: fn === "get_cached_route" ? cached : null, error: null });
  },
});
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

describe("config", () => {
  it("is null without a key", () => {
    expect(orsConfig({})).toBeNull();
    expect(orsConfig({ ORS_API_KEY: "  " })).toBeNull();
  });
  it("uses the default base and trims slashes", () => {
    expect(orsConfig({ ORS_API_KEY: "k" })?.base).toBe("https://api.openrouteservice.org");
    expect(orsConfig({ ORS_API_KEY: "k", ORS_BASE_URL: "http://x/" })?.base).toBe("http://x");
  });
});

describe("cache key", () => {
  it("is stable within ~100 m and differs beyond", () => {
    const a = routeCacheKey([ST_ALBANS, GEELONG]);
    expect(routeCacheKey([[144.80004, -37.74502], GEELONG])).toBe(a);
    expect(routeCacheKey([[144.81, -37.745], GEELONG])).not.toBe(a);
  });
});

describe("demo fixtures", () => {
  it("labels St Albans to Geelong as demo", () => {
    const r = demoRoute([ST_ALBANS, GEELONG]);
    expect(r?.source).toBe("demo");
    expect(r?.durationS).toBeGreaterThan(0);
  });
  it("sums segments through waypoints", () => {
    const r = demoRoute([ST_ALBANS, [144.832, -37.788], GEELONG]);
    expect(r?.segments).toHaveLength(2);
    expect(r?.durationS).toBe(r!.segments[0].durationS + r!.segments[1].durationS);
  });
  it("returns null for places with no fixture rather than guessing", () => {
    expect(demoRoute([ST_ALBANS, [151.2, -33.87]])).toBeNull();
  });
});

describe("getRoute", () => {
  it("without a key uses DEMO only and never calls the db or network", async () => {
    const saved = process.env.ORS_API_KEY;
    delete process.env.ORS_API_KEY;
    const db = fakeDb();
    const ok = await getRoute(db as never, [ST_ALBANS, GEELONG], new RouteBudget());
    expect(ok.ok && ok.route.source).toBe("demo");
    const no = await getRoute(db as never, [ST_ALBANS, [151.2, -33.87]], new RouteBudget());
    expect(no).toEqual({ ok: false, reason: "no_fixture" });
    expect(db.calls).toEqual([]);
    if (saved !== undefined) process.env.ORS_API_KEY = saved;
  });
  it("with a key serves a cache hit as ors without the budget", async () => {
    process.env.ORS_API_KEY = "test-key";
    const db = fakeDb({ duration_s: 100, distance_m: 2000, legs: null });
    const budget = new RouteBudget(0);
    const r = await getRoute(db as never, [ST_ALBANS, GEELONG], budget);
    delete process.env.ORS_API_KEY;
    expect(r.ok && r.route.source).toBe("ors");
    expect(budget.callsUsed).toBe(0);
  });
  it("with a key and an exhausted budget reports budget, not a made-up time", async () => {
    process.env.ORS_API_KEY = "test-key";
    const r = await getRoute(fakeDb() as never, [ST_ALBANS, GEELONG], new RouteBudget(0));
    delete process.env.ORS_API_KEY;
    expect(r).toEqual({ ok: false, reason: "budget" });
  });
});

describe("ors parsing and errors", () => {
  const cfg = { key: "k", base: "http://ors.test" };
  it("parses directions", () => {
    const r = parseOrsDirections({ routes: [{ summary: { duration: 600.4, distance: 9000 }, segments: [{ duration: 600.4, distance: 9000 }] }] });
    expect(r).toEqual({ source: "ors", durationS: 600, distanceM: 9000, segments: [{ durationS: 600, distanceM: 9000 }] });
    expect(parseOrsDirections({})).toBeNull();
  });
  it("maps 429 to quota and 500 / network to error", async () => {
    expect(await orsDirections(cfg, [ST_ALBANS, GEELONG], async () => json({}, 429))).toEqual({ ok: false, reason: "quota" });
    expect(await orsDirections(cfg, [ST_ALBANS, GEELONG], async () => json({}, 500))).toEqual({ ok: false, reason: "error" });
    expect(await orsDirections(cfg, [ST_ALBANS, GEELONG], async () => { throw new Error("net"); })).toEqual({ ok: false, reason: "error" });
  });
  it("parses geocode results and not-found", async () => {
    expect(parseOrsGeocode({ features: [{ geometry: { coordinates: [144.8, -37.7] }, properties: { label: "x" } }] }))
      .toEqual({ ok: true, lng: 144.8, lat: -37.7, label: "x" });
    expect(await orsGeocode(cfg, "nowhere", async () => json({ features: [] }))).toEqual({ ok: false, reason: "not_found" });
  });
});
