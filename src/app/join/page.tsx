import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { BadgeCheck } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getMyContext } from "@/lib/session";
import { typeLabel } from "@/lib/org";
import type { JoinableOrg } from "@/lib/membership";
import { requestMembership } from "./actions";

export const metadata = { title: "Find an organisation · PawLift" };

async function JoinListContent() {
  await connection();
  const ctx = await getMyContext();
  if (!ctx) redirect("/sign-in");
  const supabase = await createClient();
  const { data } = await supabase.rpc("list_joinable_organisations");
  const orgs = (data ?? []) as unknown as JoinableOrg[];
  return (
    <main className="mx-auto min-h-dvh max-w-lg px-4 py-8">
      <Link href="/" className="text-sm font-medium text-brand underline">Back to map</Link>
      <h1 className="mb-1 mt-4 text-2xl font-semibold">Volunteer with an organisation</h1>
      <p className="mb-4 text-muted">Ask to join a verified organisation. A coordinator approves each request. Already have an invitation link? Open it directly.</p>
      {orgs.length === 0 ? <p className="text-muted">No verified organisations yet.</p> : (
        <ul className="flex flex-col gap-2">
          {orgs.map((o) => (
            <li key={o.id} className="rounded-xl border border-border bg-surface p-3">
              <p className="flex items-center gap-1 font-medium"><BadgeCheck size={16} className="text-brand" aria-hidden />{o.name}
                {o.is_demo && <span className="ml-2 rounded bg-urgent/10 px-1.5 text-xs font-semibold text-urgent">DEMO</span>}</p>
              <p className="text-sm text-muted">{typeLabel(o.type)} · {o.operating_area ?? "Area not given"}</p>
              {o.my_status === null ? (
                <form action={requestMembership} className="mt-2">
                  <input type="hidden" name="org_id" value={o.id} />
                  <button className="h-10 rounded-lg border border-border px-3 text-sm font-medium">Ask to join</button>
                </form>
              ) : (
                <p className="mt-2 text-sm text-muted">{o.my_status === "requested" ? "Request sent. Waiting for a coordinator." : o.my_status === "active" ? "You're a member." : "Not available."}</p>
              )}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

export default function JoinPage() {
  return (
    <Suspense fallback={<main className="mx-auto min-h-dvh max-w-lg px-4 py-8 text-muted">Loading…</main>}>
      <JoinListContent />
    </Suspense>
  );
}
