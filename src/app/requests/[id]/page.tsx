import { Suspense } from "react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { ArrowRight, Clock } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getMyContext } from "@/lib/session";
import { windowLabel, type RequestView } from "@/lib/assignments";
import { publicPhotoUrl, speciesLabel, urgencyLabel } from "@/lib/requests";
import { ClaimForm } from "@/components/ClaimForm";

export const metadata = { title: "Transport request · PawLift" };

async function Content({ params }: { params: Promise<{ id: string }> }) {
  await connection();
  const { id } = await params;
  const ctx = await getMyContext();
  if (!ctx) redirect("/sign-in");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_request_detail", { p_request_id: id });
  if (error || !data) notFound();
  const r = data as unknown as RequestView;

  return (
    <main className="mx-auto min-h-dvh max-w-lg px-4 py-8">
      <Link href="/" className="text-sm font-medium text-brand underline">Back to map</Link>
      <h1 className="mt-4 text-2xl font-semibold">{r.animal_name}</h1>
      <p className="mb-4 text-muted">
        {speciesLabel(r.species)} · {urgencyLabel(r.urgency)} · {r.org_name}
        {r.org_verification_status === "verified" && " (verified)"}
        {r.is_demo && <span className="ml-2 rounded bg-urgent/10 px-1.5 text-xs font-semibold text-urgent-strong">DEMO</span>}
      </p>
      {r.photo_path && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={publicPhotoUrl(r.photo_path)} alt={r.animal_name} className="mb-4 max-h-64 w-full rounded-xl object-cover" />
      )}
      <p className="flex items-center gap-2 text-lg font-medium">
        {r.origin_suburb} <ArrowRight size={18} aria-hidden /> {r.destination_suburb}
      </p>
      <p className="text-sm text-muted">{r.origin_label} to {r.destination_label}. Exact addresses are shared with the confirmed volunteer only.</p>
      <p className="mt-3 flex items-center gap-2 text-sm"><Clock size={16} aria-hidden />Pickup between {windowLabel(r.window_start, r.window_end)}</p>
      {r.deadline && <p className="mt-1 text-sm text-muted">Needs to arrive by {windowLabel(r.deadline, r.deadline).split(" to ")[0]}</p>}
      {r.handling_requirements && <p className="mt-3 text-sm"><strong>Handling:</strong> {r.handling_requirements}</p>}
      {r.carrier_requirements && <p className="mt-1 text-sm"><strong>Carrier:</strong> {r.carrier_requirements}</p>}

      <section className="mt-6">
        {r.my_assignment_id ? (
          <Link href={`/assignments/${r.my_assignment_id}`} className="flex h-12 items-center justify-center rounded-xl bg-brand font-semibold text-brand-foreground">
            Open your assignment
          </Link>
        ) : (
          <ClaimForm legId={r.leg_id} blocked={r.claim_block} animalName={r.animal_name} />
        )}
      </section>
    </main>
  );
}

export default function RequestPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<main className="mx-auto min-h-dvh max-w-lg px-4 py-8 text-muted">Loading…</main>}>
      <Content params={params} />
    </Suspense>
  );
}
