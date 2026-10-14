// Market series API.
import { api } from "./client";

export type SeriesState = "pending" | "warming_up" | "normal" | "moved" | "stale" | "paused";
export type FetchStatus = "ok" | "no_new_data" | "error";

export interface Theme { theme: string; direction_up: string; direction_down: string; item?: string | null; currency?: string | null }
export interface Detector {
  z_threshold: number; sigma_days: number; windows_days: number[];
  cooldown_hours: number; stale_after_hours: number;
}
export interface Window { days: number; bars: number; ref_ts: string; ref_close: number; change_pct: number; z: number | null }
export interface Series {
  series_id: string; symbol: string; name: string; provider: string; interval: string;
  instrument: { type?: string; exchange?: string; currency_base?: string; currency_quote?: string; currency?: string };
  theme: Theme | null; places: string[]; detector: Detector; enabled: boolean;
  state: SeriesState; state_reason: string;
  latest: {
    bar_ts: string; bar_end: string; close: number; change_1d_pct: number | null;
    typical_daily_move_pct: number | null; windows: Window[]; max_z: number | null; max_z_days: number | null;
  } | null;
  spark: { date: string; close: number }[];
  fetch: {
    last_at: string | null; last_status: FetchStatus | null;
    last_error: { code: string; message: string; http_status: number | null; at: string } | null;
    in_progress: boolean; next_scheduled_at: string | null; refresh_available_at: string | null;
  };
  last_finding: { finding_id: string; at: string; title: string } | null;
  version: number; created_at: string; updated_at: string;
}
export interface SeriesStatus {
  prototype: boolean; notes: string[];
  limits: { max_series: number; used: number; available: number };
  schedule: { every_minutes: number; next_run_at: string | null; last_run_at: string | null; tick: string };
  refresh: { cooldown_seconds: number };
  provider: { name: string; configured: boolean;
    credits: { per_minute: number; used_last_minute: number; per_day: number; used_today: number; day_resets_at: string } };
  detector_defaults: Detector;
}
export interface Bar { ts: string; open: number; high: number; low: number; close: number; volume: number | null; bars: number | null }
export interface ProviderCall {
  call_id: number; at: string; finished_at: string | null; trigger: string; status: string; credits: number;
  http_status: number | null; error_code: string | null; error_message: string | null;
  bars_received: number | null; bars_new: number | null; duration_ms: number | null;
}
export interface Finding {
  finding_id: string; world: "live" | "sandbox"; kind: string; title: string; explanation: string; score: number;
  status: "new" | "grouped" | "linked" | "set_aside"; run_id: string | null;
  outcome: { event_id?: string; reason?: string; note?: string; attempts?: number } | null;
  themes: { theme: string; direction: string; item?: string; currency?: string }[]; places: string[]; created_at: string;
  evidence: { signals: { start_at: string; end_at: string; ref_level: number; obs_level: number; change_pct: number; z: number; window_days: number; direction?: string; description?: string }[] };
}
export interface SimulateResult { fired: boolean; note: string; finding: Finding | null; detection: { max: { days: number; z: number } | null } }
export interface LookupItem { symbol: string; name: string | null; type: string | null; exchange: string | null; country: string | null; currency: string | null; plan: string | null; watched: boolean }
export interface FetchOutcome { status: FetchStatus; trigger: string; bars_received: number; bars_new: number; latest_bar_ts: string | null; finding_id: string | null }

const B = "/api/v1";
const enc = encodeURIComponent;

export const seriesApi = {
  list: () => api<{ items: Series[] }>(`${B}/series`).then(r => r.items),
  status: () => api<SeriesStatus>(`${B}/series:status`),
  get: (id: string) => api<Series>(`${B}/series/${enc(id)}`),
  lookup: (q: string) => api<{ query: string; items: LookupItem[]; cached: boolean }>(`${B}/series:lookup?q=${enc(q)}`),
  create: (body: { symbol: string; name?: string; theme?: Theme | null; places?: string[]; detector?: Partial<Detector> }) =>
    api<Series>(`${B}/series`, { method: "POST", json: body }),
  update: (id: string, version: number, patch: Partial<Pick<Series, "name" | "theme" | "places" | "enabled">> & { detector?: Partial<Detector> }) =>
    api<Series>(`${B}/series/${enc(id)}`, { method: "PATCH", json: patch, headers: { "If-Match": `"${version}"` } }),
  remove: (id: string) => api<void>(`${B}/series/${enc(id)}`, { method: "DELETE" }),
  refresh: (id: string) => api<{ series: Series; fetch: FetchOutcome }>(`${B}/series/${enc(id)}:refresh`, { method: "POST" }),
  bars: (id: string, from: Date, until: Date, interval: "1h" | "1d") =>
    api<{ items: Bar[] }>(`${B}/series/${enc(id)}/bars?from=${enc(from.toISOString())}&until=${enc(until.toISOString())}&interval=${interval}`).then(r => r.items),
  fetches: (id: string) => api<{ items: ProviderCall[] }>(`${B}/series/${enc(id)}/fetches?limit=30`).then(r => r.items),
  simulate: (id: string, change_pct: number) =>
    api<SimulateResult>(`${B}/series/${enc(id)}:simulate`, { method: "POST", json: { change_pct } }),
  findings: (id: string) => api<{ items: Finding[] }>(`${B}/series/${enc(id)}/findings?limit=20`).then(r => r.items),
};
