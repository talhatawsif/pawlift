"use client";

import { useEffect, useRef, useState } from "react";
import { MapPin, X } from "lucide-react";
import { searchSuburbs, type SuburbOption } from "@/app/suburbs/actions";

export type ChosenLocation =
  | { kind: "device"; lat: number; lng: number }
  | { kind: "suburb"; name: string; postcode: string; lat: number; lng: number };

type Props = {
  onChoose: (loc: ChosenLocation) => void;
  onClose: () => void;
};

/** Explains why location is wanted before asking, and offers a manual suburb fallback. */
export function LocationExplainer({ onChoose, onClose }: Props) {
  const [mode, setMode] = useState<"explain" | "asking" | "suburb">("explain");
  const [notice, setNotice] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<SuburbOption[]>([]);
  const [fetchedFor, setFetchedFor] = useState<string | null>(null);
  const loading = fetchedFor !== query;
  const [error, setError] = useState<string | null>(null);
  const firstRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    (mode === "suburb" ? inputRef.current : firstRef.current)?.focus();
  }, [mode]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    if (mode !== "suburb") return;
    let cancelled = false;
    const t = setTimeout(async () => {
      const res = await searchSuburbs(query);
      if (cancelled) return;
      setItems(res.items);
      setError(res.error ?? null);
      setFetchedFor(query);
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [mode, query]);

  function useDevice() {
    if (!("geolocation" in navigator)) {
      setNotice("Your device didn't share a location. Choose a suburb instead.");
      setMode("suburb");
      return;
    }
    setMode("asking");
    // One reading only; PawLift never tracks position continuously.
    navigator.geolocation.getCurrentPosition(
      (pos) => onChoose({ kind: "device", lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => {
        setNotice("We couldn't get your location. You can still browse by choosing a suburb.");
        setMode("suburb");
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 },
    );
  }

  return (
    <div className="absolute inset-0 z-30 flex items-end justify-center bg-foreground/30 p-4 sm:items-center">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="loc-title"
        className="w-full max-w-md rounded-2xl border border-border bg-surface p-4 shadow-md"
      >
        <div className="flex items-start justify-between gap-2">
          <h2 id="loc-title" className="text-lg font-semibold">
            {mode === "suburb" ? "Choose your suburb" : "Show animals near you"}
          </h2>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg p-1 text-muted hover:bg-background">
            <X size={20} aria-hidden />
          </button>
        </div>

        {mode !== "suburb" ? (
          <>
            <p className="mt-2 text-sm text-muted">
              We use your location once, to sort animals by how close they are. It isn&apos;t stored and we
              don&apos;t track you. Without it, the list shows Western Melbourne.
            </p>
            <button
              ref={firstRef}
              type="button"
              onClick={useDevice}
              disabled={mode === "asking"}
              className="mt-4 h-12 w-full rounded-xl bg-brand text-base font-semibold text-brand-foreground disabled:opacity-60"
            >
              {mode === "asking" ? "Waiting for your device…" : "Use my location"}
            </button>
            <button
              type="button"
              onClick={() => setMode("suburb")}
              className="mt-2 h-12 w-full rounded-xl border border-border bg-surface text-base font-medium"
            >
              Choose a suburb instead
            </button>
          </>
        ) : (
          <>
            {notice && <p role="status" className="mt-2 text-sm text-muted">{notice}</p>}
            <label htmlFor="suburb-q" className="sr-only">Suburb or postcode</label>
            <div className="relative mt-3">
              <MapPin size={18} aria-hidden className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
              <input
                id="suburb-q"
                ref={inputRef}
                type="text"
                inputMode="search"
                autoComplete="off"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Suburb or postcode"
                className="h-12 w-full rounded-xl border border-border bg-background pl-10 pr-3 text-base"
              />
            </div>
            <div aria-live="polite" className="mt-2 max-h-60 overflow-y-auto">
              {error ? (
                <p role="alert" className="py-2 text-sm text-danger">{error}</p>
              ) : loading && items.length === 0 ? (
                <div className="space-y-2 py-1" aria-hidden>
                  {[0, 1, 2].map((i) => <div key={i} className="h-10 animate-pulse rounded-lg bg-background" />)}
                </div>
              ) : items.length === 0 ? (
                <p className="py-2 text-sm text-muted">No suburbs match. Try another name or postcode.</p>
              ) : (
                <ul>
                  {items.map((s) => (
                    <li key={s.id}>
                      <button
                        type="button"
                        onClick={() => onChoose({ kind: "suburb", name: s.name, postcode: s.postcode, lat: s.lat, lng: s.lng })}
                        className="flex h-11 w-full items-center justify-between rounded-lg px-2 text-left hover:bg-background"
                      >
                        <span>{s.name}</span>
                        <span className="text-sm text-muted">{s.postcode}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
