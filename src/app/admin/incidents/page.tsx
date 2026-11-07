import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getMyContext } from "@/lib/session";
import { formatMelbourne } from "@/lib/org";
import { DEMO_BADGE, incidentTypeLabel, type AdminIncident } from "@/lib/ops";

export const metadata = { title: "Incidents · PawLift" };
const TABS = ["open", "acknowledged", "resolved", "all"] as const;

async function Content({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  await connection();
  const ctx = await getMyContext();
  if (!ctx?.is_admin) notFound();
  const { status: raw } = await searchParams;
  const status = TABS.find((t) => t === raw) ?? "open";
  const supabase = await createClient();
  const { data } = await supabase.rpc("admin_list_incidents", { p_status: status });
  const rows = (data ?? []) as unknown as AdminIncident[];
  return (
    <main className="mx-auto min-h-dvh max-w-2xl px-4 py-8">
      <Link href="/" className="text-sm font-medium text-brand underline">Back to map</Link>
      <h1 className="mb-4 mt-4 text-2xl font-semibold">Incidents</h1>
      <nav aria-label="Filter by status" className="mb-4 flex flex-wrap gap-2">
        {TABS.map((t) => (
          <Link key={t} href={`/admin/incidents?status=${t}`} aria-current={t === status ? "page" : undefined}
            className={`flex h-9 items-center rounded-full border px-3 text-sm font-medium capitalize ${t === status ? "border-brand bg-brand text-brand-foreground" : "border-border bg-surface"}`}>
            {t}
          </Link>
        ))}
      </nav>
      {rows.length === 0 ? <p className="text-muted">No incidents.</p> : (
        <ul className="flex flex-col gap-2">
          {rows.map((i) => (
            <li key={i.id} className="rounded-xl border border-border bg-surface p-3 text-sm">
              <p className="font-medium">
                {incidentTypeLabel(i.type)} · {i.severity === "high" ? "High severity" : "Low severity"}
                {i.is_demo && <span className={DEMO_BADGE}>DEMO</span>}
              </p>
              <p className="text-muted">{i.animal_name} ({i.reference}) · {i.org_name}</p>
              <p className="text-muted">
                <span className="capitalize">{i.status}</span> · <time dateTime={i.created_at}>{formatMelbourne(i.created_at)}</time>
                {i.raised_by_name ? ` · raised by ${i.raised_by_name}` : ""}
              </p>
              {i.description && <p>{i.description}</p>}
              {i.resolution && <p className="text-muted">Resolution: {i.resolution}</p>}
              <Link href={`/admin/private-access?request=${i.request_id}`} className="mt-1 inline-block font-medium text-brand underline">
                View private details (logged)
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

export default function AdminIncidentsPage(props: { searchParams: Promise<{ status?: string }> }) {
  return (
    <Suspense fallback={<main className="mx-auto min-h-dvh max-w-2xl px-4 py-8 text-muted">Loading…</main>}>
      <Content {...props} />
    </Suspense>
  );
}
