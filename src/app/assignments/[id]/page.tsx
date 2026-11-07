import { Suspense } from "react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { ArrowRight, ExternalLink, Phone } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getMyContext } from "@/lib/session";
import { assignmentLabel, legLabel, windowLabel, type MyAssignment, type PrivateDetails, type PrivatePlace } from "@/lib/assignments";
import { stopLink } from "@/lib/nav-links";
import { formatMelbourne } from "@/lib/org";
import { AssignmentActions, IncidentForm } from "@/components/AssignmentActions";

export const metadata = { title: "Assignment · PawLift" };

function Place({ title, p, active }: { title: string; p: PrivatePlace; active: boolean }) {
  const links = (["google", "apple", "waze"] as const).map((app) => ({ app, href: stopLink(app, p) })).filter((l) => l.href);
  return (
    <section className={`rounded-xl border p-3 ${active ? "border-brand" : "border-border"}`}>
      <h3 className="font-semibold">{title}: {p.label} ({p.suburb})</h3>
      <p className="text-sm">{p.address ?? "No address recorded. Contact the coordinator."}</p>
      {p.contact_name && <p className="text-sm">Contact: {p.contact_name}</p>}
      {p.contact_phone && (
        <a href={`tel:${p.contact_phone.replace(/\s+/g, "")}`} className="flex items-center gap-1 text-sm font-medium text-brand underline">
          <Phone size={14} aria-hidden />{p.contact_phone}
        </a>
      )}
      {p.instructions && <p className="mt-1 text-sm text-muted">{p.instructions}</p>}
      {active && links.length > 0 && (
        <p className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-sm">
          {links.map((l) => (
            <a key={l.app} href={l.href!} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 font-medium text-brand underline">
              {l.app === "google" ? "Google Maps" : l.app === "apple" ? "Apple Maps" : "Waze"}<ExternalLink size={12} aria-hidden />
            </a>
          ))}
        </p>
      )}
    </section>
  );
}

async function Content({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ claimed?: string }> }) {
  await connection();
  const { id } = await params;
  const sp = await searchParams;
  const ctx = await getMyContext();
  if (!ctx) redirect("/sign-in");
  const supabase = await createClient();
  const { data } = await supabase.rpc("list_my_assignments");
  const a = ((data ?? []) as unknown as MyAssignment[]).find((x) => x.assignment_id === id);
  if (!a) notFound();

  const wantsDetails = a.assignment_status === "confirmed" && ["confirmed", "en_route", "collected"].includes(a.leg_status);
  let details: PrivateDetails | null = null;
  if (wantsDetails) {
    const res = await supabase.rpc("get_leg_private_details", { p_leg_id: a.leg_id });
    details = res.error ? null : (res.data as unknown as PrivateDetails);
  }
  const active = a.assignment_status === "confirmed" && !["delivered", "cancelled"].includes(a.leg_status);

  return (
    <main className="mx-auto min-h-dvh max-w-lg px-4 py-8">
      <Link href="/assignments" className="text-sm font-medium text-brand underline">All assignments</Link>
      <h1 className="mt-4 text-2xl font-semibold">{a.animal_name}</h1>
      <p className="text-muted">
        {a.reference} · {a.org_name}
        {a.is_demo && <span className="ml-2 rounded bg-urgent/10 px-1.5 text-xs font-semibold text-urgent">DEMO</span>}
      </p>
      {sp.claimed && a.assignment_status === "reserved" && (
        <p role="status" className="mt-3 rounded-xl border border-border bg-surface p-3 text-sm">Reserved for you. The organisation will confirm shortly.</p>
      )}
      <p className="mt-3 flex items-center gap-2 text-lg font-medium">
        {a.origin_suburb} <ArrowRight size={18} aria-hidden /> {a.destination_suburb}
      </p>
      {a.leg_count > 1 && <p className="text-sm font-medium">Relay: leg {a.seq} of {a.leg_count}</p>}
      <p className="text-sm text-muted">Pickup between {windowLabel(a.window_start, a.window_end)}</p>
      <p role="status" className="mt-3 rounded-xl border border-border bg-surface p-3 text-sm font-medium">
        {a.assignment_status === "confirmed" ? legLabel(a.leg_status) : assignmentLabel(a.assignment_status)}
        {a.assignment_status === "reserved" && a.reserved_until && ` (held until ${formatMelbourne(a.reserved_until)})`}
        {a.assignment_status === "offered" && a.offer_expires_at && ` (offer ends ${formatMelbourne(a.offer_expires_at)})`}
      </p>

      {a.assignment_status === "reserved" && (
        <p className="mt-3 text-sm text-muted">Exact addresses and contacts appear here once the organisation confirms you.</p>
      )}
      {wantsDetails && !details && (
        <p role="alert" className="mt-3 rounded-xl border border-danger p-3 text-sm">You no longer have access to the pickup details.</p>
      )}
      {details && (
        <div className="mt-4 flex flex-col gap-3">
          <Place title="Pickup" p={details.pickup} active={a.leg_status !== "collected"} />
          <Place title="Drop-off" p={details.dropoff} active={a.leg_status === "collected"} />
          <section className="rounded-xl border border-border p-3 text-sm">
            <h3 className="font-semibold">About {details.animal_name}</h3>
            {details.handling_requirements && <p>Handling: {details.handling_requirements}</p>}
            {details.carrier_requirements && <p>Carrier: {details.carrier_requirements}</p>}
            {details.medical_notes && <p>Medical: {details.medical_notes}</p>}
            {details.coordinator_instructions && <p>From the coordinator: {details.coordinator_instructions}</p>}
          </section>
        </div>
      )}

      <div className="mt-6 flex flex-col gap-4">
        <AssignmentActions
          id={a.assignment_id} status={a.assignment_status} legStatus={a.leg_status}
          seq={a.seq} previousLegStatus={a.previous_leg_status} handoverBlocked={a.handover_blocked}
        />
        {active && <IncidentForm requestId={a.request_id} legId={a.leg_id} />}
      </div>
      {a.assignment_status === "completed" && (
        <p className="mt-4 text-sm text-muted">Delivered. Thank you. The organisation records the completion.</p>
      )}
    </main>
  );
}

export default function AssignmentPage(props: { params: Promise<{ id: string }>; searchParams: Promise<{ claimed?: string }> }) {
  return (
    <Suspense fallback={<main className="mx-auto min-h-dvh max-w-lg px-4 py-8 text-muted">Loading…</main>}>
      <Content {...props} />
    </Suspense>
  );
}
