"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { rpcMessage } from "@/lib/org";
import type { FormState } from "@/app/auth/actions";
import type { ActionResult } from "@/components/ActionForm";

export async function acceptInvitation(_: FormState, form: FormData): Promise<FormState> {
  const token = String(form.get("token") ?? "");
  const supabase = await createClient();
  const { error } = await supabase.rpc("accept_invitation", { p_token: token });
  if (error) {
    return {
      error:
        error.code === "42501"
          ? "This invitation was sent to a different email address. Sign in with the address it was sent to."
          : rpcMessage(error.code, "We couldn't use that invitation."),
    };
  }
  redirect("/volunteer?joined=1");
}

export async function requestMembership(_: ActionResult, form: FormData): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("request_membership", { p_org_id: String(form.get("org_id") ?? "") });
  if (error) return { error: rpcMessage(error.code, "We couldn't send that request.") };
  revalidatePath("/join");
}
