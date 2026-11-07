import { Suspense } from "react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getMyContext } from "@/lib/session";
import { auditLabel, type AuditRow } from "@/lib/assignments";
import { formatMelbourne } from "@/lib/org";

export const metadata = { title: "Audit trail · PawLift" };
const UUID = /^[0-9a-f-]{36}$/i;

async function Content({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ request?: string }> }) {
  await connection();
  const { id } = await params;
  const { request } = await searchParams;
  const ctx = await getMyContext();
  if (!ctx) redirect("/sign-in");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("list_org_audit", {
    p_org_id: id,
    p_request_id: (request && UUID.test(request) ? request : null) as string,
    p_limit: 100,
  });
  if (error) notFound();
  const rows = (data ?? []) as unknown as AuditRow[];
  return (
    <main className="mx-auto min-h-dvh max-w-lg px-4 py-8">
      <Link href={`/org/${id}/dashboard`} className="text-sm font-medium text-brand underline">Back to dashboard</Link>
      <h1 className="mb-1 mt-4 text-2xl font-semibold">Audit trail</h1>
      <p className="mb-4 text-sm text-muted">{request ? "Everything recorded for one request." : "The latest 100 recorded actions for your organisation."}</p>
      {rows.length === 0 ? <p className="text-muted">Nothing recorded yet.</p> : (
        <ol className="flex flex-col gap-2">
          {rows.map((r) => (
            <li key={r.id} className="rounded-xl border border-border bg-surface p-3 text-sm">
              <p className="font-medium">{auditLabel(r.action)}</p>
              <p className="text-muted">
                <time dateTime={r.created_at}>{formatMelbourne(r.created_at)}</time> · {r.actor_name ?? "System"}
              </p>
              {r.reason && <p>{r.reason}</p>}
            </li>
          ))}
        </ol>
      )}
    </main>
  );
}

export default function AuditPage(props: { params: Promise<{ id: string }>; searchParams: Promise<{ request?: string }> }) {
  return (
    <Suspense fallback={<main className="mx-auto min-h-dvh max-w-lg px-4 py-8 text-muted">Loading…</main>}>
      <Content {...props} />
    </Suspense>
  );
}
