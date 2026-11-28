// Plain logic for the Overview (board 00 and board 15 section A): the greeting, which of the headlines to show, short
// times, the prices worth a row, a finding's status word. No React and no imports of app code, so `node --test` runs it.

import { NOT_INVESTIGATED, notInvestigatedWhy } from "../../plain.ts";

const plural = (n: number, one: string, many?: string) => `${n} ${n === 1 ? one : many ?? one + "s"}`;

// ---------------------------------------------------------------- greeting
/** "Good morning, John · Wednesday 25 November" (shown in capitals), in the institution's time zone. */
export function greetingText(now: Date, timeZone: string, name: string): string {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-GB", { timeZone, weekday: "long", day: "numeric", month: "long", hour: "2-digit", hourCycle: "h23" }).formatToParts(now);
  } catch {
    parts = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long", hour: "2-digit", hourCycle: "h23" }).formatToParts(now);
  }
  const p = (t: Intl.DateTimeFormatPartTypes) => parts.find(x => x.type === t)?.value ?? "";
  const hour = Number(p("hour"));
  const part = hour < 12 ? "morning" : hour < 18 ? "afternoon" : "evening";
  return `Good ${part}${name ? `, ${name}` : ""} · ${p("weekday")} ${p("day")} ${p("month")}`;
}

// ---------------------------------------------------------------- the headline (board 15 section A)
export type HeadlineKind = "alerts" | "quiet" | "clear" | "stopped";
export interface HeadlineIn {
  /** counts.alerts_to_review */
  alerts: number;
  /** events.length */
  events: number;
  /** services.tick.ok */
  tickOk: boolean;
}
/** The headline answers "does anything need my teams?": alerts to review; no alerts but events open; nothing open
 *  (all clear, or "nothing open" when updates stopped, so quiet doesn't mean safe). */
export function headlineKind(i: HeadlineIn): HeadlineKind {
  if (i.alerts > 0) return "alerts";
  if (i.events > 0) return "quiet";
  return i.tickOk ? "clear" : "stopped";
}
/** The hero's two lines: `hot` is the red part ("3 alerts"), `rest` the rest ("need your teams"). */
export function headlineText(kind: HeadlineKind, alerts: number): { hot?: string; rest: string } {
  switch (kind) {
    case "alerts": return { hot: plural(alerts, "alert"), rest: alerts === 1 ? "needs your teams" : "need your teams" };
    case "quiet": return { rest: "No alerts for your teams" };
    case "clear": return { rest: "All clear" };
    case "stopped": return { rest: "Nothing open right now" };
  }
}

// ---------------------------------------------------------------- times
/** "just now", "12 min ago", "2 h ago", "yesterday", "3 days ago" (the open events' age column). */
export function ageText(iso: string | null | undefined, now: Date): string {
  if (!iso) return "";
  const s = Math.round((now.getTime() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 86400 * 2) return "yesterday";
  return `${Math.floor(s / 86400)} days ago`;
}

// ---------------------------------------------------------------- the stat tiles
/** "7 monitors · 22 prices · Radar": what is being watched. */
export function watchingMeta(monitors: number, prices: number, radar: boolean): string {
  return [plural(monitors, "monitor"), plural(prices, "price"), ...(radar ? ["Radar"] : [])].join(" · ");
}
/** "9 monitors · 3 prices · 6 Radar": where the last day's findings came from (nothing found: "quiet in the last 24 h"). */
export function foundMeta(f: { monitor: number; timeseries: number; radar: number }): string {
  if (f.monitor + f.timeseries + f.radar === 0) return "quiet in the last 24 h";
  return [plural(f.monitor, "monitor"), plural(f.timeseries, "price"), `${f.radar} Radar`].join(" · ");
}
/** "open events · 14 effects to watch" (the number is the tile's big figure). */
export function tracedMeta(events: number, effects: number): string {
  return `${events === 1 ? "open event" : "open events"} · ${plural(effects, "effect")} to watch`;
}
/** "alerts for 2 teams"; without the team count (the call failed): "alerts to review"; none: "all caught up". */
export function actMeta(alerts: number, teams: number | null): string {
  if (alerts === 0) return "all caught up";
  const noun = alerts === 1 ? "alert" : "alerts";
  return teams && teams > 0 ? `${noun} for ${plural(teams, "team")}` : `${noun} to review`;
}

// ---------------------------------------------------------------- an event's row
/** "5 effects", "1 effect", "No effects yet". */
export function effectsText(n: number): string { return n === 0 ? "No effects yet" : plural(n, "effect"); }
/** The line under an event's effect rows: "+2 more effects · 3 later findings joined" (empty when there is neither). */
export function moreLine(effects: number, shown: number, developments: number): string {
  const more = Math.max(0, effects - shown);
  return [more > 0 && `+${plural(more, "more effect")}`, developments > 0 && `${plural(developments, "later finding")} joined`]
    .filter(Boolean).join(" · ");
}
/** The word read for an arrow: ↑ rises, ↓ falls. */
export function arrowOf(direction: string | null | undefined): { glyph: string; word: string } | null {
  if (direction === "rise") return { glyph: "↑", word: "rises" };
  if (direction === "fall") return { glyph: "↓", word: "falls" };
  return null;
}
/** Up to `max` place names: "Persian Gulf, Iran and 2 more". */
export function placesText(names: string[], max = 1): string {
  const uniq = [...new Set(names.filter(Boolean))];
  if (uniq.length <= max) return uniq.join(", ");
  return `${uniq.slice(0, max).join(", ")} +${uniq.length - max}`;
}

// ---------------------------------------------------------------- the map
const RANK: Record<string, number> = { bad: 0, mixed: 1, good: 2 };
/** A place as the server describes it (the overview's `map.places` and the profile's `places`). */
export interface PlaceLite { code: string; name: string | null; kind: string; parent: string | null; country: string | null; lat: number | null; lon: number | null; numeric: string | null }
type Places = Record<string, PlaceLite | undefined>;
export interface MapEvent { title?: string; tone: string; places: string[] }
/** What the map needs to know about the institution: its home country, and the place a country-wide event is marked on. */
export interface MapContext { places: Places; home: string; anchor: string | null }
export interface MapMark {
  /** The place the mark sits on: the most specific place an event has, or the home anchor for a country-wide event. */
  code: string;
  tone: "bad" | "mixed" | "good";
  first: boolean;
  /** How many of the events here are country-wide (tagged only with the home country). */
  nationwide: number;
  /** Whether an event is tagged with this very place too. */
  specific: boolean;
  /** Every event at this mark, worst first (for the mark's hover). */
  events: { title: string; tone: MapMark["tone"] }[];
}

const isCountry = (code: string, places: Places) => (places[code] ? places[code]!.kind === "country" : /^[A-Z]{2}$/.test(code));
/** Whether `inner` lies inside `outer`: by its parents (city → state → country), or by its country when the outer one is a country. */
function lies(inner: string, outer: string, places: Places): boolean {
  if (inner === outer) return false;
  let c = places[inner]?.parent ?? null;
  for (let i = 0; c && i < 5; i++) { if (c === outer) return true; c = places[c]?.parent ?? null; }
  const p = places[inner];
  return isCountry(outer, places) && !!p && p.kind !== "country" && p.country === outer && !!p.parent;
}
/** An event's places without the ones a more specific place of its own already covers: [US, US-TX] → [US-TX]. */
export function mostSpecific(codes: string[], places: Places): string[] {
  const uniq = [...new Set(codes)];
  return uniq.filter(c => !uniq.some(o => lies(o, c, places)));
}
/** The place to put a mark on: the place itself, or its nearest parent that has a position. */
function located(code: string, places: Places): string {
  let c: string | null = code;
  for (let i = 0; c && i < 5; i++) { const p: PlaceLite | undefined = places[c]; if (p && p.lat != null && p.lon != null) return c; c = p?.parent ?? null; }
  return code;
}

/** One mark per place: the worst tone of the events that touch it. Neutral events have no ▲◆▼, so they add none. With the
 *  institution's places (`ctx`) an event is marked on the most specific place it has (city → state → country), and an event
 *  tagged only with the home country is marked on the home anchor (its main state), counted as "nationwide". */
export function mapMarks(events: MapEvent[], ctx?: MapContext): MapMark[] {
  const marks = new Map<string, MapMark>();
  let firstCode: string | null = null;
  for (const e of events) {
    if (!(e.tone in RANK)) continue;
    const t = e.tone as MapMark["tone"];
    for (const raw of ctx ? mostSpecific(e.places, ctx.places) : e.places) {
      const wide = !!ctx && raw === ctx.home && isCountry(raw, ctx.places);
      const code = !ctx ? raw : wide && ctx.anchor ? ctx.anchor : located(raw, ctx.places);
      const cur = marks.get(code) ?? { code, tone: t, first: false, nationwide: 0, specific: false, events: [] };
      if (e.title && !cur.events.some(x => x.title === e.title)) cur.events.push({ title: e.title, tone: t });
      if (RANK[t] < RANK[cur.tone]) cur.tone = t;
      if (wide) cur.nationwide++; else cur.specific = true;
      marks.set(code, cur);
      if (firstCode === null) firstCode = code;
    }
  }
  return [...marks.values()].map(m => ({ ...m, first: m.code === firstCode, events: [...m.events].sort((a, b) => RANK[a.tone] - RANK[b.tone]) }));
}

// ---------------------------------------------------------------- the home footprint on the map
/** Radius of the soft halo round a state or a city on the map, in degrees (the map has country shapes only, no state borders). */
export const HALO_DEGREES = { state: 4.5, city: 1.2 };
export interface FootprintItem { code: string; role?: string; branch_count?: number | null }
export interface FootprintView {
  /** ISO numeric ids of the countries to shade whole (a footprint that is the country itself). */
  countries: string[];
  /** Soft halos round the states and cities of the footprint. */
  halos: { code: string; lat: number; lon: number; r: number; /** the numeric id of the state's country: the halo only tints that country's land */ within: string | null }[];
  /** Where country-wide events go: the home state with the most branches (or the home footprint's first place), else the home country. */
  anchor: PlaceLite | null;
  /** The footprint's place names, for the picture's words. */
  names: string[];
  /** The footprint's names to write on the map, where each place is. */
  labels: { name: string; lat: number; lon: number }[];
}
/** What of the profile's footprint the map shows: a country footprint is shaded as a country; a state or city footprint gets a
 *  soft halo (a country that has states of its own listed is not shaded whole). */
export function footprintView(home: string, items: FootprintItem[], places: Places): FootprintView {
  const known = items.map(i => ({ i, p: places[i.code] })).filter((x): x is { i: FootprintItem; p: PlaceLite } => !!x.p);
  const sub = known.filter(x => x.p.kind !== "country" && x.p.lat != null && x.p.lon != null);
  const countries = known.filter(x => x.p.kind === "country" && x.p.numeric && !sub.some(s => s.p.country === x.p.code || s.p.code.startsWith(`${x.p.code}-`)));
  const ranked = sub.map((x, n) => ({ x, n })).sort((a, b) => Number(b.x.i.role === "home") - Number(a.x.i.role === "home")
    || (b.x.i.branch_count ?? 0) - (a.x.i.branch_count ?? 0) || a.n - b.n).map(r => r.x);
  const homeP = places[home];
  const anchor = ranked[0]?.p ?? (homeP && homeP.lat != null && homeP.lon != null ? homeP : null);
  return {
    countries: countries.map(c => c.p.numeric!),
    halos: sub.map(s => ({ code: s.p.code, lat: s.p.lat!, lon: s.p.lon!, r: s.p.kind === "city" ? HALO_DEGREES.city : HALO_DEGREES.state, within: (s.p.country && places[s.p.country]?.numeric) || null })),
    anchor,
    names: [...countries, ...sub].map(x => x.p.name ?? x.p.code),
    labels: [...countries, ...sub].filter(x => x.p.lat != null && x.p.lon != null).map(x => ({ name: x.p.name ?? x.p.code, lat: x.p.lat!, lon: x.p.lon! })),
  };
}

// ---------------------------------------------------------------- findings and radar rows
export type PillKind = "good" | "unusual" | "neutral";
const SOURCE: Record<string, string> = { monitor: "Monitor", timeseries: "Price", radar: "Radar" };
export const sourceWord = (s: string): string => SOURCE[s] ?? s;
/** A finding's status as a short pill: "In an event" (good), "Being investigated", "No impact found". */
export function findingPill(f: { status: string; event_id: string | null; reason: string | null }): { word: string; tone: PillKind; /** why it couldn't be investigated, when that is the word */ why?: string } {
  if (f.event_id || f.status === "linked") return { word: "In an event", tone: "good" };
  if (f.status === "set_aside") return f.reason === "investigation_failed" ? { word: NOT_INVESTIGATED, tone: "unusual", why: notInvestigatedWhy() } : { word: "No impact found", tone: "neutral" };
  if (f.status === "grouped") return { word: "Being investigated", tone: "neutral" };
  if (f.status === "new") return { word: "Waiting", tone: "neutral" };
  return { word: f.status, tone: "neutral" };
}
/** A Radar story's status as a pill. */
export function storyPill(r: { status: string; event_id: string | null }): { word: string; tone: PillKind } {
  if (r.status === "sent") return r.event_id ? { word: "In an event", tone: "good" } : { word: "Being investigated", tone: "neutral" };
  if (r.status === "below") return { word: "Not sent this run", tone: "neutral" };
  return { word: "Dismissed", tone: "neutral" };
}

// ---------------------------------------------------------------- prices
export interface PriceIn { series_id: string; name: string; state: string; state_reason: string | null; close: number | null; change_1d_pct: number | null; spark: number[] }
/** "09:00" or "10 Nov 12:30" from the server's note "No new bar since 09:00 (…)"; null when the note says nothing. */
export function lateSince(reason: string | null | undefined): string | null {
  return reason?.match(/since (.+?)(?: \(|\.|$)/)?.[1]?.trim() ?? null;
}
/** The prices that earn a row: unusual moves first, then late ones, then (when nothing is out of the ordinary) the
 *  biggest movers, so the box is never empty. `unusual` counts the moved ones. */
export function priceRows<T extends PriceIn>(markets: T[], max = 4): { shown: T[]; unusual: number; late: number; others: number; othersNormal: boolean } {
  const moved = markets.filter(m => m.state === "moved");
  const late = markets.filter(m => m.state === "stale");
  const odd = [...moved, ...late];
  let shown = odd.slice(0, max);
  if (!odd.length) {
    shown = markets.filter(m => m.change_1d_pct != null)
      .sort((a, b) => Math.abs(b.change_1d_pct!) - Math.abs(a.change_1d_pct!)).slice(0, Math.min(3, max));
  }
  const others = markets.length - shown.length;
  return { shown, unusual: moved.length, late: late.length, others, othersNormal: odd.length <= shown.length };
}

// ---------------------------------------------------------------- needs you
export type NeedLevel = "crit" | "warn" | "info";
/** What a "Needs you" row's button says: a decision is "Review", anything else "Open". */
export function needAction(kind: string): string {
  return kind === "approval" || kind === "proposal" || kind === "review" || kind === "alerts" ? "Review" : "Open";
}
/** Read before a row's title, since its dot is colour only. */
export function needLevelWord(level: string): string {
  return level === "crit" ? "Urgent: " : level === "warn" ? "Needs attention: " : "";
}
/** A server note in plain words where it uses series wording ("No new bar since …"). */
export const plainNote = (t: string): string => t.replace(/^(.+?): No new bar since (.+?) \(.*\)\.?$/, "$1: no new price since $2");

/** The line under the prices: "18 others normal", "1 other normal", "3 more" (when some odd ones didn't fit), then all series. */
export function othersText(others: number, normal: boolean): string {
  return others <= 0 ? "" : normal ? `${others} ${others === 1 ? "other" : "others"} normal` : `${others} more`;
}
