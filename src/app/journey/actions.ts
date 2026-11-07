"use server";

import { createClient } from "@/lib/supabase/server";
import { matchJourney, type Candidate, type Capabilities } from "@/lib/matching";
import { RouteBudget, ROUTE_FAILURE_MESSAGE, routingMode, type RouteSource } from "@/lib/routing";
import { melbourneLocalToIso } from "@/lib/time/melbourne";
import type { PublicRequest } from "@/lib/requests";

export type JourneyInput = {
  origin: { lat: number; lng: number };
  destination: { lat: number; lng: number };
  /** "YYYY-MM-DDTHH:mm" in Melbourne time; empty means now. */
  departLocal: string;
  maxDetourMin: number;
};

export type MatchView = {
  id: string;
  animalName: string;
  species: string;
  urgency: string;
  isDemo: boolean;
  orgName: string;
  originSuburb: string;
  destinationSuburb: string;
  photoPath: string | null;
  detourMin: number;
  waitMin: number;
  handlingMin: number;
  pickupAt: string;
  arriveDropoff: string;
  pickup: { lat: number; lng: number };
  dropoff: { lat: number; lng: number };
  source: RouteSource;
};

export type JourneyResult =
  | { status: "invalid"; message: string }
  | { status: "unavailable"; message: string; mode: "live" | "demo" }
  | {
      status: "ok";
      source: RouteSource;
      baselineMin: number;
      matches: MatchView[];
      couldntCheck: number;
      considered: number;
      filteredByYou: boolean;
    };

const inMelbourneArea = (p: { lat: number; lng: number }) =>
  Number.isFinite(p.lat) && Number.isFinite(p.lng) && p.lat > -39.5 && p.lat < -36.5 && p.lng > 143 && p.lng < 146.5;

/**
 * Route-matched search. Journey points are used for this request only and are not stored (saved
 * journeys arrive in Batch 6). Reads `public_requests` as the signed-in (or anonymous) user.
 */
export async function findRouteMatches(input: JourneyInput): Promise<JourneyResult> {
  const max = Math.round(Number(input.maxDetourMin));
  if (!inMelbourneArea(input.origin) || !inMelbourneArea(input.destination)) {
    return { status: "invalid", message: "Choose a start and destination in Victoria." };
  }
  if (!(max >= 5 && max <= 60)) return { status: "invalid", message: "Maximum detour must be between 5 and 60 minutes." };
  const departIso = input.departLocal ? melbourneLocalToIso(input.departLocal) : new Date().toISOString();
  if (!departIso) return { status: "invalid", message: "That departure time isn't valid." };
  const departAt = new Date(departIso);

  const supabase = await createClient();
  const [reqs, prof] = await Promise.all([
    supabase.from("public_requests").select("*"),
    supabase.rpc("get_my_volunteer_profile"),
  ]);
  if (reqs.error) return { status: "unavailable", message: "Animals couldn't be loaded. Try again.", mode: routingMode() };

  const p = prof.data as { verification_status?: string; species_ok?: string[]; has_carrier?: boolean } | null;
  const caps: Capabilities =
    p && p.verification_status === "verified" ? { speciesOk: p.species_ok ?? [], hasCarrier: !!p.has_carrier } : null;

  const rows = (reqs.data ?? []) as unknown as PublicRequest[];
  const byId = new Map(rows.map((r) => [r.id, r]));
  const candidates: Candidate[] = [];
  for (const r of rows) {
    if (r.origin_lat == null || r.origin_lng == null || r.destination_lat == null || r.destination_lng == null) continue;
    if (!r.window_start || !r.window_end) continue;
    candidates.push({
      id: r.id,
      species: r.species,
      urgency: r.urgency,
      carrierRequirements: r.carrier_requirements,
      pickup: { lat: r.origin_lat, lng: r.origin_lng },
      dropoff: { lat: r.destination_lat, lng: r.destination_lng },
      windowStart: new Date(r.window_start),
      windowEnd: new Date(r.window_end),
      deadline: r.deadline ? new Date(r.deadline) : null,
    });
  }

  const out = await matchJourney(
    supabase,
    { origin: input.origin, destination: input.destination, departAt, maxDetourMin: max },
    candidates,
    caps,
    new RouteBudget(),
  );
  if (!out.ok) return { status: "unavailable", message: ROUTE_FAILURE_MESSAGE[out.reason], mode: routingMode() };

  const matches: MatchView[] = out.matches.flatMap((m) => {
    const r = byId.get(m.candidate.id);
    if (!r || !m.evaluation.feasible) return [];
    return [
      {
        id: r.id,
        animalName: r.animal_name,
        species: r.species,
        urgency: r.urgency,
        isDemo: r.is_demo,
        orgName: r.org_name,
        originSuburb: r.origin_suburb,
        destinationSuburb: r.destination_suburb,
        photoPath: r.photo_path,
        detourMin: m.evaluation.detourMin,
        waitMin: m.evaluation.waitMin,
        handlingMin: m.evaluation.handlingMin,
        pickupAt: m.evaluation.pickupAt.toISOString(),
        arriveDropoff: m.evaluation.arriveDropoff.toISOString(),
        pickup: m.candidate.pickup,
        dropoff: m.candidate.dropoff,
        source: m.source,
      },
    ];
  });
  return {
    status: "ok",
    source: out.source,
    baselineMin: out.baselineMin,
    matches,
    couldntCheck: out.couldntCheck,
    considered: out.considered,
    filteredByYou: caps != null,
  };
}
