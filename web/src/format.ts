// Times are stored in UTC and shown in the institution's time zone (GET /api/v1/installation;
// App sets it once before the pages render).
export let TIME_ZONE = "UTC";
export let ZONE_LABEL = "UTC";

const dt = (opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-GB", { timeZone: TIME_ZONE, ...opts });
let fDayTime: Intl.DateTimeFormat, fTime: Intl.DateTimeFormat, fDay: Intl.DateTimeFormat, fFull: Intl.DateTimeFormat, dayKey: Intl.DateTimeFormat;

/** "Asia/Ho_Chi_Minh" → "Ho Chi Minh". */
export function setZone(zone: string) {
  try { new Intl.DateTimeFormat("en-GB", { timeZone: zone }); } catch { zone = "UTC"; }
  TIME_ZONE = zone;
  ZONE_LABEL = zone === "UTC" ? "UTC" : zone.split("/").pop()!.replace(/_/g, " ");
  fDayTime = dt({ day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false });
  fTime = dt({ hour: "2-digit", minute: "2-digit", hour12: false });
  fDay = dt({ day: "numeric", month: "short" });
  fFull = dt({ weekday: "short", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
  dayKey = dt({ year: "numeric", month: "2-digit", day: "2-digit" });
}
setZone("UTC");

// en-GB puts a comma before the time ("9 Oct, 01:30"); the app writes "9 Oct 01:30".
const noComma = (x: string) => x.replace(/, (\d\d:\d\d)$/, " $1");

export const isToday = (iso: string, now = new Date()) => dayKey.format(new Date(iso)) === dayKey.format(now);
/** "14:05" today, otherwise "11 Oct 14:05". */
export const when = (iso: string | null | undefined, now = new Date()) =>
  !iso ? "—" : isToday(iso, now) ? fTime.format(new Date(iso)) : noComma(fDayTime.format(new Date(iso)));
/** When something is due: its time, or a plain "overdue" when the time has passed (the scheduler isn't running). */
export const due = (iso: string | null | undefined, now = new Date()) =>
  !iso ? "—" : new Date(iso) <= now ? "overdue: waiting for the scheduler" : when(iso, now);
export const dayTime = (iso: string) => noComma(fDayTime.format(new Date(iso)));
export const day = (iso: string) => fDay.format(new Date(iso));
export const fullNow = (d: Date) => noComma(fFull.format(d));

export function ago(iso: string | null | undefined, now = new Date()): string {
  if (!iso) return "never";
  const s = Math.round((now.getTime() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400 * 2) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} days ago`;
}

export function until(iso: string, now = new Date()): string {
  const s = Math.max(0, Math.round((new Date(iso).getTime() - now.getTime()) / 1000));
  if (s < 60) return `${s} s`;
  if (s < 3600) return `${Math.ceil(s / 60)} min`;
  return `${Math.floor(s / 3600)} h ${Math.round((s % 3600) / 60)} min`;
}

/** Prices: enough digits for small FX rates, two for large ones. */
export function price(x: number | null | undefined): string {
  if (x === null || x === undefined) return "—";
  const a = Math.abs(x);
  const d = a >= 1000 ? 2 : a >= 10 ? 3 : 4;
  return x.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
}
export const pct = (x: number | null | undefined, d = 2) =>
  x === null || x === undefined ? "—" : `${x > 0 ? "+" : x < 0 ? "−" : ""}${Math.abs(x).toFixed(d)}%`;
// rounded down, so a move just under the threshold (2.998) never reads as the threshold (3.0×)
export const zx = (z: number | null | undefined) => (z === null || z === undefined ? "—" : `${(Math.floor(Math.abs(z) * 10) / 10).toFixed(1)}×`);

/** A place code as a person says it: "LK" is Sri Lanka, "chk:hormuz" the Strait of Hormuz. A code with no name here
 *  reads as words ("sea:java-sea" → "Java Sea"); pages that can, ask the reference data for the exact name. */
const regionNames = (() => { try { return new Intl.DisplayNames(["en"], { type: "region" }); } catch { return null; } })();
const PLACES: Record<string, string> = {
  "chk:hormuz": "Strait of Hormuz", "chk:bab-el-mandeb": "Bab-el-Mandeb Strait", "chk:malacca": "Strait of Malacca",
  "chk:suez": "Suez Canal", "chk:panama": "Panama Canal", "chk:bosporus": "Bosporus", "chk:gibraltar": "Strait of Gibraltar",
  "chk:taiwan": "Taiwan Strait", "chk:cape-of-good-hope": "Cape of Good Hope",
  "IN-TN": "Tamil Nadu", "IN-KL": "Kerala", "IN-MH": "Maharashtra", "IN-KA": "Karnataka", "IN-DL": "Delhi",
};
const titleWords = (s: string) => s.replace(/[-_]+/g, " ").replace(/\b([a-z])/g, (_, c: string) => c.toUpperCase()).replace(/\b(Of|The|And|El)\b/g, w => w.toLowerCase());
export function placeName(code: string): string {
  if (PLACES[code]) return PLACES[code];
  if (/^[A-Z]{2}$/.test(code)) { try { return regionNames?.of(code) ?? code; } catch { return code; } }
  const sub = code.match(/^([A-Z]{2})-([A-Z0-9]+)$/);  // a state or province: "IN-TN" → "India (TN)" unless named above
  if (sub) return `${placeName(sub[1])} (${sub[2]})`;
  return titleWords(code.replace(/^[a-z]+:/, ""));
}
/** Seas, straits and regions before countries: they say more about where something happened. */
export const placeOrder = (codes: string[]) => [...codes].sort((a, b) => Number(/^[A-Z]{2}$/.test(a)) - Number(/^[A-Z]{2}$/.test(b)));

/** What a failed check means for a person, in a sentence (the raw message stays one click away). Mirrors the server's plain_error. */
export function plainError(error: string | null | undefined): string {
  const e = (error ?? "").toLowerCase();
  if (!e) return "It didn't finish.";
  if (/quota|429|rate limit|resource_exhausted/.test(e)) return "The news search is over its limit, so nothing was read this time.";
  if (/couldn't take|refused|unreachable|connect|404|lost the/.test(e)) return "The service that does this didn't answer, so nothing was read this time.";
  if (/timeout|timed out|deadline/.test(e)) return "It took too long and was stopped.";
  return "Something went wrong and nothing was read this time.";
}

/** "1 alert", "2 alerts": a count that reads right, never "alert(s)". */
export const plural = (n: number, one: string, many?: string) => `${n} ${n === 1 ? one : many ?? one + "s"}`;
