"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { ArrowLeft, ChevronUp } from "lucide-react";
import Link from "next/link";
import { formatMelbourne } from "@/lib/org";
import { distanceLabel } from "@/lib/geo/distance";
import { speciesLabel } from "@/lib/requests";
import { Chips, Photo, RequestCard, type NearbyRequest } from "@/components/RequestCard";

export type Snap = "peek" | "half" | "full";
const ORDER: Snap[] = ["peek", "half", "full"];
export const HEIGHT: Record<Snap, string> = { peek: "5.5rem", half: "50dvh", full: "88dvh" };

type Props = {
  requests: NearbyRequest[];
  loading: boolean;
  error: boolean;
  locationKnown: boolean;
  selectedId: string | null;
  snap: Snap;
  onSnap: (s: Snap) => void;
  onSelect: (id: string | null) => void;
  /** Optional section above the nearby list (route matches). */
  top?: ReactNode;
};

export function BottomSheet({ requests, loading, error, locationKnown, selectedId, snap, onSnap, onSelect, top }: Props) {
  const startY = useRef<number | null>(null);
  const moved = useRef(false);
  const scroller = useRef<HTMLDivElement>(null);
  const selected = requests.find((r) => r.id === selectedId) ?? null;

  useEffect(() => {
    scroller.current?.scrollTo({ top: 0 });
  }, [snap, selectedId]);

  const step = (dir: 1 | -1) => {
    const i = ORDER.indexOf(snap) + dir;
    onSnap(ORDER[Math.min(ORDER.length - 1, Math.max(0, i))]);
  };

  const n = requests.length;
  const title = loading
    ? "Looking for animals…"
    : error
      ? "Animals needing a lift"
      : n === 0
        ? "No animals need a lift right now"
        : `${n} ${n === 1 ? "animal needs" : "animals need"} a lift ${locationKnown ? "nearby" : "in Western Melbourne"}`;

  return (
    <section
      aria-label="Animals needing a lift"
      style={{ height: HEIGHT[snap], transition: "height 150ms ease-out" }}
      className="absolute inset-x-0 bottom-0 z-10 mx-auto flex max-w-md flex-col rounded-t-2xl border border-b-0 border-border bg-surface shadow-md"
    >
      <button
        type="button"
        aria-label={snap === "full" ? "Collapse list" : "Expand list"}
        aria-expanded={snap !== "peek"}
        onPointerDown={(e) => {
          startY.current = e.clientY;
          moved.current = false;
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerUp={(e) => {
          if (startY.current == null) return;
          const dy = e.clientY - startY.current;
          startY.current = null;
          if (Math.abs(dy) > 30) {
            moved.current = true;
            step(dy < 0 ? 1 : -1);
          }
        }}
        onClick={() => {
          if (moved.current) return;
          onSnap(snap === "full" ? "peek" : snap === "peek" ? "half" : "full");
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowUp") { e.preventDefault(); step(1); }
          if (e.key === "ArrowDown") { e.preventDefault(); step(-1); }
        }}
        className="flex w-full touch-none flex-col items-center gap-2 px-4 pb-1 pt-3"
      >
        <span className="h-1 w-10 rounded-full bg-border" aria-hidden />
      </button>

      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto px-4 pb-6">
        {selected ? (
          <Detail r={selected} onBack={() => onSelect(null)} />
        ) : (
          <>
            <h2 className="text-base font-semibold">{title}</h2>
            {!locationKnown && !loading && !error && (
              <p className="text-sm text-muted">Showing Western Melbourne. Choose a location to see what&apos;s closest.</p>
            )}
            {snap === "peek" ? (
              <button type="button" onClick={() => onSnap("half")} className="mt-1 flex items-center gap-1 text-sm font-medium text-brand underline">
                <ChevronUp size={16} aria-hidden />Show list
              </button>
            ) : (
              <div className="mt-3">
                {top}
                {top && <h3 className="mb-2 text-sm font-semibold text-muted">Also nearby</h3>}
                {error ? (
                  <p role="alert" className="rounded-xl border border-border p-3 text-sm text-danger">
                    The list couldn&apos;t load. Refresh the page to try again.
                  </p>
                ) : loading ? (
                  <div className="space-y-3" aria-hidden>
                    {[0, 1, 2].map((i) => <div key={i} className="h-24 animate-pulse rounded-xl bg-background" />)}
                  </div>
                ) : n === 0 ? (
                  <p className="text-sm text-muted">Check back soon. New lifts appear here as soon as they&apos;re published.</p>
                ) : (
                  <ul className="flex flex-col gap-3">
                    {requests.map((r) => (
                      <RequestCard key={r.id} r={r} selected={false} onSelect={() => onSelect(r.id)} />
                    ))}
                  </ul>
                )}
                <Link href="/requests" className="mt-4 inline-block text-sm font-medium text-brand underline">
                  See the full list
                </Link>
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}

function Detail({ r, onBack }: { r: NearbyRequest; onBack: () => void }) {
  return (
    <div>
      <button type="button" onClick={onBack} className="mb-3 flex items-center gap-1 text-sm font-medium text-brand">
        <ArrowLeft size={16} aria-hidden />Back to list
      </button>
      <div className="flex gap-3">
        <Photo r={r} />
        <div>
          <h2 className="text-lg font-semibold">{r.animal_name}</h2>
          <p className="text-sm text-muted">{speciesLabel(r.species)} · {r.org_name}</p>
        </div>
      </div>
      <p className="mt-3 font-medium">{r.origin_suburb} → {r.destination_suburb}</p>
      {r.distanceKm != null && <p className="text-sm text-muted">{distanceLabel(r.distanceKm)} (straight line, not travel time)</p>}
      {r.window_start && <p className="text-sm text-muted">Pickup from {formatMelbourne(r.window_start)}</p>}
      {r.deadline && <p className="text-sm text-muted">Needs to arrive by {formatMelbourne(r.deadline)}</p>}
      <div className="mt-2"><Chips r={r} /></div>
      {r.carrier_requirements && <p className="mt-2 text-sm"><span className="font-medium">Carrier:</span> {r.carrier_requirements}</p>}
      {r.handling_requirements && <p className="mt-1 text-sm"><span className="font-medium">Handling:</span> {r.handling_requirements}</p>}
      <p className="mt-3 text-sm text-muted">Exact addresses are shared only with the confirmed volunteer.</p>
      <Link href={`/requests/${r.id}`} className="mt-3 flex h-12 items-center justify-center rounded-xl bg-brand font-semibold text-brand-foreground">
        View details and take this
      </Link>
    </div>
  );
}
