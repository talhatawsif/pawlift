/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, cleanup, createTestOrg, createTestUser, makeAdmin, type TestUser } from "./helpers";

let coord: TestUser;
let otherCoord: TestUser;
let vol: TestUser;
let vol2: TestUser;
let stranger: TestUser;
let adminUser: TestUser;
let suspended: TestUser;
let orgId: string;
let otherOrgId: string;
let pendingOrgId: string;

const rpc = (u: TestUser, fn: string, args?: Record<string, unknown>) =>
  (u.client.rpc as unknown as (f: string, a?: Record<string, unknown>) => Promise<{ data: any; error: { code: string; message: string } | null }>)(fn, args);

async function makeCoordinator(userId: string, org: string) {
  const { error } = await admin.from("organisation_members").insert({
    org_id: org, user_id: userId, is_coordinator: true, status: "active",
  });
  if (error) throw new Error(error.message);
}

const invite = (u: TestUser, org: string, email: string | null = null, uses = 3, days = 14) =>
  rpc(u, "create_invitation", { p_org_id: org, p_email: email ?? "", p_expires_days: days, p_max_uses: uses });

beforeAll(async () => {
  [coord, otherCoord, vol, vol2, stranger, adminUser, suspended] = await Promise.all(
    ["coord", "othercoord", "vol", "vol2", "stranger", "admin", "suspended"].map((l) => createTestUser(l)),
  );
  await makeAdmin(adminUser.id);
  [orgId, otherOrgId, pendingOrgId] = await Promise.all([
    createTestOrg("members A"), createTestOrg("members B"), createTestOrg("members pending"),
  ]);
  await admin.from("organisations").update({ verification_status: "verified", is_demo: false }).in("id", [orgId, otherOrgId]);
  await makeCoordinator(coord.id, orgId);
  await makeCoordinator(coord.id, pendingOrgId);
  await makeCoordinator(otherCoord.id, otherOrgId);
  await admin.from("profiles").update({ account_status: "suspended" }).eq("id", suspended.id);
});

afterAll(async () => {
  await admin.from("verification_records").delete().in("subject_id", [vol.id, vol2.id]);
  await cleanup();
});

describe("invitations", () => {
  it("unverified org cannot invite; non-coordinator cannot invite", async () => {
    expect((await invite(coord, pendingOrgId)).error?.code).toBe("55000");
    expect((await invite(stranger, orgId)).error?.code).toBe("42501");
    expect((await invite(otherCoord, orgId)).error?.code).toBe("42501");
    expect((await invite(suspended, orgId)).error?.code).toBe("42501");
  });

  it("validates expiry and uses", async () => {
    expect((await invite(coord, orgId, null, 3, 99)).error?.code).toBe("22023");
    expect((await invite(coord, orgId, null, 0)).error?.code).toBe("22023");
    expect((await invite(coord, orgId, "not-an-email")).error?.code).toBe("22023");
  });

  it("open link works up to max_uses, then is used up; hash is never exposed", async () => {
    const { data: token } = await invite(coord, orgId, null, 2);
    expect(typeof token).toBe("string");
    const p = await rpc(stranger, "preview_invitation", { p_token: token });
    expect(p.data).toMatchObject({ valid: true, org_name: expect.stringContaining("DBTEST") });
    expect((await rpc(vol, "accept_invitation", { p_token: token })).error).toBeNull();
    expect((await rpc(vol2, "accept_invitation", { p_token: token })).error).toBeNull();
    expect((await rpc(stranger, "accept_invitation", { p_token: token })).error?.code).toBe("P0002");
    const { data: m } = await admin.from("organisation_members").select("*").eq("org_id", orgId).eq("user_id", vol.id).single();
    expect(m).toMatchObject({ status: "active", is_volunteer: true, is_coordinator: false });
    const { data: list } = await rpc(coord, "list_invitations", { p_org_id: orgId });
    expect(JSON.stringify(list)).not.toContain(token);
    expect(JSON.stringify(list)).not.toContain("token_hash");
  });

  it("accepting twice does not consume another use", async () => {
    const { data: token } = await invite(coord, orgId, null, 5);
    await rpc(stranger, "accept_invitation", { p_token: token });
    await rpc(stranger, "accept_invitation", { p_token: token });
    const { data: inv } = await admin.from("invitations").select("uses").eq("org_id", orgId).eq("max_uses", 5).single();
    expect(inv?.uses).toBe(1);
    await admin.from("organisation_members").delete().eq("org_id", orgId).eq("user_id", stranger.id);
  });

  it("email-bound invitation rejects a different email and accepts the right one once", async () => {
    const { data: me } = await vol.client.auth.getUser();
    const { data: token } = await invite(coord, orgId, me.user!.email!.toUpperCase());
    const prev = await rpc(stranger, "preview_invitation", { p_token: token });
    expect(prev.data.email_matches).toBe(false);
    expect((await rpc(stranger, "accept_invitation", { p_token: token })).error?.code).toBe("42501");
    await admin.from("organisation_members").delete().eq("org_id", orgId).eq("user_id", vol.id);
    expect((await rpc(vol, "accept_invitation", { p_token: token })).error).toBeNull();
    await admin.from("organisation_members").delete().eq("org_id", orgId).eq("user_id", vol.id);
    expect((await rpc(vol, "accept_invitation", { p_token: token })).error?.code).toBe("P0002");
    await rpc(vol, "accept_invitation", { p_token: (await invite(coord, orgId)).data });
  });

  it("revoked and expired invitations are refused; only own-org coordinator can revoke", async () => {
    const { data: t1 } = await invite(coord, orgId);
    const { data: list } = await rpc(coord, "list_invitations", { p_org_id: orgId });
    const id = list[0].id;
    expect((await rpc(otherCoord, "revoke_invitation", { p_invitation_id: id })).error?.code).toBe("42501");
    expect((await rpc(coord, "revoke_invitation", { p_invitation_id: id })).error).toBeNull();
    expect((await rpc(stranger, "accept_invitation", { p_token: t1 })).error?.code).toBe("P0002");

    const { data: t2 } = await invite(coord, orgId);
    await admin.from("invitations").update({ expires_at: new Date(Date.now() - 1000).toISOString() }).eq("org_id", orgId).is("revoked_at", null).gt("max_uses", 0);
    expect((await rpc(stranger, "accept_invitation", { p_token: t2 })).error?.code).toBe("P0002");
  });

  it("invitations to a suspended/unverified org stop working", async () => {
    const { data: token } = await invite(coord, orgId);
    await admin.from("organisations").update({ verification_status: "suspended" }).eq("id", orgId);
    expect((await rpc(stranger, "accept_invitation", { p_token: token })).error?.code).toBe("P0002");
    await admin.from("organisations").update({ verification_status: "verified" }).eq("id", orgId);
  });

  it("direct table access to invitations is denied", async () => {
    const { error } = await coord.client.from("invitations").select("*");
    expect(error?.code).toBe("42501");
  });
});

describe("membership requests", () => {
  it("request, approve, decline, remove and guards", async () => {
    expect((await rpc(stranger, "request_membership", { p_org_id: pendingOrgId })).error?.code).toBe("P0002");
    expect((await rpc(suspended, "request_membership", { p_org_id: orgId })).error?.code).toBe("42501");
    expect((await rpc(stranger, "request_membership", { p_org_id: orgId })).error).toBeNull();
    expect((await rpc(stranger, "request_membership", { p_org_id: orgId })).error?.code).toBe("55000");

    const { data: m } = await admin.from("organisation_members").select("id").eq("org_id", orgId).eq("user_id", stranger.id).single();
    // Other org's coordinator and the requester cannot decide.
    expect((await rpc(otherCoord, "decide_membership", { p_member_id: m!.id, p_decision: "approve" })).error?.code).toBe("42501");
    expect((await rpc(stranger, "decide_membership", { p_member_id: m!.id, p_decision: "approve" })).error?.code).toBe("42501");
    expect((await rpc(coord, "decide_membership", { p_member_id: m!.id, p_decision: "remove" })).error?.code).toBe("55000");
    expect((await rpc(coord, "decide_membership", { p_member_id: m!.id, p_decision: "approve" })).error).toBeNull();
    expect((await rpc(coord, "decide_membership", { p_member_id: m!.id, p_decision: "approve" })).error?.code).toBe("55000");
    expect((await rpc(coord, "decide_membership", { p_member_id: m!.id, p_decision: "remove" })).error).toBeNull();
    // Removed members cannot re-request.
    expect((await rpc(stranger, "request_membership", { p_org_id: orgId })).error?.code).toBe("55000");
    const { data: after } = await admin.from("organisation_members").select("status").eq("id", m!.id).single();
    expect(after?.status).toBe("removed");
  });

  it("coordinators cannot be removed or change themselves", async () => {
    const { data: m } = await admin.from("organisation_members").select("id").eq("org_id", orgId).eq("user_id", coord.id).single();
    expect((await rpc(coord, "decide_membership", { p_member_id: m!.id, p_decision: "remove" })).error?.code).toBe("55000");
  });

  it("member list is coordinator-only and carries no contact details", async () => {
    expect((await rpc(otherCoord, "list_org_members", { p_org_id: orgId })).error?.code).toBe("42501");
    expect((await rpc(vol, "list_org_members", { p_org_id: orgId })).error?.code).toBe("42501");
    const { data } = await rpc(coord, "list_org_members", { p_org_id: orgId });
    expect(data.length).toBeGreaterThan(0);
    expect(JSON.stringify(data)).not.toMatch(/phone|email/);
  });

  it("demo orgs are invisible to real users and cannot be requested", async () => {
    await admin.from("organisations").update({ is_demo: true }).eq("id", otherOrgId);
    const { data } = await rpc(stranger, "list_joinable_organisations");
    expect(data.map((o: { id: string }) => o.id)).not.toContain(otherOrgId);
    expect((await rpc(stranger, "request_membership", { p_org_id: otherOrgId })).error?.code).toBe("P0002");
    await admin.from("organisations").update({ is_demo: false }).eq("id", otherOrgId);
  });

  it("joinable list shows verified orgs only, public fields only", async () => {
    const { data } = await rpc(stranger, "list_joinable_organisations");
    const ids = data.map((o: { id: string }) => o.id);
    expect(ids).toContain(orgId);
    expect(ids).not.toContain(pendingOrgId);
  });
});

describe("volunteer profile and verification", () => {
  const profile = {
    p_species_ok: ["cat", "dog"], p_max_size: "medium", p_has_carrier: true,
    p_vehicle_notes: "Station wagon", p_availability: { days: ["sat", "sun"], notes: "Weekends" },
  };

  it("validates profile input", async () => {
    expect((await rpc(vol, "upsert_volunteer_profile", { ...profile, p_species_ok: ["horse"] })).error?.code).toBe("22023");
    expect((await rpc(vol, "upsert_volunteer_profile", { ...profile, p_max_size: "huge" })).error?.code).toBe("22023");
    expect((await rpc(vol, "upsert_volunteer_profile", { ...profile, p_availability: { days: ["funday"] } })).error?.code).toBe("22023");
    expect((await rpc(vol, "upsert_volunteer_profile", { ...profile, p_availability: { evil: 1 } })).error?.code).toBe("22023");
    expect((await rpc(suspended, "upsert_volunteer_profile", profile)).error?.code).toBe("42501");
  });

  it("guidelines need a profile and the current version", async () => {
    expect((await rpc(vol2, "accept_guidelines", { p_version: "v1" })).error?.code).toBe("55000");
    expect((await rpc(vol, "upsert_volunteer_profile", profile)).error).toBeNull();
    expect((await rpc(vol, "accept_guidelines", { p_version: "v0" })).error?.code).toBe("22023");
  });

  it("cannot be verified without guidelines; admin-only; checks and reasons required", async () => {
    const decide = (u: TestUser, id: string, d: string, checks: string[], reason: string) =>
      rpc(u, "admin_decide_volunteer", { p_user_id: id, p_decision: d, p_checks: checks, p_reason: reason });
    expect((await decide(vol, vol.id, "verified", ["self"], "")).error?.code).toBe("42501");
    expect((await decide(adminUser, vol.id, "verified", ["Spoke to applicant"], "")).error?.code).toBe("55000"); // no guidelines
    await rpc(vol, "accept_guidelines", { p_version: "v1" });
    expect((await decide(adminUser, vol.id, "verified", [], "")).error?.code).toBe("22023");
    expect((await decide(adminUser, vol.id, "suspended", [], "x")).error?.code).toBe("55000");
    expect((await decide(adminUser, vol.id, "verified", ["Spoke to applicant"], "")).error).toBeNull();
    const { data: row } = await admin.from("volunteer_profiles").select("verification_status").eq("user_id", vol.id).single();
    expect(row?.verification_status).toBe("verified");
    expect((await decide(adminUser, vol.id, "suspended", [], "")).error?.code).toBe("22023");
    expect((await decide(adminUser, vol.id, "suspended", [], "Concern raised")).error).toBeNull();
    expect((await decide(adminUser, vol.id, "verified", ["Re-checked"], "")).error).toBeNull();
  });

  it("rejection needs a reason and allows resubmission only when rejected", async () => {
    await rpc(vol2, "upsert_volunteer_profile", profile);
    expect((await rpc(vol2, "resubmit_volunteer")).error?.code).toBe("55000");
    const rej = (reason: string) =>
      rpc(adminUser, "admin_decide_volunteer", { p_user_id: vol2.id, p_decision: "rejected", p_checks: [], p_reason: reason });
    expect((await rej("")).error?.code).toBe("22023");
    expect((await rej("Could not confirm details")).error).toBeNull();
    const { data: mine } = await rpc(vol2, "get_my_volunteer_profile");
    expect(mine.history[0].reason).toBe("Could not confirm details");
    expect((await rpc(vol2, "resubmit_volunteer")).error).toBeNull();
    const { data: row } = await admin.from("volunteer_profiles").select("verification_status").eq("user_id", vol2.id).single();
    expect(row?.verification_status).toBe("pending");
  });

  it("verification records are written and admin reads are admin-only", async () => {
    const { data } = await admin.from("verification_records").select("decision").eq("subject_id", vol.id).eq("subject_type", "volunteer");
    expect(data!.map((r) => r.decision)).toEqual(expect.arrayContaining(["verified", "suspended"]));
    expect((await rpc(vol, "admin_list_volunteers", { p_status: "all" })).error?.code).toBe("42501");
    expect((await rpc(vol, "admin_get_volunteer", { p_user_id: vol.id })).error?.code).toBe("42501");
    const { data: list } = await rpc(adminUser, "admin_list_volunteers", { p_status: "all" });
    expect(list.some((v: { user_id: string }) => v.user_id === vol.id)).toBe(true);
    const { data: one } = await rpc(adminUser, "admin_get_volunteer", { p_user_id: vol.id });
    expect(JSON.stringify(one)).not.toMatch(/phone/);
  });

  it("users cannot write volunteer_profiles directly", async () => {
    const { error } = await vol.client.from("volunteer_profiles").update({ verification_status: "verified" }).eq("user_id", vol2.id);
    expect(error?.code).toBe("42501");
  });

  it("audit rows exist for the main actions", async () => {
    const { data } = await admin.from("audit_logs").select("action").eq("org_id", orgId);
    const actions = (data ?? []).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(["invitation.create", "membership.join_by_invitation", "membership.approve", "membership.remove"]));
  });
});
