// The Scenario Studio (server: app/studio/api.py).
import { api } from "./client";
import type { Theme } from "./investigation";

export type Mode = "live" | "record" | "replay";
export type Tone = "good" | "bad" | "mixed" | "neutral";
export interface Template { template_id: string; title: string; summary: string; tags: string[]; unavailable: string | null }
export interface Headline { id: string; story: string; at: string; title: string; outlet: string; day: number; time: string }
export interface Story { key: string; label: string; tone: Tone; themes: Theme[]; expected: boolean }
export interface Built {
  template_id: string; title: string; intensity: string;
  institution: { institution_id: string; name: string; country: string; currency: string; time_zone: string };
  clock: { start_at: string; steps: number; step_hours: number; step_time: string; first_step_at: string };
  headlines: Headline[]; all_headlines: Headline[];
  prices: { symbol: string; level: number; sigma_daily_pct: number; shock: { shape: string; size_pct: number; ramp_business_days: number }; off?: boolean;
    move?: PriceMove };
  monitor: { key: string; spec: { about: { name: string }; public: { in_one_sentence: string; tell_me_if: string[] } } };
  stories: Story[]; expected_findings: Record<string, number>;
}
export interface PriceMove { direction: "none" | "weaker" | "stronger"; size_pct: number; ramp_days: number }
export interface HeadlineIn { id: string; title: string; day: number; time: string }
export interface Custom { headlines?: HeadlineIn[]; prices?: PriceMove }
export interface ScenarioRow {
  scenario_id: string; institution_id: string; template_id: string; title: string; intensity: "low" | "medium" | "high";
  switched_off: string[]; version: number; created_by: string; created_at: string; updated_at: string;
  recorded?: boolean | null; last_run?: string | null; custom?: Custom;
}
export interface Scenario extends ScenarioRow {
  built: Built;
  simulations: { sim_id: string; mode: Mode; status: string; step: number; steps: number; created_at: string; finished_at: string | null }[];
  recording: { scenario_version: number; complete: boolean; recorded_at: string; current: boolean } | null;
}
export interface TimelineItem { seq: number; step: number; at: string; kind: string; ref: string | null; data: Record<string, any> }
export interface SimEvent { event_id: string; title: string; themes: Theme[]; status: string; anchor: string; created_at: string; developments: number; tone: Tone; effects: number }
export interface Simulation {
  sim_id: string; scenario_id: string; scenario_version: number; institution_id: string; mode: Mode;
  status: "running" | "waiting" | "finished" | "failed" | "stopped"; step: number; steps: number; step_hours: number;
  start_at: string; virtual_now: string; error: string | null; created_at: string; finished_at: string | null;
  title: string; institution: Built["institution"]; symbol: string;
  timeline: TimelineItem[]; bars: { ts: string; close: number }[];
  pending: { run_id: string; kind: "check" | "investigation"; step: number; seconds: number }[];
  events: SimEvent[]; findings: Record<string, number>;
  /** the alerts the live app would raise for these events (computed by the same code; none are saved) */
  alerts: { event_id: string; event_title: string; owner: string; title: string;
    effects: { product: string; metric_name: string; direction: string; size: string | null; timing: string | null }[] }[];
  summary: {
    stories: { key: string; label: string; expected: boolean; tone: Tone; found: boolean; event_id: string | null; event_title: string | null; found_tone: Tone | null }[];
    other_events: { event_id: string; title: string; tone: Tone }[];
    findings: Record<string, { expected: number; found: number }>;
  };
}

const B = "/api/v1/studio";
const enc = encodeURIComponent;
export const studioApi = {
  templates: () => api<{ items: Template[] }>(`${B}/templates`).then(r => r.items),
  scenarios: () => api<{ items: ScenarioRow[] }>(`${B}/scenarios`).then(r => r.items),
  scenario: (id: string) => api<Scenario>(`${B}/scenarios/${enc(id)}`),
  create: (template_id: string, extra: { title?: string; custom?: Custom } = {}) =>
    api<Scenario>(`${B}/scenarios`, { method: "POST", json: { template_id, intensity: "medium", ...extra } }),
  update: (id: string, body: { intensity?: string; switched_off?: string[]; title?: string; custom?: Custom }) =>
    api<Scenario>(`${B}/scenarios/${enc(id)}`, { method: "PATCH", json: body }),
  remove: (id: string) => api<void>(`${B}/scenarios/${enc(id)}`, { method: "DELETE" }),
  start: (scenario_id: string, mode: Mode) => api<Simulation>(`${B}/simulations`, { method: "POST", json: { scenario_id, mode } }),
  current: () => api<{ simulation: Simulation | null }>(`${B}/simulations/current`).then(r => r.simulation),
  get: (id: string, since = 0) => api<Simulation>(`${B}/simulations/${enc(id)}?since=${since}`),
  step: (id: string, expected_step: number) => api<Simulation>(`${B}/simulations/${enc(id)}:step`, { method: "POST", json: { expected_step } }),
  stop: (id: string) => api<Simulation>(`${B}/simulations/${enc(id)}:stop`, { method: "POST" }),
};

export const TONE: Record<Tone, [string, string]> = {
  good: ["b-ok", "GOOD FOR YOU"], bad: ["b-down", "BAD FOR YOU"], mixed: ["b-warn", "MIXED"], neutral: ["b-noeffect", "NEUTRAL"],
};
