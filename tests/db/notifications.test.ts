/* eslint-disable @typescript-eslint/no-explicit-any */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, anonClient, cleanup, createTestOrg, createTestUser, type TestUser } from "./helpers";

let coord: TestUser;
let otherCoord: TestUser;
let vol: TestUser;
let vol2: TestUser;
let orgId: string;
let otherOrgId: string;
let origin: string;
let dest: string;
let suburb: any;

type R = { data: any; error: { code: string; message: string } | null };
const rpc = (u: { client: TestUser["client"] }, fn: string, a?: Record<string, unknown>) =>
  (u.client.rpc as unknown as (f: string, a?: Record<string, unknown>) => Promise<R>)(fn, a);
const svc = (fn: string, a?: Record<string, unknown>) =>
  (admin.rpc as unknown as (f: string, a?: Record<string, unknown>) => Promise<R>)(fn, a);

const hours = (h: number) => new Date(Date.now() + h * 3600_000).toISOString();
const at = (base: string, h: number) => new Date(new Date(base).getTime() + h * 3600_000).toISOString();

async function member(org: string, userId: string, extra: Record<string, unknown>) {
  const { error } = await admin.from("organisation_members").insert({ org_id: org, user_id: userId, status: "active", ...extra });
  if (error) throw new Error(error.message);
}

async function loc(org: string, label: string, confirmed: boolean, kind: string) {
  const { data, error } = await admin.from("locations").insert({
    org_id: org, kind, label_public: label, suburb_id: suburb.id,
    approx_point: "SRID=4326;POINT(144.8 -37.7)", is_confirmed_destination: confirmed, is_demo: true,
  } as any).select("id").single();
  if (error) throw new Error(error.message);
  return data.id as string;
}

async function newVolunteer(label: string) {
  const u = await createTestUser(label);
  await admin.from("profiles").update({ is_demo: true } as any).eq("id", u.id);
  const { error } = await admin.from("volunteer_profiles").insert({
    user_id: u.id, species_ok: ["dog", "cat"], has_carrier: true, guidelines_version_accepted: "v1",
    verification_status: "verified", is_demo: true,
  } as any);
  if (error) throw new Error(error.message);
  return u;
}

let slot = 0;
/** Published request claimed by `who` and confirmed. Pickup window opens at a fixed time `start`. */
async function confirmed(who: TestUser = vol) {
  const startH = 100 + 8 * slot++;
  const { data: id, error } = await rpc(coord, "create_request", {
    p_org_id: orgId, p_animal_name: "Pip", p_species: "cat", p_urgency: "soon", p_required_date: null,
    p_deadline: hours(startH + 20), p_handling: "Calm", p_carrier: "Carrier", p_medical_notes: null,
    p_coordinator_instructions: null, p_origin_location_id: origin, p_destination_location_id: dest,
    p_window_start: hours(startH), p_window_end: hours(startH + 4),
  });
  if (error) throw new Error(error.message);
  const pub = await rpc(coord, "publish_request", { p_request_id: id, p_attest: true });
  if (pub.error) throw new Error(pub.error.message);
  const { data: leg } = await admin.from("transport_legs").select("id, window_start").eq("request_id", id).single();
  const claim = await rpc(who, "claim_leg", { p_leg_id: leg!.id, p_idempotency_key: `k-${randomUUID()}` });
  if (claim.error) throw new Error(claim.error.message);
  const conf = await rpc(coord, "confirm_assignment", { p_assignment_id: claim.data });
  if (conf.error) throw new Error(conf.error.message);
  return { requestId: id as string, legId: leg!.id as string, assignmentId: claim.data as string, start: leg!.window_start as string };
}

const noteRows = async (userId: string, key: string) =>
  ((await admin.from("notifications").select("*").eq("user_id", userId).eq("dedupe_key", key)).data ?? []) as any[];

beforeAll(async () => {
  [coord, otherCoord] = await Promise.all(["ncoord", "nother"].map((l) => createTestUser(l)));
  [vol, vol2] = await Promise.all(["nvol", "nvol2"].map((l) => newVolunteer(l)));
  [orgId, otherOrgId] = await Promise.all([createTestOrg("notif A"), createTestOrg("notif B")]);
  await admin.from("organisations").update({ verification_status: "verified" }).in("id", [orgId, otherOrgId]);
  await member(orgId, coord.id, { is_coordinator: true });
  await member(otherOrgId, otherCoord.id, { is_coordinator: true });
  await member(orgId, vol.id, { is_volunteer: true });
  await member(orgId, vol2.id, { is_volunteer: true });
  const { data } = await coord.client.rpc("list_suburbs" as any, { p_query: "" } as any);
  suburb = (data as any[]).find((s) => s.name === "St Albans");
  origin = await loc(orgId, "Pound N", false, "pound");
  dest = await loc(orgId, "Vet N", true, "vet");
}, 90_000);

afterAll(cleanup, 60_000);

describe("inbox permissions", () => {
  it("each user sees only their own notifications; anon is refused", async () => {
    const t = await confirmed();
    const mine = await rpc(vol, "list_my_notifications");
    expect(mine.error).toBeNull();
    const row = mine.data.find((n: any) => n.type === "assignment_confirmed" && n.leg_id === t.legId);
    expect(row).toBeTruthy();
    expect(row.animal_name).toBe("Pip");
    expect(row.assignment_id).toBe(t.assignmentId);
    expect(row.org_id).toBeNull();
    expect(Object.keys(row).sort()).toEqual(
      ["animal_name", "assignment_id", "created_at", "id", "leg_id", "org_id", "read_at", "reference", "request_id", "type"]);

    const coordList = await rpc(coord, "list_my_notifications");
    const claimed = coordList.data.find((n: any) => n.type === "assignment_claimed" && n.leg_id === t.legId);
    expect(claimed.org_id).toBe(orgId);
    expect(mine.data.some((n: any) => n.type === "assignment_claimed")).toBe(false);

    for (const u of [otherCoord, vol2]) {
      const other = await rpc(u, "list_my_notifications");
      expect(other.data.some((n: any) => n.leg_id === t.legId)).toBe(false);
    }
    expect((await rpc({ client: anonClient() }, "list_my_notifications")).error).not.toBeNull();
    expect((await rpc({ client: anonClient() }, "mark_notifications_read")).error).not.toBeNull();
    // Direct table access stays closed.
    const direct = await vol.client.from("notifications").select("id");
    expect(direct.data ?? []).toHaveLength(0);
  }, 60_000);

  it("mark read affects only the caller, is idempotent, and updates the unread count", async () => {
    await confirmed(vol2);
    const before = (await rpc(vol2, "count_my_unread_notifications")).data as number;
    expect(before).toBeGreaterThan(0);
    const coordBefore = (await rpc(coord, "count_my_unread_notifications")).data as number;
    const list = (await rpc(vol2, "list_my_notifications")).data;
    const coordIds = (await rpc(coord, "list_my_notifications")).data.map((n: any) => n.id);

    // Another user's ids are ignored.
    expect((await rpc(vol2, "mark_notifications_read", { p_ids: coordIds })).data).toBe(0);
    expect((await rpc(coord, "count_my_unread_notifications")).data).toBe(coordBefore);

    expect((await rpc(vol2, "mark_notifications_read", { p_ids: [list[0].id] })).data).toBe(1);
    expect((await rpc(vol2, "mark_notifications_read", { p_ids: [list[0].id] })).data).toBe(0);
    expect((await rpc(vol2, "mark_notifications_read")).data).toBe(before - 1);
    expect((await rpc(vol2, "count_my_unread_notifications")).data).toBe(0);
    expect((await rpc(coord, "count_my_unread_notifications")).data).toBe(coordBefore);
  }, 60_000);

  it("a suspended user cannot mark read or change preferences", async () => {
    await admin.from("profiles").update({ account_status: "suspended" }).eq("id", vol2.id);
    try {
      expect((await rpc(vol2, "mark_notifications_read")).error).not.toBeNull();
      expect((await rpc(vol2, "set_my_notification_preferences", { p_reminders_enabled: false })).error).not.toBeNull();
    } finally {
      await admin.from("profiles").update({ account_status: "active" }).eq("id", vol2.id);
    }
  });
});

describe("preferences", () => {
  it("default on, round trip, rejects null", async () => {
    const u = await newVolunteer("npref");
    expect((await rpc(u, "get_my_notification_preferences")).data).toEqual({ reminders_enabled: true });
    expect((await rpc(u, "set_my_notification_preferences", { p_reminders_enabled: false })).error).toBeNull();
    expect((await rpc(u, "get_my_notification_preferences")).data).toEqual({ reminders_enabled: false });
    expect((await rpc(u, "set_my_notification_preferences", { p_reminders_enabled: true })).error).toBeNull();
    expect((await rpc(u, "get_my_notification_preferences")).data).toEqual({ reminders_enabled: true });
    expect((await rpc(u, "set_my_notification_preferences", { p_reminders_enabled: null })).error?.code).toBe("22023");
  }, 30_000);
});

describe("reminders (fixed clock)", () => {
  it("sends the 24 h and 2 h reminders once each, at the right times", async () => {
    const t = await confirmed();
    const k24 = `remind:${t.assignmentId}:24h`;
    const k2 = `remind:${t.assignmentId}:2h`;

    await svc("send_assignment_reminders", { p_now: at(t.start, -25) });
    expect(await noteRows(vol.id, k24)).toHaveLength(0);

    await svc("send_assignment_reminders", { p_now: at(t.start, -23) });
    await svc("send_assignment_reminders", { p_now: at(t.start, -22.9) });
    const v24 = await noteRows(vol.id, k24);
    expect(v24).toHaveLength(1);
    expect(v24[0].type).toBe("reminder_24h");
    expect(v24[0].request_id).toBe(t.requestId);
    expect(await noteRows(coord.id, k24)).toHaveLength(1);
    expect(await noteRows(otherCoord.id, k24)).toHaveLength(0);
    expect(await noteRows(vol.id, k2)).toHaveLength(0);

    await svc("send_assignment_reminders", { p_now: at(t.start, -1.5) });
    await svc("send_assignment_reminders", { p_now: at(t.start, -1.4) });
    const v2 = await noteRows(vol.id, k2);
    expect(v2).toHaveLength(1);
    expect(v2[0].type).toBe("reminder_2h");
    expect(await noteRows(coord.id, k2)).toHaveLength(0);

    // Nothing once the window has opened.
    const t2 = await confirmed();
    await svc("send_assignment_reminders", { p_now: at(t2.start, 0.5) });
    expect(await noteRows(vol.id, `remind:${t2.assignmentId}:2h`)).toHaveLength(0);
  }, 90_000);

  it("skips started legs, opted-out volunteers and suspended volunteers", async () => {
    const started = await confirmed();
    await admin.from("transport_legs").update({ status: "en_route" }).eq("id", started.legId);
    await svc("send_assignment_reminders", { p_now: at(started.start, -1) });
    expect(await noteRows(vol.id, `remind:${started.assignmentId}:2h`)).toHaveLength(0);

    const optOut = await confirmed(vol2);
    await rpc(vol2, "set_my_notification_preferences", { p_reminders_enabled: false });
    await svc("send_assignment_reminders", { p_now: at(optOut.start, -23) });
    expect(await noteRows(vol2.id, `remind:${optOut.assignmentId}:24h`)).toHaveLength(0);
    expect(await noteRows(coord.id, `remind:${optOut.assignmentId}:24h`)).toHaveLength(1);
    await rpc(vol2, "set_my_notification_preferences", { p_reminders_enabled: true });

    await admin.from("profiles").update({ account_status: "suspended" }).eq("id", vol2.id);
    try {
      const sus = await confirmed(vol);
      await admin.from("transport_assignments").update({ volunteer_id: vol2.id }).eq("id", sus.assignmentId);
      await svc("send_assignment_reminders", { p_now: at(sus.start, -23) });
      expect(await noteRows(vol2.id, `remind:${sus.assignmentId}:24h`)).toHaveLength(0);
    } finally {
      await admin.from("profiles").update({ account_status: "active" }).eq("id", vol2.id);
    }
  }, 120_000);

  it("clients cannot call the scheduled functions", async () => {
    for (const [fn, args] of [
      ["send_assignment_reminders", {}], ["delete_expired_journeys", {}], ["sweep_expired_assignments", {}],
    ] as const) {
      expect((await rpc(vol, fn, args)).error).not.toBeNull();
      expect((await rpc(coord, fn, args)).error).not.toBeNull();
    }
  });
});

describe("journey cleanup", () => {
  it("deletes journeys only once 7 days past departure", async () => {
    const mk = (depart: string) => ({
      user_id: vol.id, origin_point: "SRID=4326;POINT(144.8 -37.7)", destination_point: "SRID=4326;POINT(144.3 -38.1)",
      depart_at: depart, expires_at: depart,
    });
    const now = new Date().toISOString();
    const { data, error } = await admin.from("journeys").insert([
      mk(at(now, -24 * 8)), mk(at(now, -24 * 6)), mk(at(now, 24)),
    ] as any).select("id, depart_at");
    expect(error).toBeNull();
    const ids = data!.map((j: any) => j.id);
    const old = data!.find((j: any) => new Date(j.depart_at) < new Date(at(now, -24 * 7)))!.id;
    const res = await svc("delete_expired_journeys", { p_now: now });
    expect(res.error).toBeNull();
    const left = (await admin.from("journeys").select("id").in("id", ids)).data!.map((j: any) => j.id);
    expect(left).not.toContain(old);
    expect(left).toHaveLength(2);
    await admin.from("journeys").delete().in("id", ids);
  });
});
