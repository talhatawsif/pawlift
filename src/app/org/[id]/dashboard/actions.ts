"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requestError } from "@/lib/requests";

export type DashState = { error?: string; ok?: boolean } | undefined;
const s = (f: FormData, k: string) => String(f.get(k) ?? "");

async function finish(error: { code?: string; message?: string } | null, orgId: string): Promise<DashState> {
  if (error) return { error: requestError(error, "That didn't work. Please try again.") };
  revalidatePath(`/org/${orgId}/dashboard`);
  return { ok: true };
}

export async function confirmAssignment(_: DashState, f: FormData): Promise<DashState> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("confirm_assignment", { p_assignment_id: s(f, "assignment_id") });
  return finish(error, s(f, "org_id"));
}

export async function releaseReserved(_: DashState, f: FormData): Promise<DashState> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("release_assignment", { p_assignment_id: s(f, "assignment_id"), p_reason: s(f, "text") });
  return finish(error, s(f, "org_id"));
}

export async function withdrawOffer(_: DashState, f: FormData): Promise<DashState> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("withdraw_offer", { p_assignment_id: s(f, "assignment_id"), p_reason: s(f, "text") });
  return finish(error, s(f, "org_id"));
}

export async function offerLeg(_: DashState, f: FormData): Promise<DashState> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("offer_leg", { p_leg_id: s(f, "leg_id"), p_volunteer_id: s(f, "volunteer_id") });
  return finish(error, s(f, "org_id"));
}

export async function reassignLeg(_: DashState, f: FormData): Promise<DashState> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("reassign", {
    p_assignment_id: s(f, "assignment_id"),
    p_reason: s(f, "text"),
    p_new_volunteer_id: (s(f, "volunteer_id") || null) as string,
  });
  return finish(error, s(f, "org_id"));
}

export async function completeRequest(_: DashState, f: FormData): Promise<DashState> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("complete_request", { p_request_id: s(f, "request_id"), p_note: s(f, "text") });
  return finish(error, s(f, "org_id"));
}

export async function confirmReceipt(_: DashState, f: FormData): Promise<DashState> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("confirm_receipt", {
    p_request_id: s(f, "request_id"), p_outcome: s(f, "outcome"), p_note: s(f, "text"),
  });
  return finish(error, s(f, "org_id"));
}

export async function resolveIncident(_: DashState, f: FormData): Promise<DashState> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("resolve_incident", { p_incident_id: s(f, "incident_id"), p_resolution: s(f, "text") });
  return finish(error, s(f, "org_id"));
}
