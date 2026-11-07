import { describe, expect, it } from "vitest";
import { isoToMelbourneLocal, melbourneLocalToIso } from "@/lib/time/melbourne";

describe("Melbourne time conversion", () => {
  it("converts summer (AEDT, +11) and winter (AEST, +10) local times to UTC", () => {
    expect(melbourneLocalToIso("2026-01-15T09:00")).toBe("2026-01-14T22:00:00.000Z");
    expect(melbourneLocalToIso("2026-07-15T09:00")).toBe("2026-07-14T23:00:00.000Z");
  });
  it("round-trips and rejects bad input", () => {
    const iso = melbourneLocalToIso("2026-11-08T17:30")!;
    expect(isoToMelbourneLocal(iso)).toBe("2026-11-08T17:30");
    expect(melbourneLocalToIso("tomorrow")).toBeNull();
    expect(melbourneLocalToIso("")).toBeNull();
  });
});
