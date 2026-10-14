// Alerts (server: app/alerts/api.py).
import { api } from "./client";

export type Level = "warning" | "developing" | "adverse";  // risk only: no opportunity alerts
export interface Effect { hypothesis_id: string; product_id: string; product: string; metric: string; metric_name: string;
  direction: string; size: string | null; timing: string | null; adverse: boolean; chain_label: string; statement: string }
export interface AlertItem {
  alert_id: string; event_id: string; owner: string; level: Level; title: string; effects: Effect[];
  product_ids: string[]; finding_ids: string[]; via_monitor: string | null; status: "new" | "acknowledged" | "resolved";
  history: { at: string; change: string; text: string; by: string }[]; created_at: string; updated_at: string;
  acknowledged_by: string | null; acknowledged_at: string | null; ack_note: string | null;
  resolved_by: string | null; resolved_at: string | null; resolved_note: string | null;
  event_title: string; event_status: string; event_anchor: string; places: string[]; top_finding: string | null; sources: string[] | null;
}
export interface AlertSummary { to_review: number; by_level: Record<Level, number>; acknowledged_week: number;
  teams: { owner: string; to_review: number }[]; all_teams: string[] }

const B = "/api/v1/alerts";
const enc = encodeURIComponent;
export const alertsApi = {
  summary: () => api<AlertSummary>(`${B}:summary`),
  list: (q: { status?: string; owner?: string; level?: string; event_id?: string } = {}) => {
    const p = new URLSearchParams(Object.entries(q).filter(([, v]) => v) as [string, string][]).toString();
    return api<{ items: AlertItem[] }>(`${B}${p ? `?${p}` : ""}`).then(r => r.items);
  },
  act: (id: string, action: "ack" | "resolve" | "reopen", note?: string) =>
    api<AlertItem>(`${B}/${enc(id)}:${action}`, { method: "POST", json: action === "reopen" ? {} : { note: note || null } }),
};

export const LEVEL: Record<Level, [string, string]> = {
  warning: ["b-down", "EARLY WARNING"], developing: ["b-warn", "DEVELOPING"], adverse: ["b-down", "CONFIRMED"],
};
