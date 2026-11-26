// The Scenario Studio list and editor, in words (board 09, states on board 15 B). Pure functions, so `npm test` covers them.
import type { HeadlineIn, Mode, PriceMove, Scenario, ScenarioRow, Simulation, Template } from "../../api/studio.ts";

export const DAYS = 21;
export const MAX_HEADLINES = 30;
export const MIN_HEADLINE = 8;

const INTENSITY: Record<string, string> = { low: "Low", medium: "Medium", high: "High" };
export const intensityWord = (i: string): string => INTENSITY[i] ?? i;

/** A template's tags in words ("fx" is a currency story). */
export const TAG: Record<string, string> = { fx: "currency" };
export const tagsText = (tags: string[]): string => tags.map(x => TAG[x] ?? x).join(" · ");

/** "Can't run here: …": why a template is not offered (the server's reason, in a sentence). */
export function unavailableText(why: string): string {
  const w = why.trim().replace(/\.$/, "");
  return `Can't run here: ${w}.`;
}

/** The second line of a scenario in the list: "Medium · Recorded · last run 22 Nov". */
export function rowMeta(s: Pick<ScenarioRow, "template_id" | "intensity" | "recorded" | "last_run">, running: boolean, dayOf: (iso: string) => string): string {
  const own = s.template_id === "blank";
  const parts = [own ? "Your own" : intensityWord(s.intensity)];
  if (running) parts.push("Running now");
  else {
    parts.push(s.recorded ? "Recorded" : "Not recorded");
    parts.push(s.last_run ? `last run ${dayOf(s.last_run)}` : "Not run yet");
  }
  return parts.join(" · ");
}

/** The line under the scenario's name: "Simulated clock: starts 8 Feb 2027 · 21 days, one step a day · recording saved for this version".
 *  The date is the scenario's pretend "today", not the real one. */
export function subtitle(startLabel: string, steps: number, own: boolean, rec: Scenario["recording"], recordedLabel: string): string {
  const parts = [`Simulated clock: starts ${startLabel}`, `${steps} days, one step a day`];
  if (own) parts.push("your own scenario");
  parts.push(recordingNote(rec, recordedLabel));
  return parts.join(" · ");
}

/** What the recording of this version is: saved, saved for an older version, unfinished, or none. */
export function recordingNote(rec: Scenario["recording"], recordedLabel: string): string {
  if (!rec) return "not recorded yet";
  if (!rec.complete) return "a recording was started but didn't finish";
  return rec.current ? `recording saved for this version (${recordedLabel})` : "changed since it was recorded";
}

/** Whether Replay can run: a complete recording of the current version. */
export const replayable = (rec: Scenario["recording"]): boolean => !!(rec?.complete && rec.current);

/** "5 of 6 on": how many headlines are in the run. */
export function onCount(total: number, off: number): string {
  return total === 0 ? "none yet" : `${total - off} of ${total} on`;
}

/** The small print beside the run buttons: why one is off, or what the main one does. */
export function runHint(opts: { running: boolean; empty: boolean; rec: Scenario["recording"]; mode: "replay" | "live" }): string {
  const { running, empty, rec, mode } = opts;
  if (running) return "Another run is going: wait for it to end, or stop it above.";
  if (empty) return "Add a headline or a price move to run it.";
  if (mode === "replay") {
    if (replayable(rec)) return "From the saved recording, no agents";
    if (!rec) return "Not recorded yet: tick Record this run, and run it live once";
    if (!rec.complete) return "A recording was started but didn't finish: record it again";
    return "You changed the scenario: record this version first";
  }
  return "The agents read the scenario as it happens; takes a few minutes";
}

/** The mode a live button starts, given the "Record this run" box. */
export const liveMode = (record: boolean): Mode => (record ? "record" : "live");

/** "Used in 1 scenario" under a template that one of your scenarios already came from; null when none did. */
export function usedWords(rows: Pick<ScenarioRow, "template_id">[], templateId: string): string | null {
  const n = rows.filter(r => r.template_id === templateId).length;
  return n === 0 ? null : `Used in ${n} ${n === 1 ? "scenario" : "scenarios"}`;
}

/** The scenario whose run a new start would clear: the one with the latest last run (null when nothing has run). */
export function lastRan(rows: Pick<ScenarioRow, "title" | "last_run">[]): string | null {
  let best: { t: number; title: string } | null = null;
  for (const r of rows) {
    if (!r.last_run) continue;
    const t = new Date(r.last_run).getTime();
    if (!best || t > best.t) best = { t, title: r.title };
  }
  return best?.title ?? null;
}

/**
 * The scenario the pane opens when the address names none (the pane is never empty): the one with the latest last run, else the
 * newest created. null when there is none. Ties keep the list's own order, so the choice is stable.
 */
export function pickDefaultScenario(rows: Pick<ScenarioRow, "scenario_id" | "last_run" | "created_at">[]): string | null {
  const t = (iso: string | null | undefined): number => { const n = iso ? new Date(iso).getTime() : NaN; return Number.isNaN(n) ? -Infinity : n; };
  let best: (typeof rows)[number] | null = null;
  for (const r of rows) {
    if (!best) { best = r; continue; }
    const [a, b] = [t(r.last_run), t(best.last_run)];
    if (a > b || (a === b && t(r.created_at) > t(best.created_at))) best = r;
  }
  return best?.scenario_id ?? null;
}

/** The template the pane previews when nothing is saved: the first one the server lists that can run here (null when none can). */
export const firstAvailable = (ts: Template[]): Template | null => ts.find(t => !t.unavailable) ?? null;

/** "Another run is going: Data-center land rush, day 3 of 21." */
export const goingText = (sim: Pick<Simulation, "title" | "step" | "steps">): string => `${sim.title}, day ${sim.step} of ${sim.steps}`;

/** One earlier run, in a line. */
export function runLine(m: { mode: Mode | string; status: string; step: number; steps: number }, when: string): string {
  const how = m.mode === "replay" ? "replay" : m.mode === "record" ? "live, saved" : "live";
  const where = m.status === "finished" || m.status === "completed" ? "finished"
    : m.status === "stopped" ? `stopped on day ${m.step} of ${m.steps}`
    : `${m.status.replace(/_/g, " ")}, day ${m.step} of ${m.steps}`;
  return `${when} · ${how} · ${where}`;
}

// ---------------------------------------------------------------- the forms

export const headlineOk = (title: string): boolean => title.trim().length >= MIN_HEADLINE;
export const headlineError = (title: string): string | null =>
  title.length > 0 && !headlineOk(title) ? `A headline needs at least ${MIN_HEADLINE} characters.` : null;

export function priceMoveOk(m: PriceMove): boolean {
  return m.direction === "none" || (m.size_pct >= 0.5 && m.size_pct <= 30 && m.ramp_days >= 1 && m.ramp_days <= 15);
}
export function priceMoveError(m: PriceMove): string | null {
  if (m.direction === "none") return null;
  if (!(m.size_pct >= 0.5 && m.size_pct <= 30)) return "The move is between 0.5% and 30%.";
  if (!(m.ramp_days >= 1 && m.ramp_days <= 15)) return "It plays out over 1 to 15 business days.";
  return null;
}
export const sameMove = (a: PriceMove | undefined, b: PriceMove): boolean => JSON.stringify(a ?? {}) === JSON.stringify(b);

/** Headlines in the order they play (day, then time): the order the editor lists them. */
export function byTime<T extends { day: number; time: string }>(xs: T[]): T[] {
  return [...xs].sort((a, b) => a.day - b.day || a.time.localeCompare(b.time));
}

/** A scenario file's contents, as the "write your own" form's fields (checked by the server when it is created). */
export function fillFromFile(x: Record<string, any>, keepTitle: string): { title: string; headlines: HeadlineIn[]; prices: PriceMove } {
  const c = (x.custom && typeof x.custom === "object" ? x.custom : x) as Record<string, any>;
  const headlines: HeadlineIn[] = (Array.isArray(c.headlines) ? c.headlines : []).filter((h: any) => h && typeof h.title === "string")
    .map((h: any, i: number) => ({ id: typeof h.id === "string" && h.id ? h.id : `h${i + 1}`, title: h.title, day: Number(h.day) || 1, time: typeof h.time === "string" ? h.time : "09:00" }));
  const p = c.prices && typeof c.prices === "object" ? c.prices : {};
  return {
    title: typeof x.title === "string" ? x.title.slice(0, 120) : keepTitle,
    headlines,
    prices: { direction: ["weaker", "stronger"].includes(p.direction) ? p.direction : "none", size_pct: Number(p.size_pct) || 0, ramp_days: Number(p.ramp_days) || 5 },
  };
}

/** What a 412 leaves of the person's work, as text for the clipboard. */
export function changesText(body: { intensity?: string; switched_off?: string[]; title?: string; custom?: { headlines?: HeadlineIn[]; prices?: PriceMove } }): string {
  const out: string[] = [];
  if (body.title) out.push(`Name: ${body.title}`);
  if (body.intensity) out.push(`How hard it hits: ${intensityWord(body.intensity)}`);
  for (const h of body.custom?.headlines ?? []) out.push(`Day ${h.day} ${h.time}: ${h.title}`);
  const p = body.custom?.prices;
  if (p) out.push(p.direction === "none" ? "No price move" : `Price move: ${p.size_pct}% ${p.direction} over ${p.ramp_days} business days`);
  if (body.switched_off) out.push(`Switched off: ${body.switched_off.join(", ") || "nothing"}`);
  return out.join("\n");
}
