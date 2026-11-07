export type MemberStatus = "invited" | "requested" | "active" | "removed";
export type VolunteerStatus = "pending" | "verified" | "rejected" | "suspended";

export type InvitationItem = {
  id: string;
  email: string | null;
  expires_at: string;
  max_uses: number;
  uses: number;
  revoked_at: string | null;
  created_at: string;
  status: "active" | "revoked" | "expired" | "used";
};

export type MemberItem = {
  id: string;
  user_id: string;
  display_name: string | null;
  status: MemberStatus;
  is_coordinator: boolean;
  is_volunteer: boolean;
  is_foster_carer: boolean;
  volunteer_status: VolunteerStatus | null;
  species_ok: string[] | null;
  max_size: string | null;
  has_carrier: boolean | null;
  availability: Availability | null;
};

export type Availability = { days?: string[]; notes?: string };

export type JoinableOrg = {
  id: string;
  name: string;
  type: string;
  operating_area: string | null;
  is_demo: boolean;
  my_status: MemberStatus | null;
};

export type InvitationPreview = {
  valid: boolean;
  reason: "invalid" | "revoked" | "expired" | "used" | "org_not_verified" | null;
  org_name?: string;
  org_type?: string;
  email_bound?: boolean;
  email_matches?: boolean;
};

export type VolunteerProfile = {
  user_id: string;
  species_ok: string[];
  max_size: string | null;
  has_carrier: boolean;
  vehicle_notes: string | null;
  availability: Availability;
  guidelines_version_accepted: string | null;
  guidelines_accepted_at: string | null;
  verification_status: VolunteerStatus;
  history: { decision: string; reason: string | null; decided_at: string }[];
};

export type VolunteerListItem = {
  user_id: string;
  display_name: string | null;
  verification_status: VolunteerStatus;
  guidelines_accepted: boolean;
  created_at: string;
  updated_at: string;
  is_demo: boolean;
};

export type AdminVolunteer = Omit<VolunteerProfile, "history"> & {
  display_name: string | null;
  orgs: string[];
  history: { decision: string; checks: string[]; reason: string | null; decided_at: string }[];
};

export const SPECIES = [
  { value: "cat", label: "Cats" },
  { value: "dog", label: "Dogs" },
  { value: "other", label: "Other animals" },
] as const;
export const SIZES = [
  { value: "small", label: "Small (up to about 10 kg)" },
  { value: "medium", label: "Medium (up to about 25 kg)" },
  { value: "large", label: "Large (over 25 kg)" },
] as const;
export const DAYS = [
  { value: "mon", label: "Mon" }, { value: "tue", label: "Tue" }, { value: "wed", label: "Wed" },
  { value: "thu", label: "Thu" }, { value: "fri", label: "Fri" }, { value: "sat", label: "Sat" }, { value: "sun", label: "Sun" },
] as const;

const VOL_LABEL: Record<VolunteerStatus, string> = {
  pending: "Awaiting verification",
  verified: "Verified",
  rejected: "Not verified",
  suspended: "Suspended",
};
export const volunteerLabel = (s: VolunteerStatus) => VOL_LABEL[s];
export const speciesLabel = (v: string) => SPECIES.find((s) => s.value === v)?.label ?? v;
