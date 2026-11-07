import type { ReactNode } from "react";
import { MapPin, Navigation } from "lucide-react";

type Props = { account?: ReactNode; originLabel: string; onEditOrigin: () => void };

/** Floating journey search card. Route search arrives in 3b/3c, so it stays disabled and says so. */
export function SearchCard({ account, originLabel, onEditOrigin }: Props) {
  return (
    <div className="absolute left-4 right-4 top-4 z-20 mx-auto max-w-md rounded-2xl border border-border bg-surface p-3 shadow-md">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-sm text-muted">
        <button
          type="button"
          onClick={onEditOrigin}
          className="flex max-w-full min-w-0 items-center gap-2 rounded-full border border-border px-3 py-1 hover:bg-background"
        >
          <Navigation size={16} aria-hidden className="shrink-0" />
          <span className="truncate whitespace-nowrap">From: {originLabel}</span>
        </button>
        {account}
      </div>
      <form aria-label="Find opportunities along your route" aria-describedby="route-soon">
        <label htmlFor="destination" className="sr-only">Where are you heading?</label>
        <div className="relative">
          <MapPin size={18} aria-hidden className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
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
        <p id="route-soon" className="mt-2 text-xs text-muted">
          Route matching isn&apos;t available yet. You can browse animals below.
        </p>
      </form>
    </div>
  );
}
