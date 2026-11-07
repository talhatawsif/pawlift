"use client";

import { useActionState } from "react";
import { confirmReceipt } from "@/app/foster/actions";

export function ReceiptForm({ requestId, animalName }: { requestId: string; animalName: string }) {
  const [state, action, pending] = useActionState(confirmReceipt, undefined);
  const id = `note-${requestId}`;
  return (
    <form action={action} className="mt-3 flex flex-col gap-2 border-t border-border pt-3">
      <input type="hidden" name="request_id" value={requestId} />
      <label htmlFor={id} className="text-sm font-medium">Note for the coordinator (optional)</label>
      <textarea id={id} name="note" rows={2} maxLength={500} className="w-full rounded-xl border border-border bg-background px-3 py-2 text-base" />
      {state?.error && <p role="alert" className="text-sm text-danger">{state.error}</p>}
      {state?.notice && <p role="status" className="text-sm text-muted">{state.notice}</p>}
      <button type="submit" disabled={pending} className="h-12 w-full rounded-xl bg-brand text-base font-semibold text-brand-foreground disabled:opacity-60">
        {pending ? "Saving…" : `${animalName} has arrived safely`}
      </button>
    </form>
  );
}
