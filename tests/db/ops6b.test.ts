/* eslint-disable @typescript-eslint/no-explicit-any */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, cleanup, createTestOrg, createTestUser, makeAdmin, type TestUser } from "./helpers";

let coord: TestUser;
let otherCoord: TestUser;
let vol: TestUser;
let foster: TestUser;
let fosterNoRight: TestUser;
let plain: TestUser;
let platformAdmin: TestUser;
let orgId: string;
let otherOrgId: string;
let origin: string;
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
/** Create, publish, claim, confirm; optionally drive to delivered. */
async function transport(destination: string, upTo: "confirmed" | "delivered") {
  const startH = 100 + 6 * slot++;
  const created = await rpc(coord, "create_request", {
    p_org_id: orgId, p_animal_name: "Waffle", p_species: "dog", p_urgency: "soon", p_required_date: null,
    p_deadline: hours(startH + 20), p_handling: "Calm", p_carrier: "Crate", p_medical_notes: "Secret meds",
    p_coordinator_instructions: null, p_origin_location_id: origin, p_destination_location_id: destination,
    p_window_start: hours(startH), p_window_end: hours(startH + 4),
  });
  if (created.error) throw new Error(created.error.message);
  const id = created.data as string;
  const pub = await rpc(coord, "publish_request", { p_request_id: id, p_attest: true });
  if (pub.error) throw new Error(pub.error.message);
  const { data: leg } = await admin.from("transport_legs").select("id").eq("request_id", id).single();
  const claim = await rpc(vol, "claim_leg", { p_leg_id: leg!.id, p_idempotency_key: `k-${randomUUID()}` });
  if (claim.error) throw new Error(claim.error.message);
  const conf = await rpc(coord, "confirm_assignment", { p_assignment_id: claim.data });
  if (conf.error) throw new Error(conf.error.message);
  if (upTo === "delivered") {
    await admin.from("transport_legs").update({ window_start: hours(1), window_end: hours(5) }).eq("id", leg!.id);
    for (const fn of ["start_leg", "confirm_pickup", "confirm_delivery"]) {
      const r = await rpc(vol, fn, fn === "start_leg" ? { p_assignment_id: claim.data } : { p_assignment_id: claim.data, p_note: null });
      if (r.error) throw new Error(`${fn}: ${r.error.message}`);
    }
  }
  return { requestId: id, legId: leg!.id as string };
}

beforeAll(async () => {
  [coord, otherCoord, vol, foster, fosterNoRight, plain, platformAdmin] = await Promise.all(
    ["bcoord", "bother", "bvol", "bfoster", "bfoster2", "bplain", "badmin"].map((l) => createTestUser(l)));
  await admin.from("profiles").update({ is_demo: true, display_name: "Dana Driver", phone: "0400 111 222" } as any).eq("id", vol.id);
  const vp = await admin.from("volunteer_profiles").insert({
    user_id: vol.id, species_ok: ["dog", "cat"], has_carrier: true, guidelines_version_accepted: "v1",
    verification_status: "verified", is_demo: true,
  } as any);
  if (vp.error) throw new Error(vp.error.message);
  await makeAdmin(platformAdmin.id);
  [orgId, otherOrgId] = await Promise.all([createTestOrg("ops A"), createTestOrg("ops B")]);
  await admin.from("organisations").update({ verification_status: "verified" }).in("id", [orgId, otherOrgId]);
  await member(orgId, coord.id, { is_coordinator: true });
  await member(otherOrgId, otherCoord.id, { is_coordinator: true });
  await member(orgId, vol.id, { is_volunteer: true });
  const approved = { is_foster_carer: true, foster_approved_by: coord.id, foster_approved_at: new Date().toISOString() };
  await member(orgId, foster.id, { ...approved, foster_can_confirm_receipt: true });
  await member(orgId, fosterNoRight.id, { ...approved, foster_can_confirm_receipt: false });
  const { data } = await coord.client.rpc("list_suburbs" as any, { p_query: "" } as any);
  suburb = (data as any[]).find((s) => s.name === "St Albans");
  origin = await loc(orgId, "Pound O", "pound");
  fosterHome = await loc(orgId, "Foster home", "foster_home", foster.id);
  fosterHome2 = await loc(orgId, "Foster home 2", "foster_home", fosterNoRight.id);
  await admin.from("location_private").insert([
    { location_id: origin, exact_address: "1 Secret St", contact_name: "Pat", contact_phone: "0400 000 111" },
    { location_id: fosterHome, exact_address: "9 Home Rd", contact_name: "Fran", contact_phone: "0400 333 444" },
  ] as any);
}, 90_000);

afterAll(async () => {
  await admin.from("private_access_log").delete().in("actor_id", [platformAdmin?.id].filter(Boolean) as string[]);
  await cleanup();
}, 60_000);

describe("foster incoming deliveries", () => {
  it("shows only the caller's own home, with driver contact while active and none after delivery", async () => {
    const t = await transport(fosterHome, "confirmed");
    const mine = await rpc(foster, "list_my_incoming_deliveries");
    expect(mine.error).toBeNull();
    const row = mine.data.find((x: any) => x.request_id === t.requestId);
    expect(row).toMatchObject({ animal_name: "Waffle", driver_first_name: "Dana", driver_phone: "0400 111 222", receipt_confirmed: false, can_confirm_receipt: true });
    expect(JSON.stringify(row)).not.toMatch(/Secret|Home Rd|Pound O|exact/i);
    for (const other of [fosterNoRight, coord, vol, plain, otherCoord]) {
      const r = await rpc(other, "list_my_incoming_deliveries");
      expect(r.data.some((x: any) => x.request_id === t.requestId)).toBe(false);
    }
    for (const fn of ["start_leg", "confirm_pickup", "confirm_delivery"]) {
      const { data: a } = await admin.from("transport_assignments").select("id").eq("leg_id", t.legId).eq("status", "confirmed").single();
      await admin.from("transport_legs").update({ window_start: hours(1), window_end: hours(5) }).eq("id", t.legId);
      const r = await rpc(vol, fn, fn === "start_leg" ? { p_assignment_id: a!.id } : { p_assignment_id: a!.id, p_note: null });
      expect(r.error).toBeNull();
    }
    const after = (await rpc(foster, "list_my_incoming_deliveries")).data.find((x: any) => x.request_id === t.requestId);
    expect(after.request_status).toBe("delivered");
    expect(after.driver_phone).toBeNull();
    expect(after.driver_first_name).toBeNull();
  }, 90_000);

  it("a carer without the receipt right sees the flag false and cannot confirm; the carer with it can, once, then history lists it", async () => {
    const t = await transport(fosterHome2, "delivered");
    const row = (await rpc(fosterNoRight, "list_my_incoming_deliveries")).data.find((x: any) => x.request_id === t.requestId);
    expect(row.can_confirm_receipt).toBe(false);
    expect((await rpc(fosterNoRight, "confirm_receipt", { p_request_id: t.requestId, p_note: null })).error?.code).toBe("42501");

    const u = await transport(fosterHome, "delivered");
    expect((await rpc(foster, "confirm_receipt", { p_request_id: u.requestId, p_note: "All good" })).error).toBeNull();
    expect((await rpc(foster, "confirm_receipt", { p_request_id: u.requestId, p_note: null })).error?.message).toMatch(/already/);
    const incoming = (await rpc(foster, "list_my_incoming_deliveries")).data.find((x: any) => x.request_id === u.requestId);
    expect(incoming.receipt_confirmed).toBe(true);
    expect((await rpc(coord, "complete_request", { p_request_id: u.requestId, p_note: null })).error).toBeNull();
    const hist = await rpc(foster, "list_my_foster_history");
    expect(hist.data.find((x: any) => x.request_id === u.requestId)).toMatchObject({ received_by_coordinator: false });
    expect((await rpc(plain, "list_my_foster_history")).data).toEqual([]);
    expect((await rpc(fosterNoRight, "list_my_foster_history")).data.some((x: any) => x.request_id === u.requestId)).toBe(false);
  }, 120_000);

  it("a suspended carer is refused", async () => {
    await admin.from("profiles").update({ account_status: "suspended" }).eq("id", fosterNoRight.id);
    expect((await rpc(fosterNoRight, "list_my_incoming_deliveries")).error?.code).toBe("42501");
    await admin.from("profiles").update({ account_status: "active" }).eq("id", fosterNoRight.id);
  });

  it("anon cannot call the foster reads", async () => {
    const { anonClient } = await import("./helpers");
    const c = anonClient();
    expect(((await (c.rpc as any)("list_my_incoming_deliveries")) as R).error).not.toBeNull();
  });
});

describe("transport history", () => {
  it("lists finished requests for the owning coordinator only", async () => {
    const t = await transport(fosterHome, "confirmed");
    await rpc(coord, "cancel_request", { p_request_id: t.requestId, p_reason: "Plans changed" });
    const mine = await rpc(coord, "list_transport_history", { p_org_id: orgId });
    expect(mine.error).toBeNull();
    expect(mine.data.every((x: any) => ["completed", "cancelled"].includes(x.status))).toBe(true);
    expect(mine.data.length).toBeGreaterThan(0);
    for (const u of [otherCoord, vol, foster, plain]) {
      expect((await rpc(u, "list_transport_history", { p_org_id: orgId })).error?.code).toBe("42501");
    }
    expect((await rpc(otherCoord, "list_transport_history", { p_org_id: otherOrgId })).data).toEqual([]);
    const paged = await rpc(coord, "list_transport_history", { p_org_id: orgId, p_limit: 1 });
    expect(paged.data).toHaveLength(1);
  }, 90_000);
});

describe("organisation settings", () => {
  const args = (o: string, extra: Record<string, unknown> = {}) => ({
    p_org_id: o, p_contact_name: "Casey", p_contact_email: "casey@example.com", p_contact_phone: "0400 555 666",
    p_operating_area: "Western Melbourne", p_website: "https://example.com", p_description: "We help animals.", ...extra,
  });

  it("a coordinator updates their own organisation and an audit row is written", async () => {
    const r = await rpc(coord, "update_org_settings", args(orgId));
    expect(r.error).toBeNull();
    const { data } = await admin.from("organisations").select("contact_name, website, name, type").eq("id", orgId).single();
    expect(data).toMatchObject({ contact_name: "Casey", website: "https://example.com", name: "DBTEST ops A", type: "rescue_group" });
    const a = await admin.from("audit_logs").select("id").eq("action", "organisation.settings").eq("entity_id", orgId);
    expect(a.data!.length).toBe(1);
  });

  it("is refused for other coordinators, non-coordinators, bad input and non-active organisations", async () => {
    for (const u of [otherCoord, vol, foster, plain]) {
      expect((await rpc(u, "update_org_settings", args(orgId))).error?.code).toBe("42501");
    }
    expect((await rpc(coord, "update_org_settings", args(orgId, { p_contact_email: "not-an-email" }))).error?.code).toBe("22023");
    expect((await rpc(coord, "update_org_settings", args(orgId, { p_website: "javascript:alert(1)" }))).error?.code).toBe("22023");
    await admin.from("organisations").update({ verification_status: "suspended" }).eq("id", orgId);
    expect((await rpc(coord, "update_org_settings", args(orgId))).error?.code).toBe("55000");
    await admin.from("organisations").update({ verification_status: "verified" }).eq("id", orgId);
  });
});

describe("admin oversight", () => {
  it("non-admins are refused every admin read", async () => {
    for (const u of [coord, vol, foster, plain]) {
      expect((await rpc(u, "admin_list_incidents", { p_status: "all" })).error?.code).toBe("42501");
      expect((await rpc(u, "admin_list_audit")).error?.code).toBe("42501");
      expect((await rpc(u, "admin_list_private_access")).error?.code).toBe("42501");
      expect((await rpc(u, "admin_view_private_details", { p_request_id: randomUUID(), p_reason: "Checking something" })).error?.code).toBe("42501");
    }
  });

  it("an admin lists incidents and audit rows", async () => {
    const t = await transport(fosterHome, "confirmed");
    const inc = await rpc(coord, "report_incident", { p_request_id: t.requestId, p_leg_id: t.legId, p_type: "delay", p_severity: "low", p_description: "Late" });
    expect(inc.error).toBeNull();
    const list = await rpc(platformAdmin, "admin_list_incidents", { p_status: "open" });
    expect(list.error).toBeNull();
    expect(list.data.some((x: any) => x.request_id === t.requestId)).toBe(true);
    expect((await rpc(platformAdmin, "admin_list_incidents", { p_status: "bogus" })).error?.code).toBe("22023");
    const audit = await rpc(platformAdmin, "admin_list_audit", { p_org_id: orgId, p_limit: 5 });
    expect(audit.data.length).toBeGreaterThan(0);
    expect(audit.data.length).toBeLessThanOrEqual(5);
  }, 90_000);

  it("private details need a reason, are logged, and show on the organisation's audit page", async () => {
    const t = await transport(fosterHome, "confirmed");
    expect((await rpc(platformAdmin, "admin_view_private_details", { p_request_id: t.requestId, p_reason: "short" })).error?.code).toBe("22023");
    expect((await rpc(platformAdmin, "admin_view_private_details", { p_request_id: t.requestId, p_reason: "   " })).error?.code).toBe("22023");
    expect((await admin.from("private_access_log").select("id").eq("request_id", t.requestId)).data).toHaveLength(0);

    const ok = await rpc(platformAdmin, "admin_view_private_details", { p_request_id: t.requestId, p_reason: "Welfare complaint 123" });
    expect(ok.error).toBeNull();
    expect(ok.data).toMatchObject({ medical_notes: "Secret meds", origin: { exact_address: "1 Secret St" }, destination: { exact_address: "9 Home Rd" } });
    const log = (await admin.from("private_access_log").select("*").eq("request_id", t.requestId)).data as any[];
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ actor_id: platformAdmin.id, org_id: orgId, reason: "Welfare complaint 123" });

    const orgAudit = await rpc(coord, "list_org_audit", { p_org_id: orgId, p_request_id: t.requestId });
    expect(orgAudit.data.some((x: any) => x.action === "admin.private_access")).toBe(true);
    const logged = await rpc(platformAdmin, "admin_list_private_access");
    expect(logged.data.some((x: any) => x.reference && x.reason === "Welfare complaint 123")).toBe(true);
    expect((await rpc(platformAdmin, "admin_view_private_details", { p_request_id: randomUUID(), p_reason: "Unknown request id" })).error?.code).toBe("42501");
  }, 90_000);

  it("a suspended admin account is refused", async () => {
    await admin.from("profiles").update({ account_status: "suspended" }).eq("id", platformAdmin.id);
    expect((await rpc(platformAdmin, "admin_list_audit")).error?.code).toBe("42501");
    await admin.from("profiles").update({ account_status: "active" }).eq("id", platformAdmin.id);
  });
});
