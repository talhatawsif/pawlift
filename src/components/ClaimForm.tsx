"use client";

import { useActionState, useState } from "react";
import { claimLeg } from "@/app/requests/actions";

/** One idempotency key per mounted form, so a retried submit cannot claim twice. */
export function ClaimForm({ legId, blocked, animalName }: { legId: string; blocked: string | null; animalName: string }) {
  const [key] = useState(() => crypto.randomUUID());
  const [state, action, pending] = useActionState(claimLeg, undefined);
  return (
    <form action={action} className="flex flex-col gap-2">
      <input type="hidden" name="leg_id" value={legId} />
      <input type="hidden" name="key" value={key} />
      {blocked && <p role="status" className="rounded-xl border border-border bg-surface p-3 text-sm">{blocked}</p>}
      {state?.error && <p role="alert" className="text-sm text-danger">{state.error}</p>}
      <button type="submit" disabled={pending || !!blocked} className="h-12 w-full rounded-xl bg-brand text-base font-semibold text-brand-foreground disabled:opacity-60">
        {pending ? "Reserving…" : `I can take ${animalName}`}
      </button>
      {!blocked && <p className="text-xs text-muted">This reserves it for you. The organisation confirms before you get the exact addresses.</p>}
    </form>
  );
}
