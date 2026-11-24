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
