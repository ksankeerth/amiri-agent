// The setup agent's chat and proposals.
import { api, ApiError, ME, type Problem } from "./client";

export interface AssistantStatus { backend: string; connected: boolean; message: string | null }
export interface TrackDef { track: string; label: string; tab: string | null; setup_step: string | null; writes: string[]; read_only: boolean; shown: boolean; order: number | null }
export interface TrackState extends TrackDef { status: "not_started" | "in_progress" | "concluded"; summary: string | null; notes: { text: string; at: string }[]; updated_at: string | null }
export interface ChatMessage {
  message_id: number; session_id: string | null; track: string | null; role: "user" | "assistant" | "system";
  kind: "text" | "answer" | "question" | "proposal" | "track" | "track_concluded" | "notes" | "session" | "applied" | "error";
  content: Record<string, any>; at: string;
}
export interface Change { section: string; id: string | null; op: string; before: Record<string, any> | null; after: Record<string, any> | null }
export interface Proposal {
  proposal_id: string; thread_id: string; session_id: string | null; track: string; kind: "profile" | "create_institution" | "monitors";
  institution_id: string | null; created_by: string; on_behalf_of: string; summary: string;
  operations: Record<string, any>[]; institution: Record<string, any> | null; evidence: any[];
  changes: Change[]; warnings: { message: string }[]; base_profile_version: number | null;
  status: "pending" | "confirmed" | "rejected" | "expired" | "failed"; decided_by: string | null; decided_at: string | null;
  result: Record<string, any> | null; created_at: string; expires_at: string; tab: string | null;
  deletes: number; fits: boolean | null; fit_errors: { message: string }[];
}
export interface Thread {
  thread_id: string; institution_id: string | null; owner_user: string; current_track: string | null; summary: string | null;
  tracks: TrackState[]; messages: ChatMessage[]; next_before: number | null; proposals: Proposal[]; active_session_id: string | null;
  turn_in_progress: boolean;
}
export interface ChatSession { session_id: string; thread_id: string; agent_connected: boolean; resumed?: boolean }
export type StreamEvent = { event: string; data: Record<string, any> };

const H = { "X-Amiri-Actor": ME };
const A = "/api/v1/assistant";
const q = (iid: string | null) => (iid ? `?institution_id=${encodeURIComponent(iid)}` : "");

export const chat = {
  status: () => api<AssistantStatus>(`${A}/status`),
  tracks: () => api<TrackDef[]>(`${A}/tracks`),
  thread: (iid: string | null) => api<Thread>(`${A}/thread${q(iid)}`, { headers: H }),
  start: (iid: string | null) => api<ChatSession>(`${A}/sessions`, { method: "POST", json: { institution_id: iid }, headers: H }),
  proposal: (id: string) => api<Proposal>(`/api/v1/proposals/${id}`),
  decide: (id: string, action: "confirm" | "reject", confirmDeletes?: number) =>
    api<Proposal>(`/api/v1/proposals/${id}:${action}${confirmDeletes ? `?confirm_deletes=${confirmDeletes}` : ""}`, { method: "POST", headers: H }),

  /** Sends a message or an answer; calls onEvent for each server-sent event until "done". */
  async send(sessionId: string, body: { text?: string; answer?: { question_id: string; options: string[] }; track?: string | null },
    onEvent: (e: StreamEvent) => void): Promise<void> {
    const r = await fetch(`${A}/run_sse`, { method: "POST", headers: { "content-type": "application/json", ...H },
      body: JSON.stringify({ session_id: sessionId, ...body, track: body.track ?? undefined }) });
    if (!r.ok) {
      let p: Problem;
      try { p = await r.json(); } catch { p = { status: r.status, code: "http_" + r.status, detail: r.statusText }; }
      throw new ApiError(p);
    }
    const reader = r.body!.getReader();
    const dec = new TextDecoder();
    let buf = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf("\n\n")) >= 0) {
        const block = buf.slice(0, i); buf = buf.slice(i + 2);
        let event = "message", data = "";
        for (const line of block.split("\n")) {
          if (line.startsWith("event: ")) event = line.slice(7);
          else if (line.startsWith("data: ")) data += line.slice(6);
        }
        if (data) onEvent({ event, data: JSON.parse(data) });
      }
    }
  },
};

/** Ask the chat to show a proposal's card (from an item's "via assistant" badge). */
export const showProposal = (proposalId: string) => window.dispatchEvent(new CustomEvent("amiri:show-proposal", { detail: proposalId }));
