"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requestError } from "@/lib/requests";

export type ActionState = { error?: string; ok?: boolean } | undefined;

const s = (f: FormData, k: string) => String(f.get(k) ?? "");

type Verb =
  | "accept_offer" | "decline_offer" | "release_assignment" | "withdraw"
  | "start_leg" | "confirm_pickup" | "confirm_delivery";

async function run(verb: Verb, form: FormData): Promise<ActionState> {
  const id = s(form, "assignment_id");
  const text = s(form, "text");
  const supabase = await createClient();
  let error: { code?: string; message?: string } | null = null;
  switch (verb) {
    case "accept_offer": ({ error } = await supabase.rpc("accept_offer", { p_assignment_id: id })); break;
    case "decline_offer": ({ error } = await supabase.rpc("decline_offer", { p_assignment_id: id, p_reason: text })); break;
    case "release_assignment": ({ error } = await supabase.rpc("release_assignment", { p_assignment_id: id, p_reason: text })); break;
    case "withdraw": ({ error } = await supabase.rpc("withdraw", { p_assignment_id: id, p_reason: text })); break;
    case "start_leg": ({ error } = await supabase.rpc("start_leg", { p_assignment_id: id })); break;
    case "confirm_pickup": ({ error } = await supabase.rpc("confirm_pickup", { p_assignment_id: id, p_note: text })); break;
    case "confirm_delivery": ({ error } = await supabase.rpc("confirm_delivery", { p_assignment_id: id, p_note: text })); break;
  }
  if (error) return { error: requestError(error, "That didn't work. Please try again.") };
  revalidatePath("/assignments");
  revalidatePath(`/assignments/${id}`);
  return { ok: true };
}

export async function acceptOffer(_: ActionState, f: FormData) { return run("accept_offer", f); }
export async function declineOffer(_: ActionState, f: FormData) { return run("decline_offer", f); }
export async function releaseAssignment(_: ActionState, f: FormData) { return run("release_assignment", f); }
export async function withdrawAssignment(_: ActionState, f: FormData) { return run("withdraw", f); }
export async function startLeg(_: ActionState, f: FormData) { return run("start_leg", f); }
export async function confirmPickup(_: ActionState, f: FormData) { return run("confirm_pickup", f); }
export async function confirmDelivery(_: ActionState, f: FormData) { return run("confirm_delivery", f); }

export async function reportIncident(_: ActionState, form: FormData): Promise<ActionState> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("report_incident", {
    p_request_id: s(form, "request_id"),
    p_leg_id: (s(form, "leg_id") || null) as string,
    p_type: s(form, "type"),
    p_severity: s(form, "severity"),
    p_description: s(form, "text"),
  });
  if (error) return { error: requestError(error, "We couldn't send that. Please try again.") };
  revalidatePath("/assignments");
  revalidatePath(`/org/${s(form, "org_id")}/dashboard`);
  return { ok: true };
}
