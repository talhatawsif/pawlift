"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { rpcMessage } from "@/lib/org";
import type { ActionResult } from "@/components/ActionForm";

export type InviteState = { error?: string; link?: string; email?: string; orgName?: string } | undefined;

export async function createInvitation(_: InviteState, form: FormData): Promise<InviteState> {
  const orgId = String(form.get("org_id") ?? "");
  const email = String(form.get("email") ?? "").trim();
  const days = Number(form.get("days") ?? 14);
  const uses = email ? 1 : Number(form.get("uses") ?? 1);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_invitation", {
    p_org_id: orgId,
    p_email: email,
    p_expires_days: days,
    p_max_uses: uses,
  });
  if (error || !data) {
    return {
      error:
        error?.code === "55000"
          ? "Only a verified organisation can invite volunteers."
          : error?.code === "54000"
            ? "You have too many active invitations. Revoke some first."
            : rpcMessage(error?.code, "We couldn't create that invitation."),
    };
  }
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  revalidatePath(`/org/${orgId}/members`);
  return { link: `${proto}://${host}/join/${data}`, email: email || undefined, orgName: String(form.get("org_name") ?? "") };
}

export async function revokeInvitation(_: ActionResult, form: FormData): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("revoke_invitation", { p_invitation_id: String(form.get("invitation_id") ?? "") });
  if (error) return { error: rpcMessage(error.code, "We couldn't revoke that invitation.") };
  revalidatePath(`/org/${String(form.get("org_id") ?? "")}/members`);
}

export async function decideMembership(_: ActionResult, form: FormData): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("decide_membership", {
    p_member_id: String(form.get("member_id") ?? ""),
    p_decision: String(form.get("decision") ?? ""),
  });
  if (error) return { error: rpcMessage(error.code, "We couldn't save that decision.") };
  revalidatePath(`/org/${String(form.get("org_id") ?? "")}/members`);
}
