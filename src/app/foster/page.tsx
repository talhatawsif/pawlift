import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getMyContext } from "@/lib/session";
import type { FosterHome } from "@/lib/locations";

export const metadata = { title: "My foster home · PawLift" };

async function FosterContent() {
  await connection();
  const ctx = await getMyContext();
  if (!ctx) redirect("/sign-in");
  const supabase = await createClient();
  const { data } = await supabase.rpc("get_my_foster_homes");
  const homes = (data ?? []) as unknown as FosterHome[];
  return (
    <main className="mx-auto min-h-dvh max-w-lg px-4 py-8">
      <Link href="/" className="text-sm font-medium text-brand underline">Back to the map</Link>
      <h1 className="mb-4 mt-4 text-2xl font-semibold">My foster home</h1>
      {homes.length === 0 ? (
        <p className="text-muted">No organisation has approved you as a foster carer yet.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {homes.map((h) => (
            <li key={h.location_id} className="rounded-xl border border-border bg-surface p-3">
              <p className="font-medium">Approved by {h.org_name}</p>
              <p className="text-sm text-muted">
                {h.suburb} {h.postcode} · {h.is_confirmed_destination ? "Confirmed as a destination" : "Not yet confirmed as a destination"}
              </p>
              <p className="mt-2 text-sm">{h.exact_address ?? "Address not set. Ask your coordinator."}</p>
              {h.can_confirm_receipt && <p className="mt-1 text-xs text-muted">You can confirm receipt of animals delivered here.</p>}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

export default function FosterPage() {
  return (
    <Suspense fallback={<main className="mx-auto min-h-dvh max-w-lg px-4 py-8 text-muted">Loading…</main>}>
      <FosterContent />
    </Suspense>
  );
}
