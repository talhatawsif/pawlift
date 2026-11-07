export const SPECIES = [
  { value: "cat", label: "Cat" },
  { value: "dog", label: "Dog" },
  { value: "other", label: "Other" },
] as const;
export const URGENCY = [
  { value: "routine", label: "Routine" },
  { value: "soon", label: "Soon" },
  { value: "urgent", label: "Urgent" },
] as const;

export const speciesLabel = (v: string) => SPECIES.find((s) => s.value === v)?.label ?? v;
export const urgencyLabel = (v: string) => URGENCY.find((s) => s.value === v)?.label ?? v;

const STATUS: Record<string, string> = {
  draft: "Draft", open: "Open for volunteers", assigned: "Assigned", confirmed: "Confirmed",
  en_route: "En route", collected: "Collected", delivered: "Delivered", completed: "Completed", cancelled: "Cancelled",
};
export const statusLabel = (v: string) => STATUS[v] ?? v;

export type RequestSummary = {
  id: string;
  reference: string;
  animal_name: string;
  species: string;
  urgency: string;
  status: string;
  published_at: string | null;
  photo_path: string | null;
  origin_suburb: string;
  destination_suburb: string;
  origin_lat: number | null;
  origin_lng: number | null;
  window_start: string;
  window_end: string;
  created_at: string;
};

export type RequestDetail = RequestSummary & {
  org_id: string;
  required_date: string | null;
  deadline: string | null;
  handling_requirements: string | null;
  carrier_requirements: string | null;
  medical_notes: string | null;
  coordinator_instructions: string | null;
  origin_location_id: string;
  destination_location_id: string;
  origin_label: string;
  destination_label: string;
  leg_status: string;
  version: number;
  is_demo: boolean;
  cancel_reason: string | null;
};

export type PublicRequest = {
  id: string;
  reference: string;
  animal_name: string;
  species: string;
  photo_path: string | null;
  urgency: string;
  deadline: string | null;
  handling_requirements: string | null;
  carrier_requirements: string | null;
  is_demo: boolean;
  org_name: string;
  org_verification_status: string;
  origin_label: string;
  origin_suburb: string;
  destination_label: string;
  destination_suburb: string;
  origin_lat: number | null;
  origin_lng: number | null;
  window_start: string | null;
  window_end: string | null;
};

/** Public URL of a sanitised photo in the public bucket (exists only after publishing). */
export const publicPhotoUrl = (path: string) =>
  `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/animal-photos/${path}`;

/** Messages written by our own request RPCs are safe to show; anything else gets a generic line. */
export function requestError(error: { code?: string; message?: string } | null | undefined, fallback: string): string {
  if (!error) return fallback;
  switch (error.code) {
    case "42501": return "You don't have permission to do that.";
    case "28000": return "Please sign in again.";
    case "55000":
    case "22023":
    case "55006":
    case "54000":
      return error.message || fallback;
    default: return fallback;
  }
}
