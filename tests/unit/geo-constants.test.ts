import { describe, expect, it } from "vitest";
import {
  WESTERN_MELBOURNE_BOUNDS,
  WESTERN_MELBOURNE_CENTRE,
} from "@/lib/geo/constants";

describe("Western Melbourne defaults", () => {
  it("centres inside its bounds", () => {
    const [lng, lat] = WESTERN_MELBOURNE_CENTRE;
    const [w, s, e, n] = WESTERN_MELBOURNE_BOUNDS;
    expect(lng).toBeGreaterThan(w);
    expect(lng).toBeLessThan(e);
    expect(lat).toBeGreaterThan(s);
    expect(lat).toBeLessThan(n);
  });
});
