// The guided setup, in words and rules (P15b): the steps and their order, what each step needs from the go-live checks, how a step's
// state reads (a shape and a word, never colour alone), where a failed check's "Fix" goes, and what the go-live confirmation says.
// No React and no imports of app code beyond types, so `npm test` runs it.
import type { Readiness } from "../../api/institutions";
import { plural } from "../../format.ts";

export interface WizardStep { key: string; /** In the step list. */ label: string; /** The page's heading. */ title: string; /** One line: what to do here. */ lede: string }

/** The ten steps, in order. The Setup agent's tracks name the same keys as their `setup_step`. */
export const STEPS: readonly WizardStep[] = [
  { key: "institution", label: "Institution", title: "Who you are", lede: "Check the basics AMIRI Agent starts from. Change them any time with Edit details." },
  { key: "where", label: "Where", title: "Where you operate", lede: "Add the countries, states or provinces where you operate. The first one should be your home country." },
  { key: "customers", label: "Customers", title: "Who your customers are", lede: "Pick the customer groups you serve, then say where each is concentrated and how your data identifies it." },
  { key: "products", label: "Products", title: "What you sell, and to whom", lede: "Pick what you sell, then say which customer groups each product is for." },
  { key: "flows", label: "Flows", title: "Money and goods moving with places abroad", lede: "Money and goods that move between your footprint and places abroad. Each figure shows where it comes from." },
  { key: "rules", label: "Rules", title: "Regulators and rules that reach you", lede: "Regulators and rules that reach you, from your home country, where you operate and the currencies you settle in." },
  { key: "rivals", label: "Rivals", title: "Rivals and firms you depend on", lede: "Firms you compete with, and firms you depend on to do business." },
  { key: "risks", label: "Risks", title: "Risks that meet what you depend on", lede: "Known hazards that meet your places, customers, flows and sea routes." },
  { key: "monitors", label: "Monitors", title: "News to watch for what you depend on", lede: "Watch the news for what your profile says matters. Optional: you can go live without any." },
  { key: "review", label: "Review", title: "Check and go live", lede: "Check what is still open, then go live. You can keep changing the profile afterwards." },
];

/** Where an address's step is in the list: no step named is the first one; a name that isn't a step is -1. */
export function stepIndex(param: string | undefined): number {
  return param ? STEPS.findIndex(s => s.key === param) : 0;
}

export type StepState = "done" | "partial" | "required" | "open";

// What each step needs from the go-live checks (by check id): the required ones must be done; the recommended ones finish the step.
const REQUIRED: Record<string, string[]> = { institution: ["identity"], where: ["footprint_home"], customers: ["segments"], products: ["products"] };
const RECOMMENDED: Record<string, string[]> = { customers: ["segment_mapping"], products: ["product_segments"], flows: ["flows"], rules: ["regulators"], rivals: ["rivals"], risks: ["risk_exposures"] };

/** Each step's state from the readiness checks: done, done but a recommended part is open, required and not done, or not started. The last
 *  step is "done" once the profile can go live. */
export function stepStates(r: Pick<Readiness, "ready" | "checks">): StepState[] {
  const ok = (ids: string[] | undefined) => (ids ?? []).every(id => r.checks.find(c => c.id === id)?.ok);
  return STEPS.map(({ key }) => {
    if (key === "review") return r.ready ? "done" : "open";
    if (!ok(REQUIRED[key])) return REQUIRED[key] ? "required" : "open";
    return ok(RECOMMENDED[key]) ? "done" : "partial";
  });
}

/** The shape in the step list and the word that goes with it. The review step says Ready or Not ready. */
export function stepMark(state: StepState, key: string): { shape: string; word: string } {
  if (key === "review") return state === "done" ? { shape: "✓", word: "Ready" } : { shape: "", word: "Not ready" };
  switch (state) {
    case "done": return { shape: "✓", word: "Done" };
    case "partial": return { shape: "◐", word: "Part still open" };
    case "required": return { shape: "◆", word: "Required" };
    default: return { shape: "", word: "Not started" };
  }
}

/** The step's whole name for a screen reader: "Step 3, Customers: required, not done yet". */
export function stepAria(n: number, label: string, state: StepState, key: string): string {
  const says = key === "review" ? (state === "done" ? "ready to go live" : "not ready to go live")
    : { done: "done", partial: "done, a recommended part is still open", required: "required, not done yet", open: "not started" }[state];
  return `Step ${n}, ${label}: ${says}`;
}

/** "3 of 10 steps done". */
export const progressLine = (states: StepState[]): string => `${states.filter(s => s === "done").length} of ${states.length} steps done`;

/** Where a failed check's Fix goes: the step that holds its section. The institution's own details are edited in a dialog (null). */
export function fixStep(section: string): string | null {
  const to: Record<string, string> = {
    footprint: "where", "watch-places": "where", segments: "customers", products: "products", flows: "flows", regulators: "rules",
    rivals: "rivals", counterparties: "rivals", "risk-exposures": "risks",
  };
  return to[section] ?? null;
}

/** "3 of 4 required parts done". */
export function requiredLine(checks: Pick<Readiness["checks"][number], "level" | "ok">[]): string {
  const req = checks.filter(c => c.level === "required");
  return `${req.filter(c => c.ok).length} of ${req.length} required parts done`;
}

/** Why Go live can't be pressed yet, in one line; "" when it can. */
export function whyNotLive(r: Pick<Readiness, "ready" | "missing_required">): string {
  return r.ready ? "" : `${plural(r.missing_required, "required part")} still missing.`;
}

/** What the go-live confirmation says about what is left open. */
export function goLiveNote(r: Pick<Readiness, "open_recommendations">): string {
  return r.open_recommendations
    ? `${plural(r.open_recommendations, "recommended part")} still open. You can finish ${r.open_recommendations === 1 ? "it" : "them"} later.`
    : "Everything required and recommended is there.";
}
