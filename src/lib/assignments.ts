import { formatMelbourne } from "@/lib/org";

export type MyAssignment = {
  assignment_id: string;
  assignment_status: "offered" | "reserved" | "confirmed" | "completed" | "declined" | "withdrawn" | "released" | "expired" | "reassigned" | "cancelled";
  kind: "claim" | "offer";
  created_at: string;
  reserved_until: string | null;
  offer_expires_at: string | null;
  leg_id: string;
  leg_status: string;
  window_start: string;
  window_end: string;
  request_id: string;
  reference: string;
  animal_name: string;
  species: string;
  photo_path: string | null;
  urgency: string;
  request_status: string;
  is_demo: boolean;
  org_name: string;
  origin_suburb: string;
  destination_suburb: string;
};

export type RequestView = {
  request_id: string;
  reference: string;
  animal_name: string;
  species: string;
  photo_path: string | null;
  urgency: string;
  is_demo: boolean;
  status: string;
  handling_requirements: string | null;
  carrier_requirements: string | null;
  deadline: string | null;
  org_name: string;
  org_verification_status: string;
  leg_id: string;
  window_start: string;
  window_end: string;
  origin_label: string;
  origin_suburb: string;
  destination_label: string;
  destination_suburb: string;
  claim_block: string | null;
  my_assignment_id: string | null;
};

export type PrivatePlace = {
  label: string;
  suburb: string;
  address: string | null;
  contact_name: string | null;
  contact_phone: string | null;
  instructions: string | null;
  lat: number | null;
  lng: number | null;
};

export type PrivateDetails = {
  animal_name: string;
  species: string;
  handling_requirements: string | null;
  carrier_requirements: string | null;
  medical_notes: string | null;
  coordinator_instructions: string | null;
  pickup: PrivatePlace;
  dropoff: PrivatePlace;
};

export type OrgRow = {
  request_id: string;
  reference: string;
  animal_name: string;
  species: string;
  urgency: string;
  request_status: string;
  is_demo: boolean;
  completed_at: string | null;
  leg_id: string;
  seq: number;
  leg_status: string;
  window_start: string;
  window_end: string;
  assignment_id: string | null;
  assignment_status: string | null;
  reserved_until: string | null;
  offer_expires_at: string | null;
  volunteer_id: string | null;
  volunteer_name: string | null;
  origin_suburb: string;
  destination_suburb: string;
  open_incidents: number;
};

export type OrgIncident = {
  id: string;
  request_id: string;
  reference: string;
  animal_name: string;
  type: string;
  severity: "low" | "high";
  description: string | null;
  status: "open" | "acknowledged" | "resolved";
  resolution: string | null;
  created_at: string;
  raised_by_name: string | null;
};

export type AuditRow = {
  id: string;
  action: string;
  entity_type: string;
  entity_id: string | null;
  created_at: string;
  reason: string | null;
  actor_name: string | null;
  request_id: string | null;
};

const ASSIGNMENT_STATUS: Record<string, string> = {
  offered: "Offer waiting for you",
  reserved: "Waiting for the coordinator to confirm",
  confirmed: "Confirmed",
  completed: "Delivered",
  declined: "Declined",
  withdrawn: "You withdrew",
  released: "Released",
  expired: "Expired",
  reassigned: "Reassigned",
  cancelled: "Cancelled",
};
export const assignmentLabel = (s: string) => ASSIGNMENT_STATUS[s] ?? s;

const LEG_STATUS: Record<string, string> = {
  open: "Open", offered: "Offered", reserved: "Waiting for confirmation", confirmed: "Confirmed",
  en_route: "On the way", collected: "Animal collected", delivered: "Delivered", cancelled: "Cancelled",
};
export const legLabel = (s: string) => LEG_STATUS[s] ?? s;

export const INCIDENT_TYPES = [
  { value: "delay", label: "Running late" },
  { value: "animal_welfare", label: "Animal welfare concern" },
  { value: "vehicle", label: "Vehicle problem" },
  { value: "no_show", label: "Nobody at the handover" },
  { value: "other", label: "Something else" },
] as const;
export const incidentLabel = (v: string) =>
  INCIDENT_TYPES.find((t) => t.value === v)?.label ??
  (v === "late_withdrawal" ? "Late withdrawal" : v);

const ACTION_LABEL: Record<string, string> = {
  "assignment.claim": "Volunteer offered to take it",
  "assignment.confirm": "Coordinator confirmed the volunteer",
  "assignment.release": "Assignment released",
  "assignment.offer": "Offer sent",
  "assignment.withdraw": "Volunteer withdrew",
  "assignment.expire": "Hold or offer expired",
  "assignment.reassign": "Volunteer reassigned",
  "leg.start": "Trip started",
  "leg.pickup": "Pickup confirmed",
  "leg.delivery": "Delivery confirmed",
  "receipt.confirm": "Arrival confirmed",
  "request.complete": "Lift completed",
  "request.cancel": "Lift cancelled",
  "request.publish": "Lift published",
  "incident.report": "Problem reported",
  "incident.resolve": "Problem resolved",
  "organisation.settings": "Organisation settings changed",
  "admin.private_access": "Platform admin viewed private details",
};
export const auditLabel = (a: string) => ACTION_LABEL[a] ?? a;

export const windowLabel = (start: string, end: string) => `${formatMelbourne(start)} to ${formatMelbourne(end)}`;

/** Where a coordinator row belongs on the dashboard. */
export type Bucket = "needs_driver" | "awaiting" | "confirmed" | "in_progress" | "to_complete" | "completed";
export function bucketOf(r: OrgRow): Bucket {
  if (r.request_status === "completed") return "completed";
  if (r.request_status === "delivered") return "to_complete";
  if (r.leg_status === "en_route" || r.leg_status === "collected") return "in_progress";
  if (r.leg_status === "confirmed") return "confirmed";
  if (r.leg_status === "reserved" || r.leg_status === "offered") return "awaiting";
  return "needs_driver";
}
