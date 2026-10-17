// Plain words for what the API returns in codes: themes, product types and angles, check results, alert levels,
// monitor and series states, set-aside reasons, sizes and dates. Pure functions, so `npm test` runs them without a browser.
import { day, TIME_ZONE } from "./format.ts";

/** The five colours of a status pill, the same meaning everywhere. */
export type Tone = "red" | "amber" | "green" | "grey" | "blue";
// red: bad for you / needs action · amber: watch / early signs · green: confirmed good / done · grey: neutral / waiting ·
// blue: info / in progress

const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const words = (s: string) => s.replace(/[_-]+/g, " ").trim();

// ---------------------------------------------------------------- themes
interface ThemeTag { theme: string; direction: string; item?: string; currency?: string }
const ITEM: Record<string, string> = {
  oil: "Oil", gold: "Gold", crops: "Crop", fuel: "Fuel", electricity: "Electricity", food: "Food",
  flood: "Flood", storm: "Storm", earthquake: "Earthquake", drought: "Drought", fire: "Fire", epidemic: "Epidemic", haze: "Haze",
};
const UPDOWN = (d: string) => (d === "up" ? "up" : d === "down" ? "down" : words(d));
const REGULATION: Record<string, string> = {
  tax: "Tax change", central_bank_direction: "Central bank directive", central_bank_relief: "Central bank relief",
  insurance_regulator_rule: "New insurance rule", import_control_tighter: "Import controls tightened",
  import_control_looser: "Import controls eased", sanctions: "Sanctions", travel_tighter: "Travel rules tightened",
  travel_looser: "Travel rules eased", tariff: "Tariff change",
};
const OTHER: Record<string, Record<string, string>> = {
  competitor: { cheaper: "Rival cuts prices", new_product: "Rival launches a product", partner_switch: "Partner moves to a rival" },
  macro: { worse: "Economy weakens", better: "Economy improves" },
  sector: { shock: "Shock to a sector", boost: "Boost to a sector" },
  trust: { own: "Trust in you shaken", rival: "Trust in a rival shaken", system: "Trust in banks shaken" },
  markets: { equity_down: "Share prices down", equity_up: "Share prices up", bonds_down: "Bond prices down", bonds_up: "Bond prices up" },
};
const currencyNames = (() => { try { return new Intl.DisplayNames(["en"], { type: "currency" }); } catch { return null; } })();
/** "LKR" → "Rupee", "USD" → "Dollar": the word people use. */
export function currencyWord(code: string): string {
  try { const n = currencyNames?.of(code); return n && n !== code ? cap(n.split(" ").pop()!.toLowerCase()) : code; } catch { return code; }
}

/** A theme tag as a short phrase: "Oil prices up", "Remittances down", "Rupee weaker". */
export function themeLabel(t: ThemeTag): string {
  const d = t.direction;
  switch (t.theme) {
    case "commodities": return `${t.item ? ITEM[t.item] ?? cap(words(t.item)) : "Commodity"} prices ${UPDOWN(d)}`;
    case "prices": return !t.item || t.item === "general" ? `Inflation ${UPDOWN(d)}` : `${ITEM[t.item] ?? cap(words(t.item))} prices ${UPDOWN(d)}`;
    case "rates": return `Interest rates ${UPDOWN(d)}`;
    case "remittance": return `Remittances ${UPDOWN(d)}`;
    case "fx": return `${t.currency ? currencyWord(t.currency) : "Currency"} ${d === "weaker" ? "weaker" : d === "stronger" ? "stronger" : words(d)}`;
    case "regulation": return REGULATION[d] ?? cap(words(d));
    case "disaster": return `${t.item ? ITEM[t.item] ?? cap(words(t.item)) : "Disaster"} ${d === "domestic" ? "at home" : d === "abroad" ? "abroad" : words(d)}`;
    default: return OTHER[t.theme]?.[d] ?? cap(`${words(t.theme)} ${words(d)}`);
  }
}

// ---------------------------------------------------------------- products
// the investigation's product types (its "tracks") and the angles it looks at them from
const PRODUCT_TYPE: Record<string, string> = {
  savings: "Savings", fc_deposit: "Foreign-currency deposits", retirement: "Retirement plan", pawning: "Gold loan",
  retail_loan: "Personal loan", leasing: "Leasing", credit_card: "Credit card", business_loan: "Business loan",
  trade_finance: "Trade finance", agri_loan: "Farm loan", remittance: "Remittances", payments: "Payments",
  customer_fx: "Currency exchange", wealth: "Investments", bancassurance: "Bancassurance",
  life: "Life insurance", health: "Health insurance", motor: "Motor insurance", travel: "Travel insurance",
  property: "Property insurance", marine: "Marine insurance", agriculture: "Crop insurance",
  micro_insurance: "Micro-insurance", liability: "Liability insurance",
  // the Metrics Spec's own product types, where a page gets those instead
  savings_account: "Savings account", current_account: "Current account", term_deposit: "Term deposit", gold_loan: "Gold loan",
  personal_loan: "Personal loan", housing_loan: "Housing loan", vehicle_lease: "Vehicle lease", auto_loan: "Car loan",
  working_capital: "Working capital", term_loan: "Term loan", import_lc: "Import LCs", export_finance: "Export finance",
  crop_loan: "Crop loan", inward_remittance: "Inward remittances", outward_remittance: "Outward remittances",
};
const ANGLE: Record<string, string> = {
  flows: "money in and out", rate_competitiveness: "rate competition", segment: "a customer group", lifecycle: "account life",
  channel: "channels", fc_flows: "foreign-currency inflows", contributions: "contributions", early_withdrawals: "early withdrawals",
  fund_returns: "fund returns", collateral: "gold value", demand: "demand", redemption: "redemptions", pricing: "pricing",
  repayment_stress: "missed repayments", prepayment: "early repayment", new_business: "new business", stress: "missed repayments",
  fx_mismatch: "currency mismatch", utilization: "more borrowing", concentration: "concentration", trade_controls: "trade controls",
  exports: "exports", imports: "imports", restructure: "restructuring", volume: "volume", corridor: "sending countries",
  competition: "competition", cash: "cash use", merchant: "merchants", reinsurance: "reinsurance", claims: "claims",
  lapses: "lapses", retention: "renewals", investment: "investment returns", claim_frequency: "more claims",
  claim_severity: "bigger claims", portfolio: "portfolio mix", catastrophe: "catastrophe", rebuild_cost: "rebuild costs",
};
export const productTypeLabel = (t: string) => PRODUCT_TYPE[t] ?? cap(words(t));
export const angleLabel = (a: string) => ANGLE[a] ?? words(a);
/** "Business loan · more borrowing". */
export const productAngle = (type: string, angle: string) => `${productTypeLabel(type)} · ${angleLabel(angle)}`;

// ---------------------------------------------------------------- a possible impact
const SIZE: Record<string, string> = { small: "Small", medium: "Medium", large: "Large" };
const TIMING: Record<string, string> = { days: "within days", weeks: "within weeks", months: "within months" };
/** "Medium · within weeks". */
export function sizeTiming(size?: string | null, timing?: string | null): string {
  return [size ? SIZE[size] ?? cap(size) : "", timing ? TIMING[timing] ?? timing : ""].filter(Boolean).join(" · ");
}
/** "Credit-line utilisation may rise". */
export function impactText(metricName: string, direction: string): string {
  const verb = direction === "rise" ? "may rise" : direction === "fall" ? "may fall" : `may ${words(direction)}`;
  return `${cap(metricName)} ${verb}`;
}
/** A metric key as words, when the spec's name isn't to hand: "facility_utilization" → "Facility utilization". */
export const metricWords = (key: string) => cap(words(key));
/** The metric's name at the front of a check's sentence ("Instalment collection rate (vehicle type: three wheeler): …"),
 *  and the rest. A colon inside the brackets isn't the split. */
export function splitCheckText(what: string): [string, string] {
  let depth = 0;
  for (let i = 0; i < what.length - 1; i++) {
    const ch = what[i];
    if (ch === "(") depth++;
    else if (ch === ")") depth = Math.max(0, depth - 1);
    else if (ch === ":" && depth === 0 && what[i + 1] === " ") return [what.slice(0, i), what.slice(i + 2)];
  }
  return [what, ""];
}
/** The move a check measured, when it has one: "−25.1% against the same period last year (usual range …)" →
 *  { move: "−25.1%", against: "vs the same period last year" }. */
export function checkMove(what: string): { move: string; against: string } | null {
  const rest = splitCheckText(what)[1];
  const m = rest.match(/^([−+-]?\d[\d.,]*\s?(?:%|pp)?)\s+against\s+([^(;]+?)\s*(?:\(|;|$)/);
  return m ? { move: m[1].replace(/\s+/g, ""), against: `vs ${m[2]}` } : null;
}

// ---------------------------------------------------------------- checks against the institution's data
export type VerdictKey = "confirms" | "contradicts" | "no_effect" | "insufficient_data" | "masked" | "not_yet" | "error";
export const VERDICT_LABEL: Record<VerdictKey, string> = {
  confirms: "Confirmed", contradicts: "Moved the other way", no_effect: "No effect seen", insufficient_data: "Not enough data",
  masked: "Hidden by a relief measure", not_yet: "Too early to check", error: "Couldn't check",
};
/** The colour of a check result: a confirmed impact is red when it's bad for you, green when it's good. */
export function verdictTone(v: VerdictKey, alert?: string | null, adverse?: boolean | null): Tone {
  if (v === "confirms") return alert === "opportunity" || adverse === false ? "green" : "red";
  if (v === "contradicts") return alert === "developing" || alert === "adverse" ? "amber" : "grey";
  if (v === "error") return "amber";
  if (v === "masked") return "blue";
  return "grey";
}
/** Why a check couldn't tell, in a few words (the server's reason sentence stays in the details). */
export function verdictWhy(why: string | null | undefined): string {
  if (!why) return "";
  if (/period to watch hasn't started/.test(why)) return "the period to watch hasn't started";
  if (/hasn't published enough/.test(why)) return "waiting for your figures";
  return why;
}

// ---------------------------------------------------------------- alerts
export type LevelKey = "warning" | "developing" | "adverse";
export const LEVEL_LABEL: Record<LevelKey, string> = { warning: "Early warning", developing: "Showing early signs", adverse: "Confirmed by your data" };
export const LEVEL_TONE: Record<LevelKey, Tone> = { warning: "amber", developing: "amber", adverse: "red" };
export const ALERT_STATUS: Record<string, [string, Tone]> = {
  new: ["Waiting for review", "red"], acknowledged: ["Acknowledged", "blue"], resolved: ["Resolved", "green"],
};
/** What each alert action means, in a few words. */
export const ACTION_MEANS = {
  ack: "Acknowledge: tell your team you're on it.",
  resolve: "Resolve: you've dealt with it; it leaves the review list.",
  reopen: "Reopen: put it back on the review list.",
};

// ---------------------------------------------------------------- monitors, series, findings
export const MONITOR_CHECK: Record<"fired" | "quiet" | "error", (n: number) => [string, Tone]> = {
  fired: n => [`Found ${n}`, "blue"], quiet: () => ["Nothing new", "grey"], error: () => ["Couldn't check (tries again soon)", "amber"],
};
export const MONITOR_STATUS: Record<string, [string, Tone]> = {
  draft: ["Draft", "grey"], submitted: ["Waiting for approval", "blue"], live: ["Live", "green"], paused: ["Paused", "amber"], retired: ["Retired", "grey"],
};
export const SERIES_STATE: Record<string, [string, Tone]> = {
  pending: ["Waiting for prices", "grey"], warming_up: ["Learning what's usual", "blue"], normal: ["Normal", "green"],
  moved: ["Unusual move", "red"], stale: ["Prices not updated", "amber"], paused: ["Paused", "grey"],
};
/** How often a monitor checks: "Every hour", "Every 15 minutes", "Once a day". */
export function everyText(min: number): string {
  if (min === 1440) return "Once a day";
  if (min === 60) return "Every hour";
  if (min % 60 === 0) return `Every ${min / 60} hours`;
  return `Every ${min} minutes`;
}
/** "flags a move 3× bigger than usual". */
export const ruleText = (k: number) => `flags a move ${k}× bigger than usual`;
export const FINDING_STATUS: Record<string, [string, Tone]> = {
  new: ["Waiting", "grey"], grouped: ["Being investigated", "blue"], linked: ["In an event", "green"], set_aside: ["No impact found", "grey"],
};
// why the investigation set a finding aside, in a few words
export const SET_ASIDE_REASON: Record<string, string> = {
  not_home_country: "not about a place where you operate",
  no_theme: "no economic link to your products",
  below_min_size: "the move is too small to matter",
  after_as_of: "came after the cut-off",
  merged_into_event: "joined another event",
  investigation_failed: "the investigation didn't finish",
};
export const setAsideReason = (reason?: string | null) => (reason ? SET_ASIDE_REASON[reason] ?? words(reason) : "");
/** Why an angle was considered and dropped for an event, in a few words. */
export const SCREENING: Record<string, string> = { rejected: "No clear link", cut_by_cap: "Less likely than the others" };
export const SOURCE: Record<string, { label: string; icon: string }> = {
  monitor: { label: "News monitor", icon: "news" }, timeseries: { label: "Market price", icon: "series" },
  radar: { label: "Radar", icon: "radar" }, studio: { label: "Scenario Studio", icon: "studio" },
};
export const sourceInfo = (s: string) => SOURCE[s] ?? { label: cap(words(s)), icon: "info" };

// ---------------------------------------------------------------- dates
const ymd = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE }).format(d);
/** A date-only value ("2026-10-19") as the day it names, shown at noon UTC so no time zone moves it. */
const asDay = (d: string) => (d.length === 10 ? `${d}T12:00:00Z` : d);
const yearOf = (d: string) => asDay(d).slice(0, 4);
/** "19 Oct – 30 Nov"; the years show only when they aren't this year's. */
export function dateRange(from: string, until: string, now = new Date()): string {
  const y = ymd(now).slice(0, 4);
  const a = day(asDay(from)), b = day(asDay(until));
  const ya = yearOf(from), yb = yearOf(until);
  if (ya === y && yb === y) return `${a} – ${b}`;
  return ya === yb ? `${a} – ${b} ${yb}` : `${a} ${ya} – ${b} ${yb}`;
}
/** A date as a day: "18 Oct". */
export const onDay = (d: string) => day(asDay(d));
/** "today", "tomorrow", "in 3 days", "2 days ago". */
export function relDay(d: string, now = new Date()): string {
  const a = Date.parse(ymd(new Date(asDay(d))) + "T00:00:00Z"), b = Date.parse(ymd(now) + "T00:00:00Z");
  const n = Math.round((a - b) / 86400_000);
  if (n === 0) return "today";
  if (n === 1) return "tomorrow";
  if (n === -1) return "yesterday";
  return n > 0 ? `in ${n} days` : `${-n} days ago`;
}
/** "Thu 15 Oct, 13:12". */
export function longWhen(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: TIME_ZONE, weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false })
    .format(new Date(iso)).replace(/^(\w+) (\d+ \w+), /, "$1 $2, ").replace(/^(\w+), /, "$1 ");
}
/** The earliest of some dates ("2026-10-18"), or null. */
export const earliest = (ds: (string | null | undefined)[]) => ds.filter((x): x is string => !!x).sort()[0] ?? null;

/** "1 product", "6 products". */
export const count = (n: number, one: string, many?: string) => `${n} ${n === 1 ? one : many ?? one + "s"}`;
/** Names in a sentence: "A", "A and B", "A, B and 2 more". */
export function listText(xs: string[], max = 3): string {
  if (xs.length <= 1) return xs[0] ?? "";
  if (xs.length <= max) return `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`;
  return `${xs.slice(0, max - 1).join(", ")} and ${xs.length - max + 1} more`;
}
