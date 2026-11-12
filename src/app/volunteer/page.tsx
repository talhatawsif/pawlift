import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getMyContext, signInUrl } from "@/lib/session";
import { formatMelbourne } from "@/lib/org";
import { volunteerLabel, type VolunteerProfile } from "@/lib/membership";
import { GUIDELINES, GUIDELINES_VERSION } from "@/lib/guidelines";
import { acceptGuidelines, resubmitVolunteer } from "./actions";
import { ActionForm } from "@/components/ActionForm";
import { VolunteerForm } from "@/components/VolunteerForm";

export const metadata = { title: "Volunteer profile · PawLift" };

async function VolunteerContent({ searchParams }: { searchParams: Promise<{ joined?: string; saved?: string; accepted?: string; error?: string }> }) {
  await connection();
  const sp = await searchParams;
  const ctx = await getMyContext();
  if (!ctx) redirect(await signInUrl());
  const supabase = await createClient();
  const { data } = await supabase.rpc("get_my_volunteer_profile");
  const profile = (data ?? null) as unknown as VolunteerProfile | null;
  const accepted = profile?.guidelines_version_accepted === GUIDELINES_VERSION;
  const last = profile?.history[0];

  return (
    <main className="mx-auto min-h-dvh max-w-lg px-4 py-8">
      <Link href="/" className="text-sm font-medium text-brand underline">Back to map</Link>
      <h1 className="mb-1 mt-4 text-2xl font-semibold">Your volunteer profile</h1>
      {sp.joined && <p role="status" className="mb-3 rounded-xl border border-border bg-surface p-3 text-sm">You&rsquo;ve joined the organisation. Complete your profile below.</p>}
      {sp.accepted && <p role="status" className="mb-3 rounded-xl border border-border bg-surface p-3 text-sm">Guidelines accepted. Thank you.</p>}
      {sp.saved && <p role="status" className="mb-3 rounded-xl border border-border bg-surface p-3 text-sm">Profile saved.</p>}
      {sp.error && <p role="alert" className="mb-3 rounded-xl border border-danger p-3 text-sm">Something went wrong. Save your profile first, then accept the guidelines.</p>}

      {profile && (
        <p role="status" className="mb-4 rounded-xl border border-border bg-surface p-3 text-sm">
          Status: <strong>{volunteerLabel(profile.verification_status)}</strong>.{" "}
          {profile.verification_status === "pending" && "A PawLift admin reviews each volunteer. We record exactly what was checked; we don't claim police, licence or driving-history checks unless they were done."}
          {profile.verification_status === "rejected" && `We couldn't verify you${last?.reason ? `: ${last.reason}` : "."}`}
          {profile.verification_status === "suspended" && `Your volunteering is suspended${last?.reason ? `: ${last.reason}` : "."}`}
        </p>
      )}
      {profile?.verification_status === "rejected" && (
        <ActionForm action={resubmitVolunteer} className="mb-6">
          <p className="mb-2 text-sm text-muted">Update your details below, then resubmit.</p>
          <button className="h-12 w-full rounded-xl border border-border font-semibold">Resubmit for verification</button>
        </ActionForm>
      )}

      <VolunteerForm profile={profile} />

      <section className="mt-10">
        <h2 className="mb-1 text-lg font-semibold">Transport guidelines <span className="rounded bg-urgent/10 px-1.5 text-xs font-semibold text-urgent-strong">DRAFT</span></h2>
        <ul className="mb-4 flex flex-col gap-2 text-sm">
          {GUIDELINES.map((g) => (
            <li key={g.title} className="rounded-xl border border-border bg-surface p-3"><p className="font-medium">{g.title}</p><p className="text-muted">{g.body}</p></li>
          ))}
        </ul>
        {accepted ? (
          <p className="text-sm text-muted">You accepted these guidelines on <time dateTime={profile!.guidelines_accepted_at!}>{formatMelbourne(profile!.guidelines_accepted_at!)}</time>.</p>
        ) : profile ? (
          <form action={acceptGuidelines}><button className="h-12 w-full btn-primary">I have read and accept the guidelines</button></form>
        ) : (
          <p className="text-sm text-muted">Save your profile to accept the guidelines.</p>
        )}
      </section>
    </main>
  );
}

export default function VolunteerPage({ searchParams }: { searchParams: Promise<{ joined?: string; saved?: string; accepted?: string; error?: string }> }) {
  return (
    <Suspense fallback={<main className="mx-auto min-h-dvh max-w-lg px-4 py-8 text-muted">Loading…</main>}>
      <VolunteerContent searchParams={searchParams} />
    </Suspense>
  );
}
