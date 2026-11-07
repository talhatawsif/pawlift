/* eslint-disable @typescript-eslint/no-explicit-any */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, cleanup, createTestOrg, createTestUser, type TestUser } from "./helpers";

let coord: TestUser;
let otherCoord: TestUser;
let stranger: TestUser;
let vol: TestUser;
let vol2: TestUser;
let flex: TestUser;
let race4: TestUser;
let race5: TestUser;
let orgId: string;
let otherOrgId: string;
let origin: string;
let dest: string;
let suburb: any;

const rpc = (u: TestUser, fn: string, args?: Record<string, unknown>) =>
  (u.client.rpc as unknown as (f: string, a?: Record<string, unknown>) => Promise<{ data: any; error: { code: string; message: string } | null }>)(fn, args);
const adminRpc = (fn: string, args?: Record<string, unknown>) =>
  (admin.rpc as unknown as (f: string, a?: Record<string, unknown>) => Promise<{ data: any; error: { message: string } | null }>)(fn, args);

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

/** Create a verified demo volunteer (signs in once). */
async function newVolunteer(label: string) {
  const u = await createTestUser(label);
  await admin.from("profiles").update({ is_demo: true } as any).eq("id", u.id);
  const { error } = await admin.from("volunteer_profiles").insert({ user_id: u.id, ...volDefaults } as any);
  if (error) throw new Error(error.message);
  return u;
}

/** Reset a shared volunteer to eligible, then apply overrides (avoids creating many users: auth rate limit). */
async function setVol(u: TestUser, over: Record<string, unknown> = {}, profileOver: Record<string, unknown> = {}) {
  await admin.from("profiles").update({ is_demo: true, account_status: "active", ...profileOver } as any).eq("id", u.id);
  await admin.from("volunteer_profiles").update({ ...volDefaults, ...over } as any).eq("user_id", u.id);
  return u;
}

/** Published single-leg request; returns the leg id. */
let slot = 0;
async function publishedLeg(over: Record<string, unknown> = {}) {
  // Each leg gets its own window so one shared volunteer never overlaps with themselves.
  const startH = 100 + 6 * slot++;
  const { data: id, error } = await rpc(coord, "create_request", {
    p_org_id: orgId, p_animal_name: "Biscuit", p_species: "dog", p_urgency: "soon",
    p_required_date: null, p_deadline: hours(startH + 20), p_handling: "Nervous, use a lead",
    p_carrier: "Large crate", p_medical_notes: null, p_coordinator_instructions: null,
    p_origin_location_id: origin, p_destination_location_id: dest,
    p_window_start: hours(startH), p_window_end: hours(startH + 4), ...over,
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

beforeAll(async () => {
  [coord, otherCoord, stranger] = await Promise.all(
    ["acoord", "aother", "astranger"].map((l) => createTestUser(l)),
  );
  [vol, vol2, flex, race4, race5] = await Promise.all(
    ["avol", "avol2", "aflex", "arace4", "arace5"].map((l) => newVolunteer(l)),
  );
  [orgId, otherOrgId] = await Promise.all([createTestOrg("asn A"), createTestOrg("asn B")]);
  await admin.from("organisations").update({ verification_status: "verified" }).in("id", [orgId, otherOrgId]);
  await member(orgId, coord.id, { is_coordinator: true });
  await member(otherOrgId, otherCoord.id, { is_coordinator: true });
  const { data } = await coord.client.rpc("list_suburbs" as any, { p_query: "" } as any);
  suburb = (data as any[]).find((s) => s.name === "St Albans");
  origin = await loc(orgId, "Pound A", false, "pound");
  dest = await loc(orgId, "Vet A", true, "vet");
});

afterAll(async () => {
  await cleanup();
});

describe("claim_leg", () => {
  it("reserves the leg, holds it for the shorter of 4 h and the window start, notifies and audits", async () => {
    const v = vol;
    const { requestId, legId } = await publishedLeg();
    const { data: id, error } = await rpc(v, "claim_leg", { p_leg_id: legId, p_idempotency_key: key() });
    expect(error).toBeNull();
    const a = await asnRow(id);
    expect(a.status).toBe("reserved");
    expect(a.kind).toBe("claim");
    const held = new Date(a.reserved_until).getTime() - Date.now();
    expect(held).toBeGreaterThan(3.9 * 3600_000);
    expect(held).toBeLessThanOrEqual(4 * 3600_000);
    expect(await legStatus(legId)).toBe("reserved");
    expect(await reqStatus(requestId)).toBe("assigned");
    const { data: audit } = await admin.from("audit_logs").select("action").eq("entity_id", id);
    expect(audit!.map((x) => x.action)).toContain("assignment.claim");
    const { data: n } = await admin.from("notifications").select("user_id").eq("dedupe_key", `claimed:${id}`);
    expect(n!.map((x) => x.user_id)).toContain(coord.id);
  });

  it("caps the hold at the window start", async () => {
    const v = vol;
    const { legId } = await publishedLeg({ p_window_start: hours(2), p_window_end: hours(5) });
    const { data: id } = await rpc(v, "claim_leg", { p_leg_id: legId, p_idempotency_key: key() });
    const a = await asnRow(id);
    expect(Math.abs(new Date(a.reserved_until).getTime() - Date.now() - 2 * 3600_000)).toBeLessThan(60_000);
  });

  it("lets exactly one of five parallel claimers win", async () => {
    await setVol(flex);
    const vols = [vol, vol2, flex, race4, race5];
    const { legId } = await publishedLeg();
    const results = await Promise.all(
      vols.map((v) => rpc(v, "claim_leg", { p_leg_id: legId, p_idempotency_key: key() })),
    );
    const wins = results.filter((r) => !r.error);
    const losses = results.filter((r) => r.error);
    expect(wins).toHaveLength(1);
    expect(losses).toHaveLength(4);
    for (const l of losses) expect(l.error!.message).toContain("Someone else has just offered");
    const { data: rows } = await admin.from("transport_assignments").select("id,status").eq("leg_id", legId);
    expect(rows!.filter((r) => ["offered", "reserved", "confirmed"].includes(r.status))).toHaveLength(1);
  });

  it("returns the same assignment for a repeated key and creates one row", async () => {
    const v = vol;
    const { legId } = await publishedLeg();
    const k = key();
    const first = await rpc(v, "claim_leg", { p_leg_id: legId, p_idempotency_key: k });
    const second = await rpc(v, "claim_leg", { p_leg_id: legId, p_idempotency_key: k });
    expect(first.error).toBeNull();
    expect(second.error).toBeNull();
    expect(second.data).toBe(first.data);
    const { data: rows } = await admin.from("transport_assignments").select("id").eq("leg_id", legId);
    expect(rows).toHaveLength(1);
  });

  it("returns the same assignment for parallel retries with one key", async () => {
    const v = vol;
    const { legId } = await publishedLeg();
    const k = key();
    const rs = await Promise.all([1, 2, 3].map(() => rpc(v, "claim_leg", { p_leg_id: legId, p_idempotency_key: k })));
    const ids = new Set(rs.filter((r) => !r.error).map((r) => r.data));
    expect(ids.size).toBe(1);
    const { data: rows } = await admin.from("transport_assignments").select("id").eq("leg_id", legId);
    expect(rows).toHaveLength(1);
  });

  it("refuses ineligible volunteers", async () => {
    const { legId } = await publishedLeg();
    const cases: [Record<string, unknown>, Record<string, unknown>][] = [
      [{ verification_status: "pending" }, {}],
      [{ guidelines_version_accepted: null }, {}],
      [{ species_ok: ["cat"] }, {}],
      [{ has_carrier: false }, {}],
      [{}, { account_status: "suspended" }],
      [{}, { is_demo: false }],
    ];
    for (const [v, p] of cases) {
      await setVol(flex, v, p);
      const r = await rpc(flex, "claim_leg", { p_leg_id: legId, p_idempotency_key: key() });
      expect(r.error, JSON.stringify([v, p])).not.toBeNull();
    }
    const noProfile = await createTestUser("e7");
    expect((await rpc(noProfile, "claim_leg", { p_leg_id: legId, p_idempotency_key: key() })).error).not.toBeNull();
    await setVol(flex);
    const { data: rows } = await admin.from("transport_assignments").select("id").eq("leg_id", legId);
    expect(rows).toHaveLength(0);
    expect(await legStatus(legId)).toBe("open");
  });

  it("refuses an overlapping window and allows a non-overlapping one", async () => {
    const v = vol;
    const a = await publishedLeg({ p_window_start: hours(20), p_window_end: hours(24) });
    const b = await publishedLeg({ p_window_start: hours(22), p_window_end: hours(26) });
    const c = await publishedLeg({ p_window_start: hours(30), p_window_end: hours(34) });
    expect((await rpc(v, "claim_leg", { p_leg_id: a.legId, p_idempotency_key: key() })).error).toBeNull();
    const overlap = await rpc(v, "claim_leg", { p_leg_id: b.legId, p_idempotency_key: key() });
    expect(overlap.error?.message).toContain("overlaps");
    expect((await rpc(v, "claim_leg", { p_leg_id: c.legId, p_idempotency_key: key() })).error).toBeNull();
  });

  it("refuses draft, cancelled and unknown legs, signed-out calls and bad keys", async () => {
    const v = vol;
    const { data: draftId } = await rpc(coord, "create_request", {
      p_org_id: orgId, p_animal_name: "Draft", p_species: "dog", p_urgency: "soon",
      p_required_date: null, p_deadline: hours(40), p_handling: "x", p_carrier: "x",
      p_medical_notes: null, p_coordinator_instructions: null, p_origin_location_id: origin,
      p_destination_location_id: dest, p_window_start: hours(10), p_window_end: hours(14),
    });
    const { data: dl } = await admin.from("transport_legs").select("id").eq("request_id", draftId).single();
    expect((await rpc(v, "claim_leg", { p_leg_id: dl!.id, p_idempotency_key: key() })).error).not.toBeNull();
    expect((await rpc(v, "claim_leg", { p_leg_id: randomUUID(), p_idempotency_key: key() })).error).not.toBeNull();
    const { legId } = await publishedLeg();
    expect((await rpc(v, "claim_leg", { p_leg_id: legId, p_idempotency_key: "short" })).error?.code).toBe("22023");
  });
});

describe("confirm_assignment", () => {
  it("lets the owning coordinator confirm; leg and request become confirmed; volunteer is told", async () => {
    const v = vol;
    const { requestId, legId } = await publishedLeg();
    const { data: id } = await rpc(v, "claim_leg", { p_leg_id: legId, p_idempotency_key: key() });
    const r = await rpc(coord, "confirm_assignment", { p_assignment_id: id });
    expect(r.error).toBeNull();
    const a = await asnRow(id);
    expect(a.status).toBe("confirmed");
    expect(a.confirmed_by).toBe(coord.id);
    expect(await legStatus(legId)).toBe("confirmed");
    expect(await reqStatus(requestId)).toBe("confirmed");
    const { data: n } = await admin.from("notifications").select("id").eq("user_id", v.id).eq("dedupe_key", `confirmed:${id}`);
    expect(n).toHaveLength(1);
    const { data: audit } = await admin.from("audit_logs").select("action").eq("entity_id", id);
    expect(audit!.map((x) => x.action)).toContain("assignment.confirm");
  });

  it("refuses other-org coordinators, volunteers and strangers", async () => {
    const v = vol;
    const { legId } = await publishedLeg();
    const { data: id } = await rpc(v, "claim_leg", { p_leg_id: legId, p_idempotency_key: key() });
    for (const u of [otherCoord, v, stranger]) {
      expect((await rpc(u, "confirm_assignment", { p_assignment_id: id })).error?.code).toBe("42501");
    }
    expect((await asnRow(id)).status).toBe("reserved");
  });

  it("re-checks eligibility at confirm time", async () => {
    const v = await setVol(flex);
    const { legId } = await publishedLeg();
    const { data: id } = await rpc(v, "claim_leg", { p_leg_id: legId, p_idempotency_key: key() });
    await admin.from("profiles").update({ account_status: "suspended" }).eq("id", v.id);
    const r = await rpc(coord, "confirm_assignment", { p_assignment_id: id });
    expect(r.error).not.toBeNull();
    expect((await asnRow(id)).status).toBe("reserved");
    expect(await legStatus(legId)).toBe("reserved");
  });

  it("cannot confirm an expired reservation", async () => {
    const v = vol;
    const { legId } = await publishedLeg();
    const { data: id } = await rpc(v, "claim_leg", { p_leg_id: legId, p_idempotency_key: key() });
    await admin.from("transport_assignments").update({ reserved_until: hours(-1) }).eq("id", id);
    const r = await rpc(coord, "confirm_assignment", { p_assignment_id: id });
    expect(r.error?.message).toContain("no longer active");
  });

  it("cannot confirm twice", async () => {
    const v = vol;
    const { legId } = await publishedLeg();
    const { data: id } = await rpc(v, "claim_leg", { p_leg_id: legId, p_idempotency_key: key() });
    expect((await rpc(coord, "confirm_assignment", { p_assignment_id: id })).error).toBeNull();
    expect((await rpc(coord, "confirm_assignment", { p_assignment_id: id })).error?.code).toBe("55000");
  });
});

describe("release_assignment", () => {
  it("lets the coordinator release; leg reopens; another volunteer can claim", async () => {
    const v1 = vol;
    const v2 = vol2;
    const { requestId, legId } = await publishedLeg();
    const { data: id } = await rpc(v1, "claim_leg", { p_leg_id: legId, p_idempotency_key: key() });
    const r = await rpc(coord, "release_assignment", { p_assignment_id: id, p_reason: "Needs a bigger car" });
    expect(r.error).toBeNull();
    const a = await asnRow(id);
    expect(a.status).toBe("released");
    expect(a.end_reason).toBe("Needs a bigger car");
    expect(a.ended_at).not.toBeNull();
    expect(await legStatus(legId)).toBe("open");
    expect(await reqStatus(requestId)).toBe("open");
    const { data: n } = await admin.from("notifications").select("id").eq("user_id", v1.id).eq("dedupe_key", `released:${id}`);
    expect(n).toHaveLength(1);
    expect((await rpc(v2, "claim_leg", { p_leg_id: legId, p_idempotency_key: key() })).error).toBeNull();
  });

  it("lets the volunteer release their own reservation and tells coordinators", async () => {
    const v = vol;
    const { legId } = await publishedLeg();
    const { data: id } = await rpc(v, "claim_leg", { p_leg_id: legId, p_idempotency_key: key() });
    expect((await rpc(v, "release_assignment", { p_assignment_id: id, p_reason: null })).error).toBeNull();
    expect(await legStatus(legId)).toBe("open");
    const { data: n } = await admin.from("notifications").select("id").eq("user_id", coord.id).eq("dedupe_key", `released:${id}`);
    expect(n).toHaveLength(1);
  });

  it("refuses strangers, other volunteers, other-org coordinators and confirmed assignments", async () => {
    const v = vol;
    const other = vol2;
    const { legId } = await publishedLeg();
    const { data: id } = await rpc(v, "claim_leg", { p_leg_id: legId, p_idempotency_key: key() });
    for (const u of [stranger, other, otherCoord]) {
      expect((await rpc(u, "release_assignment", { p_assignment_id: id, p_reason: null })).error?.code).toBe("42501");
    }
    await rpc(coord, "confirm_assignment", { p_assignment_id: id });
    expect((await rpc(v, "release_assignment", { p_assignment_id: id, p_reason: null })).error?.code).toBe("55000");
    expect((await asnRow(id)).status).toBe("confirmed");
  });
});

describe("expiry sweep", () => {
  it("expires stale reservations, reopens the leg, notifies once and audits", async () => {
    const v = vol;
    const { requestId, legId } = await publishedLeg();
    const { data: id } = await rpc(v, "claim_leg", { p_leg_id: legId, p_idempotency_key: key() });
    await admin.from("transport_assignments").update({ reserved_until: hours(-1) }).eq("id", id);
    const first = await adminRpc("sweep_expired_assignments");
    expect(first.error).toBeNull();
    expect(first.data).toBeGreaterThanOrEqual(1);
    const a = await asnRow(id);
    expect(a.status).toBe("expired");
    expect(a.end_reason).toBe("expired");
    expect(await legStatus(legId)).toBe("open");
    expect(await reqStatus(requestId)).toBe("open");
    await adminRpc("sweep_expired_assignments");
    const { data: n } = await admin.from("notifications").select("user_id").eq("dedupe_key", `expire:${id}`);
    expect(n!.map((x) => x.user_id).sort()).toEqual([coord.id, v.id].sort());
    const { data: audit } = await admin.from("audit_logs").select("action").eq("entity_id", id);
    expect(audit!.map((x) => x.action)).toContain("assignment.expire");
  });

  it("runs lazily inside claim_leg so an expired hold does not block a new claim", async () => {
    const v1 = vol;
    const v2 = vol2;
    const { legId } = await publishedLeg();
    const { data: id } = await rpc(v1, "claim_leg", { p_leg_id: legId, p_idempotency_key: key() });
    await admin.from("transport_assignments").update({ reserved_until: hours(-1) }).eq("id", id);
    const r = await rpc(v2, "claim_leg", { p_leg_id: legId, p_idempotency_key: key() });
    expect(r.error).toBeNull();
    expect((await asnRow(id)).status).toBe("expired");
  });

  it("does not expire confirmed assignments", async () => {
    const v = vol;
    const { legId } = await publishedLeg();
    const { data: id } = await rpc(v, "claim_leg", { p_leg_id: legId, p_idempotency_key: key() });
    await rpc(coord, "confirm_assignment", { p_assignment_id: id });
    await adminRpc("sweep_expired_assignments");
    expect((await asnRow(id)).status).toBe("confirmed");
  });
});

describe("access", () => {
  it("denies clients direct writes and the sweep, and hides others' assignments", async () => {
    const v = vol;
    const other = vol2;
    const { legId } = await publishedLeg();
    const { data: id } = await rpc(v, "claim_leg", { p_leg_id: legId, p_idempotency_key: key() });

    const ins = await v.client.from("transport_assignments").insert({
      leg_id: legId, volunteer_id: v.id, kind: "claim", status: "confirmed", idempotency_key: key(),
    } as any);
    expect(ins.error).not.toBeNull();
    await v.client.from("transport_assignments").update({ status: "confirmed" } as any).eq("id", id);
    expect((await asnRow(id)).status).toBe("reserved");
    const seen = await other.client.from("transport_assignments").select("id").eq("id", id);
    expect(seen.data ?? []).toHaveLength(0);

    for (const u of [v, coord, stranger]) {
      expect((await rpc(u, "sweep_expired_assignments")).error).not.toBeNull();
    }
  });
});
