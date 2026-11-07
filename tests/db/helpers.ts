import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import type { Database } from "../../src/lib/database.types";

try {
  process.loadEnvFile(".env.local");
} catch {
  // CI or shell may provide env directly.
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

// Safety: only run against a project listed in DEMO_PROJECT_REFS (same rule as demo:reset).
const ref = new URL(url).hostname.split(".")[0];
const allowed = (process.env.DEMO_PROJECT_REFS ?? "").split(",").map((s) => s.trim());
if (!ref || !allowed.includes(ref)) {
  throw new Error("test:db refuses to run: project ref is not in DEMO_PROJECT_REFS.");
}

export type Client = SupabaseClient<Database>;

export const admin: Client = createClient<Database>(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

export const anonClient = (): Client =>
  createClient<Database>(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });

export type TestUser = { id: string; client: Client };

const created: string[] = [];
const createdOrgs: string[] = [];

export async function createTestUser(label: string): Promise<TestUser> {
  const email = `pawlift-dbtest-${label}-${randomUUID().slice(0, 8)}@example.com`;
  const password = `Pw-${randomUUID()}`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { display_name: `Test ${label}` },
  });
  if (error || !data.user) throw new Error(`createUser failed: ${error?.message}`);
  created.push(data.user.id);
  const client = anonClient();
  const { error: signInError } = await client.auth.signInWithPassword({ email, password });
  if (signInError) throw new Error(`sign-in failed: ${signInError.message}`);
  return { id: data.user.id, client };
}

export async function createTestOrg(name: string): Promise<string> {
  const { data, error } = await admin
    .from("organisations")
    .insert({ name: `DBTEST ${name}`, type: "rescue_group", is_demo: true })
    .select("id")
    .single();
  if (error) throw new Error(`createOrg failed: ${error.message}`);
  createdOrgs.push(data.id);
  return data.id;
}

export async function cleanup() {
  if (createdOrgs.length) await admin.from("organisations").delete().in("id", createdOrgs);
  for (const id of created) await admin.auth.admin.deleteUser(id);
  created.length = 0;
  createdOrgs.length = 0;
}

/** Every table in the public schema except PostGIS's spatial_ref_sys. */
export const APP_TABLES = [
  "suburbs", "profiles", "platform_admins", "organisations", "organisation_members",
  "invitations", "volunteer_profiles", "verification_records", "locations",
  "location_private", "transport_requests", "request_private", "transport_legs",
  "journeys", "transport_assignments", "handover_confirmations", "route_cache",
  "incidents", "notifications", "notification_preferences", "audit_logs",
] as const;
