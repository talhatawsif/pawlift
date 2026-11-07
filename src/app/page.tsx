import { Suspense } from "react";
import { connection } from "next/server";
import { AccountMenu } from "@/components/AccountMenu";
import { HomeClient } from "@/components/HomeClient";
import { createClient } from "@/lib/supabase/server";
import type { PublicRequest } from "@/lib/requests";

async function HomeContent({ searchParams }: { searchParams: Promise<{ demo?: string }> }) {
  await connection();
  const supabase = await createClient();
  const { data, error } = await supabase.from("public_requests").select("*");
  return (
    <HomeClient
      requests={(data ?? []) as unknown as PublicRequest[]}
      error={error != null}
      account={
        <Suspense fallback={<div className="h-9 w-20" aria-hidden />}>
          <AccountMenu searchParams={searchParams} />
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
