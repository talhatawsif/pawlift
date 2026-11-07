/* eslint-disable @typescript-eslint/no-explicit-any */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, cleanup, createTestOrg, createTestUser, type TestUser } from "./helpers";

let coord: TestUser;
let otherCoord: TestUser;
let stranger: TestUser;
let v1: TestUser;
let v2: TestUser;
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

async function loc(org: string, label: string, confirmed: boolean, kind: string, address: string) {
  const { data: l, error } = await admin.from("locations").insert({
    org_id: org, kind, label_public: label, suburb_id: suburb.id,
    approx_point: "SRID=4326;POINT(144.8 -37.7)", is_confirmed_destination: confirmed, is_demo: true,
  } as any).select("id").single();
  if (error) throw new Error(error.message);
  const p = await admin.from("location_private").upsert({
    location_id: l.id, exact_address: address, exact_point: "SRID=4326;POINT(144.81 -37.71)",
    contact_name: "Gate staff", contact_phone: "0400 000 000", instructions: "Ring the bell",
  } as any);
  if (p.error) throw new Error(p.error.message);
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

let slot = 0;
/** Published request, claimed by v1 and confirmed by the coordinator. Window moved to start in 1 hour. */
async function confirmedLeg(soon = true) {
  const startH = 100 + 6 * slot++;
  const { data: id, error } = await rpc(coord, "create_request", {
    p_org_id: orgId, p_animal_name: "Biscuit", p_species: "dog", p_urgency: "soon",
    p_required_date: null, p_deadline: hours(startH + 20), p_handling: "Nervous, use a lead",
    p_carrier: "Large crate", p_medical_notes: "Takes tablets at 6pm", p_coordinator_instructions: "Call on arrival",
    p_origin_location_id: origin, p_destination_location_id: dest,
    p_window_start: hours(startH), p_window_end: hours(startH + 4),
  });
  if (error) throw new Error(error.message);
  const pub = await rpc(coord, "publish_request", { p_request_id: id, p_attest: true });
  if (pub.error) throw new Error(pub.error.message);
  const { data: leg } = await admin.from("transport_legs").select("id").eq("request_id", id).eq("seq", 1).single();
  const claim = await rpc(v1, "claim_leg", { p_leg_id: leg!.id, p_idempotency_key: key() });
  if (claim.error) throw new Error(claim.error.message);
  const conf = await rpc(coord, "confirm_assignment", { p_assignment_id: claim.data });
  if (conf.error) throw new Error(conf.error.message);
  if (soon) {
    await admin.from("transport_legs").update({ window_start: hours(1), window_end: hours(5) }).eq("id", leg!.id);
  }
  return { requestId: id as string, legId: leg!.id as string, id: claim.data as string };
}

/** Confirmed and started. */
async function started() {
  const c = await confirmedLeg();
  const s = await rpc(v1, "start_leg", { p_assignment_id: c.id });
  if (s.error) throw new Error(s.error.message);
  return c;
}

/** Delivered. */
async function delivered() {
  const c = await started();
  for (const fn of ["confirm_pickup", "confirm_delivery"]) {
    const r = await rpc(v1, fn, { p_assignment_id: c.id, p_note: null });
    if (r.error) throw new Error(r.error.message);
  }
  return c;
}

const legStatus = async (id: string) =>
  (await admin.from("transport_legs").select("status").eq("id", id).single()).data!.status;
const reqStatus = async (id: string) =>
  (await admin.from("transport_requests").select("status").eq("id", id).single()).data!.status;
const audits = async (action: string, entityId: string) =>
  (await admin.from("audit_logs").select("id").eq("action", action).eq("entity_id", entityId)).data!.length;

beforeAll(async () => {
  [coord, otherCoord, stranger] = await Promise.all(["pcoord", "pother", "pstranger"].map((l) => createTestUser(l)));
  [v1, v2] = await Promise.all(["pvol1", "pvol2"].map((l) => newVolunteer(l)));
  [orgId, otherOrgId] = await Promise.all([createTestOrg("prog A"), createTestOrg("prog B")]);
  await admin.from("organisations").update({ verification_status: "verified" }).in("id", [orgId, otherOrgId]);
  await member(orgId, coord.id, { is_coordinator: true });
  await member(otherOrgId, otherCoord.id, { is_coordinator: true });
  await member(orgId, v1.id, { is_volunteer: true });
  await member(orgId, v2.id, { is_volunteer: true });
  const { data } = await coord.client.rpc("list_suburbs" as any, { p_query: "" } as any);
  suburb = (data as any[]).find((s) => s.name === "St Albans");
  origin = await loc(orgId, "Pound P", false, "pound", "1 Secret St");
  dest = await loc(orgId, "Vet P", true, "vet", "2 Hidden Rd");
});

afterAll(async () => {
  await cleanup();
});

describe("start_leg", () => {
  it("refuses more than 3 hours before the window, then starts once the window is near", async () => {
    const c = await confirmedLeg(false);
    expect((await rpc(v1, "start_leg", { p_assignment_id: c.id })).error?.message).toMatch(/3 hours/);
    await admin.from("transport_legs").update({ window_start: hours(2), window_end: hours(6) }).eq("id", c.legId);
    expect((await rpc(v1, "start_leg", { p_assignment_id: c.id })).error).toBeNull();
    expect(await legStatus(c.legId)).toBe("en_route");
    expect(await reqStatus(c.requestId)).toBe("en_route");
    expect(await audits("leg.start", c.legId)).toBe(1);
    // second start refused
    expect((await rpc(v1, "start_leg", { p_assignment_id: c.id })).error).not.toBeNull();
  });

  it("refuses anyone but the assigned volunteer", async () => {
    const c = await confirmedLeg();
    for (const u of [v2, coord, stranger]) {
      expect((await rpc(u, "start_leg", { p_assignment_id: c.id })).error).not.toBeNull();
    }
    expect(await legStatus(c.legId)).toBe("confirmed");
  });

  it("refuses a suspended volunteer", async () => {
    const c = await confirmedLeg();
    await admin.from("profiles").update({ account_status: "suspended" }).eq("id", v1.id);
    const r = await rpc(v1, "start_leg", { p_assignment_id: c.id });
    await admin.from("profiles").update({ account_status: "active" }).eq("id", v1.id);
    expect(r.error).not.toBeNull();
    expect(await legStatus(c.legId)).toBe("confirmed");
  });
});

describe("pickup and delivery", () => {
  it("enforces order: pickup needs start, delivery needs pickup", async () => {
    const c = await confirmedLeg();
    expect((await rpc(v1, "confirm_pickup", { p_assignment_id: c.id, p_note: null })).error?.message).toMatch(/Start the trip/);
    await rpc(v1, "start_leg", { p_assignment_id: c.id });
    expect((await rpc(v1, "confirm_delivery", { p_assignment_id: c.id, p_note: null })).error?.message).toMatch(/pickup/);
    expect((await rpc(v2, "confirm_pickup", { p_assignment_id: c.id, p_note: null })).error).not.toBeNull();
    expect((await rpc(v1, "confirm_pickup", { p_assignment_id: c.id, p_note: "Collected at gate" })).error).toBeNull();
    expect(await legStatus(c.legId)).toBe("collected");
    expect(await reqStatus(c.requestId)).toBe("collected");
    expect((await rpc(v1, "confirm_pickup", { p_assignment_id: c.id, p_note: null })).error).not.toBeNull();
  });

  it("delivery completes the assignment, records the giver confirmation and audits", async () => {
    const c = await delivered();
    expect(await legStatus(c.legId)).toBe("delivered");
    expect(await reqStatus(c.requestId)).toBe("delivered");
    const a = (await admin.from("transport_assignments").select("status,end_reason").eq("id", c.id).single()).data!;
    expect(a.status).toBe("completed");
    const h = (await admin.from("handover_confirmations").select("role,confirmed_by,outcome").eq("leg_id", c.legId)).data!;
    expect(h).toEqual([{ role: "giver", confirmed_by: v1.id, outcome: "ok" }]);
    expect(await audits("leg.pickup", c.legId)).toBe(1);
    expect(await audits("leg.delivery", c.legId)).toBe(1);
    expect((await rpc(v1, "confirm_delivery", { p_assignment_id: c.id, p_note: null })).error).not.toBeNull();
  });
});

describe("get_leg_private_details", () => {
  it("is available to the confirmed assignee through collection, to nobody else", async () => {
    const c = await confirmedLeg();
    const ok = await rpc(v1, "get_leg_private_details", { p_leg_id: c.legId });
    expect(ok.error).toBeNull();
    expect(ok.data.pickup.address).toBe("1 Secret St");
    expect(ok.data.dropoff.contact_phone).toBe("0400 000 000");
    expect(ok.data.medical_notes).toBe("Takes tablets at 6pm");
    for (const u of [v2, stranger, otherCoord]) {
      expect((await rpc(u, "get_leg_private_details", { p_leg_id: c.legId })).error).not.toBeNull();
    }
    await rpc(v1, "start_leg", { p_assignment_id: c.id });
    await rpc(v1, "confirm_pickup", { p_assignment_id: c.id, p_note: null });
    // drop-off address is still needed after collection
    expect((await rpc(v1, "get_leg_private_details", { p_leg_id: c.legId })).error).toBeNull();
    await rpc(v1, "confirm_delivery", { p_assignment_id: c.id, p_note: null });
    expect((await rpc(v1, "get_leg_private_details", { p_leg_id: c.legId })).error).not.toBeNull();
  });

  it("is refused to a reserved or offered volunteer and anon", async () => {
    const startH = 300 + slot++;
    const { data: id } = await rpc(coord, "create_request", {
      p_org_id: orgId, p_animal_name: "Pip", p_species: "cat", p_urgency: "routine", p_required_date: null,
      p_deadline: hours(startH + 20), p_handling: "Gentle", p_carrier: "Carrier", p_medical_notes: null,
      p_coordinator_instructions: null, p_origin_location_id: origin, p_destination_location_id: dest,
      p_window_start: hours(startH), p_window_end: hours(startH + 4),
    });
    await rpc(coord, "publish_request", { p_request_id: id, p_attest: true });
    const { data: leg } = await admin.from("transport_legs").select("id").eq("request_id", id).single();
    const claim = await rpc(v1, "claim_leg", { p_leg_id: leg!.id, p_idempotency_key: key() });
    expect(claim.error).toBeNull();
    expect((await rpc(v1, "get_leg_private_details", { p_leg_id: leg!.id })).error).not.toBeNull();
  });

  it("is revoked by withdraw, reassign and cancel", async () => {
    const w = await confirmedLeg();
    expect((await rpc(v1, "withdraw", { p_assignment_id: w.id, p_reason: "Car broke down" })).error).toBeNull();
    expect((await rpc(v1, "get_leg_private_details", { p_leg_id: w.legId })).error).not.toBeNull();

    const r = await confirmedLeg();
    expect((await rpc(coord, "reassign", { p_assignment_id: r.id, p_reason: "Needs a bigger car", p_new_volunteer_id: null })).error).toBeNull();
    expect((await rpc(v1, "get_leg_private_details", { p_leg_id: r.legId })).error).not.toBeNull();

    const x = await confirmedLeg();
    expect((await rpc(coord, "cancel_request", { p_request_id: x.requestId, p_reason: "Owner collected" })).error).toBeNull();
    expect((await rpc(v1, "get_leg_private_details", { p_leg_id: x.legId })).error).not.toBeNull();
  });

  it("is refused to a suspended volunteer", async () => {
    const c = await confirmedLeg();
    await admin.from("profiles").update({ account_status: "suspended" }).eq("id", v1.id);
    const r = await rpc(v1, "get_leg_private_details", { p_leg_id: c.legId });
    await admin.from("profiles").update({ account_status: "active" }).eq("id", v1.id);
    expect(r.error).not.toBeNull();
  });
});

describe("claim window rule", () => {
  it("allows a claim while the window is running, holds to its end, refuses after it ends", async () => {
    const startH = 400 + slot++;
    const make = async (name: string) => {
      const { data: id } = await rpc(coord, "create_request", {
        p_org_id: orgId, p_animal_name: name, p_species: "dog", p_urgency: "soon", p_required_date: null,
        p_deadline: hours(startH + 20), p_handling: "Calm", p_carrier: "Crate", p_medical_notes: null,
        p_coordinator_instructions: null, p_origin_location_id: origin, p_destination_location_id: dest,
        p_window_start: hours(startH), p_window_end: hours(startH + 4),
      });
      await rpc(coord, "publish_request", { p_request_id: id, p_attest: true });
      const { data: leg } = await admin.from("transport_legs").select("id").eq("request_id", id).single();
      return leg!.id as string;
    };
    const running = await make("Runner");
    await admin.from("transport_legs").update({ window_start: hours(-1), window_end: hours(6) }).eq("id", running);
    const ok = await rpc(v2, "claim_leg", { p_leg_id: running, p_idempotency_key: key() });
    expect(ok.error).toBeNull();
    const a = (await admin.from("transport_assignments").select("reserved_until").eq("id", ok.data).single()).data!;
    expect(new Date(a.reserved_until as string).getTime()).toBeGreaterThan(Date.now() + 3 * 3600_000);
    await rpc(v2, "release_assignment", { p_assignment_id: ok.data, p_reason: null });

    const over = await make("Over");
    await admin.from("transport_legs").update({ window_start: hours(-6), window_end: hours(-1) }).eq("id", over);
    expect((await rpc(v2, "claim_leg", { p_leg_id: over, p_idempotency_key: key() })).error?.message).toMatch(/window has passed/);
  });
});

describe("read functions", () => {
  it("list_my_assignments returns the caller's rows with no private fields", async () => {
    const c = await confirmedLeg();
    const mine = await rpc(v1, "list_my_assignments");
    expect(mine.error).toBeNull();
    const row = mine.data.find((x: any) => x.assignment_id === c.id);
    expect(row).toBeTruthy();
    const text = JSON.stringify(mine.data);
    for (const secret of ["Secret St", "Hidden Rd", "0400 000 000", "tablets", "Call on arrival"]) {
      expect(text).not.toContain(secret);
    }
    const theirs = await rpc(v2, "list_my_assignments");
    expect(theirs.data.find((x: any) => x.assignment_id === c.id)).toBeUndefined();
  });

  it("get_request_detail reports claim_block and hides non-visible requests", async () => {
    const c = await confirmedLeg();
    const asOwner = await rpc(v1, "get_request_detail", { p_request_id: c.requestId });
    expect(asOwner.data.my_assignment_id).toBe(c.id);
    expect(asOwner.data.claim_block).toMatch(/Someone else/);
    expect(JSON.stringify(asOwner.data)).not.toContain("Secret St");
    expect((await rpc(otherCoord, "get_request_detail", { p_request_id: c.requestId })).error).not.toBeNull();
    // a volunteer outside any assignment sees an assigned (non-open) request as not found
    expect((await rpc(v2, "get_request_detail", { p_request_id: c.requestId })).error).not.toBeNull();
  });

  it("list_org_assignments, list_org_incidents and list_org_audit are coordinator-only", async () => {
    const c = await confirmedLeg();
    const l = await rpc(coord, "list_org_assignments", { p_org_id: orgId });
    expect(l.error).toBeNull();
    const row = l.data.find((x: any) => x.request_id === c.requestId);
    expect(row.volunteer_name).toBe("Test pvol1");
    expect(row.assignment_status).toBe("confirmed");
    for (const fn of ["list_org_assignments", "list_org_incidents", "list_org_audit"]) {
      for (const u of [v1, stranger, otherCoord]) {
        expect((await rpc(u, fn, { p_org_id: orgId })).error).not.toBeNull();
      }
    }
    const a = await rpc(coord, "list_org_audit", { p_org_id: orgId, p_request_id: c.requestId });
    expect(a.error).toBeNull();
    expect(a.data.map((x: any) => x.action)).toEqual(expect.arrayContaining(["assignment.claim", "assignment.confirm"]));
  });
});

describe("incidents and completion", () => {
  it("assignee and coordinator can report; strangers and bad input cannot", async () => {
    const c = await started();
    const ok = await rpc(v1, "report_incident", { p_request_id: c.requestId, p_leg_id: c.legId, p_type: "delay", p_severity: "low", p_description: "Stuck in traffic" });
    expect(ok.error).toBeNull();
    expect(await audits("incident.report", ok.data)).toBe(1);
    const notified = await admin.from("notifications").select("id").eq("user_id", coord.id).eq("dedupe_key", `incident:${ok.data}`);
    expect(notified.data!.length).toBe(1);
    expect((await rpc(coord, "report_incident", { p_request_id: c.requestId, p_leg_id: null, p_type: "other", p_severity: "low", p_description: "Called the driver" })).error).toBeNull();
    for (const u of [v2, stranger, otherCoord]) {
      expect((await rpc(u, "report_incident", { p_request_id: c.requestId, p_leg_id: null, p_type: "delay", p_severity: "low", p_description: "Nope nope" })).error).not.toBeNull();
    }
    expect((await rpc(v1, "report_incident", { p_request_id: c.requestId, p_leg_id: null, p_type: "handover_dispute", p_severity: "low", p_description: "Not allowed type" })).error).not.toBeNull();
    expect((await rpc(v1, "report_incident", { p_request_id: c.requestId, p_leg_id: null, p_type: "delay", p_severity: "low", p_description: "x" })).error).not.toBeNull();
  });

  it("only a coordinator of the owning org resolves incidents", async () => {
    const c = await started();
    const inc = await rpc(v1, "report_incident", { p_request_id: c.requestId, p_leg_id: c.legId, p_type: "vehicle", p_severity: "low", p_description: "Flat tyre fixed" });
    for (const u of [v1, otherCoord, stranger]) {
      expect((await rpc(u, "resolve_incident", { p_incident_id: inc.data, p_resolution: "Handled it" })).error).not.toBeNull();
    }
    expect((await rpc(coord, "resolve_incident", { p_incident_id: inc.data, p_resolution: "Handled it" })).error).toBeNull();
    expect((await rpc(coord, "resolve_incident", { p_incident_id: inc.data, p_resolution: "Handled it" })).error).not.toBeNull();
  });

  it("complete_request needs delivered, a coordinator and no open high-severity incident", async () => {
    const early = await started();
    expect((await rpc(coord, "complete_request", { p_request_id: early.requestId, p_note: null })).error?.message).toMatch(/delivered/);

    const c = await delivered();
    const inc = await rpc(v1, "report_incident", { p_request_id: c.requestId, p_leg_id: c.legId, p_type: "animal_welfare", p_severity: "high", p_description: "Animal seemed unwell" });
    expect(inc.error).toBeNull();
    for (const u of [v1, otherCoord, stranger]) {
      expect((await rpc(u, "complete_request", { p_request_id: c.requestId, p_note: null })).error).not.toBeNull();
    }
    expect((await rpc(coord, "complete_request", { p_request_id: c.requestId, p_note: null })).error?.message).toMatch(/high-severity/);
    await rpc(coord, "resolve_incident", { p_incident_id: inc.data, p_resolution: "Vet checked, all fine" });
    expect((await rpc(coord, "complete_request", { p_request_id: c.requestId, p_note: "Received" })).error).toBeNull();
    expect(await reqStatus(c.requestId)).toBe("completed");
    const h = (await admin.from("handover_confirmations").select("role,on_behalf_of").eq("leg_id", c.legId).eq("role", "receiver")).data!;
    expect(h).toEqual([{ role: "receiver", on_behalf_of: coord.id }]);
    expect(await audits("request.complete", c.requestId)).toBe(1);
    expect((await rpc(coord, "complete_request", { p_request_id: c.requestId, p_note: null })).error).not.toBeNull();
    // completed request appears on the dashboard
    const l = await rpc(coord, "list_org_assignments", { p_org_id: orgId });
    expect(l.data.find((x: any) => x.request_id === c.requestId)?.request_status).toBe("completed");
  });
});

describe("direct access", () => {
  it("anon cannot call the new functions", async () => {
    const { anonClient } = await import("./helpers");
    const anon = anonClient();
    const call = (fn: string, a: Record<string, unknown>) =>
      (anon.rpc as unknown as (f: string, a?: Record<string, unknown>) => Promise<{ error: unknown }>).call(anon, fn, a);
    for (const [fn, args] of [
      ["start_leg", { p_assignment_id: randomUUID() }],
      ["get_leg_private_details", { p_leg_id: randomUUID() }],
      ["list_my_assignments", {}],
      ["list_org_audit", { p_org_id: orgId }],
    ] as const) {
      expect((await call(fn, args as Record<string, unknown>)).error).not.toBeNull();
    }
  });
});
