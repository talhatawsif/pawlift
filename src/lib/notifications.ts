export type NotificationRow = {
  id: string;
  type: string;
  request_id: string | null;
  leg_id: string | null;
  read_at: string | null;
  created_at: string;
  reference: string | null;
  animal_name: string | null;
  assignment_id: string | null;
  org_id: string | null;
};

const TEXT: Record<string, string> = {
  assignment_claimed: "offered to take",
  assignment_confirmed: "Confirmed: you're taking",
  assignment_released: "Released:",
  assignment_expired: "Hold or offer expired for",
  assignment_withdrawn: "A volunteer withdrew from",
  offer_received: "You've been offered",
  offer_declined: "Offer declined for",
  offer_withdrawn: "Offer withdrawn for",
  reassigned: "You've been reassigned away from",
  cancelled: "Cancelled:",
  incident: "Problem reported for",
  leg_started: "Trip started for",
  leg_collected: "Collected:",
  leg_delivered: "Delivered:",
  reminder_24h: "Tomorrow's pickup:",
  reminder_2h: "Pickup window opens within 2 hours:",
};

/** Plain-language line and link for a notification. Unknown types still render. */
export function describeNotification(n: NotificationRow): { text: string; href: string } {
  const name = n.animal_name ?? "a request";
  const ref = n.reference ? ` (${n.reference})` : "";
  const prefix = TEXT[n.type];
  let text: string;
  if (!prefix) text = `Update for ${name}${ref}`;
  else if (n.type === "assignment_claimed") text = `A volunteer ${prefix} ${name}${ref}`;
  else text = `${prefix} ${name}${ref}`;
  const href = n.org_id ? `/org/${n.org_id}/dashboard` : n.assignment_id ? `/assignments/${n.assignment_id}` : "/assignments";
  return { text, href };
}
