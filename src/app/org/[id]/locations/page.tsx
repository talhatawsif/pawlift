import { Suspense } from "react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getMyContext } from "@/lib/session";
import type { OrgDetail } from "@/lib/org";
import { kindLabel, type OrgLocation, type Suburb } from "@/lib/locations";
import { confirmDestination, createLocation, updateLocation } from "./actions";
import { LocationForm } from "@/components/LocationForm";

export const metadata = { title: "Locations · PawLift" };

const btn = "h-10 rounded-lg border border-border px-3 text-sm font-medium";

async function LocationsContent({ params }: { params: Promise<{ id: string }> }) {
  await connection();
  const { id } = await params;
  const ctx = await getMyContext();
  if (!ctx) redirect("/sign-in");
  const supabase = await createClient();
  const [{ data: orgData }, { data: locData, error }, { data: subData }] = await Promise.all([
    supabase.rpc("get_org_for_coordinator", { p_org_id: id }),
    supabase.rpc("list_org_locations", { p_org_id: id }),
    supabase.rpc("list_suburbs", { p_query: "" }),
  ]);
  if (error || !orgData) notFound();
  const org = orgData as unknown as OrgDetail;
  const locations = (locData ?? []) as unknown as OrgLocation[];
  const suburbs = (subData ?? []) as unknown as Suburb[];
  const verified = org.verification_status === "verified";

  return (
    <main className="mx-auto min-h-dvh max-w-lg px-4 py-8">
      <Link href={`/org/${id}`} className="text-sm font-medium text-brand underline">Back to {org.name}</Link>
      <h1 className="mb-1 mt-4 text-2xl font-semibold">Locations</h1>
      <p className="mb-4 text-sm text-muted">
        Volunteers see the public name and suburb only. Exact addresses and contacts stay private.
        Confirm a location to allow it as a destination.
      </p>

      {locations.length === 0 ? <p className="mb-6 text-muted">No locations yet.</p> : (
        <ul className="mb-8 flex flex-col gap-3">
          {locations.map((l) => (
            <li key={l.id} className="rounded-xl border border-border bg-surface p-3">
              <p className="font-medium">{l.label_public}</p>
              <p className="text-sm text-muted">
                {kindLabel(l.kind)} · {l.suburb} {l.postcode} ·{" "}
                {l.is_confirmed_destination ? "Confirmed destination" : "Not confirmed"}
              </p>
              {l.kind !== "handover_point" && (
                <form action={confirmDestination} className="mt-2">
                  <input type="hidden" name="org_id" value={id} />
                  <input type="hidden" name="location_id" value={l.id} />
                  <button name="confirm" value={l.is_confirmed_destination ? "false" : "true"} disabled={!verified && !l.is_confirmed_destination} className={btn}>
                    {l.is_confirmed_destination ? "Remove confirmation" : "Confirm as destination"}
                  </button>
                </form>
              )}
              {l.kind === "foster_home" ? (
                <p className="mt-2 text-xs text-muted">Edit foster homes from the volunteers page.</p>
              ) : (
                <details className="mt-2">
                  <summary className="cursor-pointer text-sm font-medium text-brand">Edit</summary>
                  <div className="mt-3">
                    <LocationForm action={updateLocation} suburbs={suburbs} location={l} hidden={{ org_id: id, location_id: l.id }} submitLabel="Save changes" />
                  </div>
                </details>
              )}
            </li>
          ))}
        </ul>
      )}

      <h2 className="mb-2 text-lg font-semibold">Add a location</h2>
      {verified
        ? <LocationForm action={createLocation} suburbs={suburbs} hidden={{ org_id: id }} submitLabel="Add location" />
        : <p className="text-sm text-muted">You can add locations once your organisation is verified.</p>}
    </main>
  );
}

export default function LocationsPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<main className="mx-auto min-h-dvh max-w-lg px-4 py-8 text-muted">Loading…</main>}>
      <LocationsContent params={params} />
    </Suspense>
  );
}
