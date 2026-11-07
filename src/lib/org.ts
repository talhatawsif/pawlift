export const ORG_TYPES = [
  { value: "rescue_group", label: "Rescue group" },
  { value: "charity", label: "Charity" },
  { value: "council_pound", label: "Council pound" },
  { value: "shelter", label: "Shelter" },
  { value: "vet_clinic", label: "Vet clinic" },
  { value: "other", label: "Other" },
] as const;

export const typeLabel = (v: string) => ORG_TYPES.find((t) => t.value === v)?.label ?? v;

export type OrgDetail = {
  id: string;
  name: string;
  type: string;
  registration_details: string | null;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  operating_area: string | null;
  website: string | null;
  description: string | null;
  verification_status: "pending" | "verified" | "rejected" | "suspended";
  is_demo: boolean;
  created_at: string;
  history: { decision: string; checks: string[]; reason: string | null; decided_at: string }[];
};

export type OrgListItem = {
  id: string;
  name: string;
  type: string;
  operating_area: string | null;
  verification_status: OrgDetail["verification_status"];
  created_at: string;
  updated_at: string;
  is_demo: boolean;
};

/** Friendly message for an RPC error code; never leaks raw database text. */
export function rpcMessage(code: string | undefined, fallback: string): string {
  switch (code) {
    case "42501": return "You don't have permission to do that.";
    case "54000": return "You already have 3 organisations awaiting verification.";
    case "55000": return "That isn't possible in the organisation's current state.";
    case "P0002": return "We couldn't find that, or it's no longer valid.";
    case "22023": return "Please check the details and try again.";
    default: return fallback;
  }
}

const VERIFICATION_LABEL = {
  pending: "Awaiting verification",
  verified: "Verified",
  rejected: "Not verified",
  suspended: "Suspended",
} as const;
export const verificationLabel = (s: OrgDetail["verification_status"]) => VERIFICATION_LABEL[s];

/** Australia/Melbourne display for stored UTC timestamps. */
export const formatMelbourne = (iso: string) =>
  new Intl.DateTimeFormat("en-AU", { dateStyle: "medium", timeStyle: "short", timeZone: "Australia/Melbourne" }).format(new Date(iso));
