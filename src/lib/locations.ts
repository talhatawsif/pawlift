export const LOCATION_KINDS = [
  { value: "pound", label: "Pound" },
  { value: "shelter", label: "Shelter" },
  { value: "rescue_facility", label: "Rescue facility" },
  { value: "vet", label: "Vet" },
  { value: "other", label: "Other" },
] as const;

export const kindLabel = (k: string) =>
  k === "foster_home" ? "Foster home" : (LOCATION_KINDS.find((x) => x.value === k)?.label ?? k);

export type Suburb = { id: string; name: string; postcode: string };

export type OrgLocation = {
  id: string;
  kind: string;
  label_public: string;
  suburb_id: string;
  suburb: string;
  postcode: string;
  is_confirmed_destination: boolean;
  confirmed_at: string | null;
  linked_user_id: string | null;
  exact_address: string | null;
  contact_name: string | null;
  contact_phone: string | null;
  instructions: string | null;
};

export type FosterHome = {
  location_id: string;
  org_id: string;
  org_name: string;
  suburb: string;
  postcode: string;
  is_confirmed_destination: boolean;
  can_confirm_receipt: boolean;
  exact_address: string | null;
  contact_name: string | null;
  contact_phone: string | null;
  instructions: string | null;
};
