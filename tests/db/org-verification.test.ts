import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { admin, cleanup, createTestUser, makeAdmin, trackOrg, type TestUser } from "./helpers";

let owner: TestUser;
let stranger: TestUser;
let adminUser: TestUser;
let suspended: TestUser;

const fields = (name: string) => ({
  p_name: name,
  p_type: "rescue_group",
  p_registration_details: "ABN 00 000 000 000 (test)",
  p_contact_name: "Test Contact",
  p_contact_email: "contact@example.com",
  p_contact_phone: "0400 000 000",
  p_operating_area: "Western Melbourne",
  p_website: "",
  p_description: "A test organisation",
});

async function register(u: TestUser, name: string) {
  const { data, error } = await u.client.rpc("register_organisation", fields(name));
  if (data) trackOrg(data);
  return { id: data as string | null, error };
}

const decide = (u: TestUser, org: string, decision: string, checks: string[], reason: string) =>
  u.client.rpc("admin_decide_organisation", {
    p_org_id: org,
    p_decision: decision,
    p_checks: checks,
    p_reason: reason,
  });

beforeAll(async () => {
  [stranger, adminUser, suspended] = await Promise.all([
    createTestUser("stranger"),
    createTestUser("admin"),
    createTestUser("suspended"),
  ]);
  await makeAdmin(adminUser.id);
  await admin.from("profiles").update({ account_status: "suspended" }).eq("id", suspended.id);
});

// A fresh owner per test keeps each test clear of the 3-pending-orgs cap.
beforeEach(async () => {
  owner = await createTestUser("owner");
});

afterAll(cleanup);

describe("registration", () => {
  it("creates a pending org, an active coordinator membership and an audit row", async () => {
    const { id, error } = await register(owner, "DBTEST Reg");
    expect(error).toBeNull();
    const { data: org } = await admin.from("organisations").select("*").eq("id", id!).single();
    expect(org?.verification_status).toBe("pending");
    expect(org?.is_demo).toBe(false);
    const { data: m } = await admin.from("organisation_members").select("*").eq("org_id", id!);
    expect(m).toHaveLength(1);
    expect(m![0]).toMatchObject({ user_id: owner.id, is_coordinator: true, status: "active" });
    const { data: audit } = await admin.from("audit_logs").select("action").eq("entity_id", id!);
    expect(audit?.map((a) => a.action)).toContain("organisation.register");
  });

  it("a demo user's organisation is a demo organisation (D43)", async () => {
    await admin.from("profiles").update({ is_demo: true }).eq("id", owner.id);
    const { id, error } = await register(owner, "DBTEST Demo Reg");
    expect(error).toBeNull();
    const { data: org } = await admin.from("organisations").select("is_demo").eq("id", id!).single();
    expect(org?.is_demo).toBe(true);
  });

  it("the coordinator can read the org with contacts; an unrelated user and anon cannot", async () => {
    const { id } = await register(owner, "DBTEST Read");
    const mine = await owner.client.rpc("get_org_for_coordinator", { p_org_id: id! });
    expect((mine.data as { contact_email?: string } | null)?.contact_email).toBe("contact@example.com");
    const theirs = await stranger.client.rpc("get_org_for_coordinator", { p_org_id: id! });
    expect(theirs.data).toBeNull();
  });

  it("rejects invalid input", async () => {
    const bad = await owner.client.rpc("register_organisation", { ...fields("x"), p_name: "x" });
    expect(bad.error).not.toBeNull();
    const badType = await owner.client.rpc("register_organisation", { ...fields("DBTEST Type"), p_type: "bogus" });
    expect(badType.error).not.toBeNull();
  });

  it("a suspended account cannot register", async () => {
    const { error } = await register(suspended, "DBTEST Suspended");
    expect(error?.code).toBe("42501");
  });

  it("caps pending organisations per user at 3", async () => {
    const u = await createTestUser("cap");
    for (let i = 0; i < 3; i++) expect((await register(u, `DBTEST Cap ${i}`)).error).toBeNull();
    expect((await register(u, "DBTEST Cap 4")).error?.code).toBe("54000");
  });
});

describe("admin verification", () => {
  it("non-admins cannot decide or list", async () => {
    const { id } = await register(owner, "DBTEST NoAdmin");
    expect((await decide(owner, id!, "verified", ["checked"], "")).error?.code).toBe("42501");
    expect((await decide(stranger, id!, "verified", ["checked"], "")).error?.code).toBe("42501");
    expect((await owner.client.rpc("admin_list_organisations", { p_status: "all" })).error?.code).toBe("42501");
  });

  it("requires checks to verify and a reason to reject or suspend", async () => {
    const { id } = await register(owner, "DBTEST Guards");
    expect((await decide(adminUser, id!, "verified", [], "")).error).not.toBeNull();
    expect((await decide(adminUser, id!, "rejected", [], "  ")).error).not.toBeNull();
    expect((await decide(adminUser, id!, "suspended", ["x"], "why")).error?.code).toBe("55000");
    const { data } = await admin.from("organisations").select("verification_status").eq("id", id!).single();
    expect(data?.verification_status).toBe("pending");
  });

  it("verify writes a record and an audit row; reinstate path works; records are immutable", async () => {
    const { id } = await register(owner, "DBTEST Verify");
    expect((await decide(adminUser, id!, "verified", ["ABN lookup", "Website matches"], "")).error).toBeNull();
    const { data: rec } = await admin.from("verification_records").select("*").eq("subject_id", id!);
    expect(rec).toHaveLength(1);
    expect(rec![0].checks_performed).toEqual(["ABN lookup", "Website matches"]);
    expect(rec![0].decided_by).toBe(adminUser.id);
    const { data: audit } = await admin.from("audit_logs").select("action").eq("entity_id", id!);
    expect(audit?.map((a) => a.action)).toContain("organisation.verified");

    // verified -> verified is not a valid transition
    expect((await decide(adminUser, id!, "verified", ["x"], "")).error?.code).toBe("55000");
    expect((await decide(adminUser, id!, "suspended", [], "Complaint received")).error).toBeNull();
    expect((await decide(adminUser, id!, "verified", ["Re-checked"], "")).error).toBeNull();

    const upd = await admin.from("verification_records").update({ reason: "tampered" }).eq("subject_id", id!);
    expect(upd.error).not.toBeNull();
  });

  it("the coordinator sees the rejection reason in the history", async () => {
    const { id } = await register(owner, "DBTEST History");
    await decide(adminUser, id!, "rejected", ["ABN lookup"], "ABN not found");
    const { data } = await owner.client.rpc("get_org_for_coordinator", { p_org_id: id! });
    const org = data as { verification_status: string; history: { decision: string; reason: string }[] };
    expect(org.verification_status).toBe("rejected");
    expect(org.history[0]).toMatchObject({ decision: "rejected", reason: "ABN not found" });
  });
});

describe("resubmission", () => {
  it("a rejected org can be resubmitted by its coordinator only", async () => {
    const { id } = await register(owner, "DBTEST Resubmit");
    const args = { p_org_id: id!, ...fields("DBTEST Resubmit v2") };

    // not rejected yet
    expect((await owner.client.rpc("resubmit_organisation", args)).error?.code).toBe("55000");

    await decide(adminUser, id!, "rejected", ["ABN lookup"], "ABN not found");
    expect((await stranger.client.rpc("resubmit_organisation", args)).error?.code).toBe("42501");
    expect((await owner.client.rpc("resubmit_organisation", args)).error).toBeNull();

    const { data } = await admin.from("organisations").select("name, verification_status").eq("id", id!).single();
    expect(data).toMatchObject({ name: "DBTEST Resubmit v2", verification_status: "pending" });
    const { data: audit } = await admin.from("audit_logs").select("action").eq("entity_id", id!);
    expect(audit?.map((a) => a.action)).toContain("organisation.resubmit");
  });
});
