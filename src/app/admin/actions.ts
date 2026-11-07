"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { rpcMessage } from "@/lib/org";
import type { FormState } from "@/app/auth/actions";

export async function decideOrganisation(_: FormState, form: FormData): Promise<FormState> {
  const orgId = String(form.get("org_id") ?? "");
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
