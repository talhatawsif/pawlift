import { createClient } from "@/lib/supabase/server";

export type Membership = {
  org_id: string;
  org_name: string;
  org_verification: string;
  status: "invited" | "requested" | "active" | "removed";
  is_coordinator: boolean;
  is_volunteer: boolean;
  is_foster_carer: boolean;
};

export type MyContext = {
  user_id: string;
  display_name: string | null;
  account_status: "active" | "suspended";
  is_demo: boolean;
  is_admin: boolean;
  memberships: Membership[];
};

/** The signed-in user's shell context, or null when signed out. Read via RPC (tables are default-deny). */
export async function getMyContext(): Promise<MyContext | null> {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims) return null;
  const { data, error } = await supabase.rpc("get_my_context");
  if (error || !data) return null;
  return data as unknown as MyContext;
}

/** Short role labels for the account menu. */
export function roleLabels(ctx: MyContext): string[] {
  const labels: string[] = [];
  if (ctx.is_admin) labels.push("Platform admin");
  for (const m of ctx.memberships) {
    if (m.status !== "active") continue;
    if (m.is_coordinator) labels.push(`Coordinator, ${m.org_name}`);
    if (m.is_volunteer) labels.push(`Volunteer, ${m.org_name}`);
    if (m.is_foster_carer) labels.push(`Foster carer, ${m.org_name}`);
  }
  return labels;
}
