"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { rpcMessage } from "@/lib/org";
import type { FormState } from "@/app/auth/actions";

export async function decideOrganisation(_: FormState, form: FormData): Promise<FormState> {
  const orgId = String(form.get("subject_id") ?? "");
  const decision = String(form.get("decision") ?? "");
  const reason = String(form.get("reason") ?? "").trim();
  const checks = String(form.get("checks") ?? "")
    .split("\n")
    .map((c) => c.trim())
    .filter(Boolean);
  if (decision === "verified" && checks.length === 0) return { error: "List at least one check you performed." };
  if (decision !== "verified" && !reason) return { error: "A reason is required." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_decide_organisation", {
    p_org_id: orgId,
    p_decision: decision,
    p_checks: checks,
    p_reason: reason,
  });
  if (error) return { error: rpcMessage(error.code, "We couldn't record that decision.") };
  redirect("/admin/organisations");
}

export async function decideVolunteer(_: FormState, form: FormData): Promise<FormState> {
  const userId = String(form.get("subject_id") ?? "");
  const decision = String(form.get("decision") ?? "");
  const reason = String(form.get("reason") ?? "").trim();
  const checks = String(form.get("checks") ?? "")
    .split("\n")
    .map((c) => c.trim())
    .filter(Boolean);
  if (decision === "verified" && checks.length === 0) return { error: "List at least one check you performed." };
  if (decision !== "verified" && !reason) return { error: "A reason is required." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_decide_volunteer", {
    p_user_id: userId,
    p_decision: decision,
    p_checks: checks,
    p_reason: reason,
  });
  if (error) {
    return {
      error:
        error.code === "55000"
          ? "That isn't possible now. The volunteer may not have accepted the guidelines yet."
          : rpcMessage(error.code, "We couldn't record that decision."),
    };
  }
  redirect("/admin/volunteers");
}

export type PrivateDetailsState = { error?: string; details?: import("@/lib/ops").PrivateDetails } | undefined;

/** Reads exact addresses and medical notes for one request. A reason is required and the access is logged. */
export async function viewPrivateDetails(_: PrivateDetailsState, form: FormData): Promise<PrivateDetailsState> {
  const requestId = String(form.get("request_id") ?? "").trim();
  const reason = String(form.get("reason") ?? "").trim();
  if (!/^[0-9a-f-]{36}$/i.test(requestId)) return { error: "Enter a valid request id." };
  if (reason.length < 10) return { error: "Give a reason of at least 10 characters. It is recorded." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_view_private_details", { p_request_id: requestId, p_reason: reason });
  if (error || !data) return { error: error?.code === "22023" ? "The reason must be 10 to 500 characters." : "We couldn't open that request." };
  return { details: data as unknown as import("@/lib/ops").PrivateDetails };
}
