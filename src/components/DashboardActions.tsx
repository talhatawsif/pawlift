"use client";

import { useActionState } from "react";
import {
  completeRequest, confirmAssignment, confirmReceipt, offerLeg, reassignLeg, releaseReserved, resolveIncident, withdrawOffer,
  type DashState,
} from "@/app/org/[id]/dashboard/actions";

const primary = "h-11 w-full rounded-xl bg-brand text-sm font-semibold text-brand-foreground disabled:opacity-60";
const secondary = "h-11 w-full rounded-xl border border-border text-sm font-semibold disabled:opacity-60";
const input = "h-11 w-full rounded-xl border border-border bg-background px-3 text-base";

export type Volunteer = { user_id: string; name: string };

type Props = {
  orgId: string;
  action: (s: DashState, f: FormData) => Promise<DashState>;
  label: string;
  hidden: Record<string, string>;
  text?: { label: string; required?: boolean };
  volunteers?: Volunteer[];
  volunteerRequired?: boolean;
  style?: "primary" | "secondary";
};

function Form({ orgId, action, label, hidden, text, volunteers, volunteerRequired, style }: Props) {
  const [state, run, pending] = useActionState(action, undefined);
  const uid = `${label}-${Object.values(hidden).join("-")}`.replace(/[^a-z0-9-]/gi, "");
  return (
    <form action={run} className="flex flex-col gap-2">
      <input type="hidden" name="org_id" value={orgId} />
      {Object.entries(hidden).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      {volunteers && (
        <>
          <label htmlFor={`v-${uid}`} className="text-sm font-medium">Volunteer</label>
          <select id={`v-${uid}`} name="volunteer_id" required={volunteerRequired} className={input} defaultValue="">
            <option value="">{volunteerRequired ? "Choose a volunteer" : "No one yet (reopen it)"}</option>
            {volunteers.map((v) => <option key={v.user_id} value={v.user_id}>{v.name}</option>)}
          </select>
        </>
      )}
      {text && (
        <>
          <label htmlFor={`t-${uid}`} className="text-sm font-medium">{text.label}</label>
          <input id={`t-${uid}`} name="text" maxLength={500} required={text.required} className={input} />
        </>
      )}
      {state?.error && <p role="alert" className="text-sm text-danger">{state.error}</p>}
      <button type="submit" disabled={pending} className={style === "secondary" ? secondary : primary}>{pending ? "Working…" : label}</button>
    </form>
  );
}

export function ConfirmButton({ orgId, assignmentId }: { orgId: string; assignmentId: string }) {
  return <Form orgId={orgId} action={confirmAssignment} label="Confirm this volunteer" hidden={{ assignment_id: assignmentId }} />;
}
export function ReleaseButton({ orgId, assignmentId }: { orgId: string; assignmentId: string }) {
  return <Form orgId={orgId} action={releaseReserved} label="Turn down" style="secondary" hidden={{ assignment_id: assignmentId }} text={{ label: "Reason (optional)" }} />;
}
export function WithdrawOfferButton({ orgId, assignmentId }: { orgId: string; assignmentId: string }) {
  return <Form orgId={orgId} action={withdrawOffer} label="Withdraw offer" style="secondary" hidden={{ assignment_id: assignmentId }} text={{ label: "Reason (optional)" }} />;
}
export function OfferForm({ orgId, legId, volunteers }: { orgId: string; legId: string; volunteers: Volunteer[] }) {
  if (volunteers.length === 0) return <p className="text-sm text-muted">No verified volunteers in your organisation yet.</p>;
  return <Form orgId={orgId} action={offerLeg} label="Offer to this volunteer" hidden={{ leg_id: legId }} volunteers={volunteers} volunteerRequired />;
}
export function ReassignForm({ orgId, assignmentId, volunteers }: { orgId: string; assignmentId: string; volunteers: Volunteer[] }) {
  return <Form orgId={orgId} action={reassignLeg} label="Reassign" style="secondary" hidden={{ assignment_id: assignmentId }} text={{ label: "Reason (required)", required: true }} volunteers={volunteers} />;
}
export function CompleteForm({ orgId, requestId }: { orgId: string; requestId: string }) {
  return <Form orgId={orgId} action={completeRequest} label="Animal received: mark complete" hidden={{ request_id: requestId }} text={{ label: "Note (optional)" }} />;
}
export function ReceiptForms({ orgId, requestId }: { orgId: string; requestId: string }) {
  return (
    <>
      <Form orgId={orgId} action={confirmReceipt} label="Animal arrived safely" hidden={{ request_id: requestId, outcome: "ok" }} text={{ label: "Note (optional)" }} />
      <Form orgId={orgId} action={confirmReceipt} label="Something's not right" style="secondary" hidden={{ request_id: requestId, outcome: "disputed" }} text={{ label: "What is not right? (required)", required: true }} />
    </>
  );
}
export function ResolveForm({ orgId, incidentId }: { orgId: string; incidentId: string }) {
  return <Form orgId={orgId} action={resolveIncident} label="Mark resolved" style="secondary" hidden={{ incident_id: incidentId }} text={{ label: "How was it resolved?", required: true }} />;
}
