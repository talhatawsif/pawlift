/* eslint-disable @typescript-eslint/no-explicit-any */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, cleanup, createTestOrg, createTestUser, type TestUser } from "./helpers";

let coord: TestUser;
let otherCoord: TestUser;
let vol: TestUser;
let foster: TestUser;
let fosterNoRight: TestUser;
let orgId: string;
let otherOrgId: string;
let origin: string;
let dest: string;
let fosterHome: string;
let fosterHome2: string;
let suburb: any;

type R = { data: any; error: { code: string; message: string } | null };
const rpc = (u: TestUser, fn: string, a?: Record<string, unknown>) =>
  (u.client.rpc as unknown as (f: string, a?: Record<string, unknown>) => Promise<R>)(fn, a);
const hours = (h: number) => new Date(Date.now() + h * 3600_000).toISOString();

async function member(org: string, userId: string, extra: Record<string, unknown>) {
  const { error } = await admin.from("organisation_members").insert({ org_id: org, user_id: userId, status: "active", ...extra });
  if (error) throw new Error(error.message);
}

async function loc(org: string, label: string, kind: string, linked?: string) {
  const { data, error } = await admin.from("locations").insert({
    org_id: org, kind, label_public: label, suburb_id: suburb.id, linked_user_id: linked ?? null,
    approx_point: "SRID=4326;POINT(144.8 -37.7)", is_confirmed_destination: kind !== "pound", is_demo: true,
  } as any).select("id").single();
  if (error) throw new Error(error.message);
  return data.id as string;
}

let slot = 0;
async function newRequest(destination = dest) {
  const startH = 100 + 6 * slot++;
  const { data, error } = await rpc(coord, "create_request", {
    p_org_id: orgId, p_animal_name: "Solo", p_species: "dog", p_urgency: "soon", p_required_date: null,
    p_deadline: hours(startH + 20), p_handling: "Calm", p_carrier: "Crate", p_medical_notes: null,
    p_coordinator_instructions: null, p_origin_location_id: origin, p_destination_location_id: destination,
    p_window_start: hours(startH), p_window_end: hours(startH + 4),
  });
  if (error) throw new Error(error.message);
  return data as string;
}

/** Published, claimed, confirmed, driven to delivered. */
async function delivered(destination = dest) {
  const id = await newRequest(destination);
  const pub = await rpc(coord, "publish_request", { p_request_id: id, p_attest: true });
  if (pub.error) throw new Error(pub.error.message);
  const { data: leg } = await admin.from("transport_legs").select("id").eq("request_id", id).single();
  const claim = await rpc(vol, "claim_leg", { p_leg_id: leg!.id, p_idempotency_key: `k-${randomUUID()}` });
  if (claim.error) throw new Error(claim.error.message);
  const conf = await rpc(coord, "confirm_assignment", { p_assignment_id: claim.data });
  if (conf.error) throw new Error(conf.error.message);
  await admin.from("transport_legs").update({ window_start: hours(1), window_end: hours(5) }).eq("id", leg!.id);
  for (const fn of ["start_leg", "confirm_pickup", "confirm_delivery"]) {
    const r = await rpc(vol, fn, fn === "start_leg" ? { p_assignment_id: claim.data } : { p_assignment_id: claim.data, p_note: null });
    if (r.error) throw new Error(`${fn}: ${r.error.message}`);
  }
  return { requestId: id, legId: leg!.id as string };
}

const receivers = async (legId: string) =>
  ((await admin.from("handover_confirmations").select("*").eq("leg_id", legId).eq("role", "receiver")).data ?? []) as any[];
const audits = async (action: string, entityId: string) =>
  (await admin.from("audit_logs").select("id").eq("action", action).eq("entity_id", entityId)).data!.length;

beforeAll(async () => {
  [coord, otherCoord, vol, foster, fosterNoRight] = await Promise.all(
    ["scoord", "sother", "svol", "sfoster", "sfoster2"].map((l) => createTestUser(l)));
  await admin.from("profiles").update({ is_demo: true } as any).eq("id", vol.id);
  const vp = await admin.from("volunteer_profiles").insert({
    user_id: vol.id, species_ok: ["dog", "cat"], has_carrier: true, guidelines_version_accepted: "v1",
    verification_status: "verified", is_demo: true,
  } as any);
  if (vp.error) throw new Error(vp.error.message);
  [orgId, otherOrgId] = await Promise.all([createTestOrg("single A"), createTestOrg("single B")]);
  await admin.from("organisations").update({ verification_status: "verified" }).in("id", [orgId, otherOrgId]);
  await member(orgId, coord.id, { is_coordinator: true });
  await member(otherOrgId, otherCoord.id, { is_coordinator: true });
  await member(orgId, vol.id, { is_volunteer: true });
  const approved = { is_foster_carer: true, foster_approved_by: coord.id, foster_approved_at: new Date().toISOString() };
  await member(orgId, foster.id, { ...approved, foster_can_confirm_receipt: true });
  await member(orgId, fosterNoRight.id, { ...approved, foster_can_confirm_receipt: false });
  const { data } = await coord.client.rpc("list_suburbs" as any, { p_query: "" } as any);
  suburb = (data as any[]).find((s) => s.name === "St Albans");
  origin = await loc(orgId, "Pound S", "pound");
  dest = await loc(orgId, "Vet S", "vet");
  fosterHome = await loc(orgId, "Foster home", "foster_home", foster.id);
  fosterHome2 = await loc(orgId, "Foster home 2", "foster_home", fosterNoRight.id);
}, 90_000);

afterAll(cleanup, 60_000);

describe("one leg per request (D37)", () => {
  it("create_request makes exactly one leg with seq 1", async () => {
    const id = await newRequest();
    const { data } = await admin.from("transport_legs").select("seq").eq("request_id", id);
    expect(data).toEqual([{ seq: 1 }]);
  });

  it("the database refuses a second leg, with any seq", async () => {
    const id = await newRequest();
    const base = { request_id: id, from_location_id: origin, to_location_id: dest, window_start: hours(300), window_end: hours(304) };
    const dupSeq = await admin.from("transport_legs").insert({ ...base, seq: 1 } as any);
    expect(dupSeq.error?.code).toBe("23505");
    const secondSeq = await admin.from("transport_legs").insert({ ...base, seq: 2 } as any);
    expect(secondSeq.error).not.toBeNull();
    const { data } = await admin.from("transport_legs").select("seq").eq("request_id", id);
    expect(data).toHaveLength(1);
  });

  it("a signed-in user cannot insert legs directly or call the removed relay functions", async () => {
    const id = await newRequest();
    const ins = await coord.client.from("transport_legs").insert({
      request_id: id, seq: 2, from_location_id: origin, to_location_id: dest, window_start: hours(300), window_end: hours(304),
    } as any);
    expect(ins.error).not.toBeNull();
    for (const fn of ["split_leg", "merge_legs", "update_leg", "list_request_legs", "dispute_handover"]) {
      const r = await rpc(coord, fn, { p_request_id: id });
      expect(r.error).not.toBeNull();
    }
  });

  it("handover_point is not an accepted location kind", async () => {
    const { error } = await admin.from("locations").insert({
      org_id: orgId, kind: "handover_point", label_public: "Servo", suburb_id: suburb.id,
      approx_point: "SRID=4326;POINT(144.8 -37.7)", is_demo: true,
    } as any);
    expect(error).not.toBeNull();
  });
});

describe("final-destination receipt", () => {
  it("is refused before delivery", async () => {
    const id = await newRequest();
    const r = await rpc(coord, "confirm_receipt", { p_request_id: id, p_note: null });
    expect(r.error?.message).toMatch(/not been delivered/);
  });

  it("the owning coordinator confirms on their behalf, once, and completion keeps that row", async () => {
    const t = await delivered();
    const denied = await rpc(otherCoord, "confirm_receipt", { p_request_id: t.requestId, p_note: null });
    expect(denied.error?.code).toBe("42501");
    const volDenied = await rpc(vol, "confirm_receipt", { p_request_id: t.requestId, p_note: null });
    expect(volDenied.error?.code).toBe("42501");
    expect((await rpc(coord, "confirm_receipt", { p_request_id: t.requestId, p_note: "Safe" })).error).toBeNull();
    const rows = await receivers(t.legId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ confirmed_by: coord.id, on_behalf_of: coord.id, outcome: "ok" });
    expect(await audits("receipt.confirm", t.requestId)).toBe(1);
    expect((await rpc(coord, "confirm_receipt", { p_request_id: t.requestId, p_note: null })).error?.message).toMatch(/already/);
    expect((await rpc(coord, "complete_request", { p_request_id: t.requestId, p_note: null })).error).toBeNull();
    expect(await receivers(t.legId)).toHaveLength(1);
  }, 60_000);

  it("an approved foster carer with the receipt right at the destination can confirm", async () => {
    const t = await delivered(fosterHome);
    expect((await rpc(fosterNoRight, "confirm_receipt", { p_request_id: t.requestId, p_note: null })).error?.code).toBe("42501");
    expect((await rpc(foster, "confirm_receipt", { p_request_id: t.requestId, p_note: "Settled in" })).error).toBeNull();
    const rows = await receivers(t.legId);
    expect(rows[0]).toMatchObject({ confirmed_by: foster.id, on_behalf_of: null, outcome: "ok" });
  }, 60_000);

  it("a foster carer linked to a different home cannot confirm", async () => {
    const t = await delivered(fosterHome2);
    expect((await rpc(foster, "confirm_receipt", { p_request_id: t.requestId, p_note: null })).error?.code).toBe("42501");
  }, 60_000);
});
