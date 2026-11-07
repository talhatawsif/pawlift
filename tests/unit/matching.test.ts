import { describe, expect, it } from "vitest";
import {
  evaluate,
  fitsCapabilities,
  matchJourney,
  orderMatches,
  prefilter,
  type Candidate,
  type Journey,
} from "@/lib/matching";
import { RouteBudget } from "@/lib/routing";
import { navLink } from "@/lib/nav-links";

const T0 = new Date("2026-11-10T00:00:00Z");
const at = (min: number) => new Date(T0.getTime() + min * 60_000);

const stAlbans = { lat: -37.745, lng: 144.8 };
const geelong = { lat: -38.15, lng: 144.36 };
const melton = { lat: -37.683, lng: 144.58 };

const journey = (over: Partial<Journey> = {}): Journey => ({
  origin: stAlbans,
  destination: geelong,
  departAt: T0,
  maxDetourMin: 15,
  ...over,
});

const cand = (over: Partial<Candidate> = {}): Candidate => ({
  id: "c1",
  species: "cat",
  urgency: "routine",
  carrierRequirements: null,
  pickup: melton,
  dropoff: geelong,
  windowStart: at(0),
  windowEnd: at(240),
  deadline: null,
  ...over,
});

const MIN = 60;

describe("evaluate", () => {
  it("detour = via total minus baseline", () => {
    const e = evaluate(journey(), cand(), 62 * MIN, [16 * MIN, 52 * MIN, 2 * MIN]);
    expect(e.feasible && e.detourMin).toBe(8);
  });

  it("drop-off follows pickup plus handling time", () => {
    const e = evaluate(journey(), cand(), 62 * MIN, [16 * MIN, 52 * MIN, 2 * MIN]);
    if (!e.feasible) throw new Error("expected feasible");
    expect(e.arrivePickup.getTime()).toBe(at(16).getTime());
    expect(e.arriveDropoff.getTime()).toBe(at(16 + 5 + 52).getTime());
    expect(e.arriveDropoff.getTime()).toBeGreaterThan(e.pickupAt.getTime());
    expect(e.handlingMin).toBe(10);
  });

  it("rejects when detour exceeds the maximum, accepts at exactly the maximum", () => {
    const over = evaluate(journey({ maxDetourMin: 7 }), cand(), 62 * MIN, [16 * MIN, 52 * MIN, 2 * MIN]);
    expect(over).toMatchObject({ feasible: false, reason: "detour_too_large" });
    const at8 = evaluate(journey({ maxDetourMin: 8 }), cand(), 62 * MIN, [16 * MIN, 52 * MIN, 2 * MIN]);
    expect(at8.feasible).toBe(true);
  });

  it("never reports a negative detour", () => {
    const e = evaluate(journey(), cand(), 100 * MIN, [10 * MIN, 10 * MIN, 10 * MIN]);
    expect(e.feasible && e.detourMin).toBe(0);
  });

  it("rejects arrival after the pickup window closes", () => {
    const e = evaluate(journey(), cand({ windowEnd: at(10) }), 62 * MIN, [16 * MIN, 52 * MIN, 2 * MIN]);
    expect(e).toMatchObject({ feasible: false, reason: "window_missed" });
  });

  it("allows waiting up to 20 minutes and no more", () => {
    const segs: [number, number, number] = [16 * MIN, 52 * MIN, 2 * MIN];
    const ok = evaluate(journey(), cand({ windowStart: at(36) }), 62 * MIN, segs); // wait 20
    expect(ok.feasible && ok.waitMin).toBe(20);
    const tooLong = evaluate(journey(), cand({ windowStart: at(37) }), 62 * MIN, segs); // wait 21
    expect(tooLong).toMatchObject({ feasible: false, reason: "wait_too_long" });
  });

  it("waiting pushes the drop-off later", () => {
    const e = evaluate(journey(), cand({ windowStart: at(26) }), 62 * MIN, [16 * MIN, 52 * MIN, 2 * MIN]);
    if (!e.feasible) throw new Error("expected feasible");
    expect(e.pickupAt.getTime()).toBe(at(26).getTime());
    expect(e.arriveDropoff.getTime()).toBe(at(26 + 5 + 52).getTime());
  });

  it("enforces the deadline at the drop-off", () => {
    const segs: [number, number, number] = [16 * MIN, 52 * MIN, 2 * MIN]; // drop-off at 73 min
    expect(evaluate(journey(), cand({ deadline: at(73) }), 62 * MIN, segs).feasible).toBe(true);
    expect(evaluate(journey(), cand({ deadline: at(72) }), 62 * MIN, segs)).toMatchObject({
      feasible: false,
      reason: "deadline_missed",
    });
  });
});

describe("capabilities", () => {
  it("filters by species and carrier", () => {
    const caps = { speciesOk: ["cat"], hasCarrier: false };
    expect(fitsCapabilities(cand(), caps)).toBe(true);
    expect(fitsCapabilities(cand({ species: "dog" }), caps)).toBe(false);
    expect(fitsCapabilities(cand({ carrierRequirements: "Hard-sided carrier" }), caps)).toBe(false);
    expect(fitsCapabilities(cand({ carrierRequirements: "Hard-sided carrier" }), { ...caps, hasCarrier: true })).toBe(true);
  });
  it("applies no filter when capabilities are unknown", () => {
    expect(fitsCapabilities(cand({ species: "dog" }), null)).toBe(true);
  });
});

describe("prefilter", () => {
  it("drops incompatible, far-off and expired candidates", () => {
    const far = cand({ id: "far", pickup: { lat: -36.5, lng: 146.9 }, dropoff: { lat: -36.6, lng: 146.95 } });
    const dog = cand({ id: "dog", species: "dog" });
    const closed = cand({ id: "closed", windowEnd: new Date(T0.getTime() - 60_000) });
    const ok = cand({ id: "ok" });
    const out = prefilter([far, dog, closed, ok], journey(), { speciesOk: ["cat"], hasCarrier: true });
    expect(out.map((c) => c.id)).toEqual(["ok"]);
  });

  it("keeps the best five by straight-line detour", () => {
    const many = Array.from({ length: 8 }, (_, i) =>
      cand({ id: `c${i}`, pickup: { lat: melton.lat + i * 0.01, lng: melton.lng } }),
    );
    expect(prefilter(many, journey({ maxDetourMin: 60 }), null)).toHaveLength(5);
  });
});

describe("orderMatches", () => {
  it("orders by urgency, then detour", () => {
    const feasible = (d: number) => ({ feasible: true as const, detourMin: d, waitMin: 0, handlingMin: 10, arrivePickup: T0, pickupAt: T0, arriveDropoff: T0 });
    const items = [
      { candidate: cand({ id: "routine-1" }), evaluation: feasible(1) },
      { candidate: cand({ id: "urgent-9", urgency: "urgent" }), evaluation: feasible(9) },
      { candidate: cand({ id: "routine-0" }), evaluation: feasible(0) },
    ];
    expect(orderMatches(items).map((i) => i.candidate.id)).toEqual(["urgent-9", "routine-0", "routine-1"]);
  });
});

describe("matchJourney (DEMO fixtures, no key)", () => {
  const db = { rpc: async () => ({ data: null, error: null }) } as never;

  it("St Albans → Geelong matches a Melton → Geelong request, labelled DEMO", async () => {
    const out = await matchJourney(db, journey(), [cand()], null, new RouteBudget());
    if (!out.ok) throw new Error(out.reason);
    expect(out.source).toBe("demo");
    expect(out.matches).toHaveLength(1);
    expect(out.matches[0].source).toBe("demo");
    expect(out.matches[0].evaluation).toMatchObject({ feasible: true, detourMin: 8 });
  });

  it("reports a failure rather than guessing when the baseline has no fixture", async () => {
    const out = await matchJourney(db, journey({ origin: { lat: -37.0, lng: 143.0 } }), [cand()], null, new RouteBudget());
    expect(out).toEqual({ ok: false, reason: "no_fixture" });
  });

  it("counts candidates that couldn't be checked", async () => {
    const odd = cand({ id: "odd", pickup: { lat: -37.7, lng: 144.7 } });
    const out = await matchJourney(db, journey({ maxDetourMin: 60 }), [odd], null, new RouteBudget());
    if (!out.ok) throw new Error(out.reason);
    expect(out.matches).toHaveLength(0);
    expect(out.couldntCheck).toBe(1);
  });
});

describe("navLink", () => {
  it("builds Google, Apple and Waze links", () => {
    expect(navLink("google", stAlbans, [melton], geelong)).toContain("waypoints=");
    expect(navLink("apple", stAlbans, [melton], geelong)).toContain("daddr=");
    expect(navLink("waze", stAlbans, [melton], geelong)).toContain("navigate=yes");
  });
});
