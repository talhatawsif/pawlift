"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { rpcMessage } from "@/lib/org";
import { geocodeAddress, GEOCODE_FAILURE_MESSAGE } from "@/lib/routing";
import type { OrgLocation } from "@/lib/locations";

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

/** Looks up the private address and stores a map point for it. The address is sent to openrouteservice only when a key is configured. */
export async function geocodeLocation(_: LocationState, form: FormData): Promise<LocationState> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("list_org_locations", { p_org_id: s(form, "org_id") });
  if (error) return fail(error.code);
  const loc = ((data ?? []) as unknown as OrgLocation[]).find((l) => l.id === s(form, "location_id"));
  if (!loc?.exact_address) return { error: "Add an address first." };
  const res = await geocodeAddress(`${loc.exact_address}, ${loc.suburb} ${loc.postcode} VIC, Australia`);
  if (!res.ok) return { error: GEOCODE_FAILURE_MESSAGE[res.reason] };
  const { error: setErr } = await supabase.rpc("set_location_exact_point", {
    p_location_id: loc.id,
    p_lat: res.lat,
    p_lng: res.lng,
  });
  if (setErr) return fail(setErr.code);
  return { ok: true };
}
