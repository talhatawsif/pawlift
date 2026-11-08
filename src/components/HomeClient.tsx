"use client";

import { useMemo, useState, useTransition, type ReactNode } from "react";
import { AddLift } from "@/components/AddLift";
import { BottomSheet, HEIGHT, type Snap } from "@/components/BottomSheet";
import { LocationExplainer, type ChosenLocation } from "@/components/LocationExplainer";
import { SearchCard, type JourneyForm } from "@/components/SearchCard";
import { RouteMatches } from "@/components/RouteMatches";
import { findRouteMatches, type JourneyResult } from "@/app/journey/actions";
import { MapView } from "@/components/map/MapView";
import { sortByProximity } from "@/lib/geo/distance";
import type { PublicRequest } from "@/lib/requests";
import type { NearbyRequest } from "@/components/RequestCard";

const URGENCY_ORDER: Record<string, number> = { urgent: 0, soon: 1, routine: 2 };

type Props = { requests: PublicRequest[]; error: boolean; account: ReactNode; coordOrgs: { id: string; name: string }[] };

export function HomeClient({ requests, error, account, coordOrgs }: Props) {
  const [loc, setLoc] = useState<ChosenLocation | null>(null);
  const [explainer, setExplainer] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [snap, setSnap] = useState<Snap>("peek");
  const [form, setForm] = useState<JourneyForm>({ destination: null, departLocal: "", maxDetourMin: 15 });
  const [result, setResult] = useState<JourneyResult | null>(null);
  const [searched, setSearched] = useState<{ origin: { lat: number; lng: number }; destination: { lat: number; lng: number } } | null>(null);
  const [pending, startSearch] = useTransition();

  // Any search input changing makes the shown matches stale.
  const clearResult = () => {
    setResult(null);
    setSearched(null);
  };

  const runSearch = () => {
    if (!loc || !form.destination) return;
    const origin = { lat: loc.lat, lng: loc.lng };
    const destination = { lat: form.destination.lat, lng: form.destination.lng };
    startSearch(async () => {
      const res = await findRouteMatches({ origin, destination, departLocal: form.departLocal, maxDetourMin: form.maxDetourMin });
      setResult(res);
      setSearched({ origin, destination });
      setSnap((s) => (s === "peek" ? "half" : s));
    });
  };

  const ordered: NearbyRequest[] = useMemo(() => {
    if (loc) return sortByProximity(requests, loc);
    return [...requests]
      .sort(
        (a, b) =>
          (URGENCY_ORDER[a.urgency] ?? 3) - (URGENCY_ORDER[b.urgency] ?? 3) ||
          (a.window_start ?? "").localeCompare(b.window_start ?? ""),
      )
      .map((r) => ({ ...r, distanceKm: null }));
  }, [requests, loc]);

  const pins = useMemo(
    () =>
      ordered
        .filter((r) => r.origin_lat != null && r.origin_lng != null)
        .map((r) => ({
          id: r.id,
          lat: r.origin_lat as number,
          lng: r.origin_lng as number,
          label: `${r.animal_name}, ${r.origin_suburb}`,
          urgent: r.urgency === "urgent",
        })),
    [ordered],
  );

  const originLabel = !loc ? "Choose a location" : loc.kind === "device" ? "Current location" : `${loc.name} ${loc.postcode}`;

  return (
    <>
      <SearchCard
        account={account}
        originLabel={originLabel}
        originKnown={loc != null}
        onEditOrigin={() => setExplainer(true)}
        form={form}
        onChange={(f) => {
          setForm(f);
          clearResult();
        }}
        onSubmit={runSearch}
        pending={pending}
      />
      <BottomSheet
        requests={ordered}
        loading={false}
        error={error}
        locationKnown={loc != null}
        selectedId={selectedId}
        snap={snap}
        onSnap={setSnap}
        top={
          <RouteMatches
            result={result}
            origin={searched?.origin ?? null}
            destination={searched?.destination ?? null}
            onSelect={(id) => {
              setSelectedId(id);
              setSnap((s) => (s === "peek" ? "half" : s));
            }}
          />
        }
        onSelect={(id) => {
          setSelectedId(id);
          if (id) setSnap((s) => (s === "peek" ? "half" : s));
        }}
      />
      {/* Sits just above the sheet; hidden when the full sheet would cover it. */}
      {coordOrgs.length > 0 && snap !== "full" && <AddLift orgs={coordOrgs} bottom={`calc(${HEIGHT[snap]} + 1rem)`} />}
      {/* The map comes after the search card and list in the DOM so keyboard focus reaches them first;
          both float above it with z-index, so the order does not change the layout. */}
      <MapView
        pins={pins}
        selectedId={selectedId}
        focus={loc}
        onSelect={(id) => {
          setSelectedId(id);
          setSnap((s) => (s === "peek" ? "half" : s));
        }}
      />
      {explainer && (
        <LocationExplainer
          onClose={() => setExplainer(false)}
          onChoose={(l) => {
            setLoc(l);
            clearResult();
            setExplainer(false);
          }}
        />
      )}
    </>
  );
}
