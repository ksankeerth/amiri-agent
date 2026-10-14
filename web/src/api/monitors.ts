// Monitors (server: app/monitors/api.py).
import { api } from "./client";
import type { FindingRow } from "./investigation";

export type MonitorStatus = "draft" | "submitted" | "live" | "paused" | "retired";
export type ChipType = "organisation" | "place" | "region" | "person" | "sector" | "regulation" | "topic";
export interface WatchChip { name: string; type: ChipType; other_forms?: string[]; not_confused_with?: string[] }
export interface KeyDate { date: string; label: string; lead_days: 1 | 3 | 7 }
export interface MonitorSpec {
  about: { name: string; owner: string; also_notify?: string[]; check_frequency: 15 | 60 | 360 | 1440; kind?: "events" | "trend"; key_dates?: KeyDate[]; review_by?: string | null };
  public: {
    watch: WatchChip[]; in_one_sentence: string; tell_me_if: string[]; ignore?: string[];
    example_headlines?: { match: { headline: string; line: number }[]; not_match: string[] };
    places: string[]; languages: string[]; sources?: { mode: "any_reputable" | "trusted_only"; check_first: string[] };
  };
  private: { exposure: { id: string; how_it_reaches_us?: string }[]; serious?: string[]; notes?: string };
  alert_level: number;
}
export interface VersionRow {
  version: number; status: "draft" | "submitted" | "approved" | "superseded"; note: string | null; created_by: string; created_at: string;
  submitted_by: string | null; submitted_at: string | null; approved_by: string | null; approved_at: string | null;
}
export interface MonitorRow {
  monitor_id: string; institution_id: string; status: MonitorStatus; name: string; sentence: string; owner: string;
  check_frequency: number; live_version: number | null; latest_version: number;
  pending: { version: number; status: string; note: string | null } | null;
  origin: string; origin_ref: { section?: string; item_id?: string } | null; drafted_fields: string[];
  next_check_at: string | null; last_check: { at: string; status: "fired" | "quiet" | "error"; findings: number } | null;
  findings_30d: number; review_due: boolean; created_by: string; created_at: string; updated_at: string;
}
export interface Monitor extends MonitorRow { spec: MonitorSpec; live_spec: MonitorSpec | null; versions: VersionRow[] }
export interface CheckRow {
  run_id: string; version: number; world: "live" | "sandbox"; trigger: "tick" | "now" | "test"; window_since: string; window_until: string;
  status: "running" | "completed" | "stopped_early" | "failed"; findings: number | null; error: string | null; reposts: number;
  created_at: string; finished_at: string | null; summary: string | null;
  coverage: { web_queries: number; pages_seen: number; pages_dated: number; pages_in_window: number; already_reported: number } | null;
  usage: { model: string; model_calls: number } | null;
}
export interface MonitorsStatus {
  connected: boolean; agent_url: string | null; live: number; live_max: number; next_check_at: string | null; running: number;
  min_frequency_minutes: number; web_queries_per_check: number; notes: string[];
}
export interface Draftable { section: string; item_id: string; label: string; kind: string; monitor_id: string | null }
export type MonitorFinding = FindingRow & { source_ref: { monitor_id: string; monitor_version: number; check_run_id: string; lines: number[]; line_texts: string[] };
  evidence: { headlines: { title: string; url: string | null; outlet: string | null; published_at: string }[]; web: { url: string; title: string | null }[] } };

const B = "/api/v1";
const enc = encodeURIComponent;
export const monitorsApi = {
  status: () => api<MonitorsStatus>(`${B}/monitors:status`),
  list: (institution_id?: string) => api<{ items: MonitorRow[] }>(`${B}/monitors${institution_id ? `?institution_id=${enc(institution_id)}` : ""}`).then(r => r.items),
  get: (id: string) => api<Monitor>(`${B}/monitors/${enc(id)}`),
  create: (spec: MonitorSpec, note?: string) => api<Monitor>(`${B}/monitors`, { method: "POST", json: { spec, note } }),
  update: (id: string, spec: MonitorSpec, note?: string) => api<Monitor>(`${B}/monitors/${enc(id)}`, { method: "PATCH", json: { spec, note } }),
  act: (id: string, action: "submit" | "approve" | "pause" | "resume" | "retire") => api<Monitor>(`${B}/monitors/${enc(id)}:${action}`, { method: "POST" }),
  requestChanges: (id: string, note: string) => api<Monitor>(`${B}/monitors/${enc(id)}:request-changes`, { method: "POST", json: { note } }),
  runNow: (id: string) => api<CheckRow>(`${B}/monitors/${enc(id)}:run`, { method: "POST" }),
  check: (run_id: string) => api<CheckRow>(`${B}/monitor-checks/${enc(run_id)}`),
  runs: (id: string) => api<{ items: CheckRow[] }>(`${B}/monitors/${enc(id)}/runs`).then(r => r.items),
  findings: (id: string) => api<{ items: MonitorFinding[] }>(`${B}/monitors/${enc(id)}/findings`).then(r => r.items),
  draftable: (institution_id?: string) => api<{ items: Draftable[] }>(`${B}/monitors:draftable${institution_id ? `?institution_id=${enc(institution_id)}` : ""}`).then(r => r.items),
  draft: (section: string, item_id: string, institution_id?: string) =>
    api<Monitor>(`${B}/monitors:draft`, { method: "POST", json: { section, item_id, institution_id } }),
};

export const EVERY: Record<number, string> = { 15: "15 minutes", 60: "1 hour", 360: "6 hours", 1440: "1 day" };
