import type { FetchOutcome, Theme } from "../api/series";
import { currencyWord } from "../plain";

/** What a refresh did, in words. */
export function outcomeText(name: string, f: FetchOutcome): string {
  if (f.finding_id) return `${name}: unusual move flagged.`;
  if (f.status === "ok") return `${name}: ${f.bars_new} new hour${f.bars_new === 1 ? "" : "s"} of prices.`;
  return `${name}: no new prices yet (the current hour shows once it closes; markets may be closed).`;
}

// ---------------------------------------------------------------- theme presets
// Theme ids are the Metrics Spec's; directions are AMIRI Agent's (GET /api/v1/reference/themes).
// An fx theme names the currency that moved, so its presets come from the symbol's two sides.
type Preset = { id: string; label: string; theme: Theme | null };
const FIXED: Preset[] = [
  { id: "gold", label: "Gold price", theme: { theme: "commodities", direction_up: "up", direction_down: "down", item: "gold" } },
  { id: "oil", label: "Oil price", theme: { theme: "commodities", direction_up: "up", direction_down: "down", item: "oil" } },
  { id: "rates", label: "Interest rate", theme: { theme: "rates", direction_up: "up", direction_down: "down" } },
  { id: "index", label: "Stock index", theme: { theme: "markets", direction_up: "equity_up", direction_down: "equity_down" } },
  { id: "", label: "None (no theme on findings)", theme: null },
];
// gold and oil look like currency pairs (XAU/USD, XBR/USD): they only get their own meaning, never an exchange rate
export const COMMODITY: Record<string, string> = { XAU: "gold", WTI: "oil", BRENT: "oil", XBR: "oil", XTI: "oil", URALS: "oil", USOIL: "oil", UKOIL: "oil" };
export function themePresets(symbol: string): Preset[] {
  const [a, b] = symbol.toUpperCase().split("/");
  const c = COMMODITY[a ?? ""];
  if (c) return FIXED.filter(t => t.id === c || t.id === "");
  const fx: Preset[] = /^[A-Z]{3}$/.test(a ?? "") && /^[A-Z]{3}$/.test(b ?? "") ? [
    { id: `fx_${b}`, label: `Exchange rate: up = ${b} weaker`, theme: { theme: "fx", direction_up: "weaker", direction_down: "stronger", currency: b } },
    { id: `fx_${a}`, label: `Exchange rate: up = ${a} stronger`, theme: { theme: "fx", direction_up: "stronger", direction_down: "weaker", currency: a } },
  ] : [];
  return [...fx, ...FIXED];
}
export const AUTO = "auto";
const same = (a: Theme, b: Theme) => a.theme === b.theme && a.direction_up === b.direction_up && (a.item ?? null) === (b.item ?? null)
  && (a.currency ?? null) === (b.currency ?? null);
export const themeId = (t: Theme | null, symbol: string) => (t ? themePresets(symbol).find(x => x.theme && same(x.theme, t))?.id ?? "custom" : "");
export const themeFor = (id: string, symbol: string) => themePresets(symbol).find(t => t.id === id)?.theme ?? null;
export const parsePlaces = (s: string) => s.split(/[,\s]+/).map(x => x.trim().toUpperCase()).filter(Boolean);
const METAL: Record<string, string> = { XAU: "gold", XAG: "silver", XPT: "platinum" };  // not currencies to Intl: "a stronger xau"
const THEME_WORDS: Record<string, string> = { fx: "Exchange rate", commodities: "Commodity price", rates: "Interest rate" };
/** What a move in this series means, in a sentence a banker would say. */
export const themeMeaning = (t: Theme | null) => {
  if (!t) return "not set";
  const up = t.direction_up.replace(/_/g, " "), down = t.direction_down.replace(/_/g, " ");
  if (t.currency) { const w = (METAL[t.currency] ?? currencyWord(t.currency)).toLowerCase(); return `A rise means a ${up} ${w}, a fall a ${down} one`; }
  return `${THEME_WORDS[t.theme] ?? t.theme}${t.item ? ` (${t.item})` : ""}: a rise means ${up}, a fall means ${down}`;
};
export const themeLabel = (t: Theme | null) =>
  !t ? "no theme" : `${t.theme}${t.item ? ` (${t.item})` : ""}${t.currency ? ` ${t.currency}` : ""}: up = ${t.direction_up.replace(/_/g, " ")}, down = ${t.direction_down.replace(/_/g, " ")}`;
