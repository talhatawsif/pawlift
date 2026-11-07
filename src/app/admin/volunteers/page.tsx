import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getMyContext } from "@/lib/session";
import { formatMelbourne } from "@/lib/org";
import { volunteerLabel, type VolunteerListItem } from "@/lib/membership";

export const metadata = { title: "Verify volunteers · PawLift" };

const TABS = ["pending", "verified", "rejected", "suspended", "all"] as const;

async function AdminVolunteersContent({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  await connection();
  const ctx = await getMyContext();
  if (!ctx?.is_admin) notFound();
  const { status: raw } = await searchParams;
  const status = TABS.find((t) => t === raw) ?? "pending";
  const supabase = await createClient();
  const { data } = await supabase.rpc("admin_list_volunteers", { p_status: status });
  const items = (data ?? []) as unknown as VolunteerListItem[];
  return (
    <main className="mx-auto min-h-dvh max-w-2xl px-4 py-8">
      <Link href="/" className="text-sm font-medium text-brand underline">Back to map</Link>
      <h1 className="mb-4 mt-4 text-2xl font-semibold">Verify volunteers</h1>
      <nav aria-label="Filter by status" className="mb-4 flex flex-wrap gap-2">
        {TABS.map((t) => (
          <Link key={t} href={`/admin/volunteers?status=${t}`} aria-current={t === status ? "page" : undefined}
            className={`flex h-9 items-center rounded-full border px-3 text-sm font-medium capitalize ${t === status ? "border-brand bg-brand text-brand-foreground" : "border-border bg-surface"}`}>{t}</Link>
        ))}
      </nav>
      {items.length === 0 ? <p className="text-muted">Nothing here.</p> : (
        <ul className="flex flex-col gap-2">
          {items.map((v) => (
            <li key={v.user_id}>
              <Link href={`/admin/volunteers/${v.user_id}`} className="block rounded-xl border border-border bg-surface p-3">
                <p className="font-medium">{v.display_name ?? "Unnamed"}{v.is_demo && <span className="ml-2 rounded bg-urgent/10 px-1.5 text-xs font-semibold text-urgent">DEMO</span>}</p>
                <p className="text-sm text-muted">{volunteerLabel(v.verification_status)} · guidelines {v.guidelines_accepted ? "accepted" : "not accepted"} · updated {formatMelbourne(v.updated_at)}</p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

export default function AdminVolunteersPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  return (
    <Suspense fallback={<main className="mx-auto min-h-dvh max-w-lg px-4 py-8 text-muted">Loading…</main>}>
      <AdminVolunteersContent searchParams={searchParams} />
    </Suspense>
  );
}
