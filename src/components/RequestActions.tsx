"use client";

import { useActionState } from "react";
import { cancelRequest, publishRequest, uploadPhoto, type RequestState } from "@/app/org/[id]/requests/actions";

const btn = "h-12 w-full btn-primary disabled:opacity-60";
const msg = (s: RequestState) => (
  <>
    {s?.error && <p role="alert" className="text-sm text-danger">{s.error}</p>}
    {s?.ok && !s.error && <p role="status" className="text-sm text-muted">Done.</p>}
  </>
);

export function PhotoForm({ orgId, requestId }: { orgId: string; requestId: string }) {
  const [state, action, pending] = useActionState(uploadPhoto, undefined);
  return (
    <form action={action} className="flex flex-col gap-2">
      <input type="hidden" name="org_id" value={orgId} />
      <input type="hidden" name="request_id" value={requestId} />
      <label htmlFor="photo" className="text-sm font-medium">Photo (JPEG, PNG or WebP, up to 6 MB)</label>
      <input id="photo" name="photo" type="file" accept="image/jpeg,image/png,image/webp" required className="text-sm" />
      <p className="text-xs text-muted">We resize it and remove location and camera data before it is stored.</p>
      {msg(state)}
      <button type="submit" disabled={pending} className={btn}>{pending ? "Uploading…" : "Upload photo"}</button>
    </form>
  );
}

export function PublishForm({ orgId, requestId }: { orgId: string; requestId: string }) {
  const [state, action, pending] = useActionState(publishRequest, undefined);
  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="org_id" value={orgId} />
      <input type="hidden" name="request_id" value={requestId} />
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" name="attest" required className="mt-1 size-5" />
        <span>
          My organisation is authorised to release and transport this animal, and the destination has agreed to receive it.
        </span>
      </label>
      {msg(state)}
      <button type="submit" disabled={pending} className={btn}>Publish lift</button>
    </form>
  );
}

export function CancelForm({ orgId, requestId, needsReason }: { orgId: string; requestId: string; needsReason: boolean }) {
  const [state, action, pending] = useActionState(cancelRequest, undefined);
  return (
    <form action={action} onSubmit={(e) => { if (!window.confirm("Cancel this lift? This can't be undone.")) e.preventDefault(); }} className="flex flex-col gap-2">
      <input type="hidden" name="org_id" value={orgId} />
      <input type="hidden" name="request_id" value={requestId} />
      <label htmlFor="reason" className="text-sm font-medium">Reason{needsReason ? "" : " (optional)"}</label>
      <input id="reason" name="reason" maxLength={500} required={needsReason} className="h-12 w-full rounded-xl border border-border bg-background px-3 text-base" />
      {msg(state)}
      <button type="submit" disabled={pending} className="h-12 w-full rounded-xl border border-danger text-base font-semibold text-danger disabled:opacity-60">
        Cancel lift
      </button>
    </form>
  );
}
