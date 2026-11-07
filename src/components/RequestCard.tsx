import { Box, Cat, Dog, HandHelping, PawPrint } from "lucide-react";
import { distanceLabel } from "@/lib/geo/distance";
import { formatMelbourne } from "@/lib/org";
import { publicPhotoUrl, speciesLabel, urgencyLabel, type PublicRequest } from "@/lib/requests";

export type NearbyRequest = PublicRequest & { distanceKm: number | null };

export function SpeciesIcon({ species, size = 24 }: { species: string; size?: number }) {
  const Icon = species === "cat" ? Cat : species === "dog" ? Dog : PawPrint;
  return <Icon size={size} aria-hidden />;
}

export function Photo({ r }: { r: PublicRequest }) {
  return r.photo_path ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={publicPhotoUrl(r.photo_path)} alt="" className="size-14 shrink-0 rounded-xl object-cover" />
  ) : (
    <span className="flex size-14 shrink-0 items-center justify-center rounded-xl bg-background text-muted">
      <SpeciesIcon species={r.species} />
    </span>
  );
}

export function Chips({ r }: { r: PublicRequest }) {
  return (
    <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
      <span className={`rounded-full px-2 py-0.5 font-semibold ${r.urgency === "urgent" ? "bg-urgent/10 text-urgent-strong" : "bg-background text-muted"}`}>
        {urgencyLabel(r.urgency)}
      </span>
      {r.carrier_requirements && (
        <span className="flex items-center gap-1 text-muted"><Box size={14} aria-hidden />Carrier needed</span>
      )}
      {r.handling_requirements && (
        <span className="flex items-center gap-1 text-muted"><HandHelping size={14} aria-hidden />Special handling</span>
      )}
      {r.is_demo && <span className="rounded bg-urgent/10 px-1.5 font-semibold text-urgent-strong">DEMO</span>}
    </span>
  );
}

export function RequestCard({ r, selected, onSelect }: { r: NearbyRequest; selected: boolean; onSelect: () => void }) {
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        aria-pressed={selected}
        className={`flex w-full gap-3 rounded-xl border p-3 text-left ${selected ? "border-brand bg-brand/5" : "border-border bg-surface"}`}
      >
        <Photo r={r} />
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="font-medium">
            {r.animal_name} <span className="text-sm font-normal text-muted">· {speciesLabel(r.species)}</span>
          </span>
          <span className="text-sm text-muted">{r.origin_suburb} → {r.destination_suburb}</span>
          <span className="text-sm text-muted">
            {r.distanceKm != null ? distanceLabel(r.distanceKm) : r.window_start ? `Pickup from ${formatMelbourne(r.window_start)}` : "Date to be arranged"}
          </span>
          <Chips r={r} />
        </span>
      </button>
    </li>
  );
}
