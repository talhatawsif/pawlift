import { describe, expect, it } from "vitest";
import { distanceLabel, haversineKm, sortByProximity } from "@/lib/geo/distance";

const stAlbans = { lat: -37.744, lng: 144.8 };
const sunshine = { lat: -37.788, lng: 144.832 };
const geelong = { lat: -38.15, lng: 144.36 };

describe("distance", () => {
  it("computes plausible straight-line distances", () => {
    expect(haversineKm(stAlbans, stAlbans)).toBe(0);
    expect(haversineKm(stAlbans, sunshine)).toBeGreaterThan(4);
    expect(haversineKm(stAlbans, sunshine)).toBeLessThan(7);
    expect(haversineKm(stAlbans, geelong)).toBeGreaterThan(55);
  });
  it("sorts nearest first and puts missing points last", () => {
    const rows = [
      { id: "far", origin_lat: geelong.lat, origin_lng: geelong.lng },
      { id: "none", origin_lat: null, origin_lng: null },
      { id: "near", origin_lat: sunshine.lat, origin_lng: sunshine.lng },
    ];
    expect(sortByProximity(rows, stAlbans).map((r) => r.id)).toEqual(["near", "far", "none"]);
    expect(sortByProximity(rows, stAlbans)[2].distanceKm).toBeNull();
  });
  it("labels distance honestly", () => {
    expect(distanceLabel(0.4)).toBe("under 1 km away");
    expect(distanceLabel(5.6)).toBe("about 6 km away");
  });
});
