import { Suspense } from "react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { ArrowRight } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getMyContext } from "@/lib/session";
import { formatMelbourne } from "@/lib/org";
import { DEMO_BADGE, requestStatusLabel, type HistoryRow } from "@/lib/ops";

export const metadata = { title: "Transport history · PawLift" };
const PAGE = 25;

async function Content({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ before?: string }> }) {
  await connection();
  const { id } = await params;
  const { before: rawBefore } = await searchParams;
  const before = rawBefore && !Number.isNaN(Date.parse(rawBefore)) ? new Date(rawBefore).toISOString() : null;
  const ctx = await getMyContext();
  if (!ctx) redirect("/sign-in");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("list_transport_history", { p_org_id: id, p_limit: PAGE + 1, p_before: before as string });
  if (error) notFound();
  const all = (data ?? []) as unknown as HistoryRow[];
  const rows = all.slice(0, PAGE);
  const last = rows[rows.length - 1]?.ended_at;
  return (
    <main className="mx-auto min-h-dvh max-w-lg px-4 py-8">
      <Link href={`/org/${id}`} className="text-sm font-medium text-brand underline">Back to organisation</Link>
      <h1 className="mb-1 mt-4 text-2xl font-semibold">Transport history</h1>
      <p className="mb-4 text-sm text-muted">Completed and cancelled lifts, newest first.</p>
      {rows.length === 0 ? <p className="text-muted">Nothing here yet.</p> : (
        <ul className="flex flex-col gap-2">
          {rows.map((r) => (
            <li key={r.request_id} className="rounded-xl border border-border bg-surface p-3 text-sm">
              <p className="font-medium">
                {r.animal_name} <span className="font-normal text-muted">· {r.reference}</span>
                {r.is_demo && <span className={DEMO_BADGE}>DEMO</span>}
              </p>
              <p className="flex items-center gap-1 text-muted">{r.origin_suburb ?? "?"} <ArrowRight size={14} aria-hidden /> {r.destination_suburb ?? "?"}</p>
              <p>{requestStatusLabel(r.status)}{r.ended_at && <> · <time dateTime={r.ended_at}>{formatMelbourne(r.ended_at)}</time></>}</p>
              {r.driver_name && <p className="text-muted">Driver: {r.driver_name}</p>}
              {r.cancel_reason && <p className="text-muted">Reason: {r.cancel_reason}</p>}
              <Link href={`/org/${id}/audit?request=${r.request_id}`} className="mt-1 inline-block font-medium text-brand underline">Audit trail</Link>
            </li>
          ))}
        </ul>
      )}
      {all.length > PAGE && last && (
        <Link href={`/org/${id}/history?before=${encodeURIComponent(last)}`} className="mt-4 flex h-12 items-center justify-center rounded-xl border border-border bg-surface font-semibold">
          Older
        </Link>
      )}
    </main>
  );
}

export default function HistoryPage(props: { params: Promise<{ id: string }>; searchParams: Promise<{ before?: string }> }) {
  return (
    <Suspense fallback={<main className="mx-auto min-h-dvh max-w-lg px-4 py-8 text-muted">Loading…</main>}>
      <Content {...props} />
    </Suspense>
  );
}
