// The institution's data connection, the connector's reports, and the sample institutions.
import { api } from "./client";

export type CheckStatus = "ready" | "ready_with_gaps" | "not_ready";
export type StepStatus = "pass" | "warn" | "fail";
export type CheckState = "pass" | "fail" | "not_applicable" | "not_run";

export interface CheckSummary {
  check_id: string; started_at: string; status: CheckStatus; target: string; server_version: string | null;
  headline: string; current?: boolean; connection_version?: number;
}
export interface Connection {
  configured: boolean; source?: "sample" | "url"; sample?: "bank" | "insurer" | null; base_url?: string | null;
  openapi_url?: string | null; auth_header?: string | null; auth_set?: boolean;
  approved: { check_id: string; at: string; by: string } | null;
  validation_enabled: boolean; validation_allowed: boolean; latest_check: CheckSummary | null;
  updated_at?: string; updated_by?: string;
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
  steps: { step: string; status: StepStatus; title: string; detail: string | null; items: string[] }[];
  missing_for_profile: string[];
  coverage: { products: CoverageProduct[]; unmapped_catalog_products: { product_id: string; name: string; category: string }[] } | null;
  checks: ConformanceCheck[];
  formats: { where: string; errors: string[]; more: number }[];
  calls: { method: string; path: string; query: Record<string, unknown>; status: number | null; ms: number; bytes: number; error: string | null }[];
  summary: { calls: number; seconds: number; passed: number; failed: number; format_problems: number };
  withdrawn?: string;  // this check withdrew an approval
}
export interface ConnectionIn {
  source: "sample" | "url"; sample?: "bank" | "insurer"; base_url?: string; openapi_url?: string;
  auth_header?: string; auth_value?: string;
}

export interface Preset {
  id: string; label: string; group: "data" | "fault"; size_label: string | null; size: number | null;
  start_days_ago: number; note: string;
}
export interface Condition { id: string; on?: boolean; start?: string | null; size?: number | null }
export interface Sample {
  kind: "bank" | "insurer"; enabled: boolean; conditions: Condition[]; updated_at: string | null; updated_by: string | null;
  allowed: boolean; base_path: string; openapi_path: string; shaped_by: { name: string; source: "installation" | "bundled" };
  presets: Preset[];
}

const C = "/api/v1/data-connection";

export const connectApi = {
  get: () => api<Connection>(C),
  put: (body: ConnectionIn) => api<Connection>(C, { method: "PUT", json: body }),
  check: () => api<Report>(`${C}:check`, { method: "POST" }),
  checks: () => api<{ items: (CheckSummary & { summary: Report["summary"]; run_by: string })[] }>(`${C}/checks`).then(r => r.items),
  report: (id: string) => api<Report>(`${C}/checks/${encodeURIComponent(id)}`),
  approve: () => api<Connection>(`${C}:approve`, { method: "POST" }),
  validation: (enabled: boolean) => api<Connection>("/api/v1/validation", { method: "PUT", json: { enabled } }),
  samples: () => api<{ allowed: boolean; items: Sample[] }>("/api/v1/mock-institutions"),
  putSample: (kind: string, enabled: boolean, conditions: Condition[]) =>
    api<Sample>(`/api/v1/mock-institutions/${kind}`, { method: "PUT", json: { enabled, conditions } }),
};
