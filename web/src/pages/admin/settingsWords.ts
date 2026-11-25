// The Settings page's words and small decisions, as plain logic so `npm test` covers them.

export interface SettingsInst { name?: string | null; time_zone?: string; demo_lock?: boolean; prototype_reset?: boolean; profile?: boolean }

/** Whether the reset can be used: `unknown` while the installation is still loading. */
export type ResetState = "unknown" | "allowed" | "off";
export const resetState = (i: SettingsInst | null): ResetState => (!i ? "unknown" : i.prototype_reset === false ? "off" : "allowed");

/** The demo lock row: a word for the pill and one sentence. */
export function demoMode(i: SettingsInst): { on: boolean; word: string; line: string } {
  return i.demo_lock
    ? { on: true, word: "On", line: "Editing, deleting and the reset are switched off, so nothing is changed by accident. Alerts and Scenario Studio runs still work." }
    : { on: false, word: "Off", line: "Everything can be edited, deleted and reset." };
}

export const institutionLine = (i: SettingsInst): string => i.name || (i.profile ? "Not named" : "None yet");

export interface ResetChoice { id: "demo-bank" | "demo-insurer" | "empty"; title: string; line: string }
/** What to start again with: each demo, or empty. `demos` is the app's DEMOS list. */
export function resetChoices(demos: readonly { kind: string; label: string; name: string; what: string }[]): ResetChoice[] {
  return [
    ...demos.map(d => ({ id: `demo-${d.kind}` as ResetChoice["id"], title: `${d.label}: ${d.name}`, line: `${d.what}, ready to use. Monitors, events and scenarios start empty.` })),
    { id: "empty", title: "Start empty", line: "The welcome page: set up an institution from scratch with the setup agent or the forms." },
  ];
}

/** The reset goes ahead only once RESET is typed (any case, spaces around ignored). */
export const confirmed = (typed: string): boolean => typed.trim().toUpperCase() === "RESET";

type Problemish = { problem?: { detail?: unknown } } | null | undefined;
/** A failed reset in a sentence: the server's own, else a plain one. */
export function resetProblem(e: unknown): string {
  const d = (e as Problemish)?.problem?.detail;
  return typeof d === "string" && d ? d : "The reset didn't go through. Nothing was changed; try again in a moment.";
}
