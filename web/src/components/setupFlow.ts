// The setup chat's first-setup order: where ← and → go, which track comes next once one is applied,
// and the short message that moves the chat on (an ordinary turn with the track picked, so the agent opens
// the next track with its first question and the notes kept for it).

export interface FlowTrack { track: string; label: string; order: number | null; read_only: boolean; shown: boolean; status?: string }

/** The tracks of first setup, in their order. */
export const setupOrder = <T extends FlowTrack>(ts: T[]): T[] =>
  ts.filter(t => t.order !== null && !t.read_only && t.shown).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

/** The track before (-1) or after (1) `from` in first setup; null at either end. From a track outside it
 *  (a question, the history), → goes to the first one not yet concluded. */
export function stepFrom<T extends FlowTrack>(ts: T[], from: string | null, dir: 1 | -1): T | null {
  const o = setupOrder(ts);
  const i = o.findIndex(t => t.track === from);
  if (i < 0) return dir === 1 ? o.find(t => t.status !== "concluded") ?? null : null;
  return o[i + dir] ?? null;
}

/** Once `done` is applied: the next track of first setup that isn't concluded yet; null when none is left. */
export function nextOpen<T extends FlowTrack>(ts: T[], done: string): T | null {
  const o = setupOrder(ts);
  const i = o.findIndex(t => t.track === done);
  return i < 0 ? null : o.slice(i + 1).find(t => t.status !== "concluded") ?? null;
}

/** Whether the agent's latest question still waits for its answer: nothing typed or picked since it was asked.
 *  A question is one with options, or a reply of the agent's that ends by asking ("…any places to watch?"). */
export function waitingForAnswer(messages: { role: string; kind: string; content?: Record<string, any> }[]): boolean {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role === "user" && (m.kind === "text" || m.kind === "answer")) return false;
    if (m.kind === "question") return true;
    if (m.role === "assistant" && m.kind === "text" && typeof m.content?.text === "string" && m.content.text.trim().endsWith("?")) return true;
  }
  return false;
}

/** The message that moves the chat on to a track; shown as a marker, not as something the person typed. */
export const continueText = (label: string) => `Continue with ${label.toLowerCase()}.`;

/** The track a message moved the chat on to, if it is one of those messages. */
export const continuedTo = <T extends FlowTrack>(ts: T[], text: unknown): T | null =>
  typeof text === "string" ? ts.find(t => continueText(t.label) === text) ?? null : null;

// Steps of the guided setup that have no track of their own: they share their neighbour's.
const STEP_SHARES: Record<string, string> = { products: "customers", flows: "where" };

/** The track the chat should help with for the page's place: a guided-setup step or an Institution tab.
 *  The page is the single source of "where": the chat follows it. */
export function trackFor<T extends FlowTrack & { setup_step: string | null; tab: string | null }>(
  ts: T[], at: { step?: string; tab?: string },
): T | null {
  if (at.step) { const s = STEP_SHARES[at.step] ?? at.step; return ts.find(t => t.setup_step === s && t.shown) ?? null; }
  if (at.tab) return ts.find(t => t.tab === at.tab && t.shown) ?? null;
  return null;
}

/** A few things worth saying to the agent about each topic: one click sends it. */
export const STARTERS: Record<string, string[]> = {
  institution: ["We're a commercial bank in Sri Lanka", "Our Board Risk Committee owns risk decisions"],
  footprint_flows: ["We have branches in Kerala and Tamil Nadu", "Many customers get remittances from the Gulf"],
  customers_products: ["Most of our customers are migrant-worker families", "We sell gold loans and vehicle finance"],
  rules: ["We also settle in euros", "Which regulators reach us through USD?"],
  rivals_partners: ["Bank of Ceylon is our main rival", "We clear dollars through a US correspondent bank"],
  risks: ["What risks meet our Gulf remittance corridor?", "Monsoon floods hit our branches in the south"],
  monitors: ["Watch Gulf jobs for our migrant families", "Watch our main rival's deposit rates"],
  verification: ["Check my profile before we go live", "What is still missing?"],
  history: ["What changed this week?"],
  agent_view: ["Which places does Radar watch, and why?"],
};

// ---------------------------------------------------------------- plain words for a profile change
// Proposal cards and the History tab say what changes in words: names, not ids; field names, not keys.

const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const words = (s: string) => s.replace(/[_-]+/g, " ").trim();

export const SECTION_ONE: Record<string, string> = {
  institution: "institution details", footprint: "place in the footprint", "watch-places": "place to watch", segments: "customer group",
  products: "product", flows: "flow", regulators: "regulator", rivals: "rival", counterparties: "firm you depend on",
  "risk-exposures": "risk", monitors: "monitor",
};
const SECTION_MANY: Record<string, string> = {
  footprint: "places in the footprint", "watch-places": "places to watch", segments: "customer groups", products: "products", flows: "flows",
  regulators: "regulators", rivals: "rivals", counterparties: "firms you depend on", "risk-exposures": "risks", monitors: "monitors",
};
/** "3 rivals", "1 place to watch", "6 places to watch". */
export const countOf = (section: string, n: number) => `${n} ${n === 1 ? SECTION_ONE[section] ?? words(section) : SECTION_MANY[section] ?? `${words(section)}s`}`;
export const FLOW_WORDS: Record<string, string> = { remittances_in: "remittances in", remittances_out: "remittances out", tourism: "tourist spending", services: "services income", exports: "exports", imports: "imports" };
const FIELD: Record<string, string> = {
  name: "Name", legal_name: "Legal name", short_name: "Short name", institution_type: "Type", subtype: "Kind", islamic: "Islamic",
  lei: "LEI", home_country: "Home country", base_currency: "Base currency", time_zone: "Time zone",
  clearing_currencies: "Currencies you settle in abroad", summary: "Summary", governance_body: "Who owns risk decisions",
  size_band: "Size", fiscal_year_start_month: "Financial year starts", website: "Website", status: "Status",
  places: "Places", categories: "Products they compete in", segments: "Customer groups", overlap: "Overlap", spec_mapping: "In your data",
  branch_count: "Branches", product_type: "Product type", importance: "Importance", months: "Months", touches: "Touches",
};
export const fieldWord = (k: string) => FIELD[k] ?? cap(words(k));

/** A value as words: lists joined, yes/no, snake_case codes spelled out; codes like "USD" stay. */
export function valueText(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (Array.isArray(v)) return v.map(valueText).join(", ") || "—";
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (typeof v === "object") return Object.entries(v as object).filter(([, x]) => x !== null && x !== undefined)
    .map(([k, x]) => `${fieldWord(k)}: ${valueText(x)}`).join("; ") || "—";
  const s = String(v);
  return /^[a-z]+(_[a-z]+)+$/.test(s) ? words(s) : s;
}

/** An item's name for people: its name, label or title; a place's name; a flow as "remittances in: Kuwait". */
export function itemName(section: string, d: Record<string, any> | null | undefined, names: Record<string, string | null> = {}): string | null {
  if (!d) return null;
  if (d.name || d.label || d.title) return d.name || d.label || d.title;
  if (section === "footprint" && d.code) return names[d.code] ?? d.code;
  if (section === "flows" && d.kind) return `${FLOW_WORDS[d.kind] ?? words(d.kind)}${d.goods ? ` (${d.goods})` : ""}${d.counterpart ? `: ${names[d.counterpart] ?? d.counterpart}` : ""}`;
  return null;
}

export interface ChangeLike { section: string; op: string; id?: string | null; item_id?: string | null; before: Record<string, any> | null; after: Record<string, any> | null }

/** One change as a sentence in three parts (the name goes in bold): "Add | Bank of Ceylon | as a rival" when proposed,
 *  "Added rival | Coastal Remit |" once done. */
export function changeWords(c: ChangeLike, tense: "propose" | "done", names: Record<string, string | null> = {}): { lead: string; name: string | null; tail: string } {
  const one = SECTION_ONE[c.section] ?? words(c.section);
  const name = c.section === "institution" ? null : itemName(c.section, c.after ?? c.before, names) ?? (c.id ?? c.item_id ? cap(words(String(c.id ?? c.item_id))) : null);
  const fields = Object.keys(c.after ?? {});
  const what = fields.length > 3 ? `${fields.slice(0, 3).map(fieldWord).join(", ")} and ${fields.length - 3} more` : fields.map(fieldWord).join(", ");
  if (c.op === "status") {
    const to = c.after?.status, from = c.before?.status;
    return { lead: to === "active" ? "Went live" : to === "archived" ? "Archived" : from === "archived" ? "Restored" : `Status changed to ${valueText(to)}`, name: null, tail: "" };
  }
  if (tense === "propose") {
    if (c.op === "create") return name ? { lead: "Add", name, tail: `as a ${one}` } : { lead: `Add a ${one}`, name: null, tail: "" };
    if (c.op === "delete") return { lead: "Remove", name, tail: `(${one})` };
    return c.section === "institution" ? { lead: "Change the institution details", name: null, tail: "" } : { lead: "Change", name, tail: `(${one})` };
  }
  if (c.op === "create") return { lead: `Added ${one}`, name, tail: "" };
  if (c.op === "delete") return { lead: `Removed ${one}`, name, tail: "" };
  return c.section === "institution" ? { lead: `Changed ${what ? what.toLowerCase() : "the institution details"}`, name: null, tail: "" }
    : { lead: `Changed ${what ? `${what.toLowerCase()} of` : ""} ${one}`.replace(/\s+/g, " "), name, tail: "" };
}
