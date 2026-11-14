import { describe, expect, it } from "vitest";
import { safeNext } from "@/lib/session";

describe("safeNext", () => {
  it("keeps same-site paths and rejects anything that can leave the site", () => {
    expect(safeNext("/requests/1?a=b")).toBe("/requests/1?a=b");
    for (const bad of ["//evil.com", "/\\evil.com", "https://evil.com", "", null, undefined]) {
      expect(safeNext(bad)).toBe("/");
    }
  });
});
