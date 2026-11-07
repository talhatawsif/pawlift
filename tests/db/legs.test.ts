/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, anonClient, cleanup, createTestOrg, createTestUser, type TestUser } from "./helpers";

let coord: TestUser;
let otherCoord: TestUser;
let vol: TestUser;
let orgId: string;
let otherOrgId: string;
let origin: string;
let dest: string;
let hand1: string;
let hand2: string;
let shelterNotHandover: string;
let otherHand: string;
let suburb: any;

type R = { data: any; error: { code: string; message: string } | null };
const rpc = (u: TestUser, fn: string, a?: Record<string, unknown>) =>
  (u.client.rpc as unknown as (f: string, a?: Record<string, unknown>) => Promise<R>)(fn, a);

const hours = (h: number) => new Date(Date.now() + h * 3600_000).toISOString();

async function member(org: string, userId: string, extra: Record<string, unknown>) {
  const { error } = await admin.from("organisation_members")
    .insert({ org_id: org, user_id: userId, status: "active", ...extra });
  if (error) throw new Error(error.message);
}

async function loc(org: string, label: string, confirmed: boolean, kind: string) {
  const { data: l, error } = await admin.from("locations").insert({
    org_id: org, kind, label_public: label, suburb_id: suburb.id,
    approx_point: "SRID=4326;POINT(144.8 -37.7)", is_confirmed_destination: confirmed, is_demo: true,
  } as any).select("id").single();
  if (error) throw new Error(error.message);
  return l.id as string;
}

const newReq = async (over: Record<string, unknown> = {}) => {
  const { data, error } = await rpc(coord, "create_request", {
    p_org_id: orgId, p_animal_name: "Relay", p_species: "dog", p_urgency: "soon",
    p_required_date: null, p_deadline: hours(30), p_handling: "Calm", p_carrier: "Crate",
    p_medical_notes: null, p_coordinator_instructions: null, p_origin_location_id: origin,
    p_destination_location_id: dest, p_window_start: hours(2), p_window_end: hours(10), ...over,
  });
  if (error) throw new Error(error.message);
  return data as string;
};

const version = async (id: string) =>
  ((await admin.from("transport_requests").select("version").eq("id", id).single()).data as any).version as number;

const legs = async (id: string) =>
  ((await admin.from("transport_legs").select("*").eq("request_id", id).order("seq")).data ?? []) as any[];

const split = async (id: string, seq: number, hand: string, firstEnd = hours(6), secondStart = hours(5)) =>
  rpc(coord, "split_leg", {
    p_request_id: id, p_expected_version: await version(id), p_seq: seq,
    p_handover_location_id: hand, p_first_end: firstEnd, p_second_start: secondStart,
  });

beforeAll(async () => {
  [coord, otherCoord, vol] = await Promise.all(["lcoord", "lother", "lvol"].map((l) => createTestUser(l)));
  [orgId, otherOrgId] = await Promise.all([createTestOrg("legs A"), createTestOrg("legs B")]);
  await admin.from("organisations").update({ verification_status: "verified" }).in("id", [orgId, otherOrgId]);
  await member(orgId, coord.id, { is_coordinator: true });
  await member(otherOrgId, otherCoord.id, { is_coordinator: true });
  await member(orgId, vol.id, { is_volunteer: true });
  const { data } = await coord.client.rpc("list_suburbs" as any, { p_query: "" } as any);
  suburb = (data as any[]).find((s) => s.name === "St Albans");
  origin = await loc(orgId, "Pound A", false, "pound");
  dest = await loc(orgId, "Vet A", true, "vet");
  hand1 = await loc(orgId, "Servo 1", false, "handover_point");
  hand2 = await loc(orgId, "Servo 2", false, "handover_point");
  shelterNotHandover = await loc(orgId, "Shelter", false, "shelter");
  otherHand = await loc(otherOrgId, "Other servo", false, "handover_point");
}, 60_000);

afterAll(cleanup, 60_000);

describe("split and merge", () => {
  it("splits a draft leg and merges it back", async () => {
    const id = await newReq();
    const { error } = await split(id, 1, hand1);
    expect(error).toBeNull();
    let l = await legs(id);
    expect(l.map((x) => x.seq)).toEqual([1, 2]);
    expect(l[0].from_location_id).toBe(origin);
    expect(l[0].to_location_id).toBe(hand1);
    expect(l[1].from_location_id).toBe(hand1);
    expect(l[1].to_location_id).toBe(dest);

    const m = await rpc(coord, "merge_legs", { p_request_id: id, p_expected_version: await version(id), p_seq: 1 });
    expect(m.error).toBeNull();
    l = await legs(id);
    expect(l).toHaveLength(1);
    expect(l[0].from_location_id).toBe(origin);
    expect(l[0].to_location_id).toBe(dest);
  });

  it("renumbers later legs when splitting the first of two", async () => {
    const id = await newReq();
    expect((await split(id, 1, hand1, hours(5), hours(4))).error).toBeNull();
    expect((await split(id, 2, hand2, hours(8), hours(7))).error).toBeNull();
    const l = await legs(id);
    expect(l.map((x) => x.seq)).toEqual([1, 2, 3]);
    expect(l.map((x) => x.to_location_id)).toEqual([hand1, hand2, dest]);
  });

  it("lists legs for the coordinator with public labels only", async () => {
    const id = await newReq();
    await split(id, 1, hand1);
    const { data, error } = await rpc(coord, "list_request_legs", { p_request_id: id });
    expect(error).toBeNull();
    expect(data).toHaveLength(2);
    expect(JSON.stringify(data)).not.toMatch(/exact/);
    const denied = await rpc(otherCoord, "list_request_legs", { p_request_id: id });
    expect(denied.error?.code).toBe("42501");
  });

  it("rejects a non-handover place, another org's place and an end-point repeat", async () => {
    const id = await newReq();
    expect((await split(id, 1, shelterNotHandover)).error?.code).toBe("22023");
    expect((await split(id, 1, otherHand)).error?.code).toBe("22023");
    expect((await split(id, 1, origin)).error?.code).toBe("22023");
    expect(await legs(id)).toHaveLength(1);
  });

  it("rejects times outside the leg window or in the wrong order", async () => {
    const id = await newReq();
    expect((await split(id, 1, hand1, hours(1), hours(5))).error?.code).toBe("22023");
    expect((await split(id, 1, hand1, hours(6), hours(11))).error?.code).toBe("22023");
    // second leg starting before the first leg starts would break chronology
    expect((await split(id, 1, hand1, hours(9), hours(2.5))).error).toBeNull();
  });

  it("limits a relay to five legs", async () => {
    const id = await newReq({ p_window_start: hours(2), p_window_end: hours(20) });
    for (let i = 1; i <= 4; i++) {
      // always split the last leg, alternating handover points
      const { error } = await split(id, i, i % 2 === 1 ? hand1 : hand2, hours(2 + i * 2), hours(1 + i * 2));
      expect(error).toBeNull();
    }
    expect(await legs(id)).toHaveLength(5);
    const { error } = await split(id, 5, hand1, hours(19), hours(18));
    expect(error?.code).toBe("22023");
  });
});

describe("update_leg", () => {
  it("re-times a leg and moves the handover point", async () => {
    const id = await newReq();
    await split(id, 1, hand1);
    const { error } = await rpc(coord, "update_leg", {
      p_request_id: id, p_expected_version: await version(id), p_seq: 1,
      p_window_start: hours(3), p_window_end: hours(7), p_to_location_id: hand2,
    });
    expect(error).toBeNull();
    const l = await legs(id);
    expect(l[0].to_location_id).toBe(hand2);
    expect(l[1].from_location_id).toBe(hand2);
  });

  it("refuses a window that breaks chronology", async () => {
    const id = await newReq();
    await split(id, 1, hand1, hours(6), hours(5));
    const { error } = await rpc(coord, "update_leg", {
      p_request_id: id, p_expected_version: await version(id), p_seq: 1,
      p_window_start: hours(2), p_window_end: hours(12),
    });
    expect(error?.code).toBe("22023");
  });

  it("refuses to change the last leg's end or to use a non-handover point", async () => {
    const id = await newReq();
    await split(id, 1, hand1);
    const v = await version(id);
    const last = await rpc(coord, "update_leg", {
      p_request_id: id, p_expected_version: v, p_seq: 2,
      p_window_start: hours(5), p_window_end: hours(10), p_to_location_id: hand2,
    });
    expect(last.error?.code).toBe("22023");
    const bad = await rpc(coord, "update_leg", {
      p_request_id: id, p_expected_version: v, p_seq: 1,
      p_window_start: hours(2), p_window_end: hours(6), p_to_location_id: shelterNotHandover,
    });
    expect(bad.error?.code).toBe("22023");
  });

  it("refuses a last leg that ends after the deadline", async () => {
    const id = await newReq({ p_deadline: hours(11) });
    await split(id, 1, hand1);
    const { error } = await rpc(coord, "update_leg", {
      p_request_id: id, p_expected_version: await version(id), p_seq: 2,
      p_window_start: hours(5), p_window_end: hours(12),
    });
    expect(error?.code).toBe("22023");
  });
});

describe("access and guards", () => {
  it("denies other orgs, volunteers and anon", async () => {
    const id = await newReq();
    const v = await version(id);
    const args = {
      p_request_id: id, p_expected_version: v, p_seq: 1, p_handover_location_id: hand1,
      p_first_end: hours(6), p_second_start: hours(5),
    };
    expect((await rpc(otherCoord, "split_leg", args)).error?.code).toBe("42501");
    expect((await rpc(vol, "split_leg", args)).error?.code).toBe("42501");
    const anon = await anonClient().rpc("split_leg" as any, args as any);
    expect(anon.error).not.toBeNull();
    expect(await legs(id)).toHaveLength(1);
  });

  it("rejects a stale version with 55006", async () => {
    const id = await newReq();
    const stale = await version(id);
    await split(id, 1, hand1);
    const { error } = await rpc(coord, "merge_legs", { p_request_id: id, p_expected_version: stale, p_seq: 1 });
    expect(error?.code).toBe("55006");
  });

  it("blocks edits once a leg is not open", async () => {
    const id = await newReq();
    await split(id, 1, hand1);
    const l = await legs(id);
    await admin.from("transport_legs").update({ status: "offered" }).eq("id", l[0].id);
    const { error } = await rpc(coord, "merge_legs", { p_request_id: id, p_expected_version: await version(id), p_seq: 1 });
    expect(error?.code).toBe("55000");
  });

  it("writes audit rows", async () => {
    const id = await newReq();
    await split(id, 1, hand1);
    await rpc(coord, "merge_legs", { p_request_id: id, p_expected_version: await version(id), p_seq: 1 });
    const { data } = await admin.from("audit_logs").select("action").eq("entity_id", id);
    const actions = (data ?? []).map((a: any) => a.action);
    expect(actions).toContain("leg.split");
    expect(actions).toContain("leg.merge");
  });
});

describe("publish and update_request with relays", () => {
  const publish = (id: string) => rpc(coord, "publish_request", { p_request_id: id, p_attest: true });

  it("publishes a valid two-leg chain", async () => {
    const id = await newReq();
    await split(id, 1, hand1);
    expect((await publish(id)).error).toBeNull();
    const { data } = await admin.from("transport_requests").select("status").eq("id", id).single();
    expect((data as any).status).toBe("open");
  });

  it("refuses to publish a broken chain", async () => {
    const id = await newReq();
    await split(id, 1, hand1);
    const l = await legs(id);
    // service-role tampering: break continuity
    await admin.from("transport_legs").update({ from_location_id: hand2 }).eq("id", l[1].id);
    expect((await publish(id)).error?.code).toBe("22023");
  });

  it("refuses to change pickup, destination or times through update_request on a relay", async () => {
    const id = await newReq();
    await split(id, 1, hand1);
    const upd = async (over: Record<string, unknown>) =>
      rpc(coord, "update_request", {
        p_request_id: id, p_expected_version: await version(id), p_animal_name: "Relay",
        p_species: "dog", p_urgency: "soon", p_required_date: null, p_deadline: hours(30),
        p_handling: "Calm", p_carrier: "Crate", p_medical_notes: null, p_coordinator_instructions: null,
        p_origin_location_id: origin, p_destination_location_id: dest,
        p_window_start: (await legs(id))[0].window_start, p_window_end: (await legs(id))[0].window_end, ...over,
      });
    expect((await upd({ p_window_end: hours(7) })).error?.code).toBe("55000");
    expect((await upd({ p_destination_location_id: hand2 })).error?.code).toBe("55000");
    expect((await upd({ p_animal_name: "Renamed" })).error).toBeNull();
  });
});
