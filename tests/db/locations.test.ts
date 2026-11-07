/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, cleanup, createTestOrg, createTestUser, type TestUser } from "./helpers";

let coord: TestUser;
let otherCoord: TestUser;
let carer: TestUser;
let vol: TestUser;
let stranger: TestUser;
let orgId: string;
let otherOrgId: string;
let pendingOrgId: string;
let carerMemberId: string;
let volMemberId: string;
let suburbA: any;
let suburbB: any;

const rpc = (u: TestUser, fn: string, args?: Record<string, unknown>) =>
  (u.client.rpc as unknown as (f: string, a?: Record<string, unknown>) => Promise<{ data: any; error: { code: string; message: string } | null }>)(fn, args);

async function member(org: string, userId: string, extra: Record<string, unknown>) {
  const { data, error } = await admin.from("organisation_members")
    .insert({ org_id: org, user_id: userId, status: "active", ...extra }).select("id").single();
  if (error) throw new Error(error.message);
  return data.id as string;
}

const newLoc = (u: TestUser, org: string, over: Record<string, unknown> = {}) =>
  rpc(u, "create_location", {
    p_org_id: org, p_kind: "shelter", p_label_public: "Test Shelter", p_suburb_id: suburbA.id,
    p_exact_address: "12 Secret Street", p_contact_name: "Sam", p_contact_phone: "0400000000",
    p_instructions: "Ring the bell", ...over,
  });

beforeAll(async () => {
  [coord, otherCoord, carer, vol, stranger] = await Promise.all(
    ["lcoord", "lother", "lcarer", "lvol", "lstranger"].map((l) => createTestUser(l)),
  );
  [orgId, otherOrgId, pendingOrgId] = await Promise.all([
    createTestOrg("loc A"), createTestOrg("loc B"), createTestOrg("loc pending"),
  ]);
  await admin.from("organisations").update({ verification_status: "verified" }).in("id", [orgId, otherOrgId]);
  await member(orgId, coord.id, { is_coordinator: true });
  await member(pendingOrgId, coord.id, { is_coordinator: true });
  await member(otherOrgId, otherCoord.id, { is_coordinator: true });
  carerMemberId = await member(orgId, carer.id, { is_volunteer: true });
  volMemberId = await member(orgId, vol.id, { is_volunteer: true });
  const { data } = await coord.client.rpc("list_suburbs" as any, { p_query: "" } as any);
  suburbA = (data as any[]).find((s) => s.name === "St Albans");
  suburbB = (data as any[]).find((s) => s.name === "Geelong");
});

afterAll(async () => {
  await cleanup();
});

describe("suburbs", () => {
  it("lists seeded suburbs for signed-in users only", async () => {
    expect(suburbA && suburbB).toBeTruthy();
    const { data } = await rpc(stranger, "list_suburbs", { p_query: "wer" });
    expect((data as any[]).every((s) => s.name.toLowerCase().startsWith("wer"))).toBe(true);
  });
});

describe("create/update location", () => {
  let locId: string;

  it("coordinator of a verified org creates a location with the suburb centroid, no exact point", async () => {
    const { data, error } = await newLoc(coord, orgId);
    expect(error).toBeNull();
    locId = data;
    const { data: row } = await admin.from("locations").select("*, suburbs(centroid)").eq("id", locId).single();
    expect((row as any).approx_point).toEqual((row as any).suburbs.centroid);
    expect(row!.is_confirmed_destination).toBe(false);
    const { data: priv } = await admin.from("location_private").select("exact_point").eq("location_id", locId).single();
    expect(priv!.exact_point).toBeNull();
  });

  it("is audited", async () => {
    const { data } = await admin.from("audit_logs").select("action").eq("entity_id", locId).eq("action", "location.create");
    expect(data!.length).toBe(1);
  });

  it("refuses non-coordinators, other-org coordinators and strangers", async () => {
    for (const u of [vol, otherCoord, stranger]) {
      expect((await newLoc(u, orgId)).error?.code).toBe("42501");
    }
  });

  it("refuses unverified orgs, bad kinds and foster_home kind", async () => {
    expect((await newLoc(coord, pendingOrgId)).error?.code).toBe("55000");
    expect((await newLoc(coord, orgId, { p_kind: "foster_home" })).error?.code).toBe("22023");
    expect((await newLoc(coord, orgId, { p_kind: "nope" })).error?.code).toBe("22023");
    expect((await newLoc(coord, orgId, { p_label_public: "x" })).error?.code).toBe("22023");
  });

  it("private details are readable only by the owning coordinator", async () => {
    const { data } = await rpc(coord, "list_org_locations", { p_org_id: orgId });
    expect(data.find((l: any) => l.id === locId).exact_address).toBe("12 Secret Street");
    for (const u of [vol, otherCoord, stranger]) {
      expect((await rpc(u, "list_org_locations", { p_org_id: orgId })).error?.code).toBe("42501");
    }
  });

  it("direct table reads are denied", async () => {
    for (const t of ["locations", "location_private"] as const) {
      const { data, error } = await coord.client.from(t).select("*");
      expect(error ?? data?.length === 0).toBeTruthy();
    }
  });

  it("confirming works for the coordinator only; moving the address clears it", async () => {
    expect((await rpc(otherCoord, "confirm_destination", { p_location_id: locId, p_confirm: true })).error?.code).toBe("42501");
    expect((await rpc(coord, "confirm_destination", { p_location_id: locId, p_confirm: true })).error).toBeNull();
    let { data } = await rpc(coord, "list_org_locations", { p_org_id: orgId });
    expect(data.find((l: any) => l.id === locId).is_confirmed_destination).toBe(true);

    // Editing only the label keeps the confirmation.
    await rpc(coord, "update_location", {
      p_location_id: locId, p_label_public: "Renamed", p_suburb_id: suburbA.id,
      p_exact_address: "12 Secret Street", p_contact_name: "", p_contact_phone: "", p_instructions: "",
    });
    ({ data } = await rpc(coord, "list_org_locations", { p_org_id: orgId }));
    expect(data.find((l: any) => l.id === locId).is_confirmed_destination).toBe(true);

    // Changing the suburb clears it.
    expect((await rpc(coord, "update_location", {
      p_location_id: locId, p_label_public: "Renamed", p_suburb_id: suburbB.id,
      p_exact_address: "12 Secret Street", p_contact_name: "", p_contact_phone: "", p_instructions: "",
    })).error).toBeNull();
    ({ data } = await rpc(coord, "list_org_locations", { p_org_id: orgId }));
    const l = data.find((x: any) => x.id === locId);
    expect(l.is_confirmed_destination).toBe(false);
    expect(l.suburb).toBe("Geelong");
  });

  it("a handover point cannot be a destination; other orgs cannot edit", async () => {
    const { data: hp } = await newLoc(coord, orgId, { p_kind: "handover_point", p_label_public: "Servo car park" });
    expect((await rpc(coord, "confirm_destination", { p_location_id: hp, p_confirm: true })).error?.code).toBe("55000");
    const r = await rpc(otherCoord, "update_location", {
      p_location_id: hp, p_label_public: "Hijack", p_suburb_id: suburbA.id,
      p_exact_address: "1 Evil Road", p_contact_name: "", p_contact_phone: "", p_instructions: "",
    });
    expect(r.error?.code).toBe("42501");
  });

  it("copies is_demo from the org", async () => {
    const { data } = await admin.from("locations").select("is_demo").eq("id", locId).single();
    expect(data!.is_demo).toBe(true);
  });
});

describe("foster carers", () => {
  it("only an active member of the coordinator's org can be approved", async () => {
    expect((await rpc(vol, "set_foster_status", { p_member_id: carerMemberId, p_is_foster: true, p_can_confirm_receipt: false })).error?.code).toBe("42501");
    expect((await rpc(otherCoord, "set_foster_status", { p_member_id: carerMemberId, p_is_foster: true, p_can_confirm_receipt: false })).error?.code).toBe("42501");
  });

  it("a home needs foster approval first", async () => {
    const r = await rpc(coord, "upsert_foster_home", {
      p_member_id: carerMemberId, p_suburb_id: suburbA.id, p_exact_address: "5 Carer Court",
      p_contact_name: "", p_contact_phone: "", p_instructions: "",
    });
    expect(r.error?.code).toBe("55000");
  });

  it("approve, create home, confirm it", async () => {
    expect((await rpc(coord, "set_foster_status", { p_member_id: carerMemberId, p_is_foster: true, p_can_confirm_receipt: true })).error).toBeNull();
    const { data: homeId, error } = await rpc(coord, "upsert_foster_home", {
      p_member_id: carerMemberId, p_suburb_id: suburbA.id, p_exact_address: "5 Carer Court",
      p_contact_name: "Cara", p_contact_phone: "0411111111", p_instructions: "Side gate",
    });
    expect(error).toBeNull();
    expect((await rpc(coord, "confirm_destination", { p_location_id: homeId, p_confirm: true })).error).toBeNull();
    const { data: row } = await admin.from("locations").select("kind, linked_user_id, is_confirmed_destination").eq("id", homeId).single();
    expect(row).toMatchObject({ kind: "foster_home", linked_user_id: carer.id, is_confirmed_destination: true });
  });

  it("upsert is idempotent: one home per carer per org", async () => {
    await rpc(coord, "upsert_foster_home", {
      p_member_id: carerMemberId, p_suburb_id: suburbA.id, p_exact_address: "5 Carer Court",
      p_contact_name: "", p_contact_phone: "", p_instructions: "",
    });
    const { data } = await admin.from("locations").select("id").eq("org_id", orgId).eq("kind", "foster_home");
    expect(data!.length).toBe(1);
  });

  it("the carer sees only their own home; others see nothing", async () => {
    const mine = await rpc(carer, "get_my_foster_homes");
    expect(mine.data.length).toBe(1);
    expect(mine.data[0].exact_address).toBe("5 Carer Court");
    expect((await rpc(vol, "get_my_foster_homes")).data).toEqual([]);
    expect((await rpc(stranger, "get_my_foster_homes")).data).toEqual([]);
    expect((await rpc(otherCoord, "get_my_foster_homes")).data).toEqual([]);
    const { data: other } = await rpc(otherCoord, "list_org_locations", { p_org_id: otherOrgId });
    expect(other.some((l: any) => l.kind === "foster_home")).toBe(false);
    expect((await rpc(otherCoord, "list_org_locations", { p_org_id: orgId })).error?.code).toBe("42501");
  });

  it("changing the foster home address clears its confirmation", async () => {
    await rpc(coord, "upsert_foster_home", {
      p_member_id: carerMemberId, p_suburb_id: suburbA.id, p_exact_address: "9 New Place",
      p_contact_name: "", p_contact_phone: "", p_instructions: "",
    });
    const { data } = await admin.from("locations").select("is_confirmed_destination").eq("org_id", orgId).eq("kind", "foster_home").single();
    expect(data!.is_confirmed_destination).toBe(false);
  });

  it("revoking approval unconfirms the home and hides it from the carer", async () => {
    const { data: home } = await admin.from("locations").select("id").eq("org_id", orgId).eq("kind", "foster_home").single();
    await rpc(coord, "confirm_destination", { p_location_id: home!.id, p_confirm: true });
    expect((await rpc(coord, "set_foster_status", { p_member_id: carerMemberId, p_is_foster: false, p_can_confirm_receipt: false })).error).toBeNull();
    const { data } = await admin.from("locations").select("is_confirmed_destination").eq("id", home!.id).single();
    expect(data!.is_confirmed_destination).toBe(false);
    expect((await rpc(carer, "get_my_foster_homes")).data).toEqual([]);
    // Cannot be re-confirmed while not approved.
    expect((await rpc(coord, "confirm_destination", { p_location_id: home!.id, p_confirm: true })).error?.code).toBe("55000");
  });

  it("is audited", async () => {
    const { data } = await admin.from("audit_logs").select("action").eq("org_id", orgId).like("action", "foster%");
    const actions = data!.map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(["foster.approve", "foster.revoke", "foster_home.upsert"]));
  });

  it("a non-member volunteer record is untouched", async () => {
    const { data } = await admin.from("organisation_members").select("is_foster_carer").eq("id", volMemberId).single();
    expect(data!.is_foster_carer).toBe(false);
  });
});
