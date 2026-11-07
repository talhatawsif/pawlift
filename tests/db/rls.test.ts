import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  admin, anonClient, APP_TABLES, cleanup, createTestOrg, createTestUser,
  type Client, type TestUser,
} from "./helpers";

const DENIED = "42501";
type Ctx = { user_id: string; display_name: string | null; is_admin: boolean; is_demo: boolean; memberships: { org_id: string }[] };
// Typed client is strict about table names; the denial tests deliberately go through a loose handle.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const loose = (c: Client) => c as any;

let alice: TestUser; // member of org A
let bob: TestUser; // member of org B
let carol: TestUser; // no memberships
let orgA: string;
let orgB: string;

beforeAll(async () => {
  [alice, bob, carol] = await Promise.all([
    createTestUser("alice"),
    createTestUser("bob"),
    createTestUser("carol"),
  ]);
  [orgA, orgB] = await Promise.all([createTestOrg("A"), createTestOrg("B")]);
  const { error } = await admin.from("organisation_members").insert([
    { org_id: orgA, user_id: alice.id, is_coordinator: true, is_volunteer: false, is_foster_carer: false, status: "active" },
    { org_id: orgB, user_id: bob.id, is_coordinator: false, is_volunteer: true, is_foster_carer: false, status: "active" },
  ]);
  if (error) throw new Error(error.message);
});

afterAll(cleanup);

describe("default-deny on every table", () => {
  it.each(APP_TABLES)("anon cannot read or write %s", async (table) => {
    const c = loose(anonClient());
    expect((await c.from(table).select("*").limit(1)).error?.code).toBe(DENIED);
    expect((await c.from(table).insert({}).select()).error?.code).toBe(DENIED);
  });

  it.each(APP_TABLES)("signed-in user cannot read or write %s directly", async (table) => {
    const c = loose(carol.client);
    expect((await c.from(table).select("*").limit(1)).error?.code).toBe(DENIED);
    expect((await c.from(table).insert({}).select()).error?.code).toBe(DENIED);
    expect((await c.from(table).update({ created_at: new Date().toISOString() }).not("created_at", "is", null)).error?.code).toBe(DENIED);
    expect((await c.from(table).delete().not("created_at", "is", null)).error?.code).toBe(DENIED);
  });
});

describe("users cannot self-grant", () => {
  it("cannot make themselves platform admin", async () => {
    const { error } = await loose(carol.client).from("platform_admins").insert({ user_id: carol.id });
    expect(error?.code).toBe(DENIED);
    const { data } = await admin.from("platform_admins").select("user_id").eq("user_id", carol.id);
    expect(data).toEqual([]);
  });

  it("cannot add themselves as coordinator of someone else's org", async () => {
    const { error } = await carol.client.from("organisation_members").insert({
      org_id: orgA, user_id: carol.id, is_coordinator: true, status: "active",
    });
    expect(error?.code).toBe(DENIED);
    const { data } = await admin.from("organisation_members").select("id").eq("user_id", carol.id);
    expect(data).toEqual([]);
  });

  it("cannot promote an existing membership or verify an organisation", async () => {
    const m = await bob.client
      .from("organisation_members").update({ is_coordinator: true }).eq("org_id", orgB);
    expect(m.error?.code).toBe(DENIED);
    const o = await bob.client
      .from("organisations").update({ verification_status: "verified" }).eq("id", orgB);
    expect(o.error?.code).toBe(DENIED);
    const { data } = await admin
      .from("organisation_members").select("is_coordinator").eq("user_id", bob.id).single();
    expect(data?.is_coordinator).toBe(false);
  });

  it("cannot self-verify as a volunteer or write verification records", async () => {
    expect((await loose(carol.client).from("volunteer_profiles")
      .insert({ user_id: carol.id, verification_status: "verified" })).error?.code).toBe(DENIED);
    expect((await loose(carol.client).from("verification_records").insert({})).error?.code).toBe(DENIED);
  });

  it("cannot change their own account status", async () => {
    const { error } = await carol.client.from("profiles").update({ account_status: "suspended" }).eq("id", carol.id);
    expect(error?.code).toBe(DENIED);
  });
});

describe("get_my_context (shell read function)", () => {
  it("is not callable by anon", async () => {
    const { error } = await anonClient().rpc("get_my_context");
    expect(error?.code).toBe(DENIED);
  });

  it("returns only the caller's own memberships (cross-org isolation)", async () => {
    const a = (await alice.client.rpc("get_my_context")).data as unknown as Ctx;
    const b = (await bob.client.rpc("get_my_context")).data as unknown as Ctx;
    expect(a.user_id).toBe(alice.id);
    expect(a.memberships.map((m) => m.org_id)).toEqual([orgA]);
    expect(b.memberships.map((m) => m.org_id)).toEqual([orgB]);
    expect(JSON.stringify(a)).not.toContain(orgB);
    expect(JSON.stringify(b)).not.toContain(orgA);
  });

  it("gives a new user a profile, no memberships, and no admin or demo flag", async () => {
    const c = (await carol.client.rpc("get_my_context")).data as unknown as Ctx;
    expect(c.display_name).toBe("Test carol");
    expect(c.memberships).toEqual([]);
    expect(c.is_admin).toBe(false);
    expect(c.is_demo).toBe(false);
  });

  it("reports admin only for users in platform_admins", async () => {
    const admin1 = await createTestUser("admin");
    await admin.from("platform_admins").insert({ user_id: admin1.id });
    const ctx = (await admin1.client.rpc("get_my_context")).data as unknown as Ctx;
    expect(ctx.is_admin).toBe(true);
    await admin.from("platform_admins").delete().eq("user_id", admin1.id);
  });

  it("does not expose the trigger function", async () => {
    const { error } = await loose(carol.client).rpc("handle_new_user");
    expect(error).not.toBeNull();
  });
});

describe("public_requests view", () => {
  it("is readable by anon and exposes no private columns", async () => {
    const { error } = await anonClient().from("public_requests").select("*").limit(1);
    expect(error).toBeNull();
    for (const col of ["medical_notes", "exact_address", "contact_phone", "contact_email", "handover_instructions"]) {
      const r = await loose(anonClient()).from("public_requests").select(col).limit(1);
      expect(r.error, col).not.toBeNull();
    }
  });
});
