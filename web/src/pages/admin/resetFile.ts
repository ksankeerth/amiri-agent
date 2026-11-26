// "Start again from a JSON file": reading and checking the file before anything is sent, and what it will load, in words.
// Plain logic, no React, so `npm test` covers it. The server checks everything again (and wipes nothing if the file fails);
// this check only catches the common mistakes early, with a clear message: not JSON, not a profile, a section that doesn't exist.
import { parseJson } from "../../components/fillJson.ts";

type Obj = Record<string, any>;
const isObj = (x: unknown): x is Obj => !!x && typeof x === "object" && !Array.isArray(x);

/** The profile sections the server knows (institutions/schemas.py SECTIONS), with the words for a count. */
export const SECTION_WORDS: Record<string, [string, string]> = {
  footprint: ["place in the footprint", "places in the footprint"],
  "watch-places": ["watched place", "watched places"],
  segments: ["customer group", "customer groups"],
  products: ["product", "products"],
  flows: ["flow", "flows"],
  regulators: ["regulator", "regulators"],
  rivals: ["rival", "rivals"],
  counterparties: ["counterparty", "counterparties"],
  "risk-exposures": ["risk exposure", "risk exposures"],
};
const REQUIRED = ["name", "institution_type", "home_country", "base_currency", "time_zone"] as const;
const FIELD_WORDS: Record<(typeof REQUIRED)[number], string> = { name: "a name", institution_type: "a type (bank or insurer)", home_country: "a home country", base_currency: "a base currency", time_zone: "a time zone" };

/** The body the server takes: the same shape as POST /institutions:import, and as the profile Settings downloads. */
export interface ResetProfile { institution: Obj; sections: Record<string, Obj[]> }
export interface ResetSummary {
  name: string;
  kind: "Bank" | "Insurer";
  home: string;      // the country code, as written in the file
  currency: string;
  counts: { section: string; n: number; words: string }[];   // sections with at least one item, in the server's order
  total: number;
}
export type ReadResult = { ok: true; profile: ResetProfile; summary: ResetSummary } | { ok: false; error: string };

/** The shape check: `{ institution: {...}, sections: {...} }` with the institution's required fields, and every section a list
 *  of objects under a name the server knows. Other top-level keys (a "_about" note) are left out of what is sent. */
export function checkShape(doc: unknown): { ok: true; profile: ResetProfile } | { ok: false; error: string } {
  if (!isObj(doc)) return { ok: false, error: "This isn't an institution profile: the file should be one JSON object with an “institution” and its “sections”." };
  if (!isObj(doc.institution)) {
    return { ok: false, error: isObj(doc.sections) || "name" in doc
      ? "The file has no “institution” part. A profile looks like { \"institution\": { name, institution_type, … }, \"sections\": { … } }; the Export on the Institution page writes one."
      : "This isn't an institution profile: it needs an “institution” and its “sections”." };
  }
  const missing = REQUIRED.filter(k => typeof doc.institution[k] !== "string" || !doc.institution[k].trim());
  if (missing.length) return { ok: false, error: `The institution needs ${missing.map(k => FIELD_WORDS[k]).join(", ")}.` };
  if (!["bank", "insurer"].includes(doc.institution.institution_type)) return { ok: false, error: `The institution's type is “${doc.institution.institution_type}”; it must be bank or insurer.` };
  const sections = doc.sections ?? {};
  if (!isObj(sections)) return { ok: false, error: "“sections” should be an object with a list of items for each section (products, flows, …)." };
  for (const [name, items] of Object.entries(sections)) {
    if (!(name in SECTION_WORDS)) return { ok: false, error: `“${name}” isn't a section. The sections are ${Object.keys(SECTION_WORDS).join(", ")}.` };
    if (!Array.isArray(items) || !items.every(isObj)) return { ok: false, error: `The “${name}” section should be a list of items, each one an object.` };
  }
  return { ok: true, profile: { institution: doc.institution, sections: sections as Record<string, Obj[]> } };
}

/** What loading the profile will do, in the words of the confirm box. */
export function summarize(p: ResetProfile): ResetSummary {
  const counts = Object.keys(SECTION_WORDS).flatMap(section => {
    const n = (p.sections[section] ?? []).length;
    return n ? [{ section, n, words: `${n} ${SECTION_WORDS[section][n === 1 ? 0 : 1]}` }] : [];
  });
  const i = p.institution;
  return { name: String(i.name).trim(), kind: i.institution_type === "insurer" ? "Insurer" : "Bank", home: String(i.home_country).trim(),
    currency: String(i.base_currency).trim(), counts, total: counts.reduce((s, c) => s + c.n, 0) };
}

/** A file's text to the profile and its summary, or the reason it can't be used. */
export function readResetFile(text: string): ReadResult {
  const parsed = parseJson(text);
  if (!parsed.ok) return parsed;
  const s = checkShape(parsed.doc);
  return s.ok ? { ok: true, profile: s.profile, summary: summarize(s.profile) } : s;
}

/** The file to download for the current institution: the import shape, so it can be loaded again. `pick` keeps the fields a new
 *  institution can be created from (profileFile.ts pickCreate). */
export const profileFile = (institution: Obj, sections: Record<string, Obj[]>, pick: (i: Obj) => Obj): ResetProfile => ({ institution: pick(institution), sections });

type Problemish = { problem?: { detail?: unknown; errors?: { section?: string; field?: string; message?: string }[] } } | null | undefined;
/** A refused or failed reset in words: the server's own sentence and, for a 422, its first few problems. */
export function resetFailure(e: unknown): string {
  const p = (e as Problemish)?.problem;
  const detail = typeof p?.detail === "string" && p.detail ? p.detail : "The reset didn't go through. Nothing was changed; try again in a moment.";
  const errs = (p?.errors ?? []).filter(x => x?.message).slice(0, 5).map(x => `${[x.section, x.field].filter(Boolean).join(" ")}${x.section || x.field ? ": " : ""}${x.message}`);
  return errs.length ? `${detail} ${errs.join("; ")}.` : detail;
}
