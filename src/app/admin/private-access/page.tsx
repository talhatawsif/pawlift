import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getMyContext } from "@/lib/session";
import { formatMelbourne } from "@/lib/org";
import type { PrivateAccessRow } from "@/lib/ops";
import { PrivateDetailsForm } from "@/components/PrivateDetailsForm";

export const metadata = { title: "Private access log · PawLift" };
const UUID = /^[0-9a-f-]{36}$/i;

async function Content({ searchParams }: { searchParams: Promise<{ request?: string }> }) {
  await connection();
  const ctx = await getMyContext();
  if (!ctx?.is_admin) notFound();
  const { request } = await searchParams;
  const supabase = await createClient();
  const { data } = await supabase.rpc("admin_list_private_access", { p_limit: 100 });
  const rows = (data ?? []) as unknown as PrivateAccessRow[];
  return (
    <main className="mx-auto min-h-dvh max-w-2xl px-4 py-8">
      <Link href="/" className="text-sm font-medium text-brand underline">Back to map</Link>
      <h1 className="mb-1 mt-4 text-2xl font-semibold">Private access</h1>
      <p className="mb-4 text-sm text-muted">
        Exact addresses, contacts and medical notes are hidden from admins by default. Opening them needs a written reason, and
        every view is recorded below and on the organisation&rsquo;s own audit trail.
      </p>
      <PrivateDetailsForm requestId={request && UUID.test(request) ? request : undefined} />
      <h2 className="mb-2 mt-8 text-lg font-semibold">Recorded views</h2>
      {rows.length === 0 ? <p className="text-muted">No private details have been opened.</p> : (
        <ol className="flex flex-col gap-2">
          {rows.map((r) => (
            <li key={r.id} className="rounded-xl border border-border bg-surface p-3 text-sm">
              <p className="font-medium">{r.animal_name ?? "Lift"} {r.reference ? `(${r.reference})` : ""}{r.org_name ? ` · ${r.org_name}` : ""}</p>
              <p className="text-muted"><time dateTime={r.created_at}>{formatMelbourne(r.created_at)}</time> · {r.actor_name ?? "Unknown admin"}</p>
              <p>{r.reason}</p>
            </li>
          ))}
        </ol>
      )}
    </main>
  );
}

export default function PrivateAccessPage(props: { searchParams: Promise<{ request?: string }> }) {
  return (
    <Suspense fallback={<main className="mx-auto min-h-dvh max-w-2xl px-4 py-8 text-muted">Loading…</main>}>
      <Content {...props} />
    </Suspense>
  );
}
