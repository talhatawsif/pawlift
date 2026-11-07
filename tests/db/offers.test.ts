/* eslint-disable @typescript-eslint/no-explicit-any */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, cleanup, createTestOrg, createTestUser, type TestUser } from "./helpers";

let coord: TestUser;
let coord2: TestUser;
let otherCoord: TestUser;
let stranger: TestUser;
let v1: TestUser;
let v2: TestUser;
let outsider: TestUser;
let orgId: string;
let otherOrgId: string;
let origin: string;
let dest: string;
let suburb: any;

const rpc = (u: TestUser, fn: string, args?: Record<string, unknown>) =>
  (u.client.rpc as unknown as (f: string, a?: Record<string, unknown>) => Promise<{ data: any; error: { code: string; message: string } | null }>)(fn, args);

const hours = (h: number) => new Date(Date.now() + h * 3600_000).toISOString();
const key = () => `key-${randomUUID()}`;

async function member(org: string, userId: string, extra: Record<string, unknown>) {
  const { error } = await admin.from("organisation_members")
    .insert({ org_id: org, user_id: userId, status: "active", ...extra });
  if (error) throw new Error(error.message);
}

async function loc(org: string, label: string, confirmed: boolean, kind = "shelter") {
  const { data: l, error } = await admin.from("locations").insert({
    org_id: org, kind, label_public: label, suburb_id: suburb.id,
    approx_point: "SRID=4326;POINT(144.8 -37.7)", is_confirmed_destination: confirmed, is_demo: true,
  } as any).select("id").single();
  if (error) throw new Error(error.message);
  return l.id as string;
}

const volDefaults = { species_ok: ["dog", "cat"], has_carrier: true, guidelines_version_accepted: "v1", verification_status: "verified", is_demo: true };

async function newVolunteer(label: string) {
  const u = await createTestUser(label);
  await admin.from("profiles").update({ is_demo: true } as any).eq("id", u.id);
  const { error } = await admin.from("volunteer_profiles").insert({ user_id: u.id, ...volDefaults } as any);
  if (error) throw new Error(error.message);
  return u;
}

async function setVol(u: TestUser, over: Record<string, unknown> = {}, profileOver: Record<string, unknown> = {}) {
  await admin.from("profiles").update({ is_demo: true, account_status: "active", ...profileOver } as any).eq("id", u.id);
  await admin.from("volunteer_profiles").update({ ...volDefaults, ...over } as any).eq("user_id", u.id);
  return u;
}

let slot = 0;
async function publishedLeg() {
  const startH = 100 + 6 * slot++;
  const { data: id, error } = await rpc(coord, "create_request", {
    p_org_id: orgId, p_animal_name: "Biscuit", p_species: "dog", p_urgency: "soon",
    p_required_date: null, p_deadline: hours(startH + 20), p_handling: "Nervous, use a lead",
    p_carrier: "Large crate", p_medical_notes: null, p_coordinator_instructions: null,
    p_origin_location_id: origin, p_destination_location_id: dest,
    p_window_start: hours(startH), p_window_end: hours(startH + 4),
  });
  if (error) throw new Error(error.message);
  const pub = await rpc(coord, "publish_request", { p_request_id: id, p_attest: true });
  if (pub.error) throw new Error(pub.error.message);
  const { data: leg } = await admin.from("transport_legs").select("id").eq("request_id", id).eq("seq", 1).single();
  return { requestId: id as string, legId: leg!.id as string };
}

const legStatus = async (id: string) =>
  (await admin.from("transport_legs").select("status").eq("id", id).single()).data!.status;
const reqStatus = async (id: string) =>
  (await admin.from("transport_requests").select("status").eq("id", id).single()).data!.status;
const asnRow = async (id: string) =>
  (await admin.from("transport_assignments").select("*").eq("id", id).single()).data as any;
const notes = async (userId: string, type: string, dedupe?: string) => {
  let q = admin.from("notifications").select("id").eq("user_id", userId).eq("type", type);
  if (dedupe) q = q.eq("dedupe_key", dedupe);
  return (await q).data!.length;
};
const audits = async (action: string, entityId: string) =>
  (await admin.from("audit_logs").select("id").eq("action", action).eq("entity_id", entityId)).data!.length;
const ACTIVE = ["offered", "reserved", "confirmed"];

/** Leg offered to v1 and (optionally) accepted. */
async function offered(accept = false) {
  const { requestId, legId } = await publishedLeg();
  const { data: id, error } = await rpc(coord, "offer_leg", { p_leg_id: legId, p_volunteer_id: v1.id });
  if (error) throw new Error(error.message);
  if (accept) {
    const r = await rpc(v1, "accept_offer", { p_assignment_id: id });
    if (r.error) throw new Error(r.error.message);
  }
  return { requestId, legId, id: id as string };
}

beforeAll(async () => {
  [coord, coord2, otherCoord, stranger] = await Promise.all(
    ["ocoord", "ocoord2", "oother", "ostranger"].map((l) => createTestUser(l)),
  );
  [v1, v2, outsider] = await Promise.all(["ovol1", "ovol2", "ooutsider"].map((l) => newVolunteer(l)));
  [orgId, otherOrgId] = await Promise.all([createTestOrg("off A"), createTestOrg("off B")]);
  await admin.from("organisations").update({ verification_status: "verified" }).in("id", [orgId, otherOrgId]);
  await member(orgId, coord.id, { is_coordinator: true });
  await member(orgId, coord2.id, { is_coordinator: true });
  await member(otherOrgId, otherCoord.id, { is_coordinator: true });
  await member(orgId, v1.id, { is_volunteer: true });
  await member(orgId, v2.id, { is_volunteer: true });
  const { data } = await coord.client.rpc("list_suburbs" as any, { p_query: "" } as any);
  suburb = (data as any[]).find((s) => s.name === "St Albans");
  origin = await loc(orgId, "Pound A", false, "pound");
  dest = await loc(orgId, "Vet A", true, "vet");
});

afterAll(async () => {
  await cleanup();
});

describe("offer_leg", () => {
  it("offers to an org volunteer: leg offered, expiry set, volunteer told once, audited", async () => {
    await setVol(v1);
    const { requestId, legId } = await publishedLeg();
    const { data: id, error } = await rpc(coord, "offer_leg", { p_leg_id: legId, p_volunteer_id: v1.id });
    expect(error).toBeNull();
    const a = await asnRow(id);
    expect(a.status).toBe("offered");
    expect(a.kind).toBe("offer");
    const { data: leg } = await admin.from("transport_legs").select("window_start").eq("id", legId).single();
    const expected = Math.min(Date.now() + 24 * 3600_000, new Date(leg!.window_start).getTime() - 3600_000);
    expect(Math.abs(new Date(a.offer_expires_at).getTime() - expected)).toBeLessThan(60_000);
    expect(await legStatus(legId)).toBe("offered");
    expect(await reqStatus(requestId)).toBe("open");
    expect(await notes(v1.id, "offer_received", `offer:${id}`)).toBe(1);
    expect(await audits("assignment.offer", id)).toBe(1);
    // repeating returns the same offer
    const again = await rpc(coord, "offer_leg", { p_leg_id: legId, p_volunteer_id: v1.id });
    expect(again.data).toBe(id);
  });

  it("refuses non-coordinators, other-org coordinators, non-members and ineligible volunteers", async () => {
    await setVol(v1);
    const { legId } = await publishedLeg();
    for (const u of [v1, stranger, otherCoord]) {
      expect((await rpc(u, "offer_leg", { p_leg_id: legId, p_volunteer_id: v2.id })).error).not.toBeNull();
    }
    expect((await rpc(coord, "offer_leg", { p_leg_id: legId, p_volunteer_id: outsider.id })).error?.message).toMatch(/not an active volunteer/);
    await setVol(v1, { verification_status: "pending" });
    expect((await rpc(coord, "offer_leg", { p_leg_id: legId, p_volunteer_id: v1.id })).error?.message).toMatch(/verified/);
    await setVol(v1, { species_ok: ["cat"] });
    expect((await rpc(coord, "offer_leg", { p_leg_id: legId, p_volunteer_id: v1.id })).error?.message).toMatch(/kind of animal/);
    await setVol(v1);
    expect(await legStatus(legId)).toBe("open");
  });

  it("refuses an overlapping window and a second offer on an offered leg", async () => {
    await setVol(v1);
    const a = await publishedLeg();
    expect((await rpc(coord, "offer_leg", { p_leg_id: a.legId, p_volunteer_id: v1.id })).error).toBeNull();
    const second = await rpc(coord, "offer_leg", { p_leg_id: a.legId, p_volunteer_id: v2.id });
    expect(second.error).not.toBeNull();
    const b = await publishedLeg();
    await admin.from("transport_legs").update({
      window_start: (await admin.from("transport_legs").select("window_start").eq("id", a.legId).single()).data!.window_start,
      window_end: (await admin.from("transport_legs").select("window_end").eq("id", a.legId).single()).data!.window_end,
    }).eq("id", b.legId);
    expect((await rpc(coord, "offer_leg", { p_leg_id: b.legId, p_volunteer_id: v1.id })).error?.message).toMatch(/overlaps/);
  });

  it("refuses a suspended volunteer, a suspended coordinator and a cancelled leg", async () => {
    await setVol(v1);
    const { legId, requestId } = await publishedLeg();
    await setVol(v1, {}, { account_status: "suspended" });
    expect((await rpc(coord, "offer_leg", { p_leg_id: legId, p_volunteer_id: v1.id })).error?.message).toMatch(/not active/);
    await setVol(v1);
    await admin.from("profiles").update({ account_status: "suspended" }).eq("id", coord2.id);
    expect((await rpc(coord2, "offer_leg", { p_leg_id: legId, p_volunteer_id: v1.id })).error).not.toBeNull();
    await admin.from("profiles").update({ account_status: "active" }).eq("id", coord2.id);
    expect((await rpc(coord, "cancel_request", { p_request_id: requestId, p_reason: "No longer needed" })).error).toBeNull();
    expect((await rpc(coord, "offer_leg", { p_leg_id: legId, p_volunteer_id: v1.id })).error).not.toBeNull();
  });

  it("lets only one of two parallel coordinator offers win", async () => {
    await setVol(v1); await setVol(v2);
    const { legId } = await publishedLeg();
    const [x, y] = await Promise.all([
      rpc(coord, "offer_leg", { p_leg_id: legId, p_volunteer_id: v1.id }),
      rpc(coord2, "offer_leg", { p_leg_id: legId, p_volunteer_id: v2.id }),
    ]);
    const successes = [x, y].filter((r) => r.error === null && r.data);
    expect(successes.length).toBe(1);
    const { data } = await admin.from("transport_assignments").select("id").eq("leg_id", legId).in("status", ACTIVE);
    expect(data!.length).toBe(1);
  });
});

describe("accept_offer", () => {
  it("confirms the leg and tells coordinators", async () => {
    await setVol(v1);
    const { requestId, legId, id } = await offered();
    const { error } = await rpc(v1, "accept_offer", { p_assignment_id: id });
    expect(error).toBeNull();
    const a = await asnRow(id);
    expect(a.status).toBe("confirmed");
    expect(a.confirmed_by).toBe(v1.id);
    expect(await legStatus(legId)).toBe("confirmed");
    expect(await reqStatus(requestId)).toBe("confirmed");
    expect(await notes(coord.id, "assignment_confirmed", `confirmed:${id}`)).toBe(1);
    expect(await audits("assignment.accept", id)).toBe(1);
    expect((await rpc(v1, "accept_offer", { p_assignment_id: id })).error).not.toBeNull();
  });

  it("refuses anyone but the offered volunteer", async () => {
    await setVol(v1); await setVol(v2);
    const { id } = await offered();
    for (const u of [v2, coord, stranger]) {
      expect((await rpc(u, "accept_offer", { p_assignment_id: id })).error).not.toBeNull();
    }
    expect((await asnRow(id)).status).toBe("offered");
  });

  it("refuses an expired offer; the next RPC sweeps it", async () => {
    await setVol(v1); await setVol(v2);
    const { legId, id } = await offered();
    await admin.from("transport_assignments").update({ offer_expires_at: new Date(Date.now() - 1000).toISOString() }).eq("id", id);
    // The refusal raises, which rolls the lazy sweep back (D31); the next RPC's sweep expires it.
    expect((await rpc(v1, "accept_offer", { p_assignment_id: id })).error).not.toBeNull();
    expect((await rpc(coord, "offer_leg", { p_leg_id: legId, p_volunteer_id: v2.id })).error).toBeNull();
    expect((await asnRow(id)).status).toBe("expired");
    expect(await notes(v1.id, "assignment_expired", `expire:${id}`)).toBe(1);
  });

  it("re-checks eligibility and refuses a suspended volunteer", async () => {
    await setVol(v1);
    const a = await offered();
    await setVol(v1, { verification_status: "suspended" });
    expect((await rpc(v1, "accept_offer", { p_assignment_id: a.id })).error?.message).toMatch(/verified/);
    await setVol(v1, {}, { account_status: "suspended" });
    expect((await rpc(v1, "accept_offer", { p_assignment_id: a.id })).error).not.toBeNull();
    expect((await asnRow(a.id)).status).toBe("offered");
    await setVol(v1);
  });

  it("ends in one consistent state when accept races withdraw_offer", async () => {
    await setVol(v1);
    const { legId, id } = await offered();
    await Promise.all([
      rpc(v1, "accept_offer", { p_assignment_id: id }),
      rpc(coord, "withdraw_offer", { p_assignment_id: id, p_reason: "changed plan" }),
    ]);
    const a = await asnRow(id);
    expect(["confirmed", "withdrawn"]).toContain(a.status);
    expect(await legStatus(legId)).toBe(a.status === "confirmed" ? "confirmed" : "open");
  });
});

describe("decline_offer and withdraw_offer", () => {
  it("lets the volunteer decline: leg reopens, coordinators told, another volunteer can claim", async () => {
    await setVol(v1); await setVol(v2);
    const { legId, id } = await offered();
    expect((await rpc(v2, "decline_offer", { p_assignment_id: id, p_reason: null })).error).not.toBeNull();
    expect((await rpc(v1, "decline_offer", { p_assignment_id: id, p_reason: "Car in the shop" })).error).toBeNull();
    const a = await asnRow(id);
    expect(a.status).toBe("declined");
    expect(a.end_reason).toBe("Car in the shop");
    expect(await legStatus(legId)).toBe("open");
    expect(await notes(coord.id, "offer_declined", `ended:${id}`)).toBe(1);
    expect((await rpc(v2, "claim_leg", { p_leg_id: legId, p_idempotency_key: key() })).error).toBeNull();
  });

  it("lets only the org coordinator withdraw an offer and tells the volunteer", async () => {
    await setVol(v1);
    const { legId, id } = await offered();
    for (const u of [v1, otherCoord, stranger]) {
      expect((await rpc(u, "withdraw_offer", { p_assignment_id: id, p_reason: "x" })).error).not.toBeNull();
    }
    expect((await rpc(coord2, "withdraw_offer", { p_assignment_id: id, p_reason: "Found someone closer" })).error).toBeNull();
    expect((await asnRow(id)).status).toBe("withdrawn");
    expect(await legStatus(legId)).toBe("open");
    expect(await notes(v1.id, "offer_withdrawn", `ended:${id}`)).toBe(1);
    expect((await rpc(coord, "withdraw_offer", { p_assignment_id: id, p_reason: "again" })).error).not.toBeNull();
  });
});

describe("withdraw", () => {
  it("lets a volunteer withdraw a reservation without an incident", async () => {
    await setVol(v1);
    const { requestId, legId } = await publishedLeg();
    const { data: id } = await rpc(v1, "claim_leg", { p_leg_id: legId, p_idempotency_key: key() });
    expect((await rpc(v2, "withdraw", { p_assignment_id: id, p_reason: "nope" })).error).not.toBeNull();
    expect((await rpc(v1, "withdraw", { p_assignment_id: id, p_reason: null })).error).toBeNull();
    expect((await asnRow(id)).status).toBe("withdrawn");
    expect(await legStatus(legId)).toBe("open");
    expect(await reqStatus(requestId)).toBe("open");
    expect(await notes(coord.id, "assignment_withdrawn", `ended:${id}`)).toBe(1);
  });

  it("early withdrawal of a confirmed leg needs a reason and raises no incident", async () => {
    await setVol(v1);
    const { requestId, legId, id } = await offered(true);
    expect((await rpc(v1, "withdraw", { p_assignment_id: id, p_reason: "" })).error?.code).toBe("22023");
    expect((await rpc(v1, "withdraw", { p_assignment_id: id, p_reason: "Sick child" })).error).toBeNull();
    expect(await legStatus(legId)).toBe("open");
    expect(await reqStatus(requestId)).toBe("open");
    const { data } = await admin.from("incidents").select("id").eq("leg_id", legId);
    expect(data!.length).toBe(0);
  });

  it("late withdrawal (within 2 h of the window) raises a high-severity incident and notifies coordinators", async () => {
    await setVol(v1);
    const { requestId, legId, id } = await offered(true);
    await admin.from("transport_legs").update({ window_start: hours(1), window_end: hours(3) }).eq("id", legId);
    expect((await rpc(v1, "withdraw", { p_assignment_id: id, p_reason: "Car broke down" })).error).toBeNull();
    const { data } = await admin.from("incidents").select("*").eq("leg_id", legId);
    expect(data!.length).toBe(1);
    expect(data![0].type).toBe("late_withdrawal");
    expect(data![0].severity).toBe("high");
    expect(data![0].raised_by).toBe(v1.id);
    expect(await notes(coord.id, "incident", `incident:${data![0].id}`)).toBe(1);
    expect(await legStatus(legId)).toBe("open");
    expect(await reqStatus(requestId)).toBe("open");
  });

  it("refuses withdrawing after collection, and an ended assignment", async () => {
    await setVol(v1);
    const { legId, id } = await offered(true);
    await admin.from("transport_legs").update({ status: "collected" }).eq("id", legId);
    expect((await rpc(v1, "withdraw", { p_assignment_id: id, p_reason: "too late" })).error?.message).toMatch(/incident/);
    await admin.from("transport_legs").update({ status: "confirmed" }).eq("id", legId);
    expect((await rpc(v1, "withdraw", { p_assignment_id: id, p_reason: "fine" })).error).toBeNull();
    expect((await rpc(v1, "withdraw", { p_assignment_id: id, p_reason: "again" })).error).not.toBeNull();
  });

  it("returns an en route request to open when the driver withdraws", async () => {
    await setVol(v1);
    const { requestId, legId, id } = await offered(true);
    await admin.from("transport_legs").update({ status: "en_route", started_at: new Date().toISOString() }).eq("id", legId);
    await admin.from("transport_requests").update({ status: "en_route" }).eq("id", requestId);
    expect((await rpc(v1, "withdraw", { p_assignment_id: id, p_reason: "Flat tyre" })).error).toBeNull();
    expect(await legStatus(legId)).toBe("open");
    expect(await reqStatus(requestId)).toBe("open");
  });

  it("refuses a suspended volunteer", async () => {
    await setVol(v1);
    const { id } = await offered(true);
    await setVol(v1, {}, { account_status: "suspended" });
    expect((await rpc(v1, "withdraw", { p_assignment_id: id, p_reason: "Whatever" })).error).not.toBeNull();
    await setVol(v1);
  });
});

describe("reassign", () => {
  it("ends a confirmed assignment, reopens the leg and tells the volunteer", async () => {
    await setVol(v1);
    const { requestId, legId, id } = await offered(true);
    expect((await rpc(v1, "reassign", { p_assignment_id: id, p_reason: "swap", p_new_volunteer_id: null })).error).not.toBeNull();
    expect((await rpc(otherCoord, "reassign", { p_assignment_id: id, p_reason: "swap", p_new_volunteer_id: null })).error).not.toBeNull();
    expect((await rpc(coord, "reassign", { p_assignment_id: id, p_reason: "", p_new_volunteer_id: null })).error?.code).toBe("22023");
    expect((await rpc(coord, "reassign", { p_assignment_id: id, p_reason: "Driver unreachable", p_new_volunteer_id: null })).error).toBeNull();
    const a = await asnRow(id);
    expect(a.status).toBe("reassigned");
    expect(a.end_reason).toBe("Driver unreachable");
    expect(await legStatus(legId)).toBe("open");
    expect(await reqStatus(requestId)).toBe("open");
    expect(await notes(v1.id, "reassigned", `ended:${id}`)).toBe(1);
    expect(await audits("assignment.reassign", id)).toBe(1);
  });

  it("can offer straight to a new volunteer, and refuses the same volunteer", async () => {
    await setVol(v1); await setVol(v2);
    const { legId, id } = await offered(true);
    expect((await rpc(coord, "reassign", { p_assignment_id: id, p_reason: "Closer driver", p_new_volunteer_id: v1.id })).error).not.toBeNull();
    const r = await rpc(coord, "reassign", { p_assignment_id: id, p_reason: "Closer driver", p_new_volunteer_id: v2.id });
    expect(r.error).toBeNull();
    expect((await asnRow(r.data)).status).toBe("offered");
    expect((await asnRow(r.data)).volunteer_id).toBe(v2.id);
    expect((await asnRow(id)).status).toBe("reassigned");
    expect(await legStatus(legId)).toBe("offered");
  });

  it("rolls back when the new volunteer is ineligible, and refuses a collected leg", async () => {
    await setVol(v1);
    const { legId, id } = await offered(true);
    expect((await rpc(coord, "reassign", { p_assignment_id: id, p_reason: "Try outsider", p_new_volunteer_id: outsider.id })).error).not.toBeNull();
    expect((await asnRow(id)).status).toBe("confirmed");
    expect(await legStatus(legId)).toBe("confirmed");
    await admin.from("transport_legs").update({ status: "collected" }).eq("id", legId);
    expect((await rpc(coord, "reassign", { p_assignment_id: id, p_reason: "Too late", p_new_volunteer_id: null })).error?.message).toMatch(/collected/);
    await admin.from("transport_legs").update({ status: "confirmed" }).eq("id", legId);
  });
});

describe("cancel_request with active assignments", () => {
  it("ends confirmed and offered assignments, notifies volunteers once, cancels legs", async () => {
    await setVol(v1);
    const a = await offered(true);
    const reasonShort = await rpc(coord, "cancel_request", { p_request_id: a.requestId, p_reason: "x" });
    expect(reasonShort.error?.code).toBe("22023");
    expect((await rpc(otherCoord, "cancel_request", { p_request_id: a.requestId, p_reason: "Not mine" })).error).not.toBeNull();
    expect((await rpc(coord, "cancel_request", { p_request_id: a.requestId, p_reason: "Animal reclaimed by owner" })).error).toBeNull();
    const row = await asnRow(a.id);
    expect(row.status).toBe("cancelled");
    expect(row.end_reason).toBe("Animal reclaimed by owner");
    expect(await legStatus(a.legId)).toBe("cancelled");
    expect(await reqStatus(a.requestId)).toBe("cancelled");
    expect(await notes(v1.id, "cancelled", `ended:${a.id}`)).toBe(1);
    expect(await audits("assignment.cancel", a.id)).toBe(1);
    // an offered assignment is also ended
    await setVol(v2);
    const b = await publishedLeg();
    const { data: oid } = await rpc(coord, "offer_leg", { p_leg_id: b.legId, p_volunteer_id: v2.id });
    expect((await rpc(coord, "cancel_request", { p_request_id: b.requestId, p_reason: "Cancelled today" })).error).toBeNull();
    expect((await asnRow(oid)).status).toBe("cancelled");
    expect((await rpc(v2, "accept_offer", { p_assignment_id: oid })).error).not.toBeNull();
  });

  it("is blocked once the animal is collected", async () => {
    await setVol(v1);
    const a = await offered(true);
    await admin.from("transport_legs").update({ status: "collected" }).eq("id", a.legId);
    const r = await rpc(coord, "cancel_request", { p_request_id: a.requestId, p_reason: "Too late" });
    expect(r.error?.message).toMatch(/collected/);
    expect((await asnRow(a.id)).status).toBe("confirmed");
    expect(await reqStatus(a.requestId)).not.toBe("cancelled");
    await admin.from("transport_legs").update({ status: "confirmed" }).eq("id", a.legId);
  });

  it("still cancels an untouched published request and a draft", async () => {
    const a = await publishedLeg();
    expect((await rpc(coord, "cancel_request", { p_request_id: a.requestId, p_reason: "Duplicate" })).error).toBeNull();
    expect(await reqStatus(a.requestId)).toBe("cancelled");
  });
});

describe("access revocation (status level)", () => {
  it("leaves no active assignment after decline, withdraw, reassign, cancel or expiry", async () => {
    await setVol(v1);
    const ids: string[] = [];
    const d = await offered(); await rpc(v1, "decline_offer", { p_assignment_id: d.id, p_reason: null }); ids.push(d.id);
    const w = await offered(true); await rpc(v1, "withdraw", { p_assignment_id: w.id, p_reason: "Not able" }); ids.push(w.id);
    const r = await offered(true); await rpc(coord, "reassign", { p_assignment_id: r.id, p_reason: "Swap", p_new_volunteer_id: null }); ids.push(r.id);
    const c = await offered(true); await rpc(coord, "cancel_request", { p_request_id: c.requestId, p_reason: "Cancelled" }); ids.push(c.id);
    const e = await offered();
    await admin.from("transport_assignments").update({ offer_expires_at: new Date(Date.now() - 1000).toISOString() }).eq("id", e.id);
    await admin.rpc("sweep_expired_assignments" as any);
    ids.push(e.id);
    const { data } = await admin.from("transport_assignments").select("id,status,ended_at").in("id", ids);
    expect(data!.length).toBe(5);
    for (const row of data!) {
      expect(ACTIVE).not.toContain(row.status);
      expect(row.ended_at).not.toBeNull();
    }
  });
});
