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

/** The reset goes ahead only once RESET is typed (any case, spaces around ignored). */
export const confirmed = (typed: string): boolean => typed.trim().toUpperCase() === "RESET";
