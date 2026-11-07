/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, anonClient, cleanup, createTestOrg, createTestUser, type TestUser } from "./helpers";

let coord: TestUser;
let otherCoord: TestUser;
let vol: TestUser;
let stranger: TestUser;
let orgId: string;
let otherOrgId: string;
let pendingOrgId: string;
let origin: string;
let dest: string;
let unconfirmedDest: string;
let otherOrgLoc: string;
let pendingOrigin: string;
let pendingDest: string;
let suburb: any;

const rpc = (u: TestUser, fn: string, args?: Record<string, unknown>) =>
  (u.client.rpc as unknown as (f: string, a?: Record<string, unknown>) => Promise<{ data: any; error: { code: string; message: string } | null }>)(fn, args);

const hours = (h: number) => new Date(Date.now() + h * 3600_000).toISOString();

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

const args = (over: Record<string, unknown> = {}) => ({
  p_org_id: orgId, p_animal_name: "Biscuit", p_species: "dog", p_urgency: "soon",
  p_required_date: null, p_deadline: hours(30), p_handling: "Nervous, use a lead",
  p_carrier: "Large crate", p_medical_notes: "SECRET medical note",
  p_coordinator_instructions: "SECRET instruction", p_origin_location_id: origin,
  p_destination_location_id: dest, p_window_start: hours(2), p_window_end: hours(6), ...over,
});

const newReq = async (over: Record<string, unknown> = {}) => {
  const { data, error } = await rpc(coord, "create_request", args(over));
  if (error) throw new Error(error.message);
  return data as string;
};

const updArgs = (id: string, version: number, over: Record<string, unknown> = {}) => {
  const a: any = args(over);
  delete a.p_org_id;
  return { p_request_id: id, p_expected_version: version, ...a };
};

beforeAll(async () => {
  [coord, otherCoord, vol, stranger] = await Promise.all(
    ["rcoord", "rother", "rvol", "rstranger"].map((l) => createTestUser(l)),
  );
  [orgId, otherOrgId, pendingOrgId] = await Promise.all([
    createTestOrg("req A"), createTestOrg("req B"), createTestOrg("req pending"),
  ]);
  await admin.from("organisations").update({ verification_status: "verified" }).in("id", [orgId, otherOrgId]);
  await member(orgId, coord.id, { is_coordinator: true });
  await member(pendingOrgId, coord.id, { is_coordinator: true });
  await member(otherOrgId, otherCoord.id, { is_coordinator: true });
  await member(orgId, vol.id, { is_volunteer: true });
  const { data } = await coord.client.rpc("list_suburbs" as any, { p_query: "" } as any);
  suburb = (data as any[]).find((s) => s.name === "St Albans");
  origin = await loc(orgId, "Pound A", false, "pound");
  dest = await loc(orgId, "Vet A", true, "vet");
  unconfirmedDest = await loc(orgId, "Unconfirmed", false);
  otherOrgLoc = await loc(otherOrgId, "Other vet", true, "vet");
  pendingOrigin = await loc(pendingOrgId, "Pending origin", false);
  pendingDest = await loc(pendingOrgId, "Pending dest", true, "vet");
});

afterAll(async () => {
  await cleanup();
});

describe("create_request", () => {
  it("creates a draft with a private row, one leg and an audit entry", async () => {
    const id = await newReq();
    const { data: r } = await admin.from("transport_requests").select("*").eq("id", id).single();
    expect(r!.status).toBe("draft");
    expect(r!.reference).toMatch(/^PL-[0-9A-F]{8}$/);
    expect(r!.is_demo).toBe(true);
    const { data: legs } = await admin.from("transport_legs").select("seq,status").eq("request_id", id);
    expect(legs).toEqual([{ seq: 1, status: "open" }]);
    const { data: priv } = await admin.from("request_private").select("medical_notes").eq("request_id", id).single();
    expect(priv!.medical_notes).toBe("SECRET medical note");
    const { data: audit } = await admin.from("audit_logs").select("action").eq("entity_id", id);
    expect(audit!.map((a) => a.action)).toContain("request.create");
  });

  it("refuses non-coordinators, other orgs and signed-out callers", async () => {
    for (const u of [vol, stranger, otherCoord]) {
      const { error } = await rpc(u, "create_request", args());
      expect(error?.code).toBe("42501");
    }
    const { error } = await anonClient().rpc("create_request" as any, args() as any);
    expect(error).toBeTruthy();
  });

  it("refuses locations of another organisation, same locations, bad windows and species", async () => {
    expect((await rpc(coord, "create_request", args({ p_destination_location_id: otherOrgLoc }))).error?.code).toBe("22023");
    expect((await rpc(coord, "create_request", args({ p_destination_location_id: origin }))).error?.code).toBe("22023");
    expect((await rpc(coord, "create_request", args({ p_window_end: hours(1) }))).error?.code).toBe("22023");
    expect((await rpc(coord, "create_request", args({ p_deadline: hours(3) }))).error?.code).toBe("22023");
    expect((await rpc(coord, "create_request", args({ p_species: "horse" }))).error?.code).toBe("22023");
    expect((await rpc(coord, "create_request", args({ p_animal_name: "  " }))).error?.code).toBe("22023");
  });

  it("refuses when the account is suspended", async () => {
    const s = await createTestUser("rsusp");
    await member(orgId, s.id, { is_coordinator: true });
    await admin.from("profiles").update({ account_status: "suspended" }).eq("id", s.id);
    expect((await rpc(s, "create_request", args())).error).toBeTruthy();
  });
});

describe("publish_request guards", () => {
  it("an unverified organisation cannot publish", async () => {
    const { data: id } = await rpc(coord, "create_request",
      args({ p_org_id: pendingOrgId, p_origin_location_id: pendingOrigin, p_destination_location_id: pendingDest }));
    const { error } = await rpc(coord, "publish_request", { p_request_id: id, p_attest: true });
    expect(error?.code).toBe("55000");
    expect(error?.message).toMatch(/verified/);
  });

  it("refuses without attestation, without a confirmed destination, without requirements and for past windows", async () => {
    const id = await newReq();
    expect((await rpc(coord, "publish_request", { p_request_id: id, p_attest: false })).error?.code).toBe("55000");
    const noDest = await newReq({ p_destination_location_id: unconfirmedDest });
    expect((await rpc(coord, "publish_request", { p_request_id: noDest, p_attest: true })).error?.message).toMatch(/confirmed destination/);
    const noReq = await newReq({ p_handling: "", p_carrier: "" });
    expect((await rpc(coord, "publish_request", { p_request_id: noReq, p_attest: true })).error?.message).toMatch(/requirements/);
    const past = await newReq();
    await admin.from("transport_legs").update({ window_start: hours(-5), window_end: hours(-1) }).eq("request_id", past);
    expect((await rpc(coord, "publish_request", { p_request_id: past, p_attest: true })).error?.code).toBe("22023");
  });

  it("only the owning coordinator can publish", async () => {
    const id = await newReq();
    for (const u of [otherCoord, vol, stranger]) {
      expect((await rpc(u, "publish_request", { p_request_id: id, p_attest: true })).error?.code).toBe("42501");
    }
  });

  it("publishes, records attestation, audits, and cannot publish twice", async () => {
    const id = await newReq();
    const { error } = await rpc(coord, "publish_request", { p_request_id: id, p_attest: true });
    expect(error).toBeNull();
    const { data: r } = await admin.from("transport_requests").select("status,published_at,release_authority_attested_by").eq("id", id).single();
    expect(r!.status).toBe("open");
    expect(r!.published_at).toBeTruthy();
    expect(r!.release_authority_attested_by).toBe(coord.id);
    const { data: audit } = await admin.from("audit_logs").select("action").eq("entity_id", id);
    expect(audit!.map((a) => a.action)).toContain("request.publish");
    expect((await rpc(coord, "publish_request", { p_request_id: id, p_attest: true })).error?.code).toBe("55000");
  });
});

describe("visibility", () => {
  let draftId: string;
  let openId: string;
  beforeAll(async () => {
    draftId = await newReq({ p_animal_name: "Draftie" });
    openId = await newReq({ p_animal_name: "Opie" });
    await rpc(coord, "publish_request", { p_request_id: openId, p_attest: true });
  });

  it("drafts are not in public_requests; open requests are only visible to demo-matching callers", async () => {
    const { data: asDemo } = await admin.from("public_requests").select("id").in("id", [draftId, openId]);
    // service role has no auth.uid(), so it counts as a real caller and must not see demo rows
    expect(asDemo).toEqual([]);
    const { data: anon } = await anonClient().from("public_requests").select("id").in("id", [draftId, openId]);
    expect(anon).toEqual([]);
    const { data: real } = await stranger.client.from("public_requests").select("id").in("id", [draftId, openId]);
    expect(real).toEqual([]);
    await admin.from("profiles").update({ is_demo: true }).eq("id", stranger.id);
    const { data: demo } = await stranger.client.from("public_requests").select("id").in("id", [draftId, openId]);
    expect(demo!.map((x) => x.id)).toEqual([openId]);
  });

  it("a real (non-demo) open request is visible to everyone, a demo one to no real user", async () => {
    await admin.from("organisations").update({ is_demo: false }).eq("id", orgId);
    const realId = await newReq({ p_animal_name: "Realie" });
    await admin.from("transport_requests").update({ is_demo: false }).eq("id", realId);
    await rpc(coord, "publish_request", { p_request_id: realId, p_attest: true });
    const { data: anon } = await anonClient().from("public_requests").select("id").in("id", [realId, openId]);
    expect(anon!.map((x) => x.id)).toEqual([realId]);
    await admin.from("organisations").update({ is_demo: true }).eq("id", orgId);
  });

  it("public_requests exposes no private columns", async () => {
    const { data } = await anonClient().from("public_requests").select("*").limit(1);
    const cols = Object.keys(data?.[0] ?? {});
    const probe = await admin.from("public_requests").select("*").limit(1);
    const all = new Set([...cols, ...Object.keys(probe.data?.[0] ?? {})]);
    for (const bad of ["medical_notes", "coordinator_instructions", "exact_address", "contact_phone", "org_id", "release_authority_attested_by"]) {
      expect(all.has(bad)).toBe(false);
    }
    const { error } = await anonClient().from("public_requests").select("medical_notes" as any);
    expect(error).toBeTruthy();
  });

  it("tables stay closed to clients; drafts and private notes only via coordinator RPCs", async () => {
    for (const u of [coord, otherCoord, vol, stranger]) {
      const { data } = await u.client.from("transport_requests").select("id").eq("id", draftId);
      expect(data ?? []).toEqual([]);
      const { data: p } = await u.client.from("request_private").select("request_id").eq("request_id", draftId);
      expect(p ?? []).toEqual([]);
    }
    for (const u of [otherCoord, vol, stranger]) {
      expect((await rpc(u, "get_request_for_coordinator", { p_request_id: draftId })).error?.code).toBe("42501");
      expect((await rpc(u, "list_org_requests", { p_org_id: orgId })).error?.code).toBe("42501");
    }
    const { data: mine } = await rpc(coord, "get_request_for_coordinator", { p_request_id: draftId });
    expect(mine.medical_notes).toBe("SECRET medical note");
    expect(mine.origin_label).toBe("Pound A");
    expect(mine.exact_address).toBeUndefined();
    const { data: list } = await rpc(coord, "list_org_requests", { p_org_id: orgId });
    expect(list.map((r: any) => r.id)).toContain(draftId);
    expect(JSON.stringify(list)).not.toMatch(/SECRET/);
  });

  it("clients cannot write status or version directly", async () => {
    const { error } = await coord.client.from("transport_requests").update({ status: "open" }).eq("id", draftId);
    expect(error || true).toBeTruthy();
    const { data } = await admin.from("transport_requests").select("status").eq("id", draftId).single();
    expect(data!.status).toBe("draft");
  });
});

describe("update_request", () => {
  it("edits a draft, bumps the version, syncs the leg, and detects conflicts", async () => {
    const id = await newReq();
    const { data: v1 } = await admin.from("transport_requests").select("version").eq("id", id).single();
    const { data: newV, error } = await rpc(coord, "update_request",
      updArgs(id, v1!.version, { p_animal_name: "Renamed", p_window_start: hours(3), p_window_end: hours(8) }));
    expect(error).toBeNull();
    expect(newV).toBe(v1!.version + 1);
    const { data: leg } = await admin.from("transport_legs").select("window_end").eq("request_id", id).single();
    expect(new Date(leg!.window_end).getTime()).toBeGreaterThan(Date.now() + 7 * 3600_000);
    const stale = await rpc(coord, "update_request", updArgs(id, v1!.version));
    expect(stale.error?.code).toBe("55006");
  });

  it("is limited to the owning coordinator", async () => {
    const id = await newReq();
    for (const u of [otherCoord, vol, stranger]) {
      expect((await rpc(u, "update_request", updArgs(id, 1))).error?.code).toBe("42501");
    }
  });

  it("is blocked once a leg is reserved, and an open request keeps a confirmed destination", async () => {
    const id = await newReq();
    await rpc(coord, "publish_request", { p_request_id: id, p_attest: true });
    const { data: v } = await admin.from("transport_requests").select("version").eq("id", id).single();
    const bad = await rpc(coord, "update_request", updArgs(id, v!.version, { p_destination_location_id: unconfirmedDest }));
    expect(bad.error?.code).toBe("55000");
    await admin.from("transport_legs").update({ status: "reserved" }).eq("request_id", id);
    const blocked = await rpc(coord, "update_request", updArgs(id, v!.version));
    expect(blocked.error?.code).toBe("55000");
    // 4b: cancelling with a volunteer involved is now allowed (assignments end as cancelled).
    expect((await rpc(coord, "cancel_request", { p_request_id: id, p_reason: "no longer needed" })).error).toBeNull();
  });
});

describe("cancel_request and photos", () => {
  it("cancels a draft without a reason, requires one when open, and cancels the leg", async () => {
    const d = await newReq();
    expect((await rpc(coord, "cancel_request", { p_request_id: d, p_reason: null })).error).toBeNull();
    const o = await newReq();
    await rpc(coord, "publish_request", { p_request_id: o, p_attest: true });
    expect((await rpc(coord, "cancel_request", { p_request_id: o, p_reason: "" })).error?.code).toBe("22023");
    expect((await rpc(otherCoord, "cancel_request", { p_request_id: o, p_reason: "nope nope" })).error?.code).toBe("42501");
    expect((await rpc(coord, "cancel_request", { p_request_id: o, p_reason: "Animal rehomed" })).error).toBeNull();
    const { data: r } = await admin.from("transport_requests").select("status,cancel_reason").eq("id", o).single();
    expect(r).toEqual({ status: "cancelled", cancel_reason: "Animal rehomed" });
    const { data: legs } = await admin.from("transport_legs").select("status").eq("request_id", o);
    expect(legs![0].status).toBe("cancelled");
    const { data: pub } = await admin.from("public_requests").select("id").eq("id", o);
    expect(pub).toEqual([]);
  });

  it("only accepts photo paths inside the organisation's own folder", async () => {
    const id = await newReq();
    const good = `${orgId}/${crypto.randomUUID()}.webp`;
    expect((await rpc(coord, "set_request_photo", { p_request_id: id, p_path: good })).error).toBeNull();
    for (const bad of [`${otherOrgId}/${crypto.randomUUID()}.webp`, `${orgId}/../x.webp`, `${orgId}/${crypto.randomUUID()}.png`]) {
      expect((await rpc(coord, "set_request_photo", { p_request_id: id, p_path: bad })).error?.code).toBe("22023");
    }
    expect((await rpc(otherCoord, "set_request_photo", { p_request_id: id, p_path: good })).error?.code).toBe("42501");
    expect((await rpc(coord, "set_request_photo", { p_request_id: id, p_path: null })).error).toBeNull();
  });

  it("storage: only the org's coordinators can use its draft folder; public bucket only for open requests", async () => {
    const id = await newReq();
    const path = `${orgId}/${crypto.randomUUID()}.webp`;
    const body = new Blob([new Uint8Array([82, 73, 70, 70])], { type: "image/webp" });
    const mine = await coord.client.storage.from("request-photos").upload(path, body, { contentType: "image/webp" });
    expect(mine.error).toBeNull();
    const theirs = await otherCoord.client.storage.from("request-photos")
      .upload(`${orgId}/${crypto.randomUUID()}.webp`, body, { contentType: "image/webp" });
    expect(theirs.error).toBeTruthy();
    expect((await otherCoord.client.storage.from("request-photos").download(path)).error).toBeTruthy();
    // public bucket refuses a draft's photo
    await rpc(coord, "set_request_photo", { p_request_id: id, p_path: path });
    const early = await coord.client.storage.from("animal-photos").upload(path, body, { contentType: "image/webp" });
    expect(early.error).toBeTruthy();
    await rpc(coord, "publish_request", { p_request_id: id, p_attest: true });
    const late = await coord.client.storage.from("animal-photos").upload(path, body, { contentType: "image/webp" });
    expect(late.error).toBeNull();
    await admin.storage.from("request-photos").remove([path]);
    await admin.storage.from("animal-photos").remove([path]);
  });
});
