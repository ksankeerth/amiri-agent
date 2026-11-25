// The Institution page, in words and rules (board 08; states: board 15 section C): which part of the profile is open, what the
// section counters and the note under them say, what the header says, how a proposal from the setup agent reads and which
// state it is in, how a change history is grouped, and the words of an edit conflict. No React and no imports of app code
// beyond types and the two word modules, so `npm test` runs it.
import type { HistoryRow, Institution, Item, Readiness, SectionName } from "../../api/institutions";
import type { Change, Proposal } from "../../api/assistant";
import { countOf, fieldWord, itemName, SECTION_ONE, valueText } from "../../components/setupFlow.ts";
import { plural } from "../../format.ts";
import { cap, productTypeLabel, words } from "../../plain.ts";

// ---------------------------------------------------------------- which part is open

/** What the page can show: the overview (map and what is open), one section of the profile, the change history, or what the agents see. */
export type View = "overview" | SectionName | "history" | "agents";

/** The nine sections, in the order of the board's counter strip, with the name the strip gives each. */
export const SECTION_STRIP: [SectionName, string][] = [
  ["footprint", "Footprint"], ["watch-places", "Places to watch"], ["segments", "Customer groups"], ["products", "Products"],
  ["flows", "Flows"], ["regulators", "Regulators"], ["rivals", "Rivals"], ["counterparties", "Firms you depend on"], ["risk-exposures", "Risks"],
];
const SECTION_SET = new Set<string>(SECTION_STRIP.map(([k]) => k));
export const isSection = (v: string): v is SectionName => SECTION_SET.has(v);

// The setup agent's topics name an older set of tabs (customers, rules, risks); the address and the chat still use them.
const LEGACY: Record<string, View> = { customers: "products", rules: "regulators", risks: "risk-exposures" };

/** The page's part for the address's last segment. `null` for something that is not a part (the page goes to the overview). */
export function viewOf(param: string | undefined): View | null {
  if (!param || param === "overview") return "overview";
  if (param === "history" || param === "agents") return param;
  if (isSection(param)) return param;
  return LEGACY[param] ?? null;
}

/** Where a part lives: the overview is the bare address. */
export const viewPath = (v: View): string => (v === "overview" ? "/institution" : `/institution/${v}`);

/** The tab the setup agent's topics are filed under for a part (so the chat follows the page). */
export function topicTab(v: View): string {
  switch (v) {
    case "footprint": case "watch-places": case "flows": return "footprint";
    case "segments": case "products": return "customers";
    case "regulators": return "rules";
    case "rivals": case "counterparties": return "rivals";
    case "risk-exposures": return "risks";
    default: return v;
  }
}

/** The part a setup-agent topic switches to (its tab, in the older names). */
export const viewForTopic = (tab: string): View => viewOf(tab) ?? "overview";

/** The part's name for the tab title and the breadcrumb. */
export function viewName(v: View): string {
  if (v === "overview") return "Overview";
  if (v === "history") return "History";
  if (v === "agents") return "What the agents see";
  return SECTION_STRIP.find(([k]) => k === v)![1];
}

// ---------------------------------------------------------------- the counters and their note

/** The check that says whether a section has what it needs. */
const CHECK_OF: Partial<Record<SectionName, string>> = {
  footprint: "footprint_home", segments: "segments", products: "products", flows: "flows", regulators: "regulators", rivals: "rivals", "risk-exposures": "risk_exposures",
};
const EMPTY_NAME: Partial<Record<SectionName, string>> = {
  footprint: "footprint", segments: "customer groups", products: "products", flows: "flows", regulators: "regulators", rivals: "rivals", "risk-exposures": "risks",
};

/** An empty section the profile still needs: "bad" when go-live needs it, "unusual" when it is only recommended. */
export function countTone(section: SectionName, count: number, checks: Readiness["checks"]): "bad" | "unusual" | undefined {
  if (count > 0) return undefined;
  const c = checks.find(x => x.id === CHECK_OF[section]);
  if (!c || c.ok) return undefined;
  return c.level === "required" ? "bad" : "unusual";
}

const list = (xs: string[]) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);

/** The line under the counters: "Flows, rivals and risks are empty. Recommended, not required: …". Null when nothing is empty. */
export function emptyNote(counts: Record<SectionName, number>, checks: Readiness["checks"]): { text: string; required: boolean } | null {
  const empty = (tone: "bad" | "unusual") => SECTION_STRIP.map(([k]) => k).filter(k => countTone(k, counts[k] ?? 0, checks) === tone);
  const req = empty("bad"), rec = empty("unusual");
  const say = (xs: SectionName[]) => { const t = list(xs.map(k => EMPTY_NAME[k]!)); return `${cap(t)} ${xs.length === 1 && !t.endsWith("s") ? "is" : "are"} empty.`; };
  const parts: string[] = [];
  if (req.length) parts.push(`${say(req)} Required before this profile can go live.`);
  if (rec.length) parts.push(`${say(rec)} Recommended, not required: they sharpen what Amiri Agent watches.`);
  return parts.length ? { text: parts.join(" "), required: req.length > 0 } : null;
}

// ---------------------------------------------------------------- the header

/** "Commercial bank", "Takaful insurer", "Bank (Islamic)". */
export const typeWords = (i: Pick<Institution, "subtype" | "institution_type" | "islamic">): string =>
  `${i.subtype ? `${cap(words(i.subtype))} ${i.institution_type === "bank" ? "bank" : "insurer"}` : i.institution_type === "bank" ? "Bank" : "Insurer"}${i.islamic ? " (Islamic)" : ""}`;

/** "Commercial bank · United States · USD · Central time · profile version 7". */
export const subLine = (i: Institution, home: string, zone: string): string =>
  [typeWords(i), home, i.base_currency, `${zone} time`, `profile version ${i.profile_version}`].join(" · ");

/** The profile's state as a pill: the word, and its tone (the word carries the meaning). */
export function statusLook(status: string): { word: string; tone: "good" | "neutral"; hint: string } {
  if (status === "active") return { word: "Active", tone: "good", hint: "Amiri Agent uses this profile" };
  if (status === "archived") return { word: "Archived", tone: "neutral", hint: "Amiri Agent does not use this profile, and it can't be changed until it is restored" };
  return { word: "Setting up", tone: "neutral", hint: "Amiri Agent does not use it until it is activated" };
}

/** The number on the Guided setup button: what is still to do (required first, then recommended). 0: no number. */
export const toReview = (r: Pick<Readiness, "missing_required" | "open_recommendations">): number => r.missing_required + r.open_recommendations;

// ---------------------------------------------------------------- products and money

/** A book as the board writes it: "9.2 bn", "850 m", "12,000". */
export function bookText(amount: number): string {
  if (amount >= 1e9) return `${(amount / 1e9).toFixed(1)} bn`;
  if (amount >= 1e6) return `${Math.round(amount / 1e6).toLocaleString("en-US")} m`;
  return Math.round(amount).toLocaleString("en-US");
}

/** All the books added up when they are in one currency: { currency: "USD", amount, text: "USD 34.8 bn" }. Null when none, or mixed. */
export function booksTotal(products: Item[]): { currency: string; amount: number; text: string } | null {
  const books = products.map(p => p.book_size).filter((b): b is { amount: number; currency: string } => !!b && typeof b.amount === "number");
  if (!books.length || new Set(books.map(b => b.currency)).size !== 1) return null;
  const amount = books.reduce((s, b) => s + b.amount, 0);
  return { currency: books[0].currency, amount, text: `${books[0].currency} ${bookText(amount)}` };
}

/** The Book column's heading: "Book, USD", or just "Book" when the products' books are in different currencies. */
export function bookHeading(products: Item[]): string {
  const cur = new Set(products.map(p => p.book_size?.currency).filter(Boolean));
  return cur.size === 1 ? `Book, ${[...cur][0]}` : "Book";
}

/** One book in its row: "9.2 bn" (the heading carries the currency), or "USD 9.2 bn" when the currencies differ. */
export const bookCell = (p: Item, single: boolean): string => (p.book_size ? `${single ? "" : `${p.book_size.currency} `}${bookText(p.book_size.amount)}` : "—");

/** The line about products that aren't linked to the institution's data, or null when they all are. */
export function unlinkedNote(items: Item[]): { lead: string; rest: string } | null {
  const n = items.filter(p => !p.data?.source_id).length;
  if (!n) return null;
  if (n === items.length) return items.length === 1
    ? { lead: "This product is not linked to your institution's data yet", rest: ", so its checks can't use your numbers." }
    : { lead: `None of the ${items.length} is linked to your institution's data yet`, rest: ", so their checks can't use your numbers." };
  return { lead: `${n} of the ${items.length} ${n === 1 ? "is" : "are"} not linked to your institution's data yet`, rest: `, so ${n === 1 ? "its" : "their"} checks can't use your numbers.` };
}

// ---------------------------------------------------------------- what is still open (the readiness checks)

const firstNumber = (m: string, re: RegExp) => { const x = re.exec(m); return x ? Number(x[1]) : null; };
export interface OpenWords { title: string; sub?: string; action: string; to?: string }

/** A check that isn't done, in plain words, with its one action. `to` is missing when the action is "Edit details". */
export function openWords(c: Readiness["checks"][number]): OpenWords {
  switch (c.id) {
    case "regulators": {
      const n = firstNumber(c.message, /(\d+) more suggested/);
      return { title: n ? `Review the ${n} suggested regulators` : "Review the suggested regulators", sub: "from the rule table", action: "Review", to: viewPath("regulators") };
    }
    case "risk_exposures": {
      const n = firstNumber(c.message, /finder has (\d+) more/);
      return { title: "Review what the risk finder found", sub: n ? `${plural(n, "more known risk")} to look at` : undefined, action: "Review", to: viewPath("risk-exposures") };
    }
    case "flows": return { title: "Review the suggested money flows", sub: c.message, action: "Review", to: viewPath("flows") };
    case "product_data": {
      const m = /(\d+) of (\d+)/.exec(c.message);
      return { title: "Link products to your institution's data", sub: m ? `${m[1]} of ${m[2]} linked: checks need each product's numbers` : c.fix, action: "Link", to: viewPath("products") };
    }
    default: {
      const inst = c.section === "institution";
      return { title: c.fix || c.message, sub: c.message, action: inst ? "Edit details" : "Fix", to: inst ? undefined : viewPath(isSection(c.section) ? c.section : "overview") };
    }
  }
}

const LEVEL_ORDER: Record<string, number> = { required: 0, recommended: 1, info: 2 };
/** The checks as board 15 draws them: what is open first (required, then recommended), what is done last. Each says its state in a
 *  shape and a word, never colour alone. */
export function readinessRows(checks: Readiness["checks"]): { id: string; text: string; fix: string; ok: boolean; level: string; shape: string; word: string; to?: string; edit: boolean }[] {
  const rank = (c: Readiness["checks"][number]) => (c.ok ? 3 : LEVEL_ORDER[c.level] ?? 2);
  return [...checks].sort((a, b) => rank(a) - rank(b)).map(c => {
    const w = openWords(c);
    return { id: c.id, text: c.message, fix: c.fix, ok: c.ok, level: c.level, edit: !c.ok && c.section === "institution", to: !c.ok ? w.to : undefined,
      shape: c.ok ? "✓" : c.level === "required" ? "○" : "◐", word: c.ok ? "Done" : c.level === "required" ? "Required" : c.level === "recommended" ? "Recommended" : "Good to have" };
  });
}

/** "2 required items before you can go live", or the line that says it can. */
export function liveWords(r: Pick<Readiness, "missing_required" | "open_recommendations" | "ready">): string {
  if (!r.ready) return `${plural(r.missing_required, "required item")} before you can go live`;
  return r.open_recommendations ? `Everything required is there; ${plural(r.open_recommendations, "recommendation")} still open` : "Everything is there";
}

// ---------------------------------------------------------------- the setup agent's proposals

export interface ChangeRow {
  op: "Add" | "Change" | "Remove";
  /** "Customer group", "Product". */
  what: string;
  name: string;
  /** "term loan", read after the name. */
  detail?: string;
  /** What an update changes: the field, before, after. */
  fields: { label: string; before: string; after: string }[];
}

const DETAIL: Partial<Record<SectionName, (d: Record<string, any>) => string | undefined>> = {
  products: d => (d.product_type ? productTypeLabel(d.product_type).toLowerCase() : undefined),
  regulators: d => (d.area ? cap(words(d.area)) : undefined),
  rivals: d => (d.type ? words(d.type) : undefined),
  segments: d => (d.kind ? words(d.kind) : undefined),
  counterparties: d => (d.kind ? words(d.kind) : undefined),
};

/** A proposal's changes as the card lists them: "Add · Customer group · Solar and wind developers". */
export function changeRows(changes: Change[], names: Record<string, string | null> = {}): ChangeRow[] {
  return changes.map(c => {
    const d = c.after ?? c.before ?? {};
    const sec = c.section as SectionName;
    const what = c.section === "institution" ? "Institution details" : cap(SECTION_ONE[c.section] ?? words(c.section));
    const name = c.section === "institution" ? "" : itemName(c.section, c.after ?? c.before, names) ?? (c.id ? cap(words(String(c.id))) : "");
    const fields = c.op === "update" && c.after ? Object.keys(c.after).map(k => ({ label: fieldWord(k), before: valueText(c.before?.[k]), after: valueText(c.after?.[k]) })) : [];
    return { op: c.op === "create" ? "Add" : c.op === "delete" ? "Remove" : "Change", what, name, fields, detail: c.op === "create" ? DETAIL[sec]?.(d) : undefined };
  });
}

export type ProposalKind = "waiting" | "cant" | "expired" | "applied" | "rejected" | "failed";
/** Which of the card's states a proposal is in, and the small caps line that says so (board 08 and board 15 section C). */
export function proposalLook(p: Pick<Proposal, "status" | "fits">): { kind: ProposalKind; cap: string } {
  switch (p.status) {
    case "pending": return p.fits === false ? { kind: "cant", cap: "Proposed change · can't apply" } : { kind: "waiting", cap: "Proposed change · waits for you" };
    case "expired": return { kind: "expired", cap: "Proposed change · expired" };
    case "confirmed": return { kind: "applied", cap: "Applied" };
    case "rejected": return { kind: "rejected", cap: "Not applied" };
    default: return { kind: "failed", cap: "Couldn't apply" };
  }
}

/** Why an expired proposal expired: the profile moved on (board 15), or it simply waited too long. */
export function expiredWhy(p: Pick<Proposal, "base_profile_version">, profileVersion: number | null): string {
  return p.base_profile_version != null && profileVersion != null && p.base_profile_version !== profileVersion
    ? "The profile changed since." : "It waited too long to be applied.";
}

/** The reason a proposal can't be applied, in one sentence. */
export const cantApplyWhy = (p: Pick<Proposal, "fit_errors">): string =>
  p.fit_errors.length ? p.fit_errors.map(e => e.message).join(" ") : "The profile changed since, and this no longer fits it. Ask the agent to redo it.";

/** "2 places to watch and 1 risk": what a proposal removes. */
export function removesText(changes: Change[]): string {
  const by = new Map<string, number>();
  for (const c of changes) if (c.op === "delete") by.set(c.section, (by.get(c.section) ?? 0) + 1);
  return list([...by].map(([s, n]) => countOf(s, n)));
}

// ---------------------------------------------------------------- the change history

export const SOURCE_WORDS: Record<string, string> = { form: "a form", assistant: "the Setup agent", setup: "guided setup", import: "an import", system: "the system" };
/** "Dilan · via a form", "System · via the system". */
export function byWords(actor: string, source: string, person: (a: string) => string): string {
  return `${actor === "anonymous" || !actor ? "System" : person(actor)} · via ${SOURCE_WORDS[source] ?? source}`;
}

/** One save is one row: the rows of a batch (an import, an applied proposal) together, in the order they first appear. */
export function groupBatches<T extends Pick<HistoryRow, "batch_id">>(rows: T[]): T[][] {
  const out: T[][] = [];
  const at = new Map<string, T[]>();
  for (const r of rows) {
    let b = at.get(r.batch_id);
    if (!b) { b = []; at.set(r.batch_id, b); out.push(b); }
    b.push(r);
  }
  return out;
}

/** "2 rivals, 1 product": what a batch of changes touched. */
export function batchSummary(b: Pick<HistoryRow, "section">[]): string {
  const by = new Map<string, number>();
  for (const r of b) by.set(r.section, (by.get(r.section) ?? 0) + 1);
  return [...by].map(([s, n]) => countOf(s, n)).join(", ");
}

// ---------------------------------------------------------------- what the agents see

export const THEME_WORDS: Record<string, string> = {
  rates: "Interest rates", sector: "Banking and insurance", macro: "The economy", fx: "Exchange rates", commodities: "Commodities (oil, gold, food)",
  remittance: "Remittances", prices: "Prices and inflation", regulation: "Rules and regulators", disaster: "Disasters", trust: "Trust in banks",
  competitor: "Rivals' moves", markets: "Share and bond markets",
};
const WHY_TAG: Record<string, string> = { footprint: "Footprint", "place to watch": "Place to watch", flow: "Flow", risk: "Risk" };

/** "flow: remittances in with LK" → ["Flow", "Remittances in with Sri Lanka"]. */
export function whyParts(w: string, names: Record<string, string | null>): [tag: string, text: string] {
  const m = /^(footprint|place to watch|flow|risk)\b:?\s*(.*)$/i.exec(w);
  const tag = m ? WHY_TAG[m[1].toLowerCase()] : "";
  let text = (m ? m[2] : w).replace(/\b([A-Z]{2}(?:-\w+)?)\b/g, c => names[c] ?? c);
  if (tag === "Footprint") text = text.replace(/^\((.*)\)$/, "$1");
  return [tag, cap(text)];
}

// ---------------------------------------------------------------- an edit that someone else got to first

/** The institutions API answers a stale If-Match with 409 conflict (a batch with if_version) or 412 (the header on one item). */
export function isStale(e: unknown): boolean {
  const p = typeof e === "object" && e !== null ? (e as { status?: unknown; code?: unknown }) : null;
  return !!p && (p.status === 412 || (p.status === 409 && p.code === "conflict"));
}

/** What the person typed, as text for the clipboard: "My changes to Capital-Call Lines:\nOwner: Fund banking". */
export function changesText(name: string, changes: Record<string, unknown>): string {
  const lines = Object.entries(changes).map(([k, v]) => `${fieldWord(k)}: ${valueText(v)}`);
  return `My changes to ${name || "this"}:\n${lines.join("\n") || "(none)"}`;
}
