import { Suspense } from "react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getMyContext } from "@/lib/session";
import type { OrgLocation } from "@/lib/locations";
import { publicPhotoUrl, statusLabel, type RequestDetail } from "@/lib/requests";
import { RequestForm } from "@/components/RequestForm";
import { CancelForm, PhotoForm, PublishForm } from "@/components/RequestActions";
import { removePhoto, updateRequest } from "../actions";

export const metadata = { title: "Request · PawLift" };

async function RequestContent({ params }: { params: Promise<{ id: string; requestId: string }> }) {
  await connection();
  const { id, requestId } = await params;
  const ctx = await getMyContext();
  if (!ctx) redirect("/sign-in");
  const supabase = await createClient();
  const [{ data, error }, { data: locData }] = await Promise.all([
    supabase.rpc("get_request_for_coordinator", { p_request_id: requestId }),
    supabase.rpc("list_org_locations", { p_org_id: id }),
  ]);
  if (error || !data) notFound();
  const r = data as unknown as RequestDetail;
  if (r.org_id !== id) notFound();
  const locations = (locData ?? []) as unknown as OrgLocation[];
  const editable = (r.status === "draft" || r.status === "open") && r.leg_status === "open";

  let photoUrl: string | null = null;
  if (r.photo_path) {
    if (r.status === "draft") {
      const signed = await supabase.storage.from("request-photos").createSignedUrl(r.photo_path, 600);
      photoUrl = signed.data?.signedUrl ?? null;
    } else {
      photoUrl = publicPhotoUrl(r.photo_path);
    }
  }

  return (
    <main className="mx-auto min-h-dvh max-w-lg px-4 py-8">
      <Link href={`/org/${id}/requests`} className="text-sm font-medium text-brand underline">Back to requests</Link>
      <h1 className="mt-4 text-2xl font-semibold">{r.animal_name}</h1>
      <p className="mb-4 text-muted">
        {r.reference} · {statusLabel(r.status)}
        {r.is_demo && <span className="ml-2 rounded bg-urgent/10 px-1.5 text-xs font-semibold text-urgent-strong">DEMO</span>}
      </p>
      {r.status === "cancelled" && r.cancel_reason && <p className="mb-4 text-sm">Cancelled: {r.cancel_reason}</p>}

      {photoUrl && (
        <div className="mb-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={photoUrl} alt={`${r.animal_name}`} className="max-h-64 w-full rounded-xl object-cover" />
          {r.status === "draft" && (
            <form action={removePhoto} className="mt-2">
              <input type="hidden" name="org_id" value={id} />
              <input type="hidden" name="request_id" value={r.id} />
              <button className="h-10 rounded-lg border border-border px-3 text-sm font-medium">Remove photo</button>
            </form>
          )}
        </div>
      )}

      {editable ? (
        <>
          <h2 className="mb-2 text-lg font-semibold">Details</h2>
          <RequestForm action={updateRequest} orgId={id} locations={locations} request={r} submitLabel="Save changes" />
        </>
      ) : (
        <p className="text-sm text-muted">{r.origin_label} ({r.origin_suburb}) to {r.destination_label} ({r.destination_suburb}). This request can no longer be edited here.</p>
      )}

      {r.status === "draft" && (
        <>
          <h2 className="mb-2 mt-8 text-lg font-semibold">Photo</h2>
          <PhotoForm orgId={id} requestId={r.id} />
          <h2 className="mb-2 mt-8 text-lg font-semibold">Publish</h2>
          <p className="mb-3 text-sm text-muted">Needs a verified organisation, a confirmed destination, and handling or carrier requirements. Save any edits first.</p>
          <PublishForm orgId={id} requestId={r.id} />
        </>
      )}
      {(r.status === "draft" || r.status === "open") && r.leg_status === "open" && (
        <>
          <h2 className="mb-2 mt-8 text-lg font-semibold">Cancel</h2>
          <CancelForm orgId={id} requestId={r.id} needsReason={r.status === "open"} />
        </>
      )}
    </main>
  );
}

export default function RequestPage({ params }: { params: Promise<{ id: string; requestId: string }> }) {
  return (
    <Suspense fallback={<main className="mx-auto min-h-dvh max-w-lg px-4 py-8 text-muted">Loading…</main>}>
      <RequestContent params={params} />
    </Suspense>
  );
}
