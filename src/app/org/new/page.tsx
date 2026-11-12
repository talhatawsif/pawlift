import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { getMyContext, signInUrl } from "@/lib/session";
import { registerOrganisation } from "@/app/org/actions";
import { OrgForm } from "@/components/OrgForm";

export const metadata = { title: "Register an organisation · PawLift" };

async function NewOrgPageContent() {
  await connection();
  const ctx = await getMyContext();
  if (!ctx) redirect(await signInUrl());
  return (
    <main className="mx-auto min-h-dvh max-w-lg px-4 py-8">
      <Link href="/" className="text-sm font-medium text-brand underline">Back to map</Link>
      <h1 className="mb-1 mt-4 text-2xl font-semibold">Register an organisation</h1>
      <p className="mb-6 text-muted">
        Rescues, pounds, shelters and vet clinics can ask for transport once PawLift has verified them. We check your details by hand, so it can take a few days.
      </p>
      <OrgForm action={registerOrganisation} submitLabel="Submit for verification" />
    </main>
  );
}

export default function NewOrgPage() {
  return (
    <Suspense fallback={<main className="mx-auto min-h-dvh max-w-lg px-4 py-8 text-muted">Loading…</main>}>
      <NewOrgPageContent  />
    </Suspense>
  );
}
