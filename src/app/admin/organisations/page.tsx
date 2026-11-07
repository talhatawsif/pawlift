import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getMyContext } from "@/lib/session";
import { formatMelbourne, typeLabel, verificationLabel, type OrgListItem } from "@/lib/org";

export const metadata = { title: "Verify organisations · PawLift" };

const TABS = ["pending", "verified", "rejected", "suspended", "all"] as const;

async function AdminOrgsPageContent({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  await connection();
  const ctx = await getMyContext();
  if (!ctx?.is_admin) notFound();
  const { status: raw } = await searchParams;
  const status = TABS.find((t) => t === raw) ?? "pending";
  const supabase = await createClient();
  const { data } = await supabase.rpc("admin_list_organisations", { p_status: status });
  const orgs = (data ?? []) as unknown as OrgListItem[];

  return (
    <main className="mx-auto min-h-dvh max-w-2xl px-4 py-8">
      <Link href="/" className="text-sm font-medium text-brand underline">Back to map</Link>
      <h1 className="mb-4 mt-4 text-2xl font-semibold">Verify organisations</h1>
      <nav aria-label="Filter by status" className="mb-4 flex flex-wrap gap-2">
        {TABS.map((t) => (
          <Link key={t} href={`/admin/organisations?status=${t}`} aria-current={t === status ? "page" : undefined}
            className={`flex h-9 items-center rounded-full border px-3 text-sm font-medium capitalize ${t === status ? "border-brand bg-brand text-brand-foreground" : "border-border bg-surface"}`}>
            {t}
          </Link>
        ))}
      </nav>
      {orgs.length === 0 ? (
        <p className="text-muted">Nothing here.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {orgs.map((o) => (
            <li key={o.id}>
              <Link href={`/admin/organisations/${o.id}`} className="block rounded-xl border border-border bg-surface p-3">
                <p className="font-medium">{o.name}{o.is_demo && <span className="ml-2 rounded bg-urgent/10 px-1.5 text-xs font-semibold text-urgent-strong">DEMO</span>}</p>
                <p className="text-sm text-muted">
                  {typeLabel(o.type)} · {verificationLabel(o.verification_status)} · {o.operating_area ?? "Area not given"} · updated {formatMelbourne(o.updated_at)}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

export default function AdminOrgsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  return (
    <Suspense fallback={<main className="mx-auto min-h-dvh max-w-lg px-4 py-8 text-muted">Loading…</main>}>
      <AdminOrgsPageContent searchParams={searchParams} />
    </Suspense>
  );
}
