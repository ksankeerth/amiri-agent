// The Overview page's one call (server: app/overview.py).
import { api } from "./client";
import type { PlaceInfo } from "./institutions";
import type { Theme } from "./investigation";
import type { Tone } from "./studio";

export interface Attention { kind: string; audience: "user" | "admin"; level: "crit" | "warn" | "info"; title: string; detail: string | null; link: string | null; at: string | null }
export interface OverviewEvent {
  event_id: string; title: string; themes: Theme[]; places: string[]; anchor: string; tone: Tone; effects: number;
  developments: number; last_finding_at: string;
  top_effects: { product: string; label: string; metric: string | null; direction: "rise" | "fall" | null }[];
}
export interface Overview {
  as_of: string;
  institution: { institution_id: string; name: string; institution_type: "bank" | "insurer"; home_country: string; base_currency: string;
    time_zone: string; status: string; readiness: { ready: boolean; missing_required: number; open_recommendations: number } } | null;
  first_run: boolean;
  counts: { open_events: number; effects_to_watch: number; findings_24h: { timeseries: number; monitor: number; radar: number };
    monitors_live: number; monitors_waiting_approval: number; series_watched: number; alerts_to_review: number };
  attention: Attention[]; attention_more: number; admin_notes: number;
  events: OverviewEvent[];
  findings: { finding_id: string; source: string; title: string; created_at: string; status: string; event_id: string | null; reason: string | null }[];
  markets: { series_id: string; name: string; state: string; state_reason: string | null; close: number | null; change_1d_pct: number | null; spark: number[] }[];
  services: { investigation: { connected: boolean }; monitor: { connected: boolean; live: number }; assistant: { connected: boolean }; radar: { connected: boolean };
    tick: { last_at: string | null; minutes_ago: number | null; ok: boolean } };
  radar: { stories: { story_id: string; title: string; places: string[]; score: number; relevance: string; publishers: number;
    status: "sent" | "below" | "dismissed"; last_seen_at: string; event_id: string | null; why: string }[];
    last_run_at: string | null; next_run_at: string | null };
  studio: { sim_id: string; title: string; step: number; steps: number; status: string } | null;
  map: { places: Record<string, PlaceInfo> };
}

// A Platform Admin also gets Amiri Agent's own plumbing notes; a Risk Manager gets what they can act on.
export const overviewApi = { get: (all = false) => api<Overview>(`/api/v1/overview${all ? "?audience=all" : ""}`) };
