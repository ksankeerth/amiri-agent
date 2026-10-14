// Radar (server: app/radar/api.py).
import { api } from "./client";
import type { Theme } from "./investigation";

export interface RadarHeadline { title: string; url?: string | null; outlet?: string | null; published_at: string }
export interface RadarStory {
  story_id: string; fingerprint: string; title: string; summary: string; why: string; places: string[]; themes: Theme[];
  relevance: "high" | "medium" | "low"; score: number; publishers: number; headlines: RadarHeadline[];
  development_of: string | null; status: "sent" | "below" | "dismissed"; sent_by: string | null; finding_id: string | null;
  runs_seen: number; first_seen_at: string; last_seen_at: string; dismissed_by: string | null; dismissed_at: string | null;
  finding_status: string | null; event_id: string | null; event_title: string | null;
  monitor_hint: { monitor_id: string; name: string } | null;
}
export interface RadarRun {
  run_id: string; trigger: "tick" | "now"; status: "running" | "completed" | "stopped_early" | "failed";
  window_since?: string; window_until?: string; stories: number | null; sent: number | null; bytes_processed: number | null;
  error: string | null; created_by?: string | null; created_at: string; finished_at: string | null;
  considered: number | null; shortlisted: number | null;
  queries?: { name: string; purpose: string; bytes_processed: number; rows: number; cached: boolean }[] | null;
}
export interface RadarStatus {
  connected: boolean; agent_url: string | null; every_minutes: number; last_run: RadarRun | null; running: number;
  next_run_at: string; bytes_today: number; bytes_cap: number; budget_spent: boolean;
  limits: { max_stories: number; max_queries: number; max_bytes_per_query: number }; notes: string[];
}

const B = "/api/v1/radar";
const enc = encodeURIComponent;
export const radarApi = {
  status: () => api<RadarStatus>(`${B}:status`),
  run: () => api<RadarRun>(`${B}:run`, { method: "POST" }),
  runs: () => api<{ items: RadarRun[] }>(`${B}/runs`).then(r => r.items),
  getRun: (id: string) => api<RadarRun>(`${B}/runs/${enc(id)}`),
  stories: (q: Record<string, string | undefined> = {}) => {
    const p = new URLSearchParams(Object.entries(q).filter(([, v]) => v) as [string, string][]).toString();
    return api<{ items: RadarStory[] }>(`${B}/stories${p ? `?${p}` : ""}`).then(r => r.items);
  },
  investigate: (id: string) => api<RadarStory>(`${B}/stories/${enc(id)}:investigate`, { method: "POST" }),
  dismiss: (id: string) => api<RadarStory>(`${B}/stories/${enc(id)}:dismiss`, { method: "POST" }),
  restore: (id: string) => api<RadarStory>(`${B}/stories/${enc(id)}:restore`, { method: "POST" }),
};

export const gb = (b: number | null | undefined) => (b == null ? "—" : b >= 1e9 ? `${(b / 1e9).toFixed(1)} GB` : `${Math.round(b / 1e6)} MB`);
