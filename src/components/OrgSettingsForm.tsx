"use client";

import { useActionState } from "react";
import { updateOrgSettings } from "@/app/org/actions";
import type { OrgDetail } from "@/lib/org";

const input = "h-12 w-full rounded-xl border border-border bg-background px-3 text-base";

export function OrgSettingsForm({ org }: { org: OrgDetail }) {
  const [state, action, pending] = useActionState(updateOrgSettings, undefined);
  const field = (id: string, label: string, value: string | null, type = "text") => (
    <div>
      <label htmlFor={id} className="mb-1 block text-sm font-medium">{label}</label>
      <input id={id} name={id} type={type} defaultValue={value ?? ""} className={input} />
    </div>
  );
  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="org_id" value={org.id} />
      {field("contact_name", "Contact name", org.contact_name)}
      {field("contact_email", "Contact email", org.contact_email, "email")}
      {field("contact_phone", "Contact phone", org.contact_phone, "tel")}
      {field("operating_area", "Operating area", org.operating_area)}
      {field("website", "Website", org.website, "url")}
      <div>
        <label htmlFor="description" className="mb-1 block text-sm font-medium">About your organisation</label>
        <textarea id="description" name="description" rows={4} maxLength={1000} defaultValue={org.description ?? ""}
          className="w-full rounded-xl border border-border bg-background px-3 py-2 text-base" />
      </div>
      {state?.error && <p role="alert" className="text-sm text-danger">{state.error}</p>}
      {state?.notice && <p role="status" className="text-sm text-muted">{state.notice}</p>}
      <button type="submit" disabled={pending} className="h-12 w-full rounded-xl bg-brand text-base font-semibold text-brand-foreground disabled:opacity-60">
        {pending ? "Saving…" : "Save settings"}
      </button>
    </form>
  );
}
