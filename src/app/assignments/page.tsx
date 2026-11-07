import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { ArrowRight } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getMyContext } from "@/lib/session";
import { assignmentLabel, legLabel, windowLabel, type MyAssignment } from "@/lib/assignments";

export const metadata = { title: "My assignments · PawLift" };
const ACTIVE = new Set(["offered", "reserved", "confirmed"]);

function Row({ a }: { a: MyAssignment }) {
  const status = a.assignment_status === "confirmed" ? legLabel(a.leg_status) : assignmentLabel(a.assignment_status);
  return (
    <li>
      <Link href={`/assignments/${a.assignment_id}`} className="block rounded-xl border border-border bg-surface p-3">
        <span className="font-medium">
          {a.animal_name}
          {a.is_demo && <span className="ml-2 rounded bg-urgent/10 px-1.5 text-xs font-semibold text-urgent">DEMO</span>}
        </span>
        <span className="flex items-center gap-1 text-sm text-muted">{a.origin_suburb} <ArrowRight size={14} aria-hidden /> {a.destination_suburb}</span>
        <span className="block text-sm text-muted">{windowLabel(a.window_start, a.window_end)}</span>
        <span className="mt-1 block text-sm font-medium">{status}</span>
      </Link>
    </li>
  );
}

async function Content() {
  await connection();
  const ctx = await getMyContext();
  if (!ctx) redirect("/sign-in");
  const supabase = await createClient();
  const { data } = await supabase.rpc("list_my_assignments");
  const all = (data ?? []) as unknown as MyAssignment[];
  const current = all.filter((a) => ACTIVE.has(a.assignment_status));
  const past = all.filter((a) => !ACTIVE.has(a.assignment_status));
  return (
    <main className="mx-auto min-h-dvh max-w-lg px-4 py-8">
      <Link href="/" className="text-sm font-medium text-brand underline">Back to map</Link>
      <h1 className="mb-4 mt-4 text-2xl font-semibold">My assignments</h1>
      {current.length === 0 ? (
        <p className="text-muted">Nothing right now. Find an animal on the map and tap &ldquo;I can take this&rdquo;.</p>
      ) : (
        <ul className="flex flex-col gap-2">{current.map((a) => <Row key={a.assignment_id} a={a} />)}</ul>
      )}
      {past.length > 0 && (
        <>
          <h2 className="mb-2 mt-8 text-lg font-semibold">History</h2>
          <ul className="flex flex-col gap-2">{past.map((a) => <Row key={a.assignment_id} a={a} />)}</ul>
        </>
      )}
    </main>
  );
}

export default function AssignmentsPage() {
  return (
    <Suspense fallback={<main className="mx-auto min-h-dvh max-w-lg px-4 py-8 text-muted">Loading…</main>}>
      <Content />
    </Suspense>
  );
}
