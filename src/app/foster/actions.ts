"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { FormState } from "@/app/auth/actions";

export async function confirmReceipt(_: FormState, form: FormData): Promise<FormState> {
  const requestId = String(form.get("request_id") ?? "");
  const note = String(form.get("note") ?? "").trim();
  if (!requestId) return { error: "Something went wrong. Reload and try again." };
  if (note.length > 500) return { error: "Keep the note under 500 characters." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("confirm_receipt", { p_request_id: requestId, p_note: note });
  if (error) {
    if (error.code === "55000") return { error: "This delivery was already confirmed, or hasn't arrived yet. Reload to check." };
    if (error.code === "42501") return { error: "You can't confirm this delivery." };
    return { error: "We couldn't record that. Please try again." };
  }
  revalidatePath("/foster");
  return { notice: "Thank you. The coordinator can now see the animal arrived." };
}
