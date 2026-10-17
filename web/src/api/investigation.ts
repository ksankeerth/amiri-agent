// Findings, investigation runs and events (server: app/investigation/api.py).
import { api } from "./client";

export interface Theme { theme: string; direction: string; item?: string; currency?: string }
export interface FindingRow {
  finding_id: string; world: "live" | "sandbox" | "studio"; source: string; kind: string; title: string; explanation: string;
  score: number; themes: Theme[]; places: string[]; status: "new" | "grouped" | "linked" | "set_aside";
  run_id: string | null; outcome: { event_id?: string; reason?: string; note?: string; attempts?: number } | null; created_at: string;
}
export interface InvestigationStatus {
  connected: boolean; agent_url: string | null; validation: boolean; wait_minutes: number; findings_waiting: number;
  oldest_waiting_since: string | null; next_batch_at: string | null; runs_running: number; notes: string[];
}
export interface Run {
  run_id: string; world: string; status: "running" | "completed" | "stopped_early" | "failed"; trigger: string;
  finding_ids: string[]; validation: boolean; error: string | null; attempt: number; created_at: string; finished_at: string | null;
  events?: number; hypotheses?: number; tasks?: number; report?: string | null;
}
export interface EventRow {
  event_id: string; run_id: string; world: "live" | "sandbox" | "studio"; title: string; themes: Theme[]; country: string;
  country_code: string | null; anchor: string; places: string[]; regions: string[]; finding_ids: string[];
  status: "open" | "closed"; open_until: string; closed_at: string | null; hypotheses: number; tasks: number;
  developments: number; size: { value: number; unit: string } | null; tone: "good" | "bad" | "mixed" | "neutral";
}
export interface Development { finding_id: string; title: string; joined_at: string; reason: string; created_at: string }
export interface Started { items: Run[]; developments: { finding_id: string; event_id: string; event_title: string }[] }
export interface Hypothesis {
  hypothesis_id: string; product_id: string; product_name?: string; product_type: string; angle: string; mechanism_id: string;
  chain_label: string; statement: string; segment: { dimension: string; value: string } | null;
  expected: { metric: string; direction: "rise" | "fall"; size: string; timing: string }; task_id: string | null;
}
export type Verdict = "confirms" | "contradicts" | "no_effect" | "insufficient_data" | "masked" | "not_yet" | "error";
// One effect checked against the institution's data, in words (server: app/validation/explain.py).
export interface Check {
  verdict: Verdict; verdict_text: string; final: boolean; line: string; what: string; change: string | null; usual: string | null;
  checks: string[]; why: string | null; as_of: string | null; next_check_after: string | null;
  alert: "adverse" | "developing" | "opportunity" | "none"; alert_basis: "explained" | "unexplained" | null;
  supersedes: { as_of: string; verdict: Verdict; text: string } | null;
  versions: { spec: string | null; catalog: string | null; validator: string | null; data: string | null }; spec_link: string;
}
export const VERDICT_BADGE: Record<Verdict, string> = {
  confirms: "b-confirmed", contradicts: "b-warn", no_effect: "b-noeffect", insufficient_data: "b-insufficient",
  masked: "b-masked", not_yet: "b-notyet", error: "b-error",
};
export interface EventDetail extends Omit<EventRow, "hypotheses" | "tasks" | "developments"> {
  findings: FindingRow[]; hypotheses: Hypothesis[]; country_name: string | null; developments: Development[];
  set_aside: { product_type: string; angle: string; decision: string; reason: string }[];
  tasks: { task_id: string; hypothesis_id: string; metric: string; watch?: { from: string; until: string }; scope_note?: string | null;
    status?: "pending" | "done" | "failed"; next_check_after?: string | null; check?: Check | null }[];
  run: { run_id: string; status: string; validation: boolean; report: string | null };
}

const B = "/api/v1";
export const investigationApi = {
  status: () => api<InvestigationStatus>(`${B}/investigation:status`),
  findings: (q = "") => api<{ items: FindingRow[] }>(`${B}/findings${q}`).then(r => r.items),
  investigateNow: (finding_ids?: string[]) =>
    api<Started>(`${B}/investigations`, { method: "POST", json: finding_ids ? { finding_ids } : {} }),
  clearSandbox: () => api<{ findings: number; investigations: number }>(`${B}/sandbox`, { method: "DELETE" }),
  runs: () => api<{ items: Run[] }>(`${B}/investigations?limit=20`).then(r => r.items),
  collect: (run_id: string) => api<Run>(`${B}/investigations/${encodeURIComponent(run_id)}:collect`, { method: "POST" }),
  events: () => api<{ items: EventRow[] }>(`${B}/events`).then(r => r.items),
  event: (id: string) => api<EventDetail>(`${B}/events/${encodeURIComponent(id)}`),
};
