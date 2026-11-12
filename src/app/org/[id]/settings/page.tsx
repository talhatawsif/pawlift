import { Suspense } from "react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getMyContext, signInUrl } from "@/lib/session";
import type { OrgDetail } from "@/lib/org";
import { OrgSettingsForm } from "@/components/OrgSettingsForm";

export const metadata = { title: "Organisation settings · PawLift" };

async function Content({ params }: { params: Promise<{ id: string }> }) {
  await connection();
  const { id } = await params;
  const ctx = await getMyContext();
  if (!ctx) redirect(await signInUrl());
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_org_for_coordinator", { p_org_id: id });
  if (error || !data) notFound();
  const org = data as unknown as OrgDetail;
  const editable = org.verification_status === "pending" || org.verification_status === "verified";
  return (
    <main className="mx-auto min-h-dvh max-w-lg px-4 py-8">
      <Link href={`/org/${id}`} className="text-sm font-medium text-brand underline">Back to {org.name}</Link>
      <h1 className="mb-1 mt-4 text-2xl font-semibold">Settings</h1>
      <p className="mb-4 text-sm text-muted">
        Contact details and description. To change your name, type or registration details, ask a PawLift verifier.
      </p>
      {editable
        ? <OrgSettingsForm org={org} />
        : <p role="status" className="rounded-xl border border-border bg-surface p-3 text-sm">Settings can&rsquo;t be changed while the organisation is {org.verification_status}.</p>}
    </main>
  );
}

export default function SettingsPage(props: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<main className="mx-auto min-h-dvh max-w-lg px-4 py-8 text-muted">Loading…</main>}>
      <Content {...props} />
    </Suspense>
  );
}
