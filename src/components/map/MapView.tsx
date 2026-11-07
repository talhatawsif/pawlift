"use client";

import { useEffect, useRef, useState } from "react";
import { Map as MapLibreMap, NavigationControl, setWorkerUrl } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import {
  OPENFREEMAP_STYLE_URL,
  WESTERN_MELBOURNE_CENTRE,
  WESTERN_MELBOURNE_ZOOM,
} from "@/lib/geo/constants";

export function MapView() {
  const container = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);

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
    return () => map.remove();
  }, []);

  return (
    <div className="absolute inset-0">
      <div
        ref={container}
        className="h-full w-full"
        role="application"
        aria-label="Map of Western Melbourne"
      />
      {failed && (
        <p
          role="alert"
          className="absolute left-1/2 top-24 -translate-x-1/2 rounded-xl border border-border bg-surface px-4 py-2 text-sm text-danger"
        >
          The map couldn&apos;t load. Check your connection and refresh.
        </p>
      )}
    </div>
  );
}
