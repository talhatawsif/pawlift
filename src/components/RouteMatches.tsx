"use client";

import Link from "next/link";
import { ArrowRight, Clock, ExternalLink } from "lucide-react";
import type { JourneyResult, MatchView } from "@/app/journey/actions";
import { SpeciesIcon } from "@/components/RequestCard";
import { formatMelbourne } from "@/lib/org";
import { navLink } from "@/lib/nav-links";
import { ROUTE_SOURCE_LABEL } from "@/lib/routing/types";
import { speciesLabel, urgencyLabel } from "@/lib/requests";

type Props = {
  result: JourneyResult | null;
  origin: { lat: number; lng: number } | null;
  destination: { lat: number; lng: number } | null;
  onSelect: (id: string) => void;
};

export function SourceLabel({ source }: { source: "ors" | "demo" }) {
  return (
    <span className={`text-xs ${source === "demo" ? "font-semibold text-urgent" : "text-muted"}`}>
      {ROUTE_SOURCE_LABEL[source]}
    </span>
  );
}

/** "On your route" section: feasible matches with detour, handling time and an honest source label. */
export function RouteMatches({ result, origin, destination, onSelect }: Props) {
  if (!result) return null;
  if (result.status === "invalid") {
    return <p role="alert" className="mb-3 rounded-xl border border-danger p-3 text-sm">{result.message}</p>;
  }
  if (result.status === "unavailable") {
    return (
      <div role="status" className="mb-3 rounded-xl border border-border p-3 text-sm">
        <p className="font-medium">{result.message}</p>
        <p className="text-muted">Animals near you are listed below.</p>
      </div>
    );
  }
  return (
    <section aria-label="On your route" className="mb-4">
      <h3 className="text-base font-semibold">
        {result.matches.length === 0 ? "Nothing fits your route right now" : `On your route (${result.matches.length})`}
      </h3>
      <p className="text-xs text-muted">
        Your trip takes about {result.baselineMin} min without a stop. <SourceLabel source={result.source} />
      </p>
      {result.filteredByYou && <p className="text-xs text-muted">Matched to your species and carrier settings.</p>}
      {result.couldntCheck > 0 && (
        <p role="status" className="mt-1 text-xs text-muted">
          {result.couldntCheck} possible {result.couldntCheck === 1 ? "match" : "matches"} couldn&apos;t be checked right now.
        </p>
      )}
      {result.matches.length === 0 ? (
        <p className="mt-2 text-sm text-muted">Try a longer maximum detour or a different time. Animals near you are listed below.</p>
      ) : (
        <ul className="mt-2 flex flex-col gap-3">
          {result.matches.map((m) => (
            <MatchCard key={m.id} m={m} origin={origin} destination={destination} onSelect={() => onSelect(m.id)} />
          ))}
        </ul>
      )}
    </section>
  );
}

function MatchCard({ m, origin, destination, onSelect }: { m: MatchView; origin: Props["origin"]; destination: Props["destination"]; onSelect: () => void }) {
  const links = origin && destination ? (["google", "apple", "waze"] as const) : [];
  return (
    <li className="rounded-xl border border-border bg-surface p-3">
      <button type="button" onClick={onSelect} className="flex w-full gap-3 text-left">
        <span className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-background text-muted">
          <SpeciesIcon species={m.species} />
        </span>
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="font-medium">
            {m.animalName} <span className="text-sm font-normal text-muted">· {speciesLabel(m.species)}</span>
            {m.isDemo && <span className="ml-2 rounded bg-urgent/10 px-1.5 text-xs font-semibold text-urgent">DEMO</span>}
          </span>
          <span className="flex items-center gap-1 text-sm text-muted">{m.originSuburb} <ArrowRight size={14} aria-hidden /> {m.destinationSuburb}</span>
          <span className="text-sm font-medium">
            +{m.detourMin} min driving · about {m.handlingMin} min for pickup and handover
          </span>
          <span className="flex items-center gap-1 text-xs text-muted">
            <Clock size={12} aria-hidden />Pickup about {formatMelbourne(m.pickupAt)}
            {m.waitMin > 0 && ` (you may wait ${m.waitMin} min)`} · {urgencyLabel(m.urgency)}
          </span>
          <SourceLabel source={m.source} />
        </span>
      </button>
      <Link href={`/requests/${m.id}`} className="mt-2 flex h-11 items-center justify-center rounded-xl bg-brand text-sm font-semibold text-brand-foreground">
        View details and take this
      </Link>
      {links.length > 0 && origin && destination && (
        <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
          <span className="text-muted">Preview the trip (approximate stops):</span>
          {links.map((app) => (
            <a
              key={app}
              href={navLink(app, origin, app === "waze" ? [m.pickup] : [m.pickup, m.dropoff], destination)}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 font-medium text-brand underline"
            >
              {app === "google" ? "Google Maps" : app === "apple" ? "Apple Maps" : "Waze (pickup only)"}
              <ExternalLink size={12} aria-hidden />
            </a>
          ))}
        </p>
      )}
    </li>
  );
}
