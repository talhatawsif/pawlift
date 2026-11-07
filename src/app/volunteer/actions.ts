"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { rpcMessage } from "@/lib/org";
import { GUIDELINES_VERSION } from "@/lib/guidelines";
import type { FormState } from "@/app/auth/actions";

export async function saveVolunteerProfile(_: FormState, form: FormData): Promise<FormState> {
  const days = form.getAll("days").map(String);
  const supabase = await createClient();
  const { error } = await supabase.rpc("upsert_volunteer_profile", {
    p_species_ok: form.getAll("species").map(String),
    p_max_size: String(form.get("max_size") ?? "") || (null as unknown as string),
    p_has_carrier: form.get("has_carrier") === "on",
    p_vehicle_notes: String(form.get("vehicle_notes") ?? "").trim(),
    p_availability: { days, notes: String(form.get("availability_notes") ?? "").trim() },
  });
  if (error) return { error: rpcMessage(error.code, "We couldn't save your profile. Try again.") };
  redirect("/volunteer?saved=1");
}

export async function acceptGuidelines() {
  const supabase = await createClient();
  const { error } = await supabase.rpc("accept_guidelines", { p_version: GUIDELINES_VERSION });
  redirect(error ? "/volunteer?error=guidelines" : "/volunteer?accepted=1");
}

export async function resubmitVolunteer() {
  const supabase = await createClient();
  await supabase.rpc("resubmit_volunteer");
  redirect("/volunteer");
}
