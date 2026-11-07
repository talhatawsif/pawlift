const TZ = "Australia/Melbourne";

/** Offset (ms) of Melbourne from UTC at the given instant. */
function offsetMs(at: number): number {
  const parts = new Intl.DateTimeFormat("en-AU", {
    timeZone: TZ, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(new Date(at));
  const g = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  return Date.UTC(g("year"), g("month") - 1, g("day"), g("hour"), g("minute"), g("second")) - Math.floor(at / 1000) * 1000;
}

/** "YYYY-MM-DDTHH:mm" entered in Melbourne time → UTC ISO string, or null if invalid. */
export function melbourneLocalToIso(local: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local);
  if (!m) return null;
  const [y, mo, d, h, mi] = m.slice(1).map(Number);
  const asUtc = Date.UTC(y, mo - 1, d, h, mi);
  let guess = asUtc - offsetMs(asUtc);
  guess = asUtc - offsetMs(guess); // settle across a daylight-saving boundary
  const out = new Date(guess);
  return Number.isNaN(out.getTime()) ? null : out.toISOString();
}

/** UTC ISO string → "YYYY-MM-DDTHH:mm" in Melbourne time (for datetime-local inputs). */
export function isoToMelbourneLocal(iso: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit",
  }).formatToParts(new Date(iso));
  const g = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${g("year")}-${g("month")}-${g("day")}T${g("hour")}:${g("minute")}`;
}
