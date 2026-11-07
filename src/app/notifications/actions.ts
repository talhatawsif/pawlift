"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export type NotifState = { error?: string; ok?: boolean } | undefined;

export async function markAllRead(): Promise<void> {
  const supabase = await createClient();
  await supabase.rpc("mark_notifications_read", {});
  revalidatePath("/notifications");
}

export async function markOneRead(form: FormData): Promise<void> {
  const id = String(form.get("id") ?? "");
  if (!id) return;
  const supabase = await createClient();
  await supabase.rpc("mark_notifications_read", { p_ids: [id] });
  revalidatePath("/notifications");
}

export async function setReminders(_: NotifState, form: FormData): Promise<NotifState> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_my_notification_preferences", {
    p_reminders_enabled: form.get("reminders") === "on",
  });
  if (error) return { error: "We couldn't save that. Please try again." };
  revalidatePath("/notifications");
  return { ok: true };
}
