// Institution profile API.
import { api } from "./client";

export type SectionName = "footprint" | "watch-places" | "segments" | "products" | "flows" | "regulators"
  | "rivals" | "counterparties" | "risk-exposures";
export const SECTION_NAMES: SectionName[] = ["footprint", "watch-places", "segments", "products", "flows",
  "regulators", "rivals", "counterparties", "risk-exposures"];
export type InstitutionType = "bank" | "insurer";

export interface Institution {
  institution_id: string; name: string; legal_name?: string | null; short_name?: string | null;
  institution_type: InstitutionType; subtype?: string | null; islamic?: boolean; lei?: string | null;
  home_country: string; base_currency: string; time_zone: string; clearing_currencies?: string[];
  summary?: string | null; governance_body?: string | null; size_band?: string | null;
  fiscal_year_start_month?: number; website?: string | null;
  status: "setup" | "active" | "archived"; version: number; profile_version: number;
  created_at: string; updated_at: string; activated_at: string | null; archived_at: string | null;
  counts: Record<SectionName, number>;
}
export interface InstitutionSummary { institution_id: string; name: string; institution_type: InstitutionType; status: string; home_country: string; profile_version: number; items: number; updated_at: string }

/** Every item: its fields plus bookkeeping. Fields depend on the section. */
export type Item = { id: string; version: number; created_at: string | null; updated_at: string | null; updated_by: string | null } & Record<string, any>;

export interface PlaceInfo { code: string; name: string | null; kind: string; parent: string | null; country: string | null; lat: number | null; lon: number | null; numeric: string | null }
export interface Origin { source: string; by: string; at: string; proposal_id: string | null; last_source: string; last_by: string; last_at: string; last_proposal_id: string | null }
export interface Check { id: string; level: "required" | "recommended" | "info"; ok: boolean; message: string; section: string; fix: string }
export interface Note { section?: string | null; id?: string | null; code: string; message: string }
export interface Readiness { institution_id: string; status: string; ready: boolean; missing_required: number; open_recommendations: number; checks: Check[]; warnings: Note[] }
export interface Profile {
  institution: Institution;
  sections: Record<SectionName, Item[]>;
  place_names: Record<string, string | null>;
  places: Record<string, PlaceInfo>;
  origins: Record<string, Record<string, Origin>>;
  readiness: { ready: boolean; missing_required: number; open_recommendations: number };
}
export interface Operation { op: "create" | "update" | "delete"; section: SectionName | "institution"; id?: string | null; data?: Record<string, any>; if_version?: number; force?: boolean }
export interface Change { section: string; id: string | null; op: string; before: Record<string, any> | null; after: Record<string, any> | null }
export interface BatchResult { institution_id: string; dry_run: boolean; profile_version: number; results: { index: number; op: string; section: string; id: string | null; version: number | null; item: Item | null }[]; changes: Change[]; warnings: Note[] }
export interface Suggestion { added: boolean; item: Record<string, any>; [k: string]: any }
export interface HistoryRow { change_id: number; profile_version: number; at: string; actor: string; source: string; batch_id: string; section: string; item_id: string | null; op: string; before: Record<string, any> | null; after: Record<string, any> | null }

const B = "/api/v1/institutions";
const enc = encodeURIComponent;
const who = { "X-Amiri-Source": "form" };

export const inst = {
  list: () => api<InstitutionSummary[]>(B),
  create: (body: Record<string, any>) => api<Institution>(B, { method: "POST", json: body, headers: who }),
  import: (body: Record<string, any>) => api<Institution>(`${B}:import`, { method: "POST", json: body }),
  get: (id: string) => api<Institution>(`${B}/${enc(id)}`),
  patch: (id: string, version: number, body: Record<string, any>) =>
    api<Institution>(`${B}/${enc(id)}`, { method: "PATCH", json: body, headers: { ...who, "If-Match": `"${version}"` } }),
  remove: (id: string) => api<void>(`${B}/${enc(id)}`, { method: "DELETE" }),
  status: (id: string, action: "activate" | "archive" | "restore") => api<Institution>(`${B}/${enc(id)}:${action}`, { method: "POST" }),
  profile: (id: string) => api<Profile>(`${B}/${enc(id)}/profile`),
  readiness: (id: string) => api<Readiness>(`${B}/${enc(id)}/readiness`),
  context: (id: string) => api<Record<string, any>>(`${B}/${enc(id)}/context`),
  undo: (id: string, batchId: string) =>
    api<{ batch_id: string; source: string; actor: string; at: string; proposal_id: string | null; operations: Operation[]; valid: boolean; errors: { message: string }[]; changes: Change[] }>(
      `${B}/${enc(id)}/history/batches/${enc(batchId)}/undo`),
  history: (id: string, before?: number) =>
    api<{ items: HistoryRow[]; next_before: number | null }>(`${B}/${enc(id)}/history?limit=50${before ? `&before=${before}` : ""}`),
  suggestions: (id: string, section: string) =>
    api<{ section: string; note: string; items: Suggestion[] }>(`${B}/${enc(id)}/suggestions/${section}`),
  batch: (id: string, operations: Operation[], dryRun = false) =>
    api<BatchResult>(`${B}/${enc(id)}:batch`, { method: "POST", json: { operations, dry_run: dryRun }, headers: who }),
  create_item: (id: string, section: SectionName, data: Record<string, any>) =>
    api<{ item: Item; warnings: Note[]; profile_version: number }>(`${B}/${enc(id)}/${section}`, { method: "POST", json: data, headers: who }),
  patch_item: (id: string, section: SectionName, item: Item, data: Record<string, any>) =>
    api<{ item: Item; warnings: Note[]; profile_version: number }>(`${B}/${enc(id)}/${section}/${enc(item.id)}`,
      { method: "PATCH", json: data, headers: { ...who, "If-Match": `"${item.version}"` } }),
  delete_item: (id: string, section: SectionName, item: Item, force = false) =>
    api<void>(`${B}/${enc(id)}/${section}/${enc(item.id)}${force ? "?force=true" : ""}`,
      { method: "DELETE", headers: { ...who, "If-Match": `"${item.version}"` } }),
};
