/** Types for the 6b read functions (foster receiving, history, admin oversight). */

export type IncomingDelivery = {
  request_id: string;
  reference: string;
  animal_name: string;
  species: string;
  urgency: string;
  request_status: "confirmed" | "en_route" | "collected" | "delivered";
  is_demo: boolean;
  org_name: string;
  origin_suburb: string;
  window_start: string;
  window_end: string;
  delivered_at: string | null;
  receipt_confirmed: boolean;
  can_confirm_receipt: boolean;
  driver_first_name: string | null;
  driver_phone: string | null;
};

export type FosterHistoryRow = {
  request_id: string;
  reference: string;
  animal_name: string;
  species: string;
  is_demo: boolean;
  org_name: string;
  origin_suburb: string;
  completed_at: string | null;
  received_at: string | null;
  received_by_coordinator: boolean | null;
};

export type HistoryRow = {
  request_id: string;
  reference: string;
  animal_name: string;
  species: string;
  status: "completed" | "cancelled";
  is_demo: boolean;
  origin_suburb: string | null;
  destination_suburb: string | null;
  ended_at: string | null;
  cancel_reason: string | null;
  driver_name: string | null;
};

export type AdminIncident = {
  id: string;
  request_id: string;
  reference: string;
  animal_name: string;
  is_demo: boolean;
  org_id: string;
  org_name: string;
  type: string;
  severity: "low" | "high";
  status: "open" | "acknowledged" | "resolved";
  description: string | null;
  resolution: string | null;
  created_at: string;
  resolved_at: string | null;
  raised_by_name: string | null;
};

export type AdminAuditRow = {
  id: string;
  action: string;
  entity_type: string;
  entity_id: string | null;
  org_id: string | null;
  org_name: string | null;
  reason: string | null;
  created_at: string;
  actor_name: string | null;
};

export type PrivateAccessRow = {
  id: string;
  subject: string;
  reason: string;
  created_at: string;
  actor_name: string | null;
  org_name: string | null;
  reference: string | null;
  animal_name: string | null;
};

export type PrivatePlace = {
  label: string | null;
  exact_address: string | null;
  contact_name: string | null;
  contact_phone: string | null;
  instructions: string | null;
};

export type PrivateDetails = {
  request_id: string;
  reference: string;
  animal_name: string;
  org_name: string;
  medical_notes: string | null;
  coordinator_instructions: string | null;
  origin: PrivatePlace;
  destination: PrivatePlace;
};

export const DEMO_BADGE = "ml-2 rounded bg-urgent/10 px-1.5 text-xs font-semibold text-urgent";

const STATUS: Record<string, string> = {
  confirmed: "Driver confirmed",
  en_route: "Driver on the way to pick up",
  collected: "On the way to you",
  delivered: "Delivered",
  completed: "Completed",
  cancelled: "Cancelled",
};
export const requestStatusLabel = (s: string) => STATUS[s] ?? s;

const INCIDENT_TYPE: Record<string, string> = {
  delay: "Delay", animal_welfare: "Animal welfare", vehicle: "Vehicle", handover_dispute: "Handover",
  late_withdrawal: "Late withdrawal", no_show: "No-show", other: "Other",
};
export const incidentTypeLabel = (t: string) => INCIDENT_TYPE[t] ?? t;
