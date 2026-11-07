import { Suspense } from "react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getMyContext } from "@/lib/session";
import type { OrgDetail } from "@/lib/org";
import { formatMelbourne } from "@/lib/org";
import { speciesLabel, statusLabel, urgencyLabel, type RequestSummary } from "@/lib/requests";

export const metadata = { title: "Transport requests · PawLift" };

async function RequestsContent({ params }: { params: Promise<{ id: string }> }) {
  await connection();
  const { id } = await params;
  const ctx = await getMyContext();
  if (!ctx) redirect("/sign-in");
  const supabase = await createClient();
  const [{ data: orgData }, { data: listData, error }] = await Promise.all([
    supabase.rpc("get_org_for_coordinator", { p_org_id: id }),
    supabase.rpc("list_org_requests", { p_org_id: id }),
  ]);
  if (error || !orgData) notFound();
  const org = orgData as unknown as OrgDetail;
  const requests = (listData ?? []) as unknown as RequestSummary[];

  return (
    <main className="mx-auto min-h-dvh max-w-lg px-4 py-8">
      <Link href={`/org/${id}`} className="text-sm font-medium text-brand underline">Back to {org.name}</Link>
      <h1 className="mb-4 mt-4 text-2xl font-semibold">Transport requests</h1>
      <Link href={`/org/${id}/requests/new`} className="mb-6 flex h-12 items-center justify-center rounded-xl bg-brand font-semibold text-brand-foreground">
        New request
      </Link>
      {requests.length === 0 ? <p className="text-muted">No requests yet.</p> : (
        <ul className="flex flex-col gap-3">
          {requests.map((r) => (
            <li key={r.id}>
              <Link href={`/org/${id}/requests/${r.id}`} className="block rounded-xl border border-border bg-surface p-3">
                <p className="font-medium">{r.animal_name} <span className="text-sm font-normal text-muted">· {speciesLabel(r.species)} · {r.reference}</span></p>
                <p className="text-sm text-muted">{r.origin_suburb} to {r.destination_suburb}</p>
                <p className="text-sm text-muted">{formatMelbourne(r.window_start)} · {urgencyLabel(r.urgency)} · <span className="font-medium text-foreground">{statusLabel(r.status)}</span></p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

export default function RequestsPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<main className="mx-auto min-h-dvh max-w-lg px-4 py-8 text-muted">Loading…</main>}>
      <RequestsContent params={params} />
    </Suspense>
  );
}
