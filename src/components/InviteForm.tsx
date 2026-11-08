"use client";

import { useActionState, useState } from "react";
import { createInvitation } from "@/app/org/[id]/members/actions";

const input = "h-12 w-full rounded-xl border border-border bg-background px-3 text-base";

export function InviteForm({ orgId, orgName }: { orgId: string; orgName: string }) {
  const [state, formAction, pending] = useActionState(createInvitation, undefined);
  const [copied, setCopied] = useState(false);
  const mailto = state?.link && state.email
    ? `mailto:${state.email}?subject=${encodeURIComponent(`Join ${orgName} on PawLift`)}&body=${encodeURIComponent(
        `${orgName} has invited you to help with animal transport on PawLift.\n\nOpen this link while signed in with ${state.email}:\n${state.link}`)}`
    : null;
  return (
    <div className="flex flex-col gap-4">
      <form action={formAction} className="flex flex-col gap-3">
        <input type="hidden" name="org_id" value={orgId} />
        <input type="hidden" name="org_name" value={orgName} />
        <div>
          <label htmlFor="email" className="mb-1 block text-sm font-medium">Email (optional)</label>
          <input id="email" name="email" type="email" className={input} aria-describedby="email-hint" />
          <p id="email-hint" className="mt-1 text-xs text-muted">Leave blank for a link anyone can use. With an email, only that address can accept it, once.</p>
        </div>
        <div className="flex gap-3">
          <div className="flex-1">
            <label htmlFor="days" className="mb-1 block text-sm font-medium">Expires in (days)</label>
            <input id="days" name="days" type="number" min={1} max={30} defaultValue={14} className={input} />
          </div>
          <div className="flex-1">
            <label htmlFor="uses" className="mb-1 block text-sm font-medium">Max uses</label>
            <input id="uses" name="uses" type="number" min={1} max={100} defaultValue={10} className={input} />
          </div>
        </div>
        {state?.error && <p role="alert" className="text-sm text-danger">{state.error}</p>}
        <button type="submit" disabled={pending} className="h-12 btn-primary disabled:opacity-60">
          Create invitation
        </button>
      </form>
      {state?.link && (
        <div role="status" className="rounded-xl border border-border bg-surface p-3 text-sm">
          <p className="font-medium">Copy this link now. We can&rsquo;t show it again.</p>
          <input readOnly value={state.link} aria-label="Invitation link" onFocus={(e) => e.currentTarget.select()} className="mt-2 h-10 w-full rounded-lg border border-border bg-background px-2 text-xs" />
          <div className="mt-2 flex gap-2">
            <button type="button" className="h-10 rounded-lg border border-border px-3 font-medium"
              onClick={async () => { try { await navigator.clipboard.writeText(state.link!); setCopied(true); } catch { setCopied(false); } }}>
              {copied ? "Copied" : "Copy link"}
            </button>
            {mailto && <a href={mailto} className="flex h-10 items-center rounded-lg border border-border px-3 font-medium">Email it</a>}
          </div>
        </div>
      )}
    </div>
  );
}
