"use client";

import { useActionState } from "react";
import { viewPrivateDetails } from "@/app/admin/actions";
import type { PrivatePlace } from "@/lib/ops";

function Place({ title, p }: { title: string; p: PrivatePlace }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-3 text-sm">
      <p className="font-medium">{title}: {p.label ?? "Unknown"}</p>
      <p>{p.exact_address ?? "No address recorded"}</p>
      {p.contact_name && <p>Contact: {p.contact_name}{p.contact_phone ? `, ${p.contact_phone}` : ""}</p>}
      {p.instructions && <p>Instructions: {p.instructions}</p>}
    </div>
  );
}

export function PrivateDetailsForm({ requestId }: { requestId?: string }) {
  const [state, action, pending] = useActionState(viewPrivateDetails, undefined);
  const d = state?.details;
  return (
    <div className="flex flex-col gap-3">
      <form action={action} className="flex flex-col gap-3">
        <div>
          <label htmlFor="request_id" className="mb-1 block text-sm font-medium">Request id</label>
          <input id="request_id" name="request_id" defaultValue={requestId ?? ""} required className="h-12 w-full rounded-xl border border-border bg-background px-3 text-base" />
        </div>
        <div>
          <label htmlFor="reason" className="mb-1 block text-sm font-medium">Reason for viewing (recorded)</label>
          <textarea id="reason" name="reason" rows={2} required minLength={10} maxLength={500} className="w-full rounded-xl border border-border bg-background px-3 py-2 text-base" />
        </div>
        {state?.error && <p role="alert" className="text-sm text-danger">{state.error}</p>}
        <button type="submit" disabled={pending} className="h-12 w-full rounded-xl bg-brand text-base font-semibold text-brand-foreground disabled:opacity-60">
          {pending ? "Opening…" : "View private details"}
        </button>
      </form>
      {d && (
        <section aria-label="Private details" className="flex flex-col gap-2">
          <p className="font-medium">{d.animal_name} · {d.reference} · {d.org_name}</p>
          <p className="text-sm">Medical notes: {d.medical_notes ?? "None"}</p>
          {d.coordinator_instructions && <p className="text-sm">Coordinator instructions: {d.coordinator_instructions}</p>}
          <Place title="Pickup" p={d.origin} />
          <Place title="Destination" p={d.destination} />
          <p className="text-xs text-muted">This view was logged.</p>
        </section>
      )}
    </div>
  );
}
