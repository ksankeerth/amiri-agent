// Words and small decisions for the Data connection page: the three sources, the sample's conditions, the five-step
// strip, and the check's result in a person's words. Plain logic, tested by dataWords.test.ts.
import type { CheckState, CheckStatus, ConformanceCheck, CoverageProduct } from "../../api/connect";

export type Kind = "bank" | "insurer";
export type SourceId = "bank" | "insurer" | "file";

/** The cards of step 1 (decision D1: two samples and a file; nothing else). */
export const SOURCES: { id: SourceId; title: string; line: string }[] = [
  { id: "bank", title: "The sample bank", line: "Shaped by your profile: made-up figures for your products" },
  { id: "insurer", title: "The sample insurer", line: "A bundled insurer: made-up figures for an insurer" },
  { id: "file", title: "Import a JSON file", line: "Your institution's own figures, as a file in the Metrics Spec format" },
];

/** What the server can serve as a sample: the installation's own kind only. Why the other card is off. */
export function sampleOff(id: SourceId, kind: Kind): string | null {
  if (id === "file" || id === kind) return null;
  return id === "insurer" ? "Only for an insurer: this institution is a bank." : "Only for a bank: this institution is an insurer.";
}

// ---------------------------------------------------------------- conditions
export interface Condition { id: string; label: string; kinds: Kind[]; note: string; startDaysAgo: number }

/** The data conditions a sample can show (the server's presets, app/mockinst/conditions.py; same ids and order). */
export const CONDITIONS: Condition[] = [
  { id: "currency_slide_importers", label: "A currency slide hits importers", kinds: ["bank"], startDaysAgo: 21,
    note: "Importers open fewer letters of credit and their facility use rises." },
  { id: "remittances_fall", label: "Remittances fall", kinds: ["bank"], startDaysAgo: 21,
    note: "Inward remittances fall from the start." },
  { id: "floods", label: "Floods, then relief", kinds: ["bank", "insurer"], startDaysAgo: 28,
    note: "Flood claims jump; for a bank, a repayment moratorium follows." },
  { id: "late_revision", label: "A late revision", kinds: ["bank", "insurer"], startDaysAgo: 10,
    note: "Two months were first published too high, then revised down." },
  { id: "dominant_obligor", label: "One customer drives a move", kinds: ["bank"], startDaysAgo: 21,
    note: "Facility use rises, almost all of it from one customer." },
  { id: "few_customers", label: "Too few customers in a product", kinds: ["bank", "insurer"], startDaysAgo: 21,
    note: "The smallest product is so small its numbers are hidden." },
  { id: "reporting_lag", label: "Late publication", kinds: ["bank", "insurer"], startDaysAgo: 21,
    note: "Every metric is published later than usual." },
];
export const conditionsFor = (kind: Kind) => CONDITIONS.filter(c => c.kinds.includes(kind));
/** What the sample plants when nothing is chosen (the demo's own). */
export const defaultOn = (kind: Kind): string[] => (kind === "bank" ? ["remittances_fall"] : ["floods"]);
/** ?scenario= for the example file: the ids in order, or "none". Ids the kind doesn't have are dropped. */
export function scenarioParam(kind: Kind, on: string[]): string {
  const ids = conditionsFor(kind).filter(c => on.includes(c.id)).map(c => c.id);
  return ids.length ? ids.join(",") : "none";
}
export const startWords = (days: number) => `Starts ${days} days ago`;
/** The first two stay in view; the rest sit under "N more conditions". */
export const CONDITIONS_SHOWN = 2;
export function moreConditions(kind: Kind, on: string[]): { count: number; on: number } {
  const rest = conditionsFor(kind).slice(CONDITIONS_SHOWN);
  return { count: rest.length, on: rest.filter(c => on.includes(c.id)).length };
}
export const moreLine = (m: { count: number; on: number }) => `${m.count} more condition${m.count === 1 ? "" : "s"}, ${m.on ? `${m.on} on` : "off"}`;

// ---------------------------------------------------------------- where the data came from
/** The sample's own "about" line starts like this (server: mockinst/export.py); anything else is somebody's file. */
export function sourceOf(imp: { about: string | null } | null | undefined): SourceId | null {
  if (!imp) return null;
  const m = /^Synthetic data from AMIRI Agent's sample (bank|insurer)/.exec(imp.about ?? "");
  return m ? (m[1] as Kind) : "file";
}
/** The conditions a sample was made with, read back from its "about" line ("Planted: Remittances fall (from 2026-11-04, 6); ….").
 *  null when the line doesn't say (a file of your own). */
export function plantedIds(about: string | null | undefined, kind: Kind): string[] | null {
  if (!about || !/^Synthetic data from AMIRI Agent's sample/.test(about)) return null;
  if (/Nothing planted\.$/.test(about)) return [];
  const at = about.indexOf("Planted: ");
  if (at < 0) return null;
  const tail = about.slice(at);
  return conditionsFor(kind).filter(c => tail.includes(`${c.label} (from `)).map(c => c.id);
}
export const sourceName = (s: SourceId | null) => (s === "bank" ? "Sample bank" : s === "insurer" ? "Sample insurer" : s === "file" ? "JSON file" : "Not chosen yet");

// ---------------------------------------------------------------- the five-step strip
export interface StepFacts {
  source: SourceId | null; fileName: string | null;
  /** conditions on in the sample just imported (from its about line) are not known; the page's own choice is shown */
  conditionsOn: number | null;
  configured: boolean;
  check: { status: CheckStatus; current: boolean } | null;
  approved: { by: string; when: string } | null;
  validationOn: boolean; validationAllowed: boolean;
}
export interface StripStep { n: number; name: string; note: string; done: boolean; current: boolean }

export const CHECK_WORDS: Record<CheckStatus, string> = { ready: "Ready", ready_with_gaps: "Ready, with gaps", not_ready: "Not ready" };

export function stepStrip(f: StepFacts): StripStep[] {
  const checked = !!f.check && f.check.current;
  const steps = [
    { name: "Source", note: f.source === "file" && f.fileName ? f.fileName : sourceName(f.source), done: f.configured },
    { name: "Conditions", note: f.source === "file" ? "Not used for a file" : f.conditionsOn == null ? "Optional" : f.conditionsOn ? `${f.conditionsOn} on` : "None on", done: f.configured },
    { name: "Check", note: !f.configured ? "Not yet" : !f.check ? "Not checked yet" : checked ? CHECK_WORDS[f.check!.status] : "Out of date", done: checked },
    { name: "Approve", note: f.approved ? `Approved by ${f.approved.by}, ${f.approved.when}` : checked && f.check!.status === "not_ready" ? "Can't be approved yet" : "Not approved", done: !!f.approved },
    { name: "Use it", note: f.validationOn ? "Checks on" : f.approved ? "Checks off" : "Checks off until approved", done: f.validationOn },
  ];
  const first = steps.findIndex(s => !s.done);
  const current = first === -1 ? steps.length - 1 : first;
  return steps.map((s, i) => ({ n: i + 1, ...s, current: i === current }));
}

// ---------------------------------------------------------------- the check, in words
/** Metric keys the check reports ("late_30_plus") as a person would say them, when the Spec's name isn't to hand. */
export function metricLabel(key: string, names?: Map<string, string>): string {
  const n = names?.get(key);
  if (n) return n;
  const s = key.replace(/_/g, " ");
  return s[0].toUpperCase() + s.slice(1);
}

export interface Counts { full: number; partial: number; none: number }
export const coverageCounts = (ps: Pick<CoverageProduct, "status">[]): Counts => ({
  full: ps.filter(p => p.status === "full").length, partial: ps.filter(p => p.status === "partial").length, none: ps.filter(p => p.status === "none").length,
});

/** "11 of 12 products can be checked, 2 of them in part" */
export function coverageHeadline(ps: Pick<CoverageProduct, "status">[]): string {
  const c = coverageCounts(ps);
  const some = c.full + c.partial;
  const base = `${some} of ${ps.length} product${ps.length === 1 ? "" : "s"} can be checked`;
  return c.partial ? `${base}, ${c.partial} of them in part` : some === 0 ? "None of the products can be checked yet" : base;
}

/** The product row's right side: "5 of 6 · Prepayments weekly, not daily" or "No catalog product matches". */
export function productDetail(p: CoverageProduct, names?: Map<string, string>): string {
  if (p.status === "none" && !p.catalog_product_id) return "No catalog product matches";
  const have = p.required.length - p.missing.length;
  const bits = [
    ...p.missing.map(k => `missing “${metricLabel(k, names)}”`),
    ...p.reduced.map(r => `${metricLabel(r.key, names)} ${r.grain_served}, not ${r.grain_spec}`),
  ];
  return [`${have} of ${p.required.length}`, ...bits].join(" · ");
}

export type Tone = "good" | "unusual" | "bad" | "neutral";
/** A conformance check's pill: a failed check is a gap unless the whole check is not ready. */
export function checkPill(s: CheckState, overall: CheckStatus): { tone: Tone; label: string } {
  if (s === "pass") return { tone: "good", label: "Pass" };
  if (s === "fail") return overall === "not_ready" ? { tone: "bad", label: "Fail" } : { tone: "unusual", label: "Gap" };
  return s === "not_applicable" ? { tone: "neutral", label: "N/A" } : { tone: "neutral", label: "Not run" };
}
/** "Conformance · 4 pass, 1 gap" */
export function conformanceLine(checks: Pick<ConformanceCheck, "status">[], overall: CheckStatus): string {
  const pass = checks.filter(c => c.status === "pass").length;
  const fail = checks.filter(c => c.status === "fail").length;
  const parts = [`${pass} pass`];
  if (fail) parts.push(`${fail} ${overall === "not_ready" ? "failed" : fail === 1 ? "gap" : "gaps"}`);
  return `Conformance · ${parts.join(", ")}`;
}
export const statusTone = (s: CheckStatus): Tone => (s === "ready" ? "good" : s === "ready_with_gaps" ? "unusual" : "bad");

/** The line under the approval: why checks can't be switched on, or null when they can. */
export function validationWhy(f: { validation_allowed: boolean; approved: boolean }): string | null {
  if (!f.validation_allowed) return "Switched off on this server.";
  if (!f.approved) return "Approve a ready connection first.";
  return null;
}

/** Why Approve is off, or null when it can be pressed. */
export function approveWhy(f: { check: { status: CheckStatus; current: boolean } | null; approved: boolean }): string | null {
  if (f.approved) return "Already approved.";
  if (!f.check) return "Check the data first.";
  if (!f.check.current) return "The data changed after the last check: check it again.";
  if (f.check.status === "not_ready") return "Data that isn't ready can't be approved. Fix what the check found, import again, and check again.";
  return null;
}
