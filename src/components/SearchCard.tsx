"use client";

import { useEffect, useState, type ReactNode } from "react";
import { MapPin, Navigation } from "lucide-react";
import { searchSuburbs, type SuburbOption } from "@/app/suburbs/actions";

export type JourneyForm = { destination: SuburbOption | null; departLocal: string; maxDetourMin: number };

type Props = {
  account?: ReactNode;
  originLabel: string;
  originKnown: boolean;
  onEditOrigin: () => void;
  form: JourneyForm;
  onChange: (f: JourneyForm) => void;
  onSubmit: () => void;
  pending: boolean;
};

const DETOURS = [5, 10, 15, 20, 30, 45, 60];

/** Floating journey search card: where from (chip), where to (suburb), when, and how much detour is OK. */
export function SearchCard({ account, originLabel, originKnown, onEditOrigin, form, onChange, onSubmit, pending }: Props) {
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<SuburbOption[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open || query.trim().length < 2) return;
    let live = true;
    const t = setTimeout(async () => {
      const res = await searchSuburbs(query.trim());
      if (live) setItems(res.items);
    }, 200);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [query, open]);

  const shown = query.trim().length < 2 ? [] : items;
  const ready = originKnown && form.destination != null;

  return (
    <div className="absolute left-4 right-4 top-4 z-20 mx-auto max-w-md rounded-2xl border border-border bg-surface p-3 shadow-md">
      <div className="mb-2 flex items-center justify-between gap-2 text-sm text-muted">
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
      <form
        aria-label="Find opportunities along your route"
        onSubmit={(e) => {
          e.preventDefault();
          if (ready && !pending) onSubmit();
        }}
      >
        <label htmlFor="destination" className="sr-only">Where are you heading? Type a suburb</label>
        <div className="relative">
          <MapPin size={18} aria-hidden className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <input
            id="destination"
            type="text"
            autoComplete="off"
            role="combobox"
            aria-expanded={open && shown.length > 0}
            aria-controls="destination-list"
            placeholder="Where are you heading? (suburb)"
            value={open || !form.destination ? query : `${form.destination.name} ${form.destination.postcode}`}
            onFocus={() => { setOpen(true); setQuery(""); }}
            onChange={(e) => { setQuery(e.target.value); setOpen(true); onChange({ ...form, destination: null }); }}
            className="h-12 w-full rounded-xl border border-border bg-background pl-10 pr-3 text-base"
          />
          {open && shown.length > 0 && (
            <ul id="destination-list" role="listbox" className="absolute inset-x-0 top-full z-30 mt-1 max-h-56 overflow-y-auto rounded-xl border border-border bg-surface shadow-md">
              {shown.map((s) => (
                <li key={s.id} role="option" aria-selected={form.destination?.id === s.id}>
                  <button
                    type="button"
                    className="w-full px-3 py-2 text-left text-sm hover:bg-background"
                    onClick={() => { onChange({ ...form, destination: s }); setOpen(false); setQuery(""); }}
                  >
                    {s.name} <span className="text-muted">{s.postcode}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-muted">
          <label className="flex flex-col gap-1">
            Leaving (Melbourne time; blank = now)
            <input
              type="datetime-local"
              value={form.departLocal}
              onChange={(e) => onChange({ ...form, departLocal: e.target.value })}
              className="h-10 rounded-lg border border-border bg-background px-2 text-sm text-foreground"
            />
          </label>
          <label className="flex flex-col gap-1">
            Most extra driving
            <select
              value={form.maxDetourMin}
              onChange={(e) => onChange({ ...form, maxDetourMin: Number(e.target.value) })}
              className="h-10 rounded-lg border border-border bg-background px-2 text-sm text-foreground"
            >
              {DETOURS.map((d) => <option key={d} value={d}>{d} min</option>)}
            </select>
          </label>
        </div>
        <button
          type="submit"
          disabled={!ready || pending}
          className="mt-3 h-12 w-full rounded-xl bg-brand text-base font-semibold text-brand-foreground disabled:opacity-60"
        >
          {pending ? "Checking routes…" : "Find opportunities along my route"}
        </button>
        {!ready && (
          <p className="mt-2 text-xs text-muted">
            {originKnown ? "Choose a destination suburb to check your route." : "Choose where you're starting from first."}
          </p>
        )}
      </form>
    </div>
  );
}
