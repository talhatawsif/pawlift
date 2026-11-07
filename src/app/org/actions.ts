"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { rpcMessage } from "@/lib/org";
import type { FormState } from "@/app/auth/actions";

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

function fields(form: FormData) {
  return {
    p_name: str(form, "name"),
    p_type: str(form, "type"),
    p_registration_details: str(form, "registration_details"),
    p_contact_name: str(form, "contact_name"),
    p_contact_email: str(form, "contact_email"),
    p_contact_phone: str(form, "contact_phone"),
    p_operating_area: str(form, "operating_area"),
    p_website: str(form, "website"),
    p_description: str(form, "description"),
  };
}

export async function registerOrganisation(_: FormState, form: FormData): Promise<FormState> {
  const args = fields(form);
  if (args.p_name.length < 2) return { error: "Enter your organisation's name." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("register_organisation", args);
  if (error || !data) return { error: rpcMessage(error?.code, "We couldn't register your organisation. Try again.") };
  redirect(`/org/${data}`);
}

export async function resubmitOrganisation(_: FormState, form: FormData): Promise<FormState> {
  const orgId = str(form, "org_id");
  const args = fields(form);
  if (args.p_name.length < 2) return { error: "Enter your organisation's name." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("resubmit_organisation", { p_org_id: orgId, ...args });
  if (error) return { error: rpcMessage(error.code, "We couldn't resubmit. Try again.") };
  redirect(`/org/${orgId}`);
}

export async function updateOrgSettings(_: FormState, form: FormData): Promise<FormState> {
  const orgId = str(form, "org_id");
  const supabase = await createClient();
  const { error } = await supabase.rpc("update_org_settings", {
    p_org_id: orgId,
    p_contact_name: str(form, "contact_name"),
    p_contact_email: str(form, "contact_email"),
    p_contact_phone: str(form, "contact_phone"),
    p_operating_area: str(form, "operating_area"),
    p_website: str(form, "website"),
    p_description: str(form, "description"),
  });
  if (error) {
    if (error.code === "22023") return { error: "Check the email (name@example.com) and website (starting with https://) and try again." };
    return { error: rpcMessage(error.code, "We couldn't save your settings. Try again.") };
  }
  revalidatePath(`/org/${orgId}`, "layout");
  return { notice: "Saved." };
}
