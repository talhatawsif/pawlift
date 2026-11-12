import { Suspense } from "react";
import Link from "next/link";
import { connection } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getMyContext } from "@/lib/session";
import { typeLabel } from "@/lib/org";
import type { InvitationPreview } from "@/lib/membership";
import { AcceptInvitation } from "@/components/AcceptInvitation";

export const metadata = { title: "Join an organisation · PawLift" };

const REASONS: Record<string, string> = {
  invalid: "This invitation link isn't valid.",
  revoked: "This invitation has been withdrawn.",
  expired: "This invitation has expired.",
  used: "This invitation has already been used.",
  org_not_verified: "This organisation isn't currently verified.",
};

async function JoinContent({ params }: { params: Promise<{ token: string }> }) {
  await connection();
  const { token } = await params;
  const ctx = await getMyContext();
  let preview: InvitationPreview | null = null;
  if (ctx) {
    const supabase = await createClient();
    const { data } = await supabase.rpc("preview_invitation", { p_token: token });
    preview = data as unknown as InvitationPreview | null;
  }
  return (
    <main className="mx-auto min-h-dvh max-w-lg px-4 py-8">
      <Link href="/" className="text-sm font-medium text-brand underline">Back to map</Link>
      <h1 className="mb-2 mt-4 text-2xl font-semibold">Join as a volunteer</h1>
      {!ctx ? (
        <>
          <p className="text-muted">Sign in or create an account, then open this invitation link again.</p>
          <div className="mt-4 flex gap-2">
            <Link href={`/sign-in?next=${encodeURIComponent(`/join/${token}`)}`} className="flex h-12 flex-1 items-center justify-center btn-primary">Sign in</Link>
            <Link href="/sign-up" className="flex h-12 flex-1 items-center justify-center rounded-xl border border-border font-semibold">Create account</Link>
          </div>
        </>
      ) : !preview || !preview.valid ? (
        <p role="alert" className="rounded-xl border border-danger p-3 text-sm">{REASONS[preview?.reason ?? "invalid"]} Ask the organisation for a new one.</p>
      ) : (
        <>
          <p className="text-muted">{preview.org_name} ({typeLabel(preview.org_type ?? "other")}) has invited you to volunteer for animal transport.</p>
          {preview.email_bound && !preview.email_matches ? (
            <p role="alert" className="mt-4 rounded-xl border border-danger p-3 text-sm">This invitation was sent to a different email address. Sign in with the address it was sent to.</p>
          ) : (
            <AcceptInvitation token={token} orgName={preview.org_name ?? "this organisation"} />
          )}
        </>
      )}
    </main>
  );
}

export default function JoinTokenPage({ params }: { params: Promise<{ token: string }> }) {
  return (
    <Suspense fallback={<main className="mx-auto min-h-dvh max-w-lg px-4 py-8 text-muted">Loading…</main>}>
      <JoinContent params={params} />
    </Suspense>
  );
}
