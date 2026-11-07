/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, anonClient, cleanup, createTestOrg, createTestUser, type TestUser } from "./helpers";

let coord: TestUser;
let other: TestUser;
let orgId: string;
let locId: string;
const KEY = `dbtest-${Date.now()}-routecache`;

const rpc = (c: { rpc: any }, fn: string, args?: Record<string, unknown>) =>
  c.rpc(fn, args) as Promise<{ data: any; error: { code: string; message: string } | null }>;

beforeAll(async () => {
  [coord, other] = await Promise.all([createTestUser("rcoord"), createTestUser("rother")]);
  orgId = await createTestOrg("routing");
  await admin.from("organisations").update({ verification_status: "verified" }).eq("id", orgId);
  await admin.from("organisation_members").insert({ org_id: orgId, user_id: coord.id, status: "active", is_coordinator: true });
  const { data: sub } = await admin.from("suburbs").select("id").limit(1).single();
  const { data, error } = await rpc(coord.client, "create_location", {
    p_org_id: orgId, p_kind: "shelter", p_label_public: "Geo Shelter", p_suburb_id: sub!.id,
    p_exact_address: "1 Test Street", p_contact_name: "", p_contact_phone: "", p_instructions: "",
  });
  if (error) throw new Error(error.message);
  locId = data;
});

afterAll(async () => {
  await admin.from("route_cache").delete().eq("cache_key", KEY);
  await cleanup();
});

describe("route cache RPCs", () => {
  it("are closed to anon and the table to everyone", async () => {
    expect((await rpc(anonClient(), "get_cached_route", { p_key: KEY })).error).not.toBeNull();
    expect((await rpc(anonClient(), "put_cached_route", { p_key: KEY, p_provider: "ors", p_duration_s: 1, p_distance_m: 1, p_legs: null })).error).not.toBeNull();
    expect((await coord.client.from("route_cache" as never).select("*")).error).not.toBeNull();
  });
  it("stores ors results, returns them, and ignores entries older than 24 h", async () => {
    const put = await rpc(coord.client, "put_cached_route", { p_key: KEY, p_provider: "ors", p_duration_s: 600, p_distance_m: 9000, p_legs: [{ durationS: 600, distanceM: 9000 }] });
    expect(put.error).toBeNull();
    const got = await rpc(other.client, "get_cached_route", { p_key: KEY });
    expect(got.data).toMatchObject({ provider: "ors", duration_s: 600, distance_m: 9000 });
    await admin.from("route_cache").update({ created_at: new Date(Date.now() - 25 * 3600_000).toISOString() }).eq("cache_key", KEY);
    expect((await rpc(other.client, "get_cached_route", { p_key: KEY })).data).toBeNull();
  });
  it("refuses demo results and out-of-range values", async () => {
    const base = { p_key: KEY + "x", p_duration_s: 10, p_distance_m: 10, p_legs: null };
    expect((await rpc(coord.client, "put_cached_route", { ...base, p_provider: "demo" })).error?.code).toBe("22023");
    expect((await rpc(coord.client, "put_cached_route", { ...base, p_provider: "ors", p_duration_s: -1 })).error?.code).toBe("22023");
    expect((await rpc(coord.client, "put_cached_route", { ...base, p_provider: "ors", p_key: "short" })).error?.code).toBe("22023");
  });
});

describe("set_location_exact_point", () => {
  it("lets the coordinator store a point, audits it, and clears it when the address changes", async () => {
    const ok = await rpc(coord.client, "set_location_exact_point", { p_location_id: locId, p_lat: -37.8, p_lng: 144.9 });
    expect(ok.error).toBeNull();
    const { data: audit } = await admin.from("audit_logs").select("id").eq("entity_id", locId).eq("action", "location.geocode");
    expect(audit?.length).toBe(1);
    const has = async () => (await admin.from("location_private").select("exact_point").eq("location_id", locId).single()).data?.exact_point;
    expect(await has()).not.toBeNull();
    await admin.from("location_private").update({ contact_name: "Only contact changed" }).eq("location_id", locId);
    expect(await has()).not.toBeNull();
    await admin.from("location_private").update({ exact_address: "2 Moved Street" }).eq("location_id", locId);
    expect(await has()).toBeNull();
  });
  it("refuses non-coordinators and points outside Victoria", async () => {
    expect((await rpc(other.client, "set_location_exact_point", { p_location_id: locId, p_lat: -37.8, p_lng: 144.9 })).error?.code).toBe("42501");
    expect((await rpc(coord.client, "set_location_exact_point", { p_location_id: locId, p_lat: 51.5, p_lng: -0.1 })).error?.code).toBe("22023");
  });
});
