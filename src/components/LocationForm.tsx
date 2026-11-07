"use client";

import { useActionState } from "react";
import type { LocationState } from "@/app/org/[id]/locations/actions";
import { LOCATION_KINDS, type OrgLocation, type Suburb } from "@/lib/locations";

const input = "h-12 w-full rounded-xl border border-border bg-background px-3 text-base";
const area = "w-full rounded-xl border border-border bg-background px-3 py-2 text-base";

type Props = {
  action: (s: LocationState, f: FormData) => Promise<LocationState>;
  suburbs: Suburb[];
  hidden: Record<string, string>;
  location?: Partial<OrgLocation> | null;
  /** Show the kind and public label fields (not used for foster homes). */
  withKind?: boolean;
  submitLabel: string;
};

export function LocationForm({ action, suburbs, hidden, location, withKind = true, submitLabel }: Props) {
  const [state, formAction, pending] = useActionState(action, undefined);
  const id = `loc-${hidden.location_id ?? hidden.member_id ?? "new"}`;
  return (
    <form action={formAction} className="flex flex-col gap-3">
      {Object.entries(hidden).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      {withKind && (
        <>
          {!hidden.location_id && (
            <div>
              <label htmlFor={`${id}-kind`} className="mb-1 block text-sm font-medium">Type</label>
              <select id={`${id}-kind`} name="kind" defaultValue={location?.kind ?? "shelter"} className={input}>
                {LOCATION_KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
              </select>
            </div>
          )}
          <div>
            <label htmlFor={`${id}-label`} className="mb-1 block text-sm font-medium">Public name</label>
            <input id={`${id}-label`} name="label_public" required minLength={2} maxLength={80} defaultValue={location?.label_public ?? ""} className={input} />
            <p className="mt-1 text-xs text-muted">Shown to volunteers. Don&rsquo;t include the street address.</p>
          </div>
        </>
      )}
      <div>
        <label htmlFor={`${id}-suburb`} className="mb-1 block text-sm font-medium">Suburb (public)</label>
        <select id={`${id}-suburb`} name="suburb_id" required defaultValue={location?.suburb_id ?? ""} className={input}>
          <option value="" disabled>Choose a suburb</option>
          {suburbs.map((s) => <option key={s.id} value={s.id}>{s.name} {s.postcode}</option>)}
        </select>
      </div>
      <div>
        <label htmlFor={`${id}-addr`} className="mb-1 block text-sm font-medium">Exact address (private)</label>
        <input id={`${id}-addr`} name="exact_address" required minLength={5} maxLength={200} defaultValue={location?.exact_address ?? ""} className={input} />
        <p className="mt-1 text-xs text-muted">Only the assigned volunteer sees this, and only while their assignment is confirmed.</p>
      </div>
      <div>
        <label htmlFor={`${id}-cn`} className="mb-1 block text-sm font-medium">Contact name (private)</label>
        <input id={`${id}-cn`} name="contact_name" maxLength={100} defaultValue={location?.contact_name ?? ""} className={input} />
      </div>
      <div>
        <label htmlFor={`${id}-cp`} className="mb-1 block text-sm font-medium">Contact phone (private)</label>
        <input id={`${id}-cp`} name="contact_phone" type="tel" maxLength={30} defaultValue={location?.contact_phone ?? ""} className={input} />
      </div>
      <div>
        <label htmlFor={`${id}-in`} className="mb-1 block text-sm font-medium">Handover instructions (private)</label>
        <textarea id={`${id}-in`} name="instructions" rows={2} maxLength={1000} defaultValue={location?.instructions ?? ""} className={area} />
      </div>
      {state?.error && <p role="alert" className="text-sm text-danger">{state.error}</p>}
      {state?.ok && <p role="status" className="text-sm text-muted">Saved.</p>}
      <button type="submit" disabled={pending} className="h-12 rounded-xl bg-brand text-base font-semibold text-brand-foreground disabled:opacity-60">
        {submitLabel}
      </button>
    </form>
  );
}
