"use client";

import { useActionState } from "react";
import { mergeLegs, splitLeg, updateLeg, type RequestState } from "@/app/org/[id]/requests/actions";
import { isoToMelbourneLocal } from "@/lib/time/melbourne";
import type { LegRow } from "@/lib/requests";

type Handover = { id: string; label: string; suburb: string };

const input = "h-12 w-full rounded-xl border border-border bg-background px-3 text-base";
const btn = "h-12 w-full rounded-xl bg-brand text-base font-semibold text-brand-foreground disabled:opacity-60";
const ghost = "h-12 w-full rounded-xl border border-border text-base font-semibold disabled:opacity-60";

const msg = (s: RequestState) => (
  <>
    {s?.error && <p role="alert" className="text-sm text-danger">{s.error}</p>}
    {s?.ok && !s.error && <p role="status" className="text-sm text-muted">Saved.</p>}
  </>
);

const when = (iso: string) =>
  new Intl.DateTimeFormat("en-AU", {
    timeZone: "Australia/Melbourne", weekday: "short", day: "numeric", month: "short",
    hour: "numeric", minute: "2-digit",
  }).format(new Date(iso));

function Hidden({ orgId, requestId, version, seq }: { orgId: string; requestId: string; version: number; seq: number }) {
  return (
    <>
      <input type="hidden" name="org_id" value={orgId} />
      <input type="hidden" name="request_id" value={requestId} />
      <input type="hidden" name="version" value={version} />
      <input type="hidden" name="seq" value={seq} />
    </>
  );
}

function SplitForm(p: { orgId: string; requestId: string; version: number; leg: LegRow; handovers: Handover[] }) {
  const [state, action, pending] = useActionState(splitLeg, undefined);
  const mid = (a: string, b: string) => new Date((new Date(a).getTime() + new Date(b).getTime()) / 2).toISOString();
  const id = `split-${p.leg.seq}`;
  const usable = p.handovers.filter((h) => h.id !== p.leg.from_id && h.id !== p.leg.to_id);
  return (
    <form action={action} className="mt-3 flex flex-col gap-3 rounded-xl border border-border p-3">
      <Hidden orgId={p.orgId} requestId={p.requestId} version={p.version} seq={p.leg.seq} />
      <h4 className="text-sm font-semibold">Split leg {p.leg.seq} with a handover</h4>
      <div>
        <label htmlFor={`${id}-h`} className="mb-1 block text-sm font-medium">Handover point</label>
        <select id={`${id}-h`} name="handover_location_id" required defaultValue="" className={input}>
          <option value="" disabled>Choose a handover point</option>
          {usable.map((h) => <option key={h.id} value={h.id}>{h.label} · {h.suburb}</option>)}
        </select>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor={`${id}-a`} className="mb-1 block text-sm font-medium">First driver arrives by</label>
          <input id={`${id}-a`} name="first_end" type="datetime-local" required defaultValue={isoToMelbourneLocal(mid(p.leg.window_start, p.leg.window_end))} className={input} />
        </div>
        <div>
          <label htmlFor={`${id}-b`} className="mb-1 block text-sm font-medium">Next driver can leave from</label>
          <input id={`${id}-b`} name="second_start" type="datetime-local" required defaultValue={isoToMelbourneLocal(mid(p.leg.window_start, p.leg.window_end))} className={input} />
        </div>
      </div>
      {msg(state)}
      <button type="submit" disabled={pending} className={btn}>Split leg</button>
    </form>
  );
}

function TimesForm(p: { orgId: string; requestId: string; version: number; leg: LegRow; isLast: boolean; handovers: Handover[] }) {
  const [state, action, pending] = useActionState(updateLeg, undefined);
  const id = `times-${p.leg.seq}`;
  const options = p.handovers.filter((h) => h.id === p.leg.to_id || h.id !== p.leg.from_id);
  return (
    <form action={action} className="mt-3 flex flex-col gap-3 rounded-xl border border-border p-3">
      <Hidden orgId={p.orgId} requestId={p.requestId} version={p.version} seq={p.leg.seq} />
      <h4 className="text-sm font-semibold">Change leg {p.leg.seq}</h4>
      <p className="text-xs text-muted">Times are Melbourne time.</p>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor={`${id}-s`} className="mb-1 block text-sm font-medium">Starts</label>
          <input id={`${id}-s`} name="window_start" type="datetime-local" required defaultValue={isoToMelbourneLocal(p.leg.window_start)} className={input} />
        </div>
        <div>
          <label htmlFor={`${id}-e`} className="mb-1 block text-sm font-medium">Ends</label>
          <input id={`${id}-e`} name="window_end" type="datetime-local" required defaultValue={isoToMelbourneLocal(p.leg.window_end)} className={input} />
        </div>
      </div>
      {!p.isLast && (
        <div>
          <label htmlFor={`${id}-t`} className="mb-1 block text-sm font-medium">Handover point at the end</label>
          <select id={`${id}-t`} name="to_location_id" defaultValue={p.leg.to_id} className={input}>
            {options.map((h) => <option key={h.id} value={h.id}>{h.label} · {h.suburb}</option>)}
          </select>
        </div>
      )}
      {msg(state)}
      <button type="submit" disabled={pending} className={btn}>Save leg</button>
    </form>
  );
}

function MergeForm(p: { orgId: string; requestId: string; version: number; seq: number }) {
  const [state, action, pending] = useActionState(mergeLegs, undefined);
  return (
    <form action={action} className="mt-3 flex flex-col gap-2">
      <Hidden orgId={p.orgId} requestId={p.requestId} version={p.version} seq={p.seq} />
      {msg(state)}
      <button type="submit" disabled={pending} className={ghost}>Merge leg {p.seq} with leg {p.seq + 1}</button>
    </form>
  );
}

export function LegEditor(p: {
  orgId: string;
  requestId: string;
  version: number;
  legs: LegRow[];
  handovers: Handover[];
  editable: boolean;
}) {
  const { legs } = p;
  return (
    <div className="flex flex-col gap-4">
      {legs.map((leg, i) => (
        <section key={leg.id} aria-label={`Leg ${leg.seq}`} className="rounded-xl border border-border p-3">
          <h3 className="font-semibold">Leg {leg.seq}{legs.length > 1 && i === 0 ? " (pickup)" : ""}{i === legs.length - 1 && legs.length > 1 ? " (delivery)" : ""}</h3>
          <p className="text-sm">{leg.from_label} ({leg.from_suburb}) to {leg.to_label} ({leg.to_suburb})</p>
          <p className="text-sm text-muted">{when(leg.window_start)} to {when(leg.window_end)}</p>
          {p.editable && (
            <details className="mt-2">
              <summary className="cursor-pointer text-sm font-medium text-brand underline">Edit this leg</summary>
              <TimesForm orgId={p.orgId} requestId={p.requestId} version={p.version} leg={leg} isLast={i === legs.length - 1} handovers={p.handovers} />
              {p.handovers.some((h) => h.id !== leg.from_id && h.id !== leg.to_id) && legs.length < 5 && (
                <SplitForm orgId={p.orgId} requestId={p.requestId} version={p.version} leg={leg} handovers={p.handovers} />
              )}
              {i < legs.length - 1 && (
                <MergeForm orgId={p.orgId} requestId={p.requestId} version={p.version} seq={leg.seq} />
              )}
            </details>
          )}
        </section>
      ))}
      {p.editable && p.handovers.length === 0 && (
        <p className="text-sm text-muted">To split this into a relay, add a handover point on the locations page first.</p>
      )}
    </div>
  );
}
