// Reading a JSON file into a form: what a file may look like, and what comes out of it. Pure functions, no React,
// so they can be run without a browser. The control itself is components/FillFromJson.tsx.

export type Obj = Record<string, any>;
export interface Candidate { label: string; data: Obj }

const isObj = (x: unknown): x is Obj => !!x && typeof x === "object" && !Array.isArray(x);

/** The words that name an item in a pick list: its name, title, label or code. */
export function labelOf(x: Obj, fallback: string): string {
  const flow = x.kind && (x.local || x.counterpart) ? `${String(x.kind).replace(/_/g, " ")} ${x.local ?? "?"} ↔ ${x.counterpart ?? "?"}${x.goods ? ` (${x.goods})` : ""}` : null;
  const v = x.name ?? x.title ?? x.label ?? x.symbol ?? x.regulator_id ?? flow ?? x.code ?? x.id ?? x.about?.name;
  return typeof v === "string" && v.trim() ? v.trim() : fallback;
}

/** The items a file holds for one section: a list, {items: […]}, a whole profile ({sections: {…}}), or one item. */
export function itemsOf(doc: unknown, section: string): Candidate[] {
  let list: unknown[] = [];
  if (Array.isArray(doc)) list = doc;
  else if (isObj(doc)) {
    if (Array.isArray(doc.items)) list = doc.items;
    else if (isObj(doc.sections)) list = Array.isArray(doc.sections[section]) ? doc.sections[section] : [];
    else if (Array.isArray(doc[section])) list = doc[section];
    else if (!("institution" in doc) && !("sections" in doc)) list = [doc];  // one item on its own
  }
  return list.filter(isObj).map((x, i) => ({ label: labelOf(x, `Item ${i + 1}`), data: x }));
}

const INSTITUTION_KEYS = ["name", "legal_name", "short_name", "institution_type", "subtype", "islamic", "lei", "home_country",
  "base_currency", "time_zone", "clearing_currencies", "summary", "governance_body", "size_band", "fiscal_year_start_month", "website"];

/** The institution in a file: {institution: {…}}, the fields themselves, or a list of either. */
export function institutionsOf(doc: unknown): Candidate[] {  // cleanInstitution is defined below
  const list = Array.isArray(doc) ? doc : [doc];
  return list.flatMap(x => (isObj(x) ? [isObj(x.institution) ? x.institution : x] : []))
    .filter(x => INSTITUTION_KEYS.some(k => k in x))
    .map((x, i) => ({ label: labelOf(x, `Institution ${i + 1}`), data: cleanInstitution(x) }));
}

/** A monitor's spec in a file: {spec: {…}}, a monitor as the API gives it, or the spec itself; or a list. */
export function monitorsOf(doc: unknown): Candidate[] {
  const list = Array.isArray(doc) ? doc : isObj(doc) && Array.isArray(doc.items) ? doc.items : [doc];
  return list.flatMap(x => {
    const s = isObj(x) ? (isObj(x.spec) ? x.spec : isObj(x.monitor) && isObj(x.monitor.spec) ? x.monitor.spec : x) : null;
    return s && (isObj(s.about) || isObj(s.public) || isObj(s.private)) ? [s] : [];
  }).map((s, i) => ({ label: labelOf(isObj(s.about) ? s.about : {}, `Monitor ${i + 1}`), data: cleanMonitorSpec(s) }));
}

/** Series in a file: a list, {series: […]}, or one {symbol, …}. */
export function seriesOf(doc: unknown): Candidate[] {
  const list = Array.isArray(doc) ? doc : isObj(doc) && Array.isArray(doc.series) ? doc.series : isObj(doc) && Array.isArray(doc.items) ? doc.items : [doc];
  return list.filter(x => isObj(x) && typeof x.symbol === "string" && x.symbol.trim())
    .map((x, i) => ({ label: `${(x as Obj).symbol}${(x as Obj).name ? ` · ${(x as Obj).name}` : ""}`.trim() || `Series ${i + 1}`, data: x as Obj }));
}

/** Scenarios in a file: a list, {scenarios: […]}, or one {title, headlines, prices} (also under `custom`). */
export function scenariosOf(doc: unknown): Candidate[] {
  const list = Array.isArray(doc) ? doc : isObj(doc) && Array.isArray(doc.scenarios) ? doc.scenarios : isObj(doc) && Array.isArray(doc.items) ? doc.items : [doc];
  return list.filter(x => isObj(x) && (typeof x.title === "string" || Array.isArray(x.headlines) || isObj(x.custom)))
    .map((x, i) => ({ label: labelOf(x as Obj, `Scenario ${i + 1}`), data: x as Obj }));
}

// ---------------------------------------------------------------- conforming a file's values to what a form can show
// A form assumes its values have the right kinds (a list is a list, a name is text). A file can say anything, so every
// value is conformed first: what fits is kept (a text where a list belongs becomes a one-item list), what doesn't is
// dropped and the form's default stays. Nothing here ever throws.

const DROP = Symbol("drop");
const SERVER_KEYS = new Set(["version", "created_at", "updated_at", "updated_by", "used_by", "warnings", "origins"]);
const UNSAFE = new Set(["__proto__", "constructor", "prototype"]);  // never copied from a file onto an object
const NUM_LIST = new Set(["months"]);                      // lists of numbers
const OBJECT_LIST = new Set(["spec_mapping", "watch", "exposure", "key_dates"]);  // lists of objects
const NUMBERS = new Set(["branch_count", "share_of_customers_pct", "fiscal_year_start_month", "alert_level", "check_frequency", "lead_days", "day", "size_pct", "ramp_days"]);
const BOOLS = new Set(["islamic"]);
const MONEY = new Set(["book_size", "value"]);              // {amount, currency, as_of | year}
const PLAIN = new Set(["attributes", "data", "source", "touches"]);  // an object of simple values
const isPrim = (x: unknown) => ["string", "number", "boolean"].includes(typeof x) || x === null;
const text = (v: unknown): string | typeof DROP => (typeof v === "string" ? v : typeof v === "number" && Number.isFinite(v) ? String(v) : DROP);
const num = (v: unknown): number | typeof DROP => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : DROP;
};
const strings = (v: unknown): string[] | typeof DROP => {
  const one = text(v);
  const l = Array.isArray(v) ? v : one !== DROP && one.trim() ? [one] : null;
  return l ? l.map(text).filter((x): x is string => x !== DROP && x !== "") : DROP;
};

/** One value, shaped like its field (by the field's name and its default); DROP when it can't be made to fit. */
export function conform(key: string, v: unknown, dflt: unknown): unknown {
  if (v === undefined) return DROP;
  if (Array.isArray(dflt) || NUM_LIST.has(key) || OBJECT_LIST.has(key)) {
    if (OBJECT_LIST.has(key)) return Array.isArray(v) ? v.filter(isObj).map(o => Object.fromEntries(Object.entries(o).filter(([, x]) => isPrim(x) || Array.isArray(x) && x.every(isPrim)))) : DROP;
    if (NUM_LIST.has(key)) return Array.isArray(v) ? v.map(num).filter((x): x is number => x !== DROP) : DROP;
    return strings(v);
  }
  if (MONEY.has(key)) {
    if (!isObj(v)) return DROP;
    const amount = num(v.amount), cur = text(v.currency);
    if (amount === DROP || cur === DROP) return DROP;
    const out: Obj = { amount, currency: cur };
    if (typeof v.as_of === "string") out.as_of = v.as_of;
    const year = num(v.year); if (year !== DROP) out.year = year;
    return out;
  }
  if (isObj(dflt) || PLAIN.has(key)) {
    if (typeof dflt === "string") return text(v);        // risks: `source` is a word, flows: `source` is an object
    if (!isObj(v)) return DROP;
    const out: Obj = isObj(dflt) ? { ...dflt } : {};
    for (const [k, x] of Object.entries(v)) {
      if (UNSAFE.has(k)) continue;
      if (isObj(dflt) && k in dflt) { const c = conform(k, x, (dflt as Obj)[k]); if (c !== DROP) out[k] = c; }  // a known part: its kind
      else if (typeof x === "string" || typeof x === "boolean" || (typeof x === "number" && Number.isFinite(x))) out[k] = x;  // details keep their kind (tenor_months: 12, secured: true)
    }
    return out;
  }
  if (NUMBERS.has(key)) return num(v);
  if (BOOLS.has(key)) return typeof v === "boolean" ? v : DROP;
  if (v === null) return Array.isArray(dflt) || isObj(dflt) || typeof dflt === "string" ? DROP : null;  // a text keeps its default
  return text(v);  // everything else a form shows is text
}

/** What a dialog starts from: the defaults (or, in an edit, the item's current values), overlaid with the file's item,
 * each value conformed to the defaults' kinds; ids and server bookkeeping stay out of an edit. */
export function draftFrom(defaults: Obj, item: Obj, opts: { keepId: boolean; base?: Obj }): Obj {
  const out: Obj = { ...defaults, ...(opts.base ?? {}) };
  for (const [k, v] of Object.entries(item)) {
    if (SERVER_KEYS.has(k) || UNSAFE.has(k) || (k === "id" && !opts.keepId)) continue;
    const c = k === "id" ? text(v) : conform(k, v, defaults[k]);
    if (c !== DROP) out[k] = c;
  }
  return out;
}

/** The institution's own fields from a file, conformed (type is bank or insurer, the month a number 1 to 12, …). */
export function cleanInstitution(x: Obj): Obj {
  const out: Obj = {};
  for (const k of INSTITUTION_KEYS) {
    if (!(k in x)) continue;
    let c: unknown;
    if (k === "institution_type") c = x[k] === "bank" || x[k] === "insurer" ? x[k] : DROP;
    else if (k === "fiscal_year_start_month") { const n = num(x[k]); c = n !== DROP && n >= 1 && n <= 12 ? Math.trunc(n) : DROP; }
    else c = conform(k, x[k], k === "clearing_currencies" ? [] : undefined);
    if (c !== DROP) out[k] = c;
  }
  return out;
}

/** A monitor's spec from a file, conformed to what the monitor form reads; what it doesn't give stays out. */
export function cleanMonitorSpec(spec: Obj): Obj {
  const sect = (o: unknown) => (isObj(o) ? o : {});
  const pick = (src: Obj, key: string, dflt?: unknown) => { const c = conform(key, src[key], dflt); return c === DROP ? {} : { [key]: c }; };
  const about = sect(spec.about), pub = sect(spec.public), priv = sect(spec.private);
  const eh = sect(pub.example_headlines), srcs = sect(pub.sources);
  return {
    ...pick(spec, "alert_level"),
    about: { ...["name", "owner", "kind", "review_by"].reduce((a, k) => ({ ...a, ...pick(about, k) }), {}), ...pick(about, "check_frequency"),
      ...pick(about, "key_dates"), ...pick(about, "also_notify", []) },
    public: { ...pick(pub, "watch"), ...pick(pub, "in_one_sentence"), ...pick(pub, "tell_me_if", []), ...pick(pub, "ignore", []),
      ...pick(pub, "places", []), ...pick(pub, "languages", []),
      example_headlines: { ...(Array.isArray(eh.match) ? { match: eh.match.filter(isObj) } : {}), ...pick(eh, "not_match", []) },
      sources: { ...pick(srcs, "mode"), ...pick(srcs, "check_first", []) } },
    private: { ...pick(priv, "exposure"), ...pick(priv, "serious", []), ...pick(priv, "notes") },
  };
}

/** A file's text as JSON, or a plain sentence saying why not. */
export function parseJson(text: string): { ok: true; doc: unknown } | { ok: false; error: string } {
  try { return { ok: true, doc: JSON.parse(text) }; }
  catch (e) { return { ok: false, error: `That isn't valid JSON (${e instanceof Error ? e.message.slice(0, 90) : "parse error"}).` }; }
}
