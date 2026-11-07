"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { rpcMessage } from "@/lib/org";

export type LocationState = { error?: string; ok?: boolean } | undefined;

const s = (f: FormData, k: string) => String(f.get(k) ?? "");

function fail(code: string | undefined): LocationState {
  return { error: rpcMessage(code, "We couldn't save that. Please try again.") };
}

export async function createLocation(_: LocationState, form: FormData): Promise<LocationState> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("create_location", {
    p_org_id: s(form, "org_id"),
    p_kind: s(form, "kind"),
    p_label_public: s(form, "label_public"),
    p_suburb_id: s(form, "suburb_id"),
    p_exact_address: s(form, "exact_address"),
    p_contact_name: s(form, "contact_name"),
    p_contact_phone: s(form, "contact_phone"),
    p_instructions: s(form, "instructions"),
  });
  if (error) return fail(error.code);
  revalidatePath(`/org/${s(form, "org_id")}/locations`);
  return { ok: true };
}

export async function updateLocation(_: LocationState, form: FormData): Promise<LocationState> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("update_location", {
    p_location_id: s(form, "location_id"),
    p_label_public: s(form, "label_public"),
    p_suburb_id: s(form, "suburb_id"),
    p_exact_address: s(form, "exact_address"),
    p_contact_name: s(form, "contact_name"),
    p_contact_phone: s(form, "contact_phone"),
    p_instructions: s(form, "instructions"),
  });
  if (error) return fail(error.code);
  revalidatePath(`/org/${s(form, "org_id")}/locations`);
  return { ok: true };
}

export async function confirmDestination(form: FormData) {
  const supabase = await createClient();
  await supabase.rpc("confirm_destination", {
    p_location_id: s(form, "location_id"),
    p_confirm: s(form, "confirm") === "true",
  });
  revalidatePath(`/org/${s(form, "org_id")}/locations`);
}

export async function setFosterStatus(form: FormData) {
  const supabase = await createClient();
  await supabase.rpc("set_foster_status", {
    p_member_id: s(form, "member_id"),
    p_is_foster: s(form, "is_foster") === "true",
    p_can_confirm_receipt: form.get("can_confirm_receipt") === "on",
  });
  revalidatePath(`/org/${s(form, "org_id")}/members`);
}

export async function saveFosterHome(_: LocationState, form: FormData): Promise<LocationState> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("upsert_foster_home", {
    p_member_id: s(form, "member_id"),
    p_suburb_id: s(form, "suburb_id"),
    p_exact_address: s(form, "exact_address"),
    p_contact_name: s(form, "contact_name"),
    p_contact_phone: s(form, "contact_phone"),
    p_instructions: s(form, "instructions"),
  });
  if (error) return fail(error.code);
  revalidatePath(`/org/${s(form, "org_id")}/members`);
  revalidatePath(`/org/${s(form, "org_id")}/locations`);
  return { ok: true };
}
