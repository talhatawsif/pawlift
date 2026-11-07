import { Suspense } from "react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { BadgeCheck } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getMyContext } from "@/lib/session";
import { formatMelbourne, typeLabel, verificationLabel, type OrgDetail } from "@/lib/org";
import { resubmitOrganisation } from "@/app/org/actions";
import { OrgForm } from "@/components/OrgForm";

export const metadata = { title: "Your organisation · PawLift" };

async function OrgPageContent({ params }: { params: Promise<{ id: string }> }) {
  await connection();
  const { id } = await params;
  const ctx = await getMyContext();
  if (!ctx) redirect("/sign-in");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_org_for_coordinator", { p_org_id: id });
  if (error || !data) notFound();
  const org = data as unknown as OrgDetail;
  const last = org.history[0];

  return (
    <main className="mx-auto min-h-dvh max-w-lg px-4 py-8">
      <Link href="/" className="text-sm font-medium text-brand underline">Back to map</Link>
      <h1 className="mt-4 text-2xl font-semibold">{org.name}</h1>
      <p className="mt-1 flex items-center gap-1 text-muted">
        {org.verification_status === "verified" && <BadgeCheck size={16} className="text-brand" aria-hidden />}
        {typeLabel(org.type)} · {verificationLabel(org.verification_status)}
        {org.is_demo && <span className="ml-2 rounded bg-urgent/10 px-1.5 text-xs font-semibold text-urgent">DEMO</span>}
      </p>

      <Link href={`/org/${org.id}/members`} className="mt-4 flex h-12 items-center justify-center rounded-xl border border-border bg-surface font-semibold">
        Volunteers and invitations
      </Link>
      <Link href={`/org/${org.id}/locations`} className="mt-2 flex h-12 items-center justify-center rounded-xl border border-border bg-surface font-semibold">
        Locations and destinations
      </Link>
      {org.verification_status !== "suspended" && (
        <Link href={`/org/${org.id}/requests`} className="mt-2 flex h-12 items-center justify-center rounded-xl border border-border bg-surface font-semibold">
          Transport requests
        </Link>
      )}

      {org.verification_status === "pending" && (
        <p role="status" className="mt-4 rounded-xl border border-border bg-surface p-3 text-sm">
          We&rsquo;re checking your details. You can&rsquo;t publish transport requests until you&rsquo;re verified.
        </p>
      )}
      {org.verification_status === "verified" && (
        <p role="status" className="mt-4 rounded-xl border border-border bg-surface p-3 text-sm">
          You&rsquo;re verified. Coordinators can publish transport requests.
        </p>
      )}
      {org.verification_status === "suspended" && (
        <p role="alert" className="mt-4 rounded-xl border border-danger p-3 text-sm">
          This organisation is suspended and can&rsquo;t take actions.{last?.reason ? ` Reason: ${last.reason}` : ""}
        </p>
      )}
      {org.verification_status === "rejected" && (
        <section className="mt-4">
          <p role="alert" className="rounded-xl border border-danger p-3 text-sm">
            We couldn&rsquo;t verify this organisation{last?.reason ? `: ${last.reason}` : "."} Fix the details below and submit again.
          </p>
          <h2 className="mb-3 mt-6 text-lg font-semibold">Update and resubmit</h2>
          <OrgForm action={resubmitOrganisation} org={org} submitLabel="Resubmit for verification" />
        </section>
      )}

      {org.history.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-2 text-lg font-semibold">Verification history</h2>
          <ul className="flex flex-col gap-2 text-sm">
            {org.history.map((h, i) => (
              <li key={i} className="rounded-xl border border-border bg-surface p-3">
                <p className="font-medium">{h.decision} · <time dateTime={h.decided_at}>{formatMelbourne(h.decided_at)}</time></p>
                {h.reason && <p className="text-muted">{h.reason}</p>}
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}

export default function OrgPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<main className="mx-auto min-h-dvh max-w-lg px-4 py-8 text-muted">Loading…</main>}>
      <OrgPageContent params={params} />
    </Suspense>
  );
}
