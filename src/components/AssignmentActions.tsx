"use client";

import { useActionState, useState } from "react";
import {
  acceptOffer, confirmDelivery, confirmPickup, declineOffer, releaseAssignment, reportIncident,
  startLeg, withdrawAssignment, type ActionState,
} from "@/app/assignments/actions";
import { INCIDENT_TYPES } from "@/lib/assignments";

const primary = "h-12 w-full btn-primary disabled:opacity-60";
const secondary = "h-12 w-full rounded-xl border border-border text-base font-semibold disabled:opacity-60";
const input = "h-12 w-full rounded-xl border border-border bg-background px-3 text-base";

function Msg({ s }: { s: ActionState }) {
  return s?.error ? <p role="alert" className="text-sm text-danger">{s.error}</p> : null;
}

type Cfg = {
  action: (s: ActionState, f: FormData) => Promise<ActionState>;
  label: string;
  field?: { label: string; required?: boolean };
  style?: "primary" | "secondary" | "danger";
};

function One({ id, cfg }: { id: string; cfg: Cfg }) {
  const [state, action, pending] = useActionState(cfg.action, undefined);
  const cls = cfg.style === "secondary" ? secondary : cfg.style === "danger" ? `${secondary} border-danger text-danger` : primary;
  const fid = `${cfg.label}-${id}`.replace(/\s+/g, "-");
  return (
    <form action={action} className="flex flex-col gap-2">
      <input type="hidden" name="assignment_id" value={id} />
      {cfg.field && (
        <>
          <label htmlFor={fid} className="text-sm font-medium">{cfg.field.label}</label>
          <input id={fid} name="text" maxLength={500} required={cfg.field.required} className={input} />
        </>
      )}
      <Msg s={state} />
      <button type="submit" disabled={pending} className={cls}>{pending ? "Working…" : cfg.label}</button>
    </form>
  );
}

/** The actions that make sense for the assignment and leg state; the database re-checks every one. */
export function AssignmentActions({ id, status, legStatus }: { id: string; status: string; legStatus: string }) {
  if (status === "offered") {
    return (
      <div className="flex flex-col gap-4">
        <One id={id} cfg={{ action: acceptOffer, label: "Accept this transport" }} />
        <One id={id} cfg={{ action: declineOffer, label: "Decline", style: "secondary", field: { label: "Reason (optional)" } }} />
      </div>
    );
  }
  if (status === "reserved") {
    return <One id={id} cfg={{ action: releaseAssignment, label: "Let someone else take it", style: "secondary", field: { label: "Reason (optional)" } }} />;
  }
  if (status !== "confirmed") return null;
  return (
    <div className="flex flex-col gap-4">
      {legStatus === "confirmed" && <One id={id} cfg={{ action: startLeg, label: "Start trip" }} />}
      {legStatus === "en_route" && <One id={id} cfg={{ action: confirmPickup, label: "I've collected the animal", field: { label: "Note (optional)" } }} />}
      {legStatus === "collected" && <One id={id} cfg={{ action: confirmDelivery, label: "I've delivered the animal", field: { label: "Note (optional)" } }} />}
      {(legStatus === "confirmed" || legStatus === "en_route") && (
        <One id={id} cfg={{ action: withdrawAssignment, label: "Withdraw from this transport", style: "danger", field: { label: "Reason (required)", required: true } }} />
      )}
    </div>
  );
}

export function IncidentForm({ requestId, legId, orgId }: { requestId: string; legId: string | null; orgId?: string }) {
  const [state, action, pending] = useActionState(reportIncident, undefined);
  const [open, setOpen] = useState(false);
  if (!open) {
    return <button type="button" onClick={() => setOpen(true)} className={secondary}>Report a problem</button>;
  }
  return (
    <form action={action} className="flex flex-col gap-2 rounded-xl border border-border p-3">
      <input type="hidden" name="request_id" value={requestId} />
      <input type="hidden" name="leg_id" value={legId ?? ""} />
      <input type="hidden" name="org_id" value={orgId ?? ""} />
      <label htmlFor="inc-type" className="text-sm font-medium">What happened?</label>
      <select id="inc-type" name="type" className={input} defaultValue="delay">
        {INCIDENT_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
      </select>
      <label htmlFor="inc-sev" className="text-sm font-medium">How serious is it?</label>
      <select id="inc-sev" name="severity" className={input} defaultValue="low">
        <option value="low">Minor, just letting you know</option>
        <option value="high">Serious, needs attention now</option>
      </select>
      <label htmlFor="inc-text" className="text-sm font-medium">Details</label>
      <textarea id="inc-text" name="text" required minLength={3} maxLength={1000} rows={3} className="w-full rounded-xl border border-border bg-background p-3 text-base" />
      <p className="text-xs text-muted">If an animal is in danger, contact the organisation or emergency services directly.</p>
      <Msg s={state} />
      {state && !state.error && <p role="status" className="text-sm text-muted">Sent to the coordinators.</p>}
      <button type="submit" disabled={pending} className={primary}>Send report</button>
    </form>
  );
}
