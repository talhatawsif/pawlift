import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getMyContext } from "@/lib/session";
import { formatMelbourne, typeLabel, verificationLabel, type OrgDetail } from "@/lib/org";
import { DecisionForm } from "@/components/DecisionForm";

export const metadata = { title: "Review organisation · PawLift" };

async function AdminOrgPageContent({ params }: { params: Promise<{ id: string }> }) {
  await connection();
  const { id } = await params;
  const ctx = await getMyContext();
  if (!ctx?.is_admin) notFound();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_org_for_coordinator", { p_org_id: id });
  if (error || !data) notFound();
  const org = data as unknown as OrgDetail;
  const rows: [string, string | null][] = [
    ["Type", typeLabel(org.type)],
    ["Registration details", org.registration_details],
    ["Contact", [org.contact_name, org.contact_email, org.contact_phone].filter(Boolean).join(" · ") || null],
    ["Operating area", org.operating_area],
    ["Website", org.website],
    ["About", org.description],
    ["Registered", formatMelbourne(org.created_at)],
  ];

  return (
    <main className="mx-auto min-h-dvh max-w-2xl px-4 py-8">
      <Link href="/admin/organisations" className="text-sm font-medium text-brand underline">Back to queue</Link>
      <h1 className="mt-4 text-2xl font-semibold">{org.name}</h1>
      <p className="text-muted">{verificationLabel(org.verification_status)}</p>
      <dl className="mt-4 grid gap-3 rounded-xl border border-border bg-surface p-4 text-sm">
        {rows.map(([k, v]) => (
          <div key={k}>
            <dt className="font-medium">{k}</dt>
            <dd className="whitespace-pre-wrap text-muted">{v || "Not given"}</dd>
          </div>
        ))}
      </dl>
      <section className="mt-6">
        <h2 className="mb-3 text-lg font-semibold">Decision</h2>
        <DecisionForm orgId={org.id} status={org.verification_status} />
      </section>
      {org.history.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-2 text-lg font-semibold">History</h2>
          <ul className="flex flex-col gap-2 text-sm">
            {org.history.map((h, i) => (
              <li key={i} className="rounded-xl border border-border bg-surface p-3">
                <p className="font-medium">{h.decision} · <time dateTime={h.decided_at}>{formatMelbourne(h.decided_at)}</time></p>
                {h.checks.length > 0 && <ul className="list-disc pl-5 text-muted">{h.checks.map((c, j) => <li key={j}>{c}</li>)}</ul>}
                {h.reason && <p className="text-muted">Reason: {h.reason}</p>}
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}

export default function AdminOrgPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<main className="mx-auto min-h-dvh max-w-lg px-4 py-8 text-muted">Loading…</main>}>
      <AdminOrgPageContent params={params} />
    </Suspense>
  );
}
