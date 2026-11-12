import { Suspense } from "react";
import { connection } from "next/server";
import { NavMenu } from "@/components/NavMenu";
import { HomeClient } from "@/components/HomeClient";
import { createClient } from "@/lib/supabase/server";
import { getMyContext } from "@/lib/session";
import type { PublicRequest } from "@/lib/requests";

async function HomeContent({ searchParams }: { searchParams: Promise<{ demo?: string }> }) {
  await connection();
  const { demo } = await searchParams;
  const supabase = await createClient();
  const { data, error } = await supabase.from("public_requests").select("*");
  const ctx = await getMyContext();
  // Only shows or hides the button: the new-request page and RPCs check access themselves.
  const coordOrgs = (ctx?.memberships ?? [])
    .filter((m) => m.status === "active" && m.is_coordinator)
    .map((m) => ({ id: m.org_id, name: m.org_name, verified: m.org_verification === "verified" }));
  return (
    <HomeClient
      requests={(data ?? []) as unknown as PublicRequest[]}
      error={error != null}
      coordOrgs={coordOrgs}
      account={
        <Suspense fallback={<div className="h-10 w-10" aria-hidden />}>
          <NavMenu demoNotice={demo} />
        </Suspense>
      }
    />
  );
}

export default function Home({ searchParams }: { searchParams: Promise<{ demo?: string }> }) {
  return (
    <main className="relative h-dvh w-full overflow-hidden">
      <Suspense
        fallback={
          <p className="absolute inset-x-0 bottom-8 text-center text-sm text-muted">Loading…</p>
        }
      >
        <HomeContent searchParams={searchParams} />
      </Suspense>
    </main>
  );
}
