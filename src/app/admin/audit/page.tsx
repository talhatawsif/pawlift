import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getMyContext } from "@/lib/session";
import { auditLabel } from "@/lib/assignments";
import { formatMelbourne } from "@/lib/org";
import type { AdminAuditRow } from "@/lib/ops";

export const metadata = { title: "Audit log · PawLift" };
const PAGE = 50;
const UUID = /^[0-9a-f-]{36}$/i;

async function Content({ searchParams }: { searchParams: Promise<{ org?: string; before?: string }> }) {
  await connection();
  const ctx = await getMyContext();
  if (!ctx?.is_admin) notFound();
  const { org, before: rawBefore } = await searchParams;
  const before = rawBefore && !Number.isNaN(Date.parse(rawBefore)) ? new Date(rawBefore).toISOString() : null;
  const orgId = org && UUID.test(org) ? org : null;
  const supabase = await createClient();
  const { data } = await supabase.rpc("admin_list_audit", { p_org_id: orgId as string, p_limit: PAGE + 1, p_before: before as string });
  const all = (data ?? []) as unknown as AdminAuditRow[];
  const rows = all.slice(0, PAGE);
  const last = rows[rows.length - 1]?.created_at;
  const q = (b: string) => `/admin/audit?${orgId ? `org=${orgId}&` : ""}before=${encodeURIComponent(b)}`;
  return (
    <main className="mx-auto min-h-dvh max-w-2xl px-4 py-8">
      <Link href="/" className="text-sm font-medium text-brand underline">Back to map</Link>
      <h1 className="mb-1 mt-4 text-2xl font-semibold">Audit log</h1>
      <p className="mb-4 text-sm text-muted">{orgId ? "One organisation." : "All organisations."} Newest first.</p>
      {rows.length === 0 ? <p className="text-muted">Nothing recorded.</p> : (
        <ol className="flex flex-col gap-2">
          {rows.map((r) => (
            <li key={r.id} className="rounded-xl border border-border bg-surface p-3 text-sm">
              <p className="font-medium">{auditLabel(r.action)}</p>
              <p className="text-muted">
                <time dateTime={r.created_at}>{formatMelbourne(r.created_at)}</time> · {r.actor_name ?? "System"}
                {r.org_name && r.org_id && <> · <Link href={`/admin/audit?org=${r.org_id}`} className="underline">{r.org_name}</Link></>}
              </p>
              {r.reason && <p>{r.reason}</p>}
            </li>
          ))}
        </ol>
      )}
      {all.length > PAGE && last && (
        <Link href={q(last)} className="mt-4 flex h-12 items-center justify-center rounded-xl border border-border bg-surface font-semibold">Older</Link>
      )}
    </main>
  );
}

export default function AdminAuditPage(props: { searchParams: Promise<{ org?: string; before?: string }> }) {
  return (
    <Suspense fallback={<main className="mx-auto min-h-dvh max-w-2xl px-4 py-8 text-muted">Loading…</main>}>
      <Content {...props} />
    </Suspense>
  );
}
