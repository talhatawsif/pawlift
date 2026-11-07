import type { ReactNode } from "react";
import { MapPin, Navigation } from "lucide-react";

/** Static placeholder for the floating journey search card (wired up in Batch 3). */
export function SearchCard({ account }: { account?: ReactNode }) {
  return (
    <div className="absolute left-4 right-4 top-4 z-10 mx-auto max-w-md rounded-2xl border border-border bg-surface p-3 shadow-md">
      <div className="mb-2 flex items-center justify-between gap-2 text-sm text-muted">
        <div className="flex items-center gap-2">
          <Navigation size={16} aria-hidden />
          <span className="rounded-full border border-border px-3 py-1">
            From: Current location
          </span>
        </div>
        {account}
      </div>
      <form aria-label="Find opportunities along your route">
        <label htmlFor="destination" className="sr-only">
          Where are you heading?
        </label>
        <div className="relative">
          <MapPin
            size={18}
            aria-hidden
            className="absolute left-3 top-1/2 -translate-y-1/2 text-muted"
          />
          <input
            id="destination"
            type="text"
            placeholder="Where are you heading?"
            disabled
            className="h-12 w-full rounded-xl border border-border bg-background pl-10 pr-3 text-base"
          />
        </div>
        <button
          type="button"
          disabled
          className="mt-3 h-12 w-full rounded-xl bg-brand text-base font-semibold text-brand-foreground disabled:opacity-60"
        >
          Find opportunities along my route
        </button>
      </form>
    </div>
  );
}
