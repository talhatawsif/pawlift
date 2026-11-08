import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getMyContext } from "@/lib/session";
import { formatMelbourne } from "@/lib/org";
import { DEMO_BADGE, type AdminRequest } from "@/lib/ops";
import { speciesLabel, statusLabel, urgencyLabel } from "@/lib/requests";

export const metadata = { title: "Lifts · PawLift" };
const TABS = ["active", "draft", "completed", "cancelled", "all"] as const;

const DRIVER: Record<string, string> = {
  offered: "offered to", reserved: "claimed by", confirmed: "driver", completed: "driven by",
};

async function Content({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  await connection();
  const ctx = await getMyContext();
  if (!ctx?.is_admin) notFound();
  const { status: raw } = await searchParams;
  const status = TABS.find((t) => t === raw) ?? "active";
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_list_requests", { p_status: status, p_limit: 100 });
  const rows = (data ?? []) as unknown as AdminRequest[];
  return (
    <main className="mx-auto min-h-dvh max-w-2xl px-4 py-8">
      <Link href="/admin" className="text-sm font-medium text-brand underline">Back to admin</Link>
      <h1 className="mb-1 mt-4 text-2xl font-semibold">Lifts</h1>
      <p className="mb-4 text-sm text-muted">Every organisation&apos;s lifts. Addresses, contacts and medical notes are not shown here.</p>
      <nav aria-label="Filter by status" className="mb-4 flex flex-wrap gap-2">
        {TABS.map((t) => (
          <Link key={t} href={`/admin/requests?status=${t}`} aria-current={t === status ? "page" : undefined}
            className={`flex h-9 items-center rounded-full border px-3 text-sm font-medium capitalize ${t === status ? "border-brand bg-brand text-brand-foreground" : "border-border bg-surface"}`}>
            {t}
          </Link>
        ))}
      </nav>
      {error ? <p role="alert" className="text-urgent">Couldn&apos;t load lifts. Try again.</p>
        : rows.length === 0 ? <p className="text-muted">No lifts.</p> : (
        <ul className="flex flex-col gap-2">
          {rows.map((r) => (
            <li key={r.id} className="rounded-xl border border-border bg-surface p-3 text-sm">
              <p className="font-medium">
                {r.animal_name} · {speciesLabel(r.species)} ({r.reference})
                {r.is_demo && <span className={DEMO_BADGE}>DEMO</span>}
              </p>
              <p className="text-muted">{r.org_name} · {statusLabel(r.status)} · {urgencyLabel(r.urgency)}</p>
              {(r.origin_suburb || r.destination_suburb) && (
                <p className="text-muted">{r.origin_suburb ?? "?"} → {r.destination_suburb ?? "?"}</p>
              )}
              {r.window_start && r.window_end && (
                <p className="text-muted">
                  Window <time dateTime={r.window_start}>{formatMelbourne(r.window_start)}</time> –{" "}
                  <time dateTime={r.window_end}>{formatMelbourne(r.window_end)}</time>
                </p>
              )}
              {r.assignment_status && r.volunteer_name && (
                <p className="text-muted">{DRIVER[r.assignment_status] ?? r.assignment_status}: {r.volunteer_name}</p>
              )}
              {r.status !== "draft" && (
                <Link href={`/admin/private-access?request=${r.id}`} className="mt-1 inline-block font-medium text-brand underline">
                  View private details (logged)
                </Link>
              )}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

export default function AdminRequestsPage(props: { searchParams: Promise<{ status?: string }> }) {
  return (
    <Suspense fallback={<main className="mx-auto min-h-dvh max-w-2xl px-4 py-8 text-muted">Loading…</main>}>
      <Content {...props} />
    </Suspense>
  );
}
