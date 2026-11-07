import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = path.join(dir, n);
    return statSync(p).isDirectory() ? files(p) : [p];
  });
}

describe("service-role key", () => {
  it("is never referenced from src/", () => {
    const offenders = files(path.resolve(__dirname, "../../src")).filter((f) =>
      /SUPABASE_SERVICE_ROLE_KEY|service_role/i.test(readFileSync(f, "utf8")),
    );
    expect(offenders).toEqual([]);
  });
});
