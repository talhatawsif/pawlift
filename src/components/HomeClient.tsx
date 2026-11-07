"use client";

import { useMemo, useState, type ReactNode } from "react";
import { BottomSheet, type Snap } from "@/components/BottomSheet";
import { LocationExplainer, type ChosenLocation } from "@/components/LocationExplainer";
import { SearchCard } from "@/components/SearchCard";
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
      <SearchCard account={account} originLabel={originLabel} onEditOrigin={() => setExplainer(true)} />
      <BottomSheet
        requests={ordered}
        loading={false}
        error={error}
        locationKnown={loc != null}
        selectedId={selectedId}
        snap={snap}
        onSnap={setSnap}
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
