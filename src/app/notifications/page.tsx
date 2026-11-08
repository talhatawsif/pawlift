import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getMyContext } from "@/lib/session";
import { formatMelbourne } from "@/lib/org";
import { describeNotification, type NotificationRow } from "@/lib/notifications";
import { markAllRead, markOneRead } from "@/app/notifications/actions";
import { ReminderToggle } from "@/components/ReminderToggle";

export const metadata = { title: "Notifications · PawLift" };

async function Content() {
  await connection();
  const ctx = await getMyContext();
  if (!ctx) redirect("/sign-in");
  const supabase = await createClient();
  const [listRes, prefRes] = await Promise.all([
    supabase.rpc("list_my_notifications", { p_limit: 50 }),
    supabase.rpc("get_my_notification_preferences"),
  ]);
  const rows = (listRes.data ?? []) as unknown as NotificationRow[];
  const reminders = (prefRes.data as unknown as { reminders_enabled?: boolean } | null)?.reminders_enabled ?? true;
  const unread = rows.filter((n) => !n.read_at).length;

  return (
    <main className="mx-auto min-h-dvh max-w-lg px-4 py-8">
      <Link href="/" className="text-sm font-medium text-brand underline">Back to map</Link>
      <h1 className="mb-4 mt-4 text-2xl font-semibold">Notifications</h1>
      {rows.length === 0 ? (
        <p className="text-muted">Nothing yet. Updates about your transports and lifts appear here.</p>
      ) : (
        <>
          {unread > 0 && (
            <form action={markAllRead} className="mb-3">
              <button type="submit" className="h-10 rounded-xl border border-border px-4 text-sm font-semibold">Mark all as read</button>
            </form>
          )}
          <ul className="flex flex-col gap-2">
            {rows.map((n) => {
              const d = describeNotification(n);
              return (
                <li key={n.id} className={`rounded-xl border p-3 ${n.read_at ? "border-border" : "border-brand bg-surface"}`}>
                  <Link href={d.href} className="block font-medium">
                    {!n.read_at && <span className="mr-2 rounded bg-brand px-1.5 text-xs font-semibold text-brand-foreground">New</span>}
                    {d.text}
                  </Link>
                  <p className="text-xs text-muted">{formatMelbourne(n.created_at)}</p>
                  {!n.read_at && (
                    <form action={markOneRead} className="mt-1">
                      <input type="hidden" name="id" value={n.id} />
                      <button type="submit" className="text-sm font-medium text-brand underline">Mark as read</button>
                    </form>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}
      <h2 className="mb-2 mt-8 text-lg font-semibold">Settings</h2>
      <ReminderToggle enabled={reminders} />
    </main>
  );
}

export default function NotificationsPage() {
  return (
    <Suspense fallback={<main className="mx-auto min-h-dvh max-w-lg px-4 py-8 text-muted">Loading…</main>}>
      <Content />
    </Suspense>
  );
}
