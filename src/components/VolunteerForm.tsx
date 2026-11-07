"use client";

import { useActionState } from "react";
import { saveVolunteerProfile } from "@/app/volunteer/actions";
import { DAYS, SIZES, SPECIES, type VolunteerProfile } from "@/lib/membership";

const input = "h-12 w-full rounded-xl border border-border bg-background px-3 text-base";
const area = "w-full rounded-xl border border-border bg-background px-3 py-2 text-base";

export function VolunteerForm({ profile }: { profile?: VolunteerProfile | null }) {
  const [state, formAction, pending] = useActionState(saveVolunteerProfile, undefined);
  return (
    <form action={formAction} className="flex flex-col gap-5">
      <fieldset>
        <legend className="mb-1 text-sm font-medium">Animals you can transport</legend>
        <div className="flex flex-wrap gap-3">
          {SPECIES.map((s) => (
            <label key={s.value} className="flex h-11 items-center gap-2">
              <input type="checkbox" name="species" value={s.value} defaultChecked={profile?.species_ok.includes(s.value)} className="h-5 w-5" />
              {s.label}
            </label>
          ))}
        </div>
      </fieldset>
      <div>
        <label htmlFor="max_size" className="mb-1 block text-sm font-medium">Largest animal you can take</label>
        <select id="max_size" name="max_size" defaultValue={profile?.max_size ?? ""} className={input}>
          <option value="">Not set</option>
          {SIZES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
      </div>
      <label className="flex h-11 items-center gap-2">
        <input type="checkbox" name="has_carrier" defaultChecked={profile?.has_carrier} className="h-5 w-5" />
        I have a secure carrier or restraint
      </label>
      <div>
        <label htmlFor="vehicle_notes" className="mb-1 block text-sm font-medium">Vehicle notes</label>
        <textarea id="vehicle_notes" name="vehicle_notes" rows={2} defaultValue={profile?.vehicle_notes ?? ""} className={area} />
      </div>
      <fieldset>
        <legend className="mb-1 text-sm font-medium">Days you are usually available</legend>
        <div className="flex flex-wrap gap-3">
          {DAYS.map((d) => (
            <label key={d.value} className="flex h-11 items-center gap-2">
              <input type="checkbox" name="days" value={d.value} defaultChecked={profile?.availability.days?.includes(d.value)} className="h-5 w-5" />
              {d.label}
            </label>
          ))}
        </div>
      </fieldset>
      <div>
        <label htmlFor="availability_notes" className="mb-1 block text-sm font-medium">Availability notes</label>
        <textarea id="availability_notes" name="availability_notes" rows={2} defaultValue={profile?.availability.notes ?? ""} className={area} />
      </div>
      {state?.error && <p role="alert" className="text-sm text-danger">{state.error}</p>}
      <button type="submit" disabled={pending} className="h-12 rounded-xl bg-brand text-base font-semibold text-brand-foreground disabled:opacity-60">
        Save profile
      </button>
    </form>
  );
}
