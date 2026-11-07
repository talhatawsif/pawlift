import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getMyContext } from "@/lib/session";
import { formatMelbourne } from "@/lib/org";
import { speciesLabel, volunteerLabel, type AdminVolunteer } from "@/lib/membership";
import { decideVolunteer } from "@/app/admin/actions";
import { DecisionForm } from "@/components/DecisionForm";

export const metadata = { title: "Review volunteer · PawLift" };

async function AdminVolunteerContent({ params }: { params: Promise<{ id: string }> }) {
  await connection();
  const { id } = await params;
  const ctx = await getMyContext();
  if (!ctx?.is_admin) notFound();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_get_volunteer", { p_user_id: id });
  if (error || !data) notFound();
  const v = data as unknown as AdminVolunteer;
  const rows: [string, string][] = [
    ["Organisations", v.orgs.join(", ") || "None yet"],
    ["Animals", v.species_ok.map(speciesLabel).join(", ") || "Not given"],
    ["Largest animal", v.max_size ?? "Not given"],
    ["Secure carrier", v.has_carrier ? "Yes" : "No"],
    ["Vehicle notes", v.vehicle_notes || "Not given"],
    ["Availability", [v.availability.days?.join(", "), v.availability.notes].filter(Boolean).join(" · ") || "Not given"],
    ["Guidelines", v.guidelines_accepted_at ? `${v.guidelines_version_accepted} accepted ${formatMelbourne(v.guidelines_accepted_at)}` : "Not accepted"],
  ];
  return (
    <main className="mx-auto min-h-dvh max-w-2xl px-4 py-8">
      <Link href="/admin/volunteers" className="text-sm font-medium text-brand underline">Back to queue</Link>
      <h1 className="mt-4 text-2xl font-semibold">{v.display_name ?? "Unnamed"}</h1>
      <p className="text-muted">{volunteerLabel(v.verification_status)}</p>
      <dl className="mt-4 grid gap-3 rounded-xl border border-border bg-surface p-4 text-sm">
        {rows.map(([k, val]) => (<div key={k}><dt className="font-medium">{k}</dt><dd className="whitespace-pre-wrap text-muted">{val}</dd></div>))}
      </dl>
      <section className="mt-6">
        <h2 className="mb-3 text-lg font-semibold">Decision</h2>
        <DecisionForm action={decideVolunteer} subjectId={v.user_id} status={v.verification_status} subject="volunteer" />
      </section>
      {v.history.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-2 text-lg font-semibold">History</h2>
          <ul className="flex flex-col gap-2 text-sm">
            {v.history.map((h, i) => (
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

export default function AdminVolunteerPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<main className="mx-auto min-h-dvh max-w-lg px-4 py-8 text-muted">Loading…</main>}>
      <AdminVolunteerContent params={params} />
    </Suspense>
  );
}
