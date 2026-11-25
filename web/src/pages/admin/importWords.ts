// Words for the imported data file on Data connections: what a file covers, its size, a check before sending it,
// and an upload's errors. Plain logic, tested by importWords.test.ts.

export interface ImportSummary {
  products: number; metrics: number; series: number; rows: number; from: string | null; until: string | null;
  as_of: string | null; institution?: string | null; capability_level?: string | null; vintages_kept?: boolean;
}

const fDate = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

/** A local date (YYYY-MM-DD) as "1 Jul 2023". */
export const dateWords = (iso: string) => fDate.format(new Date(`${iso}T00:00:00Z`));

const n = (x: number, one: string, many = `${one}s`) => `${x.toLocaleString("en-GB")} ${x === 1 ? one : many}`;

/** "10 products · 53 metrics" */
export const coverWords = (s: ImportSummary) => `${n(s.products, "product")} · ${n(s.metrics, "metric")}`;

/** "1 Jul 2023 to 6 Oct 2026", the periods the rows cover (until is exclusive: the last day is the day before). */
export function rangeWords(s: ImportSummary): string | null {
  if (!s.from || !s.until) return null;
  const last = new Date(`${s.until}T00:00:00Z`);
  last.setUTCDate(last.getUTCDate() - 1);
  return `${dateWords(s.from)} to ${fDate.format(last)}`;
}

/** 14,750,110 → "14.1 MB"; 900 → "1 KB". */
export function sizeWords(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** Why a picked file won't be sent (null: send it). */
export function fileProblem(file: { name: string; size: number; type?: string }, maxMb: number): string | null {
  if (!/\.json$/i.test(file.name) && file.type !== "application/json") return `${file.name} isn't a JSON file.`;
  if (file.size === 0) return `${file.name} is empty.`;
  if (file.size > maxMb * 1024 * 1024) return `${file.name} is ${sizeWords(file.size)}; the most this server takes is ${maxMb} MB.`;
  return null;
}

export interface UploadProblem { headline: string; items: string[]; more: number }

/** An upload's refusal in words: the first few problems, each "where: what", and how many more. */
export function uploadWords(p: { code?: string; detail?: string; errors?: { field: string; message: string }[] } | null | undefined,
  shown = 4): UploadProblem {
  const errs = (p?.errors ?? []).filter(e => e.field !== "…");
  const more = (p?.errors ?? []).find(e => e.field === "…");
  const extra = more ? Number(/(\d+)/.exec(more.message)?.[1] ?? 0) : 0;
  const headline = p?.code === "invalid_import" ? (errs.length === 1 ? "The file has a problem, so nothing was imported."
    : `The file has ${errs.length + extra} problems, so nothing was imported.`)
    : p?.code === "invalid_json" ? "The file isn't valid JSON, so nothing was imported."
    : p?.code === "too_large" ? "The file is too large, so nothing was imported."
    : p?.detail || "The file couldn't be imported.";
  const items = p?.code === "invalid_import" ? errs.slice(0, shown).map(e => `${e.field}: ${e.message}`)
    : p?.detail && headline !== p.detail ? [p.detail] : [];
  return { headline, items, more: p?.code === "invalid_import" ? Math.max(0, errs.length - shown) + extra : 0 };
}

// ---------------------------------------------------------------- looking at a file before it is sent
export interface Peek {
  products: number; metrics: number; series: number; rows: number; from: string | null; until: string | null;
  as_of: string; about: string | null; institution: string | null;
}
export type PeekResult = { ok: true; peek: Peek } | { ok: false; problem: UploadProblem };

const FORMAT = "amiri-institution-data/1";

/** The offset of the first syntax error in `t` (null: it is valid JSON). Engines word their errors differently and
 *  some give no position, so this reads the text itself. Only used once JSON.parse has already failed. */
export function jsonErrorAt(t: string): number | null {
  let i = 0;
  const fail = (): never => { throw i; };
  const ws = () => { while (i < t.length && " \t\n\r".includes(t[i])) i++; };
  const str = () => {
    i++;
    for (;;) {
      const c = t[i];
      if (c === undefined || c < " ") fail();
      if (c === '"') { i++; return; }
      if (c === "\\") {
        const e = t[i + 1];
        if (e !== undefined && '"\\/bfnrt'.includes(e)) i += 2;
        else if (e === "u" && /^[0-9a-fA-F]{4}$/.test(t.slice(i + 2, i + 6))) i += 6;
        else { i++; fail(); }
      } else i++;
    }
  };
  const num = () => { const m = /^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?/.exec(t.slice(i, i + 64)); if (!m) fail(); i += m![0].length; };
  const val = (): void => {
    ws();
    const c = t[i];
    if (c === "{") {
      i++; ws();
      if (t[i] === "}") { i++; return; }
      for (;;) {
        ws(); if (t[i] !== '"') fail();
        str(); ws(); if (t[i] !== ":") fail();
        i++; val(); ws();
        if (t[i] === ",") { i++; continue; }
        if (t[i] === "}") { i++; return; }
        fail();
      }
    } else if (c === "[") {
      i++; ws();
      if (t[i] === "]") { i++; return; }
      for (;;) {
        val(); ws();
        if (t[i] === ",") { i++; continue; }
        if (t[i] === "]") { i++; return; }
        fail();
      }
    } else if (c === '"') str();
    else if (t.startsWith("true", i)) i += 4;
    else if (t.startsWith("false", i)) i += 5;
    else if (t.startsWith("null", i)) i += 4;
    else num();
  };
  try { val(); ws(); if (i < t.length) fail(); return null; } catch (e) { return typeof e === "number" ? e : null; }
}

/** Where a JSON syntax error is: "line 4, column 12". */
export function jsonWhere(text: string): string | null {
  const at = jsonErrorAt(text);
  if (at === null) return null;
  const before = text.slice(0, at);
  return `line ${before.split("\n").length}, column ${before.length - before.lastIndexOf("\n")}`;
}

/** A first look at the file's text: is it JSON, is it in the import format, and what will it bring in. The server
 *  checks every row when it is sent; this only keeps an obvious mistake from costing a 15 MB upload. */
export function peekImport(text: string): PeekResult {
  let doc: any;
  try { doc = JSON.parse(text); }
  catch {
    const where = jsonWhere(text);
    return { ok: false, problem: { headline: "The file isn't valid JSON, so nothing was imported.", items: where ? [`${where}: this isn't valid JSON here`] : [], more: 0 } };
  }
  const bad = (field: string, message: string): PeekResult => ({ ok: false, problem: { headline: "The file isn't in the import format, so nothing was imported.", items: [`${field}: ${message}`], more: 0 } });
  if (doc === null || typeof doc !== "object" || Array.isArray(doc)) return bad("(the file)", "must be one JSON object");
  if (doc.format !== FORMAT) return bad("format", `must be "${FORMAT}"`);
  if (typeof doc.as_of !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(doc.as_of)) return bad("as_of", "must be a date, like 2026-11-23");
  if (!doc.catalog || !Array.isArray(doc.catalog.products)) return bad("catalog.products", "is missing");
  if (!Array.isArray(doc.series)) return bad("series", "is missing");
  let rows = 0, from: string | null = null, until: string | null = null;
  for (const s of doc.series) for (const r of Array.isArray(s?.rows) ? s.rows : []) {
    rows++;
    if (typeof r?.from === "string" && (from === null || r.from < from)) from = r.from;
    if (typeof r?.until === "string" && (until === null || r.until > until)) until = r.until;
  }
  const metrics = doc.catalog.products.reduce((n: number, p: any) => n + (Array.isArray(p?.metrics) ? p.metrics.length : 0), 0);
  const name = doc.catalog.profile?.name ?? doc.catalog.profile?.institution_name;
  return { ok: true, peek: { products: doc.catalog.products.length, metrics, series: doc.series.length, rows, from, until, as_of: doc.as_of,
    about: typeof doc.about === "string" && doc.about ? doc.about : null, institution: typeof name === "string" ? name : null } };
}

/** "376 series · 132,769 rows" */
export const bulkWords = (p: Pick<Peek, "series" | "rows">) => `${n(p.series, "series", "series")} · ${n(p.rows, "row")}`;
