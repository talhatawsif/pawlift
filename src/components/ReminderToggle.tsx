"use client";

import { useActionState } from "react";
import { setReminders, type NotifState } from "@/app/notifications/actions";

export function ReminderToggle({ enabled }: { enabled: boolean }) {
  const [state, action, pending] = useActionState<NotifState, FormData>(setReminders, undefined);
  return (
    <form action={action} className="flex flex-col gap-2 rounded-xl border border-border p-3">
      <label className="flex items-start gap-3 text-base">
        <input type="checkbox" name="reminders" defaultChecked={enabled} className="mt-1 h-5 w-5" />
        <span>
          Pickup reminders
          <span className="block text-sm text-muted">
            We add a reminder here 24 hours and 2 hours before the pickup window of a transport you&apos;ve been confirmed for.
          </span>
        </span>
      </label>
      {state?.error && <p role="alert" className="text-sm text-danger">{state.error}</p>}
      {state?.ok && <p role="status" className="text-sm text-muted">Saved.</p>}
      <button type="submit" disabled={pending} className="h-12 w-full rounded-xl border border-border text-base font-semibold disabled:opacity-60">
        {pending ? "Saving…" : "Save"}
      </button>
    </form>
  );
}
