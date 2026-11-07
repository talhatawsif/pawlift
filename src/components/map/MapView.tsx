"use client";

import { useEffect, useRef, useState } from "react";
import { Map as MapLibreMap, Marker, NavigationControl, setWorkerUrl } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import {
  OPENFREEMAP_STYLE_URL,
  WESTERN_MELBOURNE_CENTRE,
  WESTERN_MELBOURNE_ZOOM,
} from "@/lib/geo/constants";

export type MapPin = { id: string; lat: number; lng: number; label: string; urgent: boolean };

type Props = {
  pins: MapPin[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  /** Chosen location (device or suburb), shown as a dot and flown to. */
  focus: { lat: number; lng: number } | null;
};

// Static copy of the lucide "paw-print" icon (rendering the React component at import time breaks SSR).
const PAW =
  '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="4" r="2"/><circle cx="18" cy="8" r="2"/><circle cx="20" cy="16" r="2"/><path d="M9 10a5 5 0 0 1 5 5v3.5a3.5 3.5 0 0 1-6.84 1.045Q6.52 17.48 4.46 16.84A3.5 3.5 0 0 1 5.5 10Z"/></svg>';

export function MapView({ pins, selectedId, onSelect, focus }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markers = useRef<Map<string, { marker: Marker; el: HTMLButtonElement }>>(new Map());
  const youRef = useRef<Marker | null>(null);
  const onSelectRef = useRef(onSelect);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);

  useEffect(() => {
    if (!container.current) return;
    setWorkerUrl("/maplibre/maplibre-gl-worker.mjs");
    const map = new MapLibreMap({
      container: container.current,
      style: OPENFREEMAP_STYLE_URL,
      center: WESTERN_MELBOURNE_CENTRE,
      zoom: WESTERN_MELBOURNE_ZOOM,
      attributionControl: { compact: true },
    });
    map.addControl(new NavigationControl({ showCompass: false }), "top-right");
    map.on("error", () => setFailed(true));
    mapRef.current = map;
    const current = markers.current;
    setReady(true);
    return () => {
      current.clear();
      youRef.current = null;
      mapRef.current = null;
      map.remove();
    };
  }, []);

  // Sync pins.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const current = markers.current;
    const keep = new Set(pins.map((p) => p.id));
    for (const [id, m] of current) {
      if (!keep.has(id)) {
        m.marker.remove();
        current.delete(id);
      }
    }
    for (const p of pins) {
      if (current.has(p.id)) continue;
      const el = document.createElement("button");
      el.type = "button";
      el.setAttribute("aria-label", `${p.label}, pickup pin`);
      el.innerHTML = PAW;
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        onSelectRef.current(p.id);
      });
      const marker = new Marker({ element: el }).setLngLat([p.lng, p.lat]).addTo(map);
      current.set(p.id, { marker, el });
    }
    for (const p of pins) {
      const m = current.get(p.id);
      if (!m) continue;
      const sel = p.id === selectedId;
      const size = sel ? 44 : 34;
      m.el.style.cssText = `width:${size}px;height:${size}px;border-radius:9999px;border:2px solid #fff;background:${p.urgent ? "#b45309" : "#2f7d55"};display:flex;align-items:center;justify-content:center;cursor:pointer;padding:0;z-index:${sel ? 2 : 1};`;
    }
  }, [pins, selectedId, ready]);

  // Fly to selected pin.
  useEffect(() => {
    const map = mapRef.current;
    const p = pins.find((x) => x.id === selectedId);
    if (map && p) map.flyTo({ center: [p.lng, p.lat], zoom: Math.max(map.getZoom(), 11), duration: 600 });
  }, [selectedId, pins]);

  // Show and fly to the chosen location.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    youRef.current?.remove();
    youRef.current = null;
    if (!focus) return;
    const el = document.createElement("div");
    el.setAttribute("role", "img");
    el.setAttribute("aria-label", "Your chosen location");
    el.style.cssText = "width:16px;height:16px;border-radius:9999px;background:#1f2421;border:3px solid #fff;";
    youRef.current = new Marker({ element: el }).setLngLat([focus.lng, focus.lat]).addTo(map);
    map.flyTo({ center: [focus.lng, focus.lat], zoom: 11.5, duration: 700 });
  }, [focus, ready]);

  return (
    <div className="absolute inset-0">
      <div ref={container} className="h-full w-full" role="application" aria-label="Map of Western Melbourne" />
      {failed && (
        <p
          role="alert"
          className="absolute left-1/2 top-40 -translate-x-1/2 rounded-xl border border-border bg-surface px-4 py-2 text-sm text-danger"
        >
          The map couldn&apos;t load. The list still works. Check your connection and refresh.
        </p>
      )}
    </div>
  );
}
