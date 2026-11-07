/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it } from "vitest";
import { anonClient } from "./helpers";

const call = (q: string) =>
  (anonClient().rpc as unknown as (f: string, a: Record<string, unknown>) => Promise<{ data: any; error: any }>)(
    "list_public_suburbs",
    { p_query: q },
  );

describe("list_public_suburbs", () => {
  it("works for anon, prefix-matches name and postcode, caps results", async () => {
    const { data, error } = await call("st alb");
    expect(error).toBeNull();
    expect(data.some((s: any) => s.name === "St Albans")).toBe(true);
    const byPostcode = await call("3021");
    expect(byPostcode.data.some((s: any) => s.name === "St Albans")).toBe(true);
    expect((await call("")).data.length).toBeLessThanOrEqual(50);
  });
  it("returns only public keys", async () => {
    const { data } = await call("st alb");
    expect(Object.keys(data[0]).sort()).toEqual(["id", "lat", "lng", "name", "postcode"]);
    expect(typeof data[0].lat).toBe("number");
  });
  it("leaves the suburbs table itself denied", async () => {
    const { error } = await anonClient().from("suburbs").select("id").limit(1);
    expect(error).not.toBeNull();
  });
});
