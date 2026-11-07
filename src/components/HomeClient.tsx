"use client";

import { useMemo, useState, useTransition, type ReactNode } from "react";
import { BottomSheet, type Snap } from "@/components/BottomSheet";
import { LocationExplainer, type ChosenLocation } from "@/components/LocationExplainer";
import { SearchCard, type JourneyForm } from "@/components/SearchCard";
import { RouteMatches } from "@/components/RouteMatches";
import { findRouteMatches, type JourneyResult } from "@/app/journey/actions";
import { MapView } from "@/components/map/MapView";
import { sortByProximity } from "@/lib/geo/distance";
import type { PublicRequest } from "@/lib/requests";
import type { NearbyRequest } from "@/components/RequestCard";

const URGENCY_ORDER: Record<string, number> = { urgent: 0, soon: 1, routine: 2 };

type Props = { requests: PublicRequest[]; error: boolean; account: ReactNode };

export function HomeClient({ requests, error, account }: Props) {
  const [loc, setLoc] = useState<ChosenLocation | null>(null);
  const [explainer, setExplainer] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [snap, setSnap] = useState<Snap>("peek");
  const [form, setForm] = useState<JourneyForm>({ destination: null, departLocal: "", maxDetourMin: 15 });
  const [result, setResult] = useState<JourneyResult | null>(null);
  const [searched, setSearched] = useState<{ origin: { lat: number; lng: number }; destination: { lat: number; lng: number } } | null>(null);
  const [pending, startSearch] = useTransition();

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
      <MapView
        pins={pins}
        selectedId={selectedId}
        focus={loc}
        onSelect={(id) => {
          setSelectedId(id);
          setSnap((s) => (s === "peek" ? "half" : s));
        }}
      />
      <SearchCard
        account={account}
        originLabel={originLabel}
        originKnown={loc != null}
        onEditOrigin={() => setExplainer(true)}
        form={form}
        onChange={setForm}
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
      {explainer && (
        <LocationExplainer
          onClose={() => setExplainer(false)}
          onChoose={(l) => {
            setLoc(l);
            setExplainer(false);
          }}
        />
      )}
    </>
  );
}
