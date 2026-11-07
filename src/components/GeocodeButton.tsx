"use client";

import { useActionState } from "react";
import type { LocationState } from "@/app/org/[id]/locations/actions";

type Props = {
  action: (s: LocationState, f: FormData) => Promise<LocationState>;
  orgId: string;
  locationId: string;
};

export function GeocodeButton({ action, orgId, locationId }: Props) {
  const [state, formAction, pending] = useActionState(action, undefined);
  return (
    <form action={formAction} className="mt-2">
      <input type="hidden" name="org_id" value={orgId} />
      <input type="hidden" name="location_id" value={locationId} />
      <button disabled={pending} className="h-10 rounded-lg border border-border px-3 text-sm font-medium">
        {pending ? "Looking up…" : "Find address on map"}
      </button>
      <p role="status" className="mt-1 text-xs text-muted">
        {state?.error ?? (state?.ok ? "Map point saved (private)." : "")}
      </p>
    </form>
  );
}
