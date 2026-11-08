import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getMyContext } from "@/lib/session";

export const metadata = { title: "Admin · PawLift" };

const count = (r: { data: unknown; error: unknown }) =>
  r.error || !Array.isArray(r.data) ? null : r.data.length;

async function Content() {
  await connection();
  const ctx = await getMyContext();
  if (!ctx?.is_admin) notFound();
  const supabase = await createClient();
  const [orgs, vols, incidents, requests] = await Promise.all([
    supabase.rpc("admin_list_organisations", { p_status: "pending" }),
    supabase.rpc("admin_list_volunteers", { p_status: "pending" }),
    supabase.rpc("admin_list_incidents", { p_status: "open" }),
    supabase.rpc("admin_list_requests", { p_status: "active", p_limit: 200 }),
  ]);
  const tiles = [
    { href: "/admin/organisations", label: "Organisations waiting for verification", n: count(orgs) },
    { href: "/admin/volunteers", label: "Volunteers waiting for verification", n: count(vols) },
    { href: "/admin/incidents", label: "Open incidents", n: count(incidents), cap: 100 },
    { href: "/admin/requests", label: "Active lifts", n: count(requests), cap: 200 },
  ];
  const links = [
    { href: "/admin/audit", label: "Audit log" },
    { href: "/admin/private-access", label: "Private access log" },
  ];
  return (
    <main className="mx-auto min-h-dvh max-w-2xl px-4 py-8">
      <Link href="/" className="text-sm font-medium text-brand underline">Back to map</Link>
      <h1 className="mb-4 mt-4 text-2xl font-semibold">Admin</h1>
      <ul className="grid gap-2 sm:grid-cols-2">
        {tiles.map((t) => (
          <li key={t.href}>
            <Link href={t.href} className="flex h-full flex-col rounded-xl border border-border bg-surface p-4 hover:border-brand">
              <span className="text-3xl font-semibold">
                {t.n === null ? "—" : t.cap && t.n >= t.cap ? `${t.cap}+` : t.n}
              </span>
              <span className="text-sm text-muted">{t.n === null ? `${t.label} (couldn't load)` : t.label}</span>
            </Link>
          </li>
        ))}
      </ul>
      <ul className="mt-6 flex flex-col gap-1 border-t border-border pt-4">
        {links.map((l) => (
          <li key={l.href}>
            <Link href={l.href} className="flex h-10 items-center font-medium text-brand underline">{l.label}</Link>
          </li>
        ))}
      </ul>
    </main>
  );
}

export default function AdminPage() {
  return (
    <Suspense fallback={<main className="mx-auto min-h-dvh max-w-2xl px-4 py-8 text-muted">Loading…</main>}>
      <Content />
    </Suspense>
  );
}
