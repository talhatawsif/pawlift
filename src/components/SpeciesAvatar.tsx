/** Warm tile with a filled silhouette, shown wherever a lift has no photo. Decorative. */
const SHAPES = {
  cat: "M5.5 3.5 9 6.2a8 8 0 0 1 6 0l3.500-2.700c.600-.400 1.300 0 1.300.700V11c0 .700.200 1.400.500 2 .700 1.200 1.200 2.600 1.200 4.200 0 2.400-2.400 3.800-5.200 3.800h-9c-2.800 0-5.200-1.400-5.200-3.800 0-1.600.5-3 1.200-4.200.300-.600.500-1.300.500-2V4.200c0-.700.700-1.100 1.200-.700Z",
  dog: "M5 8.500c0-1.700 1.300-3 3-3l1.500 1.500h5L16 5.500c1.700 0 3 1.300 3 3v2.200c0 1.200-.5 2.200-1.300 3V16c0 2.200-2.500 4-5.700 4s-5.700-1.800-5.700-4v-2.300C5.500 12.900 5 11.900 5 10.700V8.500Z",
  other: "M8 9.500a1.800 2.300 0 1 0 0-.1ZM16 9.500a1.800 2.300 0 1 0 0-.1ZM4.800 13.500a1.600 2.100 0 1 0 0-.1ZM19.200 13.500a1.600 2.100 0 1 0 0-.1ZM12 12c-2.700 0-5 2.800-5 4.800 0 1.500 1.200 2.200 2.600 2.200 1 0 1.600-.4 2.400-.4s1.400.4 2.400.4c1.400 0 2.600-.7 2.600-2.200C17 14.800 14.700 12 12 12Z",
};

export function SpeciesAvatar({ species, className = "size-[72px]" }: { species: string; className?: string }) {
  const d = species === "cat" ? SHAPES.cat : species === "dog" ? SHAPES.dog : SHAPES.other;
  return (
    <span aria-hidden className={`flex shrink-0 items-center justify-center rounded-2xl bg-[var(--tile)] ${className}`}>
      <svg viewBox="0 0 24 24" className="size-3/5" fill="var(--tile-ink)"><path d={d} /></svg>
    </span>
  );
}
