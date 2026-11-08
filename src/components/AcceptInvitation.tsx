"use client";

import { useActionState } from "react";
import { acceptInvitation } from "@/app/join/actions";

export function AcceptInvitation({ token, orgName }: { token: string; orgName: string }) {
  const [state, formAction, pending] = useActionState(acceptInvitation, undefined);
  return (
    <form action={formAction} className="mt-6 flex flex-col gap-3">
      <input type="hidden" name="token" value={token} />
      {state?.error && <p role="alert" className="text-sm text-danger">{state.error}</p>}
      <button type="submit" disabled={pending} className="h-12 btn-primary disabled:opacity-60">
        Join {orgName} as a volunteer
      </button>
    </form>
  );
}
