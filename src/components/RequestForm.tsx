"use client";

import { useActionState, useState } from "react";
import type { RequestState } from "@/app/org/[id]/requests/actions";
import { SPECIES, URGENCY, type RequestDetail } from "@/lib/requests";
import type { OrgLocation } from "@/lib/locations";
import { isoToMelbourneLocal } from "@/lib/time/melbourne";

const input = "h-12 w-full rounded-xl border border-border bg-background px-3 text-base";
const area = "w-full rounded-xl border border-border bg-background px-3 py-2 text-base";

type Props = {
  action: (s: RequestState, f: FormData) => Promise<RequestState>;
  orgId: string;
  locations: OrgLocation[];
  request?: RequestDetail;
  submitLabel: string;
  /** New-lift form only: adds the release checkbox and a one-step Publish button. */
  canPublish?: boolean;
};

export function RequestForm({ action, orgId, locations, request, submitLabel, canPublish }: Props) {
  const [state, formAction, pending] = useActionState(action, undefined);
  const [from, setFrom] = useState(request?.origin_location_id ?? "");
  const [to, setTo] = useState(request?.destination_location_id ?? "");
  const destinations = locations.filter((l) => l.is_confirmed_destination);
  const id = request ? `req-${request.id}` : "req-new";
  const dt = (iso: string | null | undefined) => (iso ? isoToMelbourneLocal(iso) : "");
  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="org_id" value={orgId} />
      {request && <input type="hidden" name="request_id" value={request.id} />}
      {request && <input type="hidden" name="version" value={request.version} />}
      <div>
        <label htmlFor={`${id}-name`} className="mb-1 block text-sm font-medium">Animal name or reference</label>
        <input id={`${id}-name`} name="animal_name" required maxLength={80} defaultValue={request?.animal_name ?? ""} className={input} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor={`${id}-sp`} className="mb-1 block text-sm font-medium">Type</label>
          <select id={`${id}-sp`} name="species" defaultValue={request?.species ?? "dog"} className={input}>
            {SPECIES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor={`${id}-ur`} className="mb-1 block text-sm font-medium">Urgency</label>
          <select id={`${id}-ur`} name="urgency" defaultValue={request?.urgency ?? "routine"} className={input}>
            {URGENCY.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
      </div>
      <div>
        <label htmlFor={`${id}-from`} className="mb-1 block text-sm font-medium">Pickup location</label>
        <select id={`${id}-from`} name="origin_location_id" required value={from} onChange={(e) => setFrom(e.target.value)} className={input}>
          <option value="" disabled>Choose a location</option>
          {locations.filter((l) => l.id !== to).map((l) => <option key={l.id} value={l.id}>{l.label_public} · {l.suburb}</option>)}
        </select>
      </div>
      <div>
        <label htmlFor={`${id}-to`} className="mb-1 block text-sm font-medium">Destination (confirmed locations only)</label>
        <select id={`${id}-to`} name="destination_location_id" required value={to} onChange={(e) => { setTo(e.target.value); if (e.target.value === from) setFrom(""); }} className={input}>
          <option value="" disabled>Choose a destination</option>
          {destinations.map((l) => <option key={l.id} value={l.id}>{l.label_public} · {l.suburb}</option>)}
        </select>
        {destinations.length === 0 && <p className="mt-1 text-xs text-muted">Confirm a destination on the locations page first.</p>}
      </div>
      <p className="text-xs text-muted">Times are Melbourne time.</p>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor={`${id}-ws`} className="mb-1 block text-sm font-medium">Pickup window starts</label>
          <input id={`${id}-ws`} name="window_start" type="datetime-local" required defaultValue={dt(request?.window_start)} className={input} />
        </div>
        <div>
          <label htmlFor={`${id}-we`} className="mb-1 block text-sm font-medium">Pickup window ends</label>
          <input id={`${id}-we`} name="window_end" type="datetime-local" required defaultValue={dt(request?.window_end)} className={input} />
        </div>
      </div>
      <div>
        <label htmlFor={`${id}-dl`} className="mb-1 block text-sm font-medium">Delivery deadline (optional)</label>
        <input id={`${id}-dl`} name="deadline" type="datetime-local" defaultValue={dt(request?.deadline)} className={input} />
      </div>
      <div>
        <label htmlFor={`${id}-hr`} className="mb-1 block text-sm font-medium">Special handling</label>
        <textarea id={`${id}-hr`} name="handling_requirements" rows={2} maxLength={1000} defaultValue={request?.handling_requirements ?? ""} className={area} />
      </div>
      <div>
        <label htmlFor={`${id}-cr`} className="mb-1 block text-sm font-medium">Carrier or restraint requirements</label>
        <textarea id={`${id}-cr`} name="carrier_requirements" rows={2} maxLength={1000} defaultValue={request?.carrier_requirements ?? ""} className={area} />
        <p className="mt-1 text-xs text-muted">Publishing needs handling or carrier requirements. Both are public.</p>
      </div>
      <div>
        <label htmlFor={`${id}-mn`} className="mb-1 block text-sm font-medium">Medical or mobility notes (private)</label>
        <textarea id={`${id}-mn`} name="medical_notes" rows={2} maxLength={2000} defaultValue={request?.medical_notes ?? ""} className={area} />
      </div>
      <div>
        <label htmlFor={`${id}-ci`} className="mb-1 block text-sm font-medium">Contact instructions (private)</label>
        <textarea id={`${id}-ci`} name="coordinator_instructions" rows={2} maxLength={1000} defaultValue={request?.coordinator_instructions ?? ""} className={area} />
      </div>
      {state?.error && <p role="alert" className="text-sm text-danger">{state.error}</p>}
      {state?.ok && <p role="status" className="text-sm text-muted">Saved.</p>}
      {canPublish && (
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" name="attest" className="mt-1 size-5" />
          <span>My organisation is authorised to release and transport this animal, and the destination has agreed to receive it. (Needed to publish.)</span>
        </label>
      )}
      <button type="submit" name="intent" value={canPublish ? "publish" : "save"} disabled={pending} className="h-12 btn-primary disabled:opacity-60">
        {canPublish ? "Publish lift" : submitLabel}
      </button>
      {canPublish && (
        <button type="submit" name="intent" value="draft" disabled={pending} className="h-12 btn-secondary disabled:opacity-60">
          {submitLabel}
        </button>
      )}
    </form>
  );
}
