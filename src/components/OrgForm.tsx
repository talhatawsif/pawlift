"use client";

import { useActionState } from "react";
import type { FormState } from "@/app/auth/actions";
import { ORG_TYPES, type OrgDetail } from "@/lib/org";

const input = "h-12 w-full rounded-xl border border-border bg-background px-3 text-base";
const area = "w-full rounded-xl border border-border bg-background px-3 py-2 text-base";

type Props = {
  action: (state: FormState, form: FormData) => Promise<FormState>;
  org?: OrgDetail;
  submitLabel: string;
};

export function OrgForm({ action, org, submitLabel }: Props) {
  const [state, formAction, pending] = useActionState(action, undefined);
  const field = (id: string, label: string, value: string | null | undefined, opts: { type?: string; required?: boolean; hint?: string } = {}) => (
    <div>
      <label htmlFor={id} className="mb-1 block text-sm font-medium">{label}</label>
      <input id={id} name={id} type={opts.type ?? "text"} defaultValue={value ?? ""} required={opts.required} aria-describedby={opts.hint ? `${id}-hint` : undefined} className={input} />
      {opts.hint && <p id={`${id}-hint`} className="mt-1 text-xs text-muted">{opts.hint}</p>}
    </div>
  );
  return (
    <form action={formAction} className="flex flex-col gap-4">
      {org && <input type="hidden" name="org_id" value={org.id} />}
      {field("name", "Organisation name", org?.name, { required: true })}
      <div>
        <label htmlFor="type" className="mb-1 block text-sm font-medium">Type</label>
        <select id="type" name="type" defaultValue={org?.type ?? "rescue_group"} className={input}>
          {ORG_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
      </div>
      <div>
        <label htmlFor="registration_details" className="mb-1 block text-sm font-medium">Registration details</label>
        <textarea id="registration_details" name="registration_details" rows={3} defaultValue={org?.registration_details ?? ""} aria-describedby="reg-hint" className={area} />
        <p id="reg-hint" className="mt-1 text-xs text-muted">For example your ABN, rescue registration number or council pound code. Only our verifiers and your coordinators see this.</p>
      </div>
      {field("contact_name", "Contact name", org?.contact_name)}
      {field("contact_email", "Contact email", org?.contact_email, { type: "email" })}
      {field("contact_phone", "Contact phone", org?.contact_phone, { type: "tel", hint: "Not shown publicly." })}
      {field("operating_area", "Where you operate", org?.operating_area, { hint: "For example: Western Melbourne." })}
      {field("website", "Website or social page", org?.website, { type: "url" })}
      <div>
        <label htmlFor="description" className="mb-1 block text-sm font-medium">About your organisation</label>
        <textarea id="description" name="description" rows={4} defaultValue={org?.description ?? ""} className={area} />
      </div>
      {state?.error && <p role="alert" className="text-sm text-danger">{state.error}</p>}
      <button type="submit" disabled={pending} className="h-12 btn-primary disabled:opacity-60">
        {submitLabel}
      </button>
    </form>
  );
}
