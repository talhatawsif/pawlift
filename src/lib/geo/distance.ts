export type LngLat = { lat: number; lng: number };

/** Straight-line (great-circle) distance in km. Not a travel distance or time. */
export function haversineKm(a: LngLat, b: LngLat): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

/** "about 6 km away" style label; rounds to whole km, "under 1 km" below that. */
export function distanceLabel(km: number): string {
  return km < 1 ? "under 1 km away" : `about ${Math.round(km)} km away`;
}

/** Sorts nearest first by origin point; items without a point go last. Stable for ties. */
export function sortByProximity<T extends { origin_lat: number | null; origin_lng: number | null }>(
  items: T[],
  from: LngLat,
): (T & { distanceKm: number | null })[] {
  return items
    .map((i) => ({
      ...i,
      distanceKm:
        i.origin_lat == null || i.origin_lng == null
          ? null
          : haversineKm(from, { lat: i.origin_lat, lng: i.origin_lng }),
    }))
    .sort((a, b) => (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity));
}
