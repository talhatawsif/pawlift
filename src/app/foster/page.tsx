import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getMyContext } from "@/lib/session";
import type { FosterHome } from "@/lib/locations";
import { DEMO_BADGE, requestStatusLabel, type FosterHistoryRow, type IncomingDelivery } from "@/lib/ops";
import { formatMelbourne } from "@/lib/org";
import { windowLabel } from "@/lib/assignments";
import { ReceiptForm } from "@/components/ReceiptForm";

export const metadata = { title: "My foster home · PawLift" };

async function FosterContent() {
  await connection();
  const ctx = await getMyContext();
  if (!ctx) redirect("/sign-in");
  const supabase = await createClient();
  const { data } = await supabase.rpc("get_my_foster_homes");
  const homes = (data ?? []) as unknown as FosterHome[];
  const [inc, hist] = await Promise.all([supabase.rpc("list_my_incoming_deliveries"), supabase.rpc("list_my_foster_history")]);
  const incoming = (inc.data ?? []) as unknown as IncomingDelivery[];
  const history = (hist.data ?? []) as unknown as FosterHistoryRow[];
  return (
    <main className="mx-auto min-h-dvh max-w-lg px-4 py-8">
      <Link href="/" className="text-sm font-medium text-brand underline">Back to the map</Link>
      <h1 className="mb-4 mt-4 text-2xl font-semibold">My foster home</h1>
      {homes.length > 0 && (
        <section aria-labelledby="incoming" className="mb-8">
          <h2 id="incoming" className="mb-2 text-lg font-semibold">Incoming animals</h2>
          {incoming.length === 0 ? (
            <p className="text-muted">Nothing on the way to you right now.</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {incoming.map((d) => (
                <li key={d.request_id} className="rounded-xl border border-border bg-surface p-3">
                  <p className="font-medium">
                    {d.animal_name}
                    {d.is_demo && <span className={DEMO_BADGE}>DEMO</span>}
                  </p>
                  <p className="text-sm text-muted">From {d.origin_suburb} · {d.org_name}</p>
                  <p className="text-sm text-muted">{windowLabel(d.window_start, d.window_end)}</p>
                  <p className="mt-1 text-sm font-medium">{d.receipt_confirmed ? "Arrival confirmed" : requestStatusLabel(d.request_status)}</p>
                  {d.driver_first_name && (
                    <p className="mt-1 text-sm">
                      Driver: {d.driver_first_name}
                      {d.driver_phone && <> · <a href={`tel:${d.driver_phone.replace(/\s/g, "")}`} className="font-medium text-brand underline">{d.driver_phone}</a></>}
                    </p>
                  )}
                  {d.request_status === "delivered" && !d.receipt_confirmed && (
                    d.can_confirm_receipt
                      ? <ReceiptForm requestId={d.request_id} animalName={d.animal_name} />
                      : <p className="mt-2 text-sm text-muted">Your coordinator will confirm arrival.</p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
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
      {history.length > 0 && (
        <section aria-labelledby="past" className="mt-8">
          <h2 id="past" className="mb-2 text-lg font-semibold">Past arrivals</h2>
          <ul className="flex flex-col gap-2">
            {history.map((h) => (
              <li key={h.request_id} className="rounded-xl border border-border bg-surface p-3 text-sm">
                <p className="font-medium">
                  {h.animal_name}
                  {h.is_demo && <span className={DEMO_BADGE}>DEMO</span>}
                </p>
                <p className="text-muted">From {h.origin_suburb} · {h.org_name}</p>
                {h.received_at && (
                  <p className="text-muted">
                    Received <time dateTime={h.received_at}>{formatMelbourne(h.received_at)}</time>
                    {h.received_by_coordinator ? " (confirmed by the coordinator)" : ""}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </section>
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
