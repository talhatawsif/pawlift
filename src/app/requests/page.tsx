import { Suspense } from "react";
import Link from "next/link";
import { connection } from "next/server";
import { BadgeCheck } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { formatMelbourne } from "@/lib/org";
import { publicPhotoUrl, speciesLabel, urgencyLabel, type PublicRequest } from "@/lib/requests";

export const metadata = { title: "Animals needing a lift · PawLift" };

const URGENCY_ORDER: Record<string, number> = { urgent: 0, soon: 1, routine: 2 };

async function ListContent() {
  await connection();
  const supabase = await createClient();
  const { data } = await supabase.from("public_requests").select("*");
  const rows = ((data ?? []) as unknown as PublicRequest[]).sort(
    (a, b) =>
      (URGENCY_ORDER[a.urgency] ?? 3) - (URGENCY_ORDER[b.urgency] ?? 3) ||
      (a.window_start ?? "").localeCompare(b.window_start ?? ""),
  );
  return rows.length === 0 ? (
    <p className="text-muted">No animals need a lift right now.</p>
  ) : (
    <ul className="flex flex-col gap-3">
      {rows.map((r) => (
        <li key={r.id} className="flex gap-3 rounded-xl border border-border bg-surface p-3">
          {r.photo_path ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={publicPhotoUrl(r.photo_path)} alt={r.animal_name} className="size-20 shrink-0 rounded-lg object-cover" />
          ) : null}
          <div className="min-w-0">
            <p className="font-medium">
              {r.animal_name} <span className="text-sm font-normal text-muted">· {speciesLabel(r.species)} · {urgencyLabel(r.urgency)}</span>
              {r.is_demo && <span className="ml-2 rounded bg-urgent/10 px-1.5 text-xs font-semibold text-urgent">DEMO</span>}
            </p>
            <p className="text-sm text-muted">{r.origin_suburb} to {r.destination_suburb}</p>
            {r.window_start && <p className="text-sm text-muted">Pickup from {formatMelbourne(r.window_start)}</p>}
            <p className="flex items-center gap-1 text-sm text-muted">
              {r.org_verification_status === "verified" && <BadgeCheck size={14} className="text-brand" aria-hidden />}
              {r.org_name}
            </p>
          </div>
        </li>
      ))}
    </ul>
  );
}

export default function RequestsListPage() {
  return (
    <main className="mx-auto min-h-dvh max-w-lg px-4 py-8">
      <Link href="/" className="text-sm font-medium text-brand underline">Back to map</Link>
      <h1 className="mb-1 mt-4 text-2xl font-semibold">Animals needing a lift</h1>
      <p className="mb-4 text-sm text-muted">Suburbs only. Exact addresses are shared with the confirmed volunteer.</p>
      <Suspense fallback={<p className="text-muted">Loading…</p>}>
        <ListContent />
      </Suspense>
    </main>
  );
}
