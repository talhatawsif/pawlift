import { Suspense } from "react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getMyContext } from "@/lib/session";
import type { OrgLocation } from "@/lib/locations";
import { RequestForm } from "@/components/RequestForm";
import { createRequest } from "../actions";

export const metadata = { title: "New lift · PawLift" };

async function NewContent({ params }: { params: Promise<{ id: string }> }) {
  await connection();
  const { id } = await params;
  const ctx = await getMyContext();
  if (!ctx) redirect("/sign-in");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("list_org_locations", { p_org_id: id });
  if (error) notFound();
  const locations = (data ?? []) as unknown as OrgLocation[];
  return (
    <main className="mx-auto min-h-dvh max-w-lg px-4 py-8">
      <Link href={`/org/${id}/requests`} className="text-sm font-medium text-brand underline">Back to lifts</Link>
      <h1 className="mb-1 mt-4 text-2xl font-semibold">New lift</h1>
      <p className="mb-4 text-sm text-muted">Saved as a draft. You can add a photo and publish on the next page.</p>
      {locations.length < 2 ? (
        <p className="text-sm text-muted">
          Add at least two locations (a pickup and a confirmed destination) on the{" "}
          <Link href={`/org/${id}/locations`} className="font-medium text-brand underline">locations page</Link> first.
        </p>
      ) : (
        <RequestForm action={createRequest} orgId={id} locations={locations} submitLabel="Save draft" />
      )}
    </main>
  );
}

export default function NewRequestPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<main className="mx-auto min-h-dvh max-w-lg px-4 py-8 text-muted">Loading…</main>}>
      <NewContent params={params} />
    </Suspense>
  );
}
