// The institution's data (imported as a JSON file), the connector's reports, approval and the validation switch.
import type { ImportSummary } from "../pages/admin/importWords";
import { api } from "./client";

export type CheckStatus = "ready" | "ready_with_gaps" | "not_ready";
export type StepStatus = "pass" | "warn" | "fail";
export type CheckState = "pass" | "fail" | "not_applicable" | "not_run";

export interface CheckSummary {
  check_id: string; started_at: string; status: CheckStatus; target: string; server_version: string | null;
  headline: string; current?: boolean; connection_version?: number;
}
export interface Imported {
  file_name: string | null; bytes: number; as_of: string; about: string | null; summary: ImportSummary; at: string; by: string | null;
}
export interface Connection {
  configured: boolean; source?: "imported"; imported?: Imported;
  approved: { check_id: string; at: string; by: string } | null;
  validation_enabled: boolean; validation_allowed: boolean; latest_check: CheckSummary | null;
  max_import_mb: number; updated_at?: string; updated_by?: string;
}
export interface ConformanceCheck {
  id: string; level: string; title: string; status: CheckState; findings: string[]; more: number; fix: string; note: string | null;
}
export interface CoverageProduct {
  profile_product_id: string; name: string; category: string; catalog_product_id: string | null;
  required: string[]; served: string[]; missing: string[];
  reduced: { key: string; grain_spec: string; grain_served: string; off: string[] }[]; extra: string[];
  status: "full" | "partial" | "none";
}
export interface Report {
  check_id: string; run_by: string; target: string; started_at: string; finished_at: string; status: CheckStatus;
  headline: string; spec_version: string; server_version: string | null; accepted: boolean;
  steps: { step: string; status: StepStatus; title: string; detail: string | null; items: string[]; fix?: string | null }[];
  missing_for_profile: string[];
  coverage: { products: CoverageProduct[]; unmapped_catalog_products: { product_id: string; name: string; category: string }[] } | null;
  checks: ConformanceCheck[];
  formats: { where: string; errors: string[]; more: number }[];
  calls: { method: string; path: string; query: Record<string, unknown>; status: number | null; ms: number; bytes: number; error: string | null }[];
  summary: { calls: number; seconds: number; passed: number; failed: number; format_problems: number };
  withdrawn?: string;  // this check withdrew an approval
}

const C = "/api/v1/data-connection";

export const connectApi = {
  get: () => api<Connection>(C),
  /** The file as it is, as the body: the server checks it, and nothing is stored unless all of it is valid. */
  importFile: (file: Blob, name: string) => api<Connection>(`${C}:import?file_name=${encodeURIComponent(name)}`,
    { method: "POST", body: file, headers: { "content-type": "application/json" } }),
  /** Where the example file downloads from (a plain link: the browser saves it). */
  exampleUrl: `${C}:example`,
  check: () => api<Report>(`${C}:check`, { method: "POST" }),
  checks: () => api<{ items: (CheckSummary & { summary: Report["summary"]; run_by: string })[] }>(`${C}/checks`).then(r => r.items),
  report: (id: string) => api<Report>(`${C}/checks/${encodeURIComponent(id)}`),
  approve: () => api<Connection>(`${C}:approve`, { method: "POST" }),
  validation: (enabled: boolean) => api<Connection>("/api/v1/validation", { method: "PUT", json: { enabled } }),
};
