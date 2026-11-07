"use client";

import { useActionState } from "react";
import { decideOrganisation } from "@/app/admin/actions";

const area = "w-full rounded-xl border border-border bg-background px-3 py-2 text-base";

export function DecisionForm({ orgId, status }: { orgId: string; status: string }) {
  const [state, formAction, pending] = useActionState(decideOrganisation, undefined);
  const options =
    status === "pending" ? ["verified", "rejected"] : status === "verified" ? ["suspended"] : status === "suspended" ? ["verified"] : [];
  if (options.length === 0) return <p className="text-sm text-muted">No decision is available. The organisation must resubmit first.</p>;
  const labels: Record<string, string> = { verified: status === "suspended" ? "Reinstate" : "Verify", rejected: "Reject", suspended: "Suspend" };
  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="org_id" value={orgId} />
      <div>
        <label htmlFor="checks" className="mb-1 block text-sm font-medium">Checks performed (one per line)</label>
        <textarea id="checks" name="checks" rows={4} aria-describedby="checks-hint" className={area} />
        <p id="checks-hint" className="mt-1 text-xs text-muted">Record exactly what you checked, for example &ldquo;ABN found on ABN Lookup and matches the name&rdquo;. Required to verify.</p>
      </div>
      <div>
        <label htmlFor="reason" className="mb-1 block text-sm font-medium">Reason</label>
        <textarea id="reason" name="reason" rows={3} className={area} />
        <p className="mt-1 text-xs text-muted">Required to reject or suspend. Coordinators will see it.</p>
      </div>
      {state?.error && <p role="alert" className="text-sm text-danger">{state.error}</p>}
      <div className="flex gap-2">
        {options.map((d) => (
          <button key={d} type="submit" name="decision" value={d} disabled={pending}
            className={`h-12 flex-1 rounded-xl text-base font-semibold disabled:opacity-60 ${d === "verified" ? "bg-brand text-brand-foreground" : "border border-border bg-surface text-danger"}`}>
            {labels[d]}
          </button>
        ))}
      </div>
    </form>
  );
}
