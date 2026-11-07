/* eslint-disable @typescript-eslint/no-explicit-any */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, cleanup, createTestOrg, createTestUser, type TestUser } from "./helpers";

let coord: TestUser;
let otherCoord: TestUser;
let v1: TestUser;
let v2: TestUser;
let foster: TestUser;
let fosterNoRight: TestUser;
let orgId: string;
let otherOrgId: string;
let origin: string;
let dest: string;
let hand: string;
let fosterHome: string;
let fosterHome2: string;
let suburb: any;

type R = { data: any; error: { code: string; message: string } | null };
const rpc = (u: TestUser, fn: string, a?: Record<string, unknown>) =>
  (u.client.rpc as unknown as (f: string, a?: Record<string, unknown>) => Promise<R>)(fn, a);

const hours = (h: number) => new Date(Date.now() + h * 3600_000).toISOString();
const key = () => `key-${randomUUID()}`;

async function member(org: string, userId: string, extra: Record<string, unknown>) {
  const { error } = await admin.from("organisation_members")
    .insert({ org_id: org, user_id: userId, status: "active", ...extra });
  if (error) throw new Error(error.message);
}

async function loc(org: string, label: string, confirmed: boolean, kind: string, linked?: string) {
  const { data: l, error } = await admin.from("locations").insert({
    org_id: org, kind, label_public: label, suburb_id: suburb.id, linked_user_id: linked ?? null,
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

let slot = 0;
/** Two-leg relay (origin -> hand -> destination), both legs claimed and confirmed, windows moved to start soon. */
async function relay(destination = dest) {
  const startH = 200 + 12 * slot++;
  const { data: id, error } = await rpc(coord, "create_request", {
    p_org_id: orgId, p_animal_name: "Relay", p_species: "dog", p_urgency: "soon",
    p_required_date: null, p_deadline: hours(startH + 30), p_handling: "Calm", p_carrier: "Crate",
    p_medical_notes: null, p_coordinator_instructions: null, p_origin_location_id: origin,
    p_destination_location_id: destination, p_window_start: hours(startH), p_window_end: hours(startH + 10),
  });
  if (error) throw new Error(error.message);
  const ver = (await admin.from("transport_requests").select("version").eq("id", id).single()).data!.version;
  const sp = await rpc(coord, "split_leg", {
    p_request_id: id, p_expected_version: ver, p_seq: 1, p_handover_location_id: hand,
    p_first_end: hours(startH + 6), p_second_start: hours(startH + 5),
  });
  if (sp.error) throw new Error(sp.error.message);
  const pub = await rpc(coord, "publish_request", { p_request_id: id, p_attest: true });
  if (pub.error) throw new Error(pub.error.message);
  const { data: legs } = await admin.from("transport_legs").select("id, seq").eq("request_id", id).order("seq");
  const ids: string[] = [];
  for (const [i, who] of [v1, v2].entries()) {
    const claim = await rpc(who, "claim_leg", { p_leg_id: legs![i].id, p_idempotency_key: key() });
    if (claim.error) throw new Error(claim.error.message);
    const conf = await rpc(coord, "confirm_assignment", { p_assignment_id: claim.data });
    if (conf.error) throw new Error(conf.error.message);
    ids.push(claim.data);
  }
  await admin.from("transport_legs").update({ window_start: hours(1), window_end: hours(5) }).eq("id", legs![0].id);
  await admin.from("transport_legs").update({ window_start: hours(2), window_end: hours(9) }).eq("id", legs![1].id);
  return { requestId: id as string, leg1: legs![0].id as string, leg2: legs![1].id as string, a1: ids[0], a2: ids[1] };
}

const must = async (p: Promise<R>) => {
  const r = await p;
  if (r.error) throw new Error(r.error.message);
  return r;
};

/** Leg 1 fully delivered, leg 2 started (en route to the handover). */
async function leg1Delivered(destination = dest) {
  const t = await relay(destination);
  await must(rpc(v1, "start_leg", { p_assignment_id: t.a1 }));
  await must(rpc(v1, "confirm_pickup", { p_assignment_id: t.a1, p_note: null }));
  await must(rpc(v1, "confirm_delivery", { p_assignment_id: t.a1, p_note: null }));
  await must(rpc(v2, "start_leg", { p_assignment_id: t.a2 }));
  return t;
}

/** Whole relay delivered. */
async function allDelivered(destination = dest) {
  const t = await leg1Delivered(destination);
  await must(rpc(v2, "confirm_pickup", { p_assignment_id: t.a2, p_note: null }));
  await must(rpc(v2, "confirm_delivery", { p_assignment_id: t.a2, p_note: null }));
  return t;
}

const reqStatus = async (id: string) =>
  (await admin.from("transport_requests").select("status").eq("id", id).single()).data!.status;
const handovers = async (legId: string) =>
  ((await admin.from("handover_confirmations").select("*").eq("leg_id", legId)).data ?? []) as any[];
const audits = async (action: string, entityId: string) =>
  (await admin.from("audit_logs").select("id").eq("action", action).eq("entity_id", entityId)).data!.length;
const openDisputes = async (requestId: string) =>
  ((await admin.from("incidents").select("*").eq("request_id", requestId).eq("type", "handover_dispute").neq("status", "resolved")).data ?? []) as any[];

beforeAll(async () => {
  [coord, otherCoord, foster, fosterNoRight] = await Promise.all(["hcoord", "hother", "hfoster", "hfoster2"].map((l) => createTestUser(l)));
  [v1, v2] = await Promise.all(["hvol1", "hvol2"].map((l) => newVolunteer(l)));
  [orgId, otherOrgId] = await Promise.all([createTestOrg("hand A"), createTestOrg("hand B")]);
  await admin.from("organisations").update({ verification_status: "verified" }).in("id", [orgId, otherOrgId]);
  await member(orgId, coord.id, { is_coordinator: true });
  await member(otherOrgId, otherCoord.id, { is_coordinator: true });
  await member(orgId, v1.id, { is_volunteer: true });
  await member(orgId, v2.id, { is_volunteer: true });
  const approved = { is_foster_carer: true, foster_approved_by: coord.id, foster_approved_at: new Date().toISOString() };
  await member(orgId, foster.id, { ...approved, foster_can_confirm_receipt: true });
  await member(orgId, fosterNoRight.id, { ...approved, foster_can_confirm_receipt: false });
  const { data } = await coord.client.rpc("list_suburbs" as any, { p_query: "" } as any);
  suburb = (data as any[]).find((s) => s.name === "St Albans");
  origin = await loc(orgId, "Pound H", false, "pound");
  dest = await loc(orgId, "Vet H", true, "vet");
  hand = await loc(orgId, "Servo H", false, "handover_point");
  fosterHome = await loc(orgId, "Foster home", true, "foster_home", foster.id);
  fosterHome2 = await loc(orgId, "Foster home 2", true, "foster_home", fosterNoRight.id);
}, 90_000);

afterAll(cleanup, 60_000);

describe("two-driver handover", () => {
  it("runs a relay end to end and records both sides of the handover", async () => {
    const t = await relay();
    await must(rpc(v1, "start_leg", { p_assignment_id: t.a1 }));
    expect(await reqStatus(t.requestId)).toBe("en_route");
    await must(rpc(v1, "confirm_pickup", { p_assignment_id: t.a1, p_note: null }));
    expect(await reqStatus(t.requestId)).toBe("collected");
    await must(rpc(v2, "start_leg", { p_assignment_id: t.a2 }));
    expect(await reqStatus(t.requestId)).toBe("collected");

    // Receiver cannot collect before the giver has delivered.
    const early = await rpc(v2, "confirm_pickup", { p_assignment_id: t.a2, p_note: null });
    expect(early.error?.message).toMatch(/previous driver/);

    await must(rpc(v1, "confirm_delivery", { p_assignment_id: t.a1, p_note: "Left with driver 2" }));
    expect(await reqStatus(t.requestId)).toBe("collected");
    expect((await handovers(t.leg1)).map((h) => h.role)).toEqual(["giver"]);

    await must(rpc(v2, "confirm_pickup", { p_assignment_id: t.a2, p_note: "Got him" }));
    const rows = await handovers(t.leg1);
    expect(rows.map((h) => h.role).sort()).toEqual(["giver", "receiver"]);
    const recv = rows.find((h) => h.role === "receiver");
    expect(recv.confirmed_by).toBe(v2.id);
    expect(recv.outcome).toBe("ok");
    expect(await audits("handover.receive", t.leg1)).toBe(1);

    await must(rpc(v2, "confirm_delivery", { p_assignment_id: t.a2, p_note: null }));
    expect(await reqStatus(t.requestId)).toBe("delivered");

    await must(rpc(coord, "complete_request", { p_request_id: t.requestId, p_note: null }));
    expect(await reqStatus(t.requestId)).toBe("completed");
    expect((await handovers(t.leg2)).map((h) => h.role).sort()).toEqual(["giver", "receiver"]);
  }, 60_000);

  it("only the assigned volunteer can act on a leg", async () => {
    const t = await relay();
    const r = await rpc(v2, "start_leg", { p_assignment_id: t.a1 });
    expect(r.error?.code).toBe("42501");
    const d = await rpc(v1, "dispute_handover", { p_assignment_id: t.a1, p_description: "nope" });
    expect(d.error).not.toBeNull();
  }, 60_000);
});

describe("dispute", () => {
  it("opens a high-severity incident and blocks the next leg until resolved", async () => {
    const t = await leg1Delivered();
    const short = await rpc(v2, "dispute_handover", { p_assignment_id: t.a2, p_description: "x" });
    expect(short.error?.code).toBe("22023");

    const { data: inc, error } = await rpc(v2, "dispute_handover", { p_assignment_id: t.a2, p_description: "Dog is limping" });
    expect(error).toBeNull();
    const disputes = await openDisputes(t.requestId);
    expect(disputes).toHaveLength(1);
    expect(disputes[0].id).toBe(inc);
    expect(disputes[0].severity).toBe("high");
    expect(disputes[0].leg_id).toBe(t.leg1);
    expect((await handovers(t.leg1)).find((h) => h.role === "receiver").outcome).toBe("disputed");
    expect(await audits("handover.dispute", inc)).toBe(1);
    const { data: notes } = await admin.from("notifications").select("id").eq("user_id", coord.id).eq("type", "handover_disputed").eq("request_id", t.requestId);
    expect(notes).toHaveLength(1);

    const blocked = await rpc(v2, "confirm_pickup", { p_assignment_id: t.a2, p_note: null });
    expect(blocked.error?.message).toMatch(/reviewed by the coordinator/);
    const again = await rpc(v2, "dispute_handover", { p_assignment_id: t.a2, p_description: "Still limping" });
    expect(again.error?.message).toMatch(/reviewed by the coordinator/);

    const mine = await rpc(v2, "list_my_assignments");
    expect(mine.data.find((x: any) => x.assignment_id === t.a2).handover_blocked).toBe(true);

    // Other org's coordinator cannot resolve it.
    const denied = await rpc(otherCoord, "resolve_incident", { p_incident_id: inc, p_resolution: "Fine now" });
    expect(denied.error?.code).toBe("42501");

    await must(rpc(coord, "resolve_incident", { p_incident_id: inc, p_resolution: "Vet checked, fit to travel" }));
    await must(rpc(v2, "confirm_pickup", { p_assignment_id: t.a2, p_note: "Checked by vet" }));
    expect((await handovers(t.leg1)).find((h) => h.role === "receiver").outcome).toBe("ok");
    expect(await openDisputes(t.requestId)).toHaveLength(0);
  }, 90_000);

  it("cannot be raised before the previous leg is delivered or on a first leg", async () => {
    const t = await relay();
    await must(rpc(v1, "start_leg", { p_assignment_id: t.a1 }));
    await must(rpc(v2, "start_leg", { p_assignment_id: t.a2 }));
    const first = await rpc(v1, "dispute_handover", { p_assignment_id: t.a1, p_description: "Something odd" });
    expect(first.error?.message).toMatch(/no earlier handover/);
    const early = await rpc(v2, "dispute_handover", { p_assignment_id: t.a2, p_description: "Something odd" });
    expect(early.error?.message).toMatch(/previous driver/);
  }, 60_000);

  it("blocks completion while a dispute is open", async () => {
    const t = await allDelivered();
    const { data: inc } = await rpc(coord, "report_incident", {
      p_request_id: t.requestId, p_leg_id: t.leg2, p_type: "other", p_severity: "high", p_description: "Concern",
    });
    const blocked = await rpc(coord, "complete_request", { p_request_id: t.requestId, p_note: null });
    expect(blocked.error?.message).toMatch(/high-severity/);
    await must(rpc(coord, "resolve_incident", { p_incident_id: inc, p_resolution: "Sorted" }));
    await must(rpc(coord, "complete_request", { p_request_id: t.requestId, p_note: null }));
  }, 90_000);
});

describe("final receipt", () => {
  it("coordinator confirms receipt on behalf; completion keeps that row", async () => {
    const t = await allDelivered();
    const wrong = await rpc(otherCoord, "confirm_receipt", { p_request_id: t.requestId, p_outcome: "ok", p_note: null });
    expect(wrong.error?.code).toBe("42501");
    const bad = await rpc(coord, "confirm_receipt", { p_request_id: t.requestId, p_outcome: "maybe", p_note: null });
    expect(bad.error?.code).toBe("22023");
    await must(rpc(coord, "confirm_receipt", { p_request_id: t.requestId, p_outcome: "ok", p_note: "Safe" }));
    const row = (await handovers(t.leg2)).find((h) => h.role === "receiver");
    expect(row.outcome).toBe("ok");
    expect(row.on_behalf_of).toBe(coord.id);
    expect(await audits("receipt.confirm", t.requestId)).toBe(1);
    await must(rpc(coord, "complete_request", { p_request_id: t.requestId, p_note: null }));
    expect((await handovers(t.leg2)).filter((h) => h.role === "receiver")).toHaveLength(1);
  }, 90_000);

  it("is refused before the request is delivered", async () => {
    const t = await leg1Delivered();
    const r = await rpc(coord, "confirm_receipt", { p_request_id: t.requestId, p_outcome: "ok", p_note: null });
    expect(r.error?.message).toMatch(/not been delivered/);
  }, 60_000);

  it("foster carer with the right at the destination can confirm; others cannot", async () => {
    const t = await allDelivered(fosterHome);
    const noRight = await rpc(fosterNoRight, "confirm_receipt", { p_request_id: t.requestId, p_outcome: "ok", p_note: null });
    expect(noRight.error?.code).toBe("42501");
    const volunteer = await rpc(v2, "confirm_receipt", { p_request_id: t.requestId, p_outcome: "ok", p_note: null });
    expect(volunteer.error?.code).toBe("42501");
    await must(rpc(foster, "confirm_receipt", { p_request_id: t.requestId, p_outcome: "ok", p_note: "Settled in" }));
    const row = (await handovers(t.leg2)).find((h) => h.role === "receiver");
    expect(row.confirmed_by).toBe(foster.id);
    expect(row.on_behalf_of).toBeNull();
  }, 90_000);

  it("a foster carer linked to a different home cannot confirm", async () => {
    const t = await allDelivered(fosterHome2);
    const wrongHome = await rpc(foster, "confirm_receipt", { p_request_id: t.requestId, p_outcome: "ok", p_note: null });
    expect(wrongHome.error?.code).toBe("42501");
  }, 90_000);

  it("a disputed receipt opens an incident, blocks completion, and can be re-confirmed after resolving", async () => {
    const t = await allDelivered();
    const needNote = await rpc(coord, "confirm_receipt", { p_request_id: t.requestId, p_outcome: "disputed", p_note: null });
    expect(needNote.error?.code).toBe("22023");
    await must(rpc(coord, "confirm_receipt", { p_request_id: t.requestId, p_outcome: "disputed", p_note: "Arrived injured" }));
    const disputes = await openDisputes(t.requestId);
    expect(disputes).toHaveLength(1);
    expect(disputes[0].leg_id).toBe(t.leg2);
    expect(await audits("receipt.dispute", disputes[0].id)).toBe(1);

    const complete = await rpc(coord, "complete_request", { p_request_id: t.requestId, p_note: null });
    expect(complete.error?.message).toMatch(/high-severity/);
    const reconfirm = await rpc(coord, "confirm_receipt", { p_request_id: t.requestId, p_outcome: "ok", p_note: null });
    expect(reconfirm.error?.message).toMatch(/Resolve the open handover problem/);

    await must(rpc(coord, "resolve_incident", { p_incident_id: disputes[0].id, p_resolution: "Vet saw him" }));
    const stillDisputed = await rpc(coord, "complete_request", { p_request_id: t.requestId, p_note: null });
    expect(stillDisputed.error?.message).toMatch(/arrived safely/);
    await must(rpc(coord, "confirm_receipt", { p_request_id: t.requestId, p_outcome: "ok", p_note: "Recovered" }));
    await must(rpc(coord, "complete_request", { p_request_id: t.requestId, p_note: null }));
    expect(await reqStatus(t.requestId)).toBe("completed");
  }, 90_000);
});

describe("relay reads", () => {
  it("list_my_assignments and list_org_assignments describe the relay", async () => {
    const t = await leg1Delivered();
    const mine = (await rpc(v2, "list_my_assignments")).data.find((x: any) => x.assignment_id === t.a2);
    expect(mine.seq).toBe(2);
    expect(Number(mine.leg_count)).toBe(2);
    expect(mine.previous_leg_status).toBe("delivered");
    expect(mine.handover_blocked).toBe(false);
    const org = (await rpc(coord, "list_org_assignments", { p_org_id: orgId })).data.filter((x: any) => x.request_id === t.requestId);
    expect(org.map((x: any) => [x.seq, x.is_last_leg])).toEqual([[1, false], [2, true]]);
  }, 60_000);

  it("get_request_detail shows the next open leg once the first is filled", async () => {
    const startH = 400 + 12 * slot++;
    const { data: id } = await rpc(coord, "create_request", {
      p_org_id: orgId, p_animal_name: "Detail", p_species: "dog", p_urgency: "soon",
      p_required_date: null, p_deadline: hours(startH + 30), p_handling: "Calm", p_carrier: "Crate",
      p_medical_notes: null, p_coordinator_instructions: null, p_origin_location_id: origin,
      p_destination_location_id: dest, p_window_start: hours(startH), p_window_end: hours(startH + 10),
    });
    const ver = (await admin.from("transport_requests").select("version").eq("id", id).single()).data!.version;
    await must(rpc(coord, "split_leg", {
      p_request_id: id, p_expected_version: ver, p_seq: 1, p_handover_location_id: hand,
      p_first_end: hours(startH + 6), p_second_start: hours(startH + 5),
    }));
    await must(rpc(coord, "publish_request", { p_request_id: id, p_attest: true }));
    const { data: legs } = await admin.from("transport_legs").select("id, seq").eq("request_id", id).order("seq");
    expect((await rpc(v2, "get_request_detail", { p_request_id: id })).data.leg_id).toBe(legs![0].id);
    const claim = await must(rpc(v1, "claim_leg", { p_leg_id: legs![0].id, p_idempotency_key: key() }));
    await must(rpc(coord, "confirm_assignment", { p_assignment_id: claim.data }));
    expect((await rpc(v2, "get_request_detail", { p_request_id: id })).data.leg_id).toBe(legs![1].id);
    // The volunteer holding leg 1 still sees their own leg.
    expect((await rpc(v1, "get_request_detail", { p_request_id: id })).data.leg_id).toBe(legs![0].id);
  }, 90_000);
});
