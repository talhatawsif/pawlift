import { Suspense } from "react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { ArrowRight } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getMyContext } from "@/lib/session";
import { bucketOf, incidentLabel, legLabel, windowLabel, type Bucket, type OrgIncident, type OrgRow } from "@/lib/assignments";
import { formatMelbourne } from "@/lib/org";
import { urgencyLabel } from "@/lib/requests";
import type { MemberItem } from "@/lib/membership";
import {
  CompleteForm, ConfirmButton, OfferForm, ReassignForm, ReleaseButton, ResolveForm, WithdrawOfferButton, type Volunteer,
} from "@/components/DashboardActions";

export const metadata = { title: "Dashboard · PawLift" };

const SECTIONS: { key: Bucket; title: string; empty: string }[] = [
  { key: "needs_driver", title: "Needs a driver", empty: "Every open request has someone lined up." },
  { key: "awaiting", title: "Waiting for you to confirm", empty: "" },
  { key: "to_complete", title: "Delivered: confirm the animal arrived", empty: "" },
  { key: "in_progress", title: "On the way", empty: "" },
  { key: "confirmed", title: "Confirmed", empty: "" },
  { key: "completed", title: "Completed in the last 30 days", empty: "" },
];

function RowCard({ r, orgId, volunteers }: { r: OrgRow; orgId: string; volunteers: Volunteer[] }) {
  const b = bucketOf(r);
  return (
    <li className="rounded-xl border border-border bg-surface p-3">
      <p className="font-medium">
        {r.animal_name} <span className="text-sm font-normal text-muted">· {r.reference}</span>
        {r.is_demo && <span className="ml-2 rounded bg-urgent/10 px-1.5 text-xs font-semibold text-urgent-strong">DEMO</span>}
        {r.open_incidents > 0 && <span className="ml-2 rounded bg-danger/10 px-1.5 text-xs font-semibold text-danger">Needs attention</span>}
      </p>
      <p className="flex items-center gap-1 text-sm text-muted">{r.origin_suburb} <ArrowRight size={14} aria-hidden /> {r.destination_suburb}</p>
      <p className="text-sm text-muted">{windowLabel(r.window_start, r.window_end)} · {urgencyLabel(r.urgency)}</p>
      <p className="mt-1 text-sm">
        {r.volunteer_name ? <>Volunteer: <strong>{r.volunteer_name}</strong> · </> : null}
        {r.request_status === "completed" ? `Completed ${r.completed_at ? formatMelbourne(r.completed_at) : ""}` : legLabel(r.leg_status)}
        {r.assignment_status === "offered" && " (offer sent)"}
      </p>
      <div className="mt-3 flex flex-col gap-3">
        {b === "needs_driver" && <OfferForm orgId={orgId} legId={r.leg_id} volunteers={volunteers} />}
        {b === "awaiting" && r.assignment_id && r.assignment_status === "reserved" && (
          <>
            <ConfirmButton orgId={orgId} assignmentId={r.assignment_id} />
            <ReleaseButton orgId={orgId} assignmentId={r.assignment_id} />
          </>
        )}
        {b === "awaiting" && r.assignment_id && r.assignment_status === "offered" && (
          <WithdrawOfferButton orgId={orgId} assignmentId={r.assignment_id} />
        )}
        {b === "confirmed" && r.assignment_id && <ReassignForm orgId={orgId} assignmentId={r.assignment_id} volunteers={volunteers} />}
        {b === "to_complete" && <CompleteForm orgId={orgId} requestId={r.request_id} />}
        <Link href={`/org/${orgId}/audit?request=${r.request_id}`} className="text-sm font-medium text-brand underline">History for this request</Link>
      </div>
    </li>
  );
}

async function Content({ params }: { params: Promise<{ id: string }> }) {
  await connection();
  const { id } = await params;
  const ctx = await getMyContext();
  if (!ctx) redirect("/sign-in");
  const supabase = await createClient();
  const [rowsRes, incRes, memRes] = await Promise.all([
    supabase.rpc("list_org_assignments", { p_org_id: id }),
    supabase.rpc("list_org_incidents", { p_org_id: id }),
    supabase.rpc("list_org_members", { p_org_id: id }),
  ]);
  if (rowsRes.error) notFound();
  const rows = (rowsRes.data ?? []) as unknown as OrgRow[];
  const incidents = ((incRes.data ?? []) as unknown as OrgIncident[]);
  const open = incidents.filter((i) => i.status !== "resolved");
  const volunteers: Volunteer[] = ((memRes.data ?? []) as unknown as MemberItem[])
    .filter((m) => m.status === "active" && m.is_volunteer && m.volunteer_status === "verified")
    .map((m) => ({ user_id: m.user_id, name: m.display_name ?? "Volunteer" }));

  return (
    <main className="mx-auto min-h-dvh max-w-lg px-4 py-8">
      <Link href={`/org/${id}`} className="text-sm font-medium text-brand underline">Back to organisation</Link>
      <h1 className="mb-1 mt-4 text-2xl font-semibold">Dashboard</h1>
      <p className="mb-4 text-sm text-muted">
        <Link href={`/org/${id}/requests`} className="font-medium text-brand underline">Requests</Link> ·{" "}
        <Link href={`/org/${id}/audit`} className="font-medium text-brand underline">Audit trail</Link>
      </p>

      {open.length > 0 && (
        <section aria-label="Open problems" className="mb-6">
          <h2 className="mb-2 text-lg font-semibold">Problems reported</h2>
          <ul className="flex flex-col gap-2">
            {open.map((i) => (
              <li key={i.id} className={`rounded-xl border p-3 ${i.severity === "high" ? "border-danger" : "border-border"}`}>
                <p className="font-medium">{incidentLabel(i.type)} · {i.animal_name} <span className="text-sm font-normal text-muted">({i.reference})</span></p>
                <p className="text-sm">{i.description}</p>
                <p className="mb-2 text-xs text-muted">{i.severity === "high" ? "Serious" : "Minor"} · {i.raised_by_name ?? "Someone"} · {formatMelbourne(i.created_at)}</p>
                <ResolveForm orgId={id} incidentId={i.id} />
              </li>
            ))}
          </ul>
        </section>
      )}

      {SECTIONS.map(({ key, title, empty }) => {
        const list = rows.filter((r) => bucketOf(r) === key);
        if (list.length === 0 && !empty) return null;
        return (
          <section key={key} aria-label={title} className="mb-6">
            <h2 className="mb-2 text-lg font-semibold">{title}{list.length > 0 && ` (${list.length})`}</h2>
            {list.length === 0 ? <p className="text-sm text-muted">{empty}</p> : (
              <ul className="flex flex-col gap-3">{list.map((r) => <RowCard key={r.leg_id} r={r} orgId={id} volunteers={volunteers} />)}</ul>
            )}
          </section>
        );
      })}
    </main>
  );
}

export default function DashboardPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<main className="mx-auto min-h-dvh max-w-lg px-4 py-8 text-muted">Loading…</main>}>
      <Content params={params} />
    </Suspense>
  );
}
