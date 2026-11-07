import { Suspense } from "react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getMyContext } from "@/lib/session";
import { formatMelbourne, type OrgDetail } from "@/lib/org";
import { speciesLabel, volunteerLabel, type InvitationItem, type MemberItem } from "@/lib/membership";
import { decideMembership, revokeInvitation } from "./actions";
import { InviteForm } from "@/components/InviteForm";

export const metadata = { title: "Volunteers · PawLift" };

const btn = "h-10 rounded-lg border border-border px-3 text-sm font-medium";

async function MembersContent({ params }: { params: Promise<{ id: string }> }) {
  await connection();
  const { id } = await params;
  const ctx = await getMyContext();
  if (!ctx) redirect("/sign-in");
  const supabase = await createClient();
  const [{ data: orgData }, { data: memberData, error }, { data: invData }] = await Promise.all([
    supabase.rpc("get_org_for_coordinator", { p_org_id: id }),
    supabase.rpc("list_org_members", { p_org_id: id }),
    supabase.rpc("list_invitations", { p_org_id: id }),
  ]);
  if (error || !orgData) notFound();
  const org = orgData as unknown as OrgDetail;
  const members = (memberData ?? []) as unknown as MemberItem[];
  const invitations = (invData ?? []) as unknown as InvitationItem[];
  const requests = members.filter((m) => m.status === "requested");
  const active = members.filter((m) => m.status === "active");

  return (
    <main className="mx-auto min-h-dvh max-w-lg px-4 py-8">
      <Link href={`/org/${id}`} className="text-sm font-medium text-brand underline">Back to {org.name}</Link>
      <h1 className="mb-4 mt-4 text-2xl font-semibold">Volunteers</h1>

      {requests.length > 0 && (
        <section className="mb-8">
          <h2 className="mb-2 text-lg font-semibold">Requests to join</h2>
          <ul className="flex flex-col gap-2">
            {requests.map((m) => (
              <li key={m.id} className="rounded-xl border border-border bg-surface p-3">
                <p className="font-medium">{m.display_name ?? "Unnamed"}</p>
                <p className="text-sm text-muted">{m.volunteer_status ? `Volunteer profile: ${volunteerLabel(m.volunteer_status)}` : "No volunteer profile yet"}</p>
                <div className="mt-2 flex gap-2">
                  {(["approve", "decline"] as const).map((d) => (
                    <form key={d} action={decideMembership}>
                      <input type="hidden" name="org_id" value={id} /><input type="hidden" name="member_id" value={m.id} />
                      <button name="decision" value={d} className={btn}>{d === "approve" ? "Approve" : "Decline"}</button>
                    </form>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="mb-8">
        <h2 className="mb-2 text-lg font-semibold">Members</h2>
        {active.length === 0 ? <p className="text-muted">No members yet.</p> : (
          <ul className="flex flex-col gap-2">
            {active.map((m) => (
              <li key={m.id} className="rounded-xl border border-border bg-surface p-3">
                <p className="font-medium">{m.display_name ?? "Unnamed"}{m.is_coordinator && <span className="ml-2 text-xs text-muted">Coordinator</span>}</p>
                {m.is_volunteer && (
                  <p className="text-sm text-muted">
                    Volunteer · {m.volunteer_status ? volunteerLabel(m.volunteer_status) : "No profile yet"}
                    {m.species_ok && m.species_ok.length > 0 && ` · ${m.species_ok.map(speciesLabel).join(", ")}`}
                    {m.availability?.days && m.availability.days.length > 0 && ` · ${m.availability.days.join(", ")}`}
                  </p>
                )}
                {!m.is_coordinator && (
                  <form action={decideMembership} className="mt-2">
                    <input type="hidden" name="org_id" value={id} /><input type="hidden" name="member_id" value={m.id} />
                    <button name="decision" value="remove" className={btn}>Remove</button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mb-8">
        <h2 className="mb-2 text-lg font-semibold">Invite volunteers</h2>
        {org.verification_status === "verified"
          ? <InviteForm orgId={id} orgName={org.name} />
          : <p className="text-sm text-muted">You can invite volunteers once your organisation is verified.</p>}
      </section>

      {invitations.length > 0 && (
        <section>
          <h2 className="mb-2 text-lg font-semibold">Invitations</h2>
          <ul className="flex flex-col gap-2">
            {invitations.map((i) => (
              <li key={i.id} className="rounded-xl border border-border bg-surface p-3 text-sm">
                <p className="font-medium">{i.email ?? "Open link"} · {i.status}</p>
                <p className="text-muted">Used {i.uses} of {i.max_uses} · expires <time dateTime={i.expires_at}>{formatMelbourne(i.expires_at)}</time></p>
                {i.status === "active" && (
                  <form action={revokeInvitation} className="mt-2">
                    <input type="hidden" name="org_id" value={id} /><input type="hidden" name="invitation_id" value={i.id} />
                    <button className={btn}>Revoke</button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}

export default function MembersPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<main className="mx-auto min-h-dvh max-w-lg px-4 py-8 text-muted">Loading…</main>}>
      <MembersContent params={params} />
    </Suspense>
  );
}
