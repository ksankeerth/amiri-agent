// The setup agent's chat: one thread per institution,
// always beside the Institution page and the guided setup. Shows which track you're in
// (not for off-topic), lets you pick a track, switches the tab with it, and shows each
// track's conclusion as a proposal to confirm. Works the same before the institution exists.
import { Fragment, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { ApiError } from "../api/client";
import { chat, type AssistantStatus, type ChatMessage, type Proposal, type TrackDef, type TrackState } from "../api/assistant";
import { dayTime, plural } from "../format";
import { Icon } from "./Icon";
import { ChatToggleCtx, Modal, useRole, useToast } from "./ui";

const SECTION_WORDS: Record<string, string> = {
  institution: "Institution", footprint: "Footprint", "watch-places": "Place to watch", segments: "Customer group",
  products: "Product", flows: "Flow", regulators: "Regulator", rivals: "Rival", counterparties: "Counterparty", "risk-exposures": "Risk exposure",
  monitors: "Monitor",
};
const show = (v: unknown): string => (v === null || v === undefined ? "—" : Array.isArray(v) ? v.map(show).join(", ") || "—"
  : typeof v === "object" ? Object.entries(v as object).map(([k, x]) => `${k}: ${show(x)}`).join("; ") : String(v));

function ProposalCard({ p, onDecided }: { p: Proposal; onDecided: (p: Proposal) => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [sure, setSure] = useState(false);
  const decide = async (a: "confirm" | "reject", confirmDeletes?: number) => {
    if (a === "confirm" && p.deletes >= 3 && !confirmDeletes) { setSure(true); return; }
    setSure(false);
    setBusy(true);
    try { const x = await chat.decide(p.proposal_id, a, confirmDeletes); toast(a === "confirm" ? "Applied." : "Rejected; nothing changed."); onDecided(x); }
    catch (e) { toast(e instanceof ApiError ? e.full : String(e)); chat.proposal(p.proposal_id).then(onDecided).catch(() => {}); }
    finally { setBusy(false); }
  };
  const badge = { pending: "b-sub", confirmed: "b-ok", rejected: "b-noeffect", expired: "b-noeffect", failed: "b-down" }[p.status];
  return (
    <div className="proposal" data-proposal={p.proposal_id}>
      <div className="ph"><Icon name="edit" className="ico16" /><b style={{ flex: 1 }}>{p.status === "pending" ? "Shall I apply these changes?" : p.summary}</b><span className={`badge ${badge}`}>{p.status.toUpperCase()}</span></div>
      <div className="pb">
        {p.status === "pending" && <span className="small" style={{ color: "var(--ink)" }}>{p.summary}</span>}
        {p.kind === "monitors" ? p.changes.map((c, i) => (
          <div key={i} className="col" style={{ gap: 2 }}>
            <span className="small"><b>{c.op === "create" ? "New monitor" : "Change monitor"}</b> {c.after?.name} {c.id && <span className="mono muted">{c.id}</span>}</span>
            <span className="small muted">{c.after?.sentence}</span>
            <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>{(c.after?.tell_me_if ?? []).map((l: string) => (
              <li key={l}>{c.before && !(c.before.tell_me_if ?? []).includes(l) ? <ins>{l}</ins> : l}</li>))}</ul>
            <span className="small muted">Where: {show(c.after?.places)} · every {c.after?.check_frequency >= 1440 ? "day" : c.after?.check_frequency >= 360 ? "6 hours" : "hour"}</span>
          </div>)) : p.changes.map((c, i) => (
          <div key={i} className="col" style={{ gap: 2 }}>
            <span className="small"><b>{c.op === "create" ? "Add" : c.op === "delete" ? "Remove" : "Change"}</b> {SECTION_WORDS[c.section] ?? c.section} <span className="mono muted">{c.id}</span></span>
            {c.op === "update" && c.after && <div className="diff">{Object.keys(c.after).map(k => (
              <Fragment key={k}><span className="k">{k}</span><span><del>{show(c.before?.[k])}</del> <ins>{show(c.after?.[k])}</ins></span></Fragment>))}</div>}
            {c.op === "create" && c.after && <span className="small muted">{show(c.after.name ?? c.after.label ?? c.after.title ?? c.after.code ?? c.after)}</span>}
          </div>))}
        {p.kind === "monitors" && p.status === "pending" && <div className="note">Applying submits {p.changes.length === 1 ? "it" : "them"} for approval; a Risk Manager makes {p.changes.length === 1 ? "it" : "them"} live on the Monitors page.</div>}
        {p.kind === "monitors" && p.status === "confirmed" && <span className="small">{(p.result?.monitors ?? []).map((m: { monitor_id: string; name: string }) => (
          <Link key={m.monitor_id} to={`/monitors/${m.monitor_id}`} style={{ marginRight: 8 }}>{m.name} →</Link>))}</span>}
        {p.warnings.length > 0 && <div className="note">{p.warnings.map(w => w.message).join(" · ")}</div>}
        {p.status === "failed" && p.result && <div className="rawerr">{String(p.result.detail ?? "")}</div>}
        {p.status === "pending" && p.fits === false && <div className="rawerr">No longer fits: the profile changed since ({p.fit_errors.map(e => e.message).join("; ")}). Ask the agent to redo it.</div>}
      </div>
      {p.status === "pending" && <div className="pf"><span className="small muted" style={{ flex: 1 }}>{p.deletes >= 3 ? `Removes ${p.deletes} items. ` : ""}Nothing changes until you apply.</span>
        <button className="btn btn--sm" type="button" disabled={busy} onClick={() => decide("reject")}>Not now</button>
        <button className="btn btn--sm btn--primary" type="button" disabled={busy || p.fits === false} onClick={() => decide("confirm")}>Apply</button></div>}
      {sure && <Modal title={`Remove ${p.deletes} items?`} onClose={() => setSure(false)} footer={<>
        <button className="btn" type="button" onClick={() => setSure(false)}>Cancel</button>
        <button className="btn btn--danger" type="button" onClick={() => decide("confirm", p.deletes)}>Yes, remove {p.deletes}</button></>}>
        <p>This proposal removes {p.deletes} items from your profile: {p.changes.filter(c => c.op === "delete").map(c => c.id).join(", ")}. The history keeps them, and Undo can bring them back.</p>
      </Modal>}
    </div>
  );
}

const DOT: Record<string, string> = { not_started: "sd-off", in_progress: "sd-warn", concluded: "sd-ok" };

export function SetupChat({ institutionId, onTrack, onApplied }: {
  institutionId: string | null;
  onTrack?: (t: TrackDef) => void;                         // the tab (or setup step) to follow
  onApplied?: (p: Proposal) => void;                       // a proposal was applied (reload; a new institution)
}) {
  const chatToggle = useContext(ChatToggleCtx);
  const toast = useToast();
  const { role } = useRole();
  const [status, setStatus] = useState<AssistantStatus | null>(null);
  const [defs, setDefs] = useState<TrackDef[]>([]);
  const [tracks, setTracks] = useState<TrackState[]>([]);
  const [current, setCurrent] = useState<string | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [proposals, setProposals] = useState<Record<string, Proposal>>({});
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [live, setLive] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const log = useRef<HTMLDivElement>(null);
  const def = (id: string | null) => defs.find(d => d.track === id);

  const [writing, setWriting] = useState(false);  // a reply still being written (after a reload or from another tab)
  const load = useCallback(async () => {
    const th = await chat.thread(institutionId);
    setTracks(th.tracks); setCurrent(th.current_track); setMessages(th.messages); setSessionId(th.active_session_id);
    setProposals(Object.fromEntries(th.proposals.map(p => [p.proposal_id, p])));
    setWriting(th.turn_in_progress);
    return th;
  }, [institutionId]);
  useEffect(() => {
    if (!writing || busy) return;
    const t = setInterval(() => { load().catch(() => {}); }, 2000);
    return () => clearInterval(t);
  }, [writing, busy, load]);
  // The setup agent is its own service: Cloud Run stops it after about 15 idle minutes, and starting it again takes
  // a while. Checking it wakes it, so: on opening, every few seconds while it starts, every few minutes while someone
  // is using the page, and at once when they come back to it. The server says how often (0 for an in-process agent).
  const checkStatus = useCallback(() => chat.status().then(setStatus).catch(() => {}), []);
  const lastUse = useRef(Date.now());
  useEffect(() => {
    checkStatus();
    chat.tracks().then(setDefs).catch(() => {});
    load().catch(() => {});
  }, [load, checkStatus]);
  useEffect(() => {
    if (!status?.starting) return;
    const until = Date.now() + 120_000;
    const t = setInterval(() => { if (Date.now() < until) checkStatus(); }, 2500);
    return () => clearInterval(t);
  }, [status?.starting, checkStatus]);
  const warmEvery = (status?.keep_warm_seconds ?? 0) * 1000, warmFor = (status?.keep_warm_idle_minutes ?? 0) * 60_000;
  useEffect(() => {
    if (!warmEvery) return;
    const used = () => {
      const away = Date.now() - lastUse.current;
      lastUse.current = Date.now();
      if (away > 60_000) checkStatus();  // back after a while: wake it now, before they type
    };
    const back = () => { if (document.visibilityState === "visible") used(); };
    window.addEventListener("pointerdown", used); window.addEventListener("keydown", used); window.addEventListener("focus", used);
    document.addEventListener("visibilitychange", back);
    const t = setInterval(() => { if (Date.now() - lastUse.current < warmFor) checkStatus(); }, warmEvery);
    return () => {
      clearInterval(t);
      window.removeEventListener("pointerdown", used); window.removeEventListener("keydown", used); window.removeEventListener("focus", used);
      document.removeEventListener("visibilitychange", back);
    };
  }, [warmEvery, warmFor, checkStatus]);
  // a reply that takes a while to begin: the agent may be starting
  const [heard, setHeard] = useState(false);
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (!busy || heard) { setSlow(false); return; }
    const t = setTimeout(() => setSlow(true), 5000);
    return () => clearTimeout(t);
  }, [busy, heard]);
  useEffect(() => { log.current?.scrollTo({ top: log.current.scrollHeight }); }, [messages.length, live]);
  // "via assistant" on an item: show its proposal here
  useEffect(() => {
    const f = (e: Event) => {
      const id = (e as CustomEvent<string>).detail;
      const el = log.current?.querySelector(`[data-proposal="${id}"]`);
      if (el && log.current) {  // scroll the chat only, not the page
        log.current.scrollTo({ top: (el as HTMLElement).offsetTop - log.current.clientHeight / 3, behavior: "smooth" });
        setFlash(id); setTimeout(() => setFlash(null), 1600);
      }
      else toast("That change came from an earlier chat; scroll up in the history.");
    };
    window.addEventListener("amiri:show-proposal", f);
    return () => window.removeEventListener("amiri:show-proposal", f);
  }, [toast]);

  const follow = (id: string | null) => { const d = def(id); if (d && d.shown && d.tab !== null) onTrack?.(d); };
  const markTrack = (id: string, status: TrackState["status"]) => setTracks(ts => ts.map(t => (t.track === id ? { ...t, status } : t)));

  const send = async (body: { text?: string; answer?: { question_id: string; options: string[] } }) => {
    if (busy) return;
    setBusy(true); setHeard(false);
    const track = picked;
    try {
      let sid = sessionId;
      if (!sid) { const s = await chat.start(institutionId); sid = s.session_id; setSessionId(sid); await load(); }
      const mine: ChatMessage = { message_id: -Date.now(), session_id: sid, track: track ?? current, role: "user",
        kind: body.text ? "text" : "answer", content: body.text ? { text: body.text } : body.answer!, at: new Date().toISOString() };
      setMessages(m => [...m, mine]);
      let text = "";
      const onEvent = ({ event, data }: { event: string; data: Record<string, any> }) => {
        if (event !== "start") setHeard(true);
        if (event === "text_delta") { text += data.text; setLive(text); return; }
        if (event === "start" || event === "done") return;
        if (event === "track") {
          setCurrent(data.track); markTrack(data.track, "in_progress"); follow(data.track);
          setMessages(m => m.map(x => (x.message_id === mine.message_id ? { ...x, track: data.track } : x)));  // it led here
        }
        if (event === "track_concluded") markTrack(data.track, "concluded");
        if (event === "proposal") setProposals(p => ({ ...p, [data.proposal.proposal_id]: data.proposal }));
        setLive(null); text = "";
        const kind = (event === "message" ? "text" : event) as ChatMessage["kind"];
        const content = event === "proposal" ? { proposal_id: data.proposal.proposal_id, summary: data.proposal.summary } : data;
        setMessages(m => [...m, { message_id: data.message_id ?? -Date.now() - Math.random(), session_id: sid, track: data.track ?? null, role: "assistant", kind, content, at: new Date().toISOString() }]);
      };
      try { await chat.send(sid, { ...body, track }, onEvent); }
      catch (e) {
        if (!(e instanceof ApiError && e.code === "session_ended")) throw e;
        const s = await chat.start(institutionId); setSessionId(s.session_id);  // a new session, same chat
        await chat.send(s.session_id, { ...body, track }, onEvent);
      }
      if (track) { setCurrent(track); setPicked(null); }
    } catch (e) {
      if (e instanceof ApiError && e.code === "turn_in_progress") { setWriting(true); setMessages(m => m.filter(x => x.message_id >= 0)); }
      toast(e instanceof ApiError ? e.full : String(e));
    }
    finally { setBusy(false); setLive(null); load().catch(() => {}); checkStatus(); }
  };

  const pick = (t: TrackState) => {
    setPicked(t.track); follow(t.track);
  };
  const decided = (p: Proposal) => {
    setProposals(ps => ({ ...ps, [p.proposal_id]: p }));
    if (p.status === "confirmed") { markTrack(p.track, "concluded"); follow(p.track); onApplied?.(p); load().catch(() => {}); }
  };
  const answered = new Set(messages.filter(m => m.kind === "answer").map(m => m.content.question_id));
  const lastQuestion = [...messages].reverse().find(m => m.kind === "question");
  const shownTracks = tracks.filter(t => t.shown);

  // messages, with a divider each time the track changes
  const rows: ReactNode[] = [];
  let prevTrack: string | null | undefined;
  for (const m of messages) {
    const tr = m.track && def(m.track)?.shown ? m.track : null;
    if (tr && tr !== prevTrack && m.kind !== "session") rows.push(<div key={`d${m.message_id}`} className="trackdiv"><span>{def(tr)?.label}</span></div>);
    if (tr) prevTrack = tr;
    rows.push(<MessageRow key={m.message_id} m={m} proposals={proposals} flash={flash} open={m === lastQuestion && !answered.has(m.content.question_id)}
      busy={busy} onAnswer={(qid, o) => send({ answer: { question_id: qid, options: [o] } })} onDecided={decided} />);
  }

  return (
    <div className="col" style={{ height: "100%", minHeight: 0 }}>
      <div style={{ padding: "12px 14px 10px", borderBottom: "1px solid var(--hairline)", display: "flex", flexDirection: "column", gap: 8 }}>
        <div className="row"><Icon name="chat" className="ico16" /><b>Setup agent</b><span className="spacer" />
          {chatToggle && <button className="btn btn--sm btn--ghost" type="button" onClick={chatToggle.toggle} aria-label="Hide the setup agent">Hide<Icon name="x" /></button>}</div>
        <div className="row wrap" style={{ gap: 4 }}>
          {shownTracks.map(t => (
            <button key={t.track} type="button" className={`chip click ${(picked ?? current) === t.track ? "sel" : ""}`} style={{ height: 22, fontSize: 11 }}
              title={`${t.label}: ${t.status.replace("_", " ")}${t.summary ? ` · ${t.summary}` : ""}${t.read_only ? " · read only" : ""}${t.notes.length ? ` · noted: ${t.notes.map(n => n.text).join("; ")}` : ""}`} onClick={() => pick(t)}>
              <span className={`statusdot ${DOT[t.status]}`} />{t.label}{t.notes.length > 0 && t.status === "not_started" ? " ●" : ""}</button>))}
        </div>
        {status && !status.connected && (status.starting
          ? <div className="note small" role="status"><b>Starting the setup assistant…</b> This can take up to a minute. You can type now: your message waits for it.</div>
          : <div className="note small" style={{ background: "var(--medium-soft)", color: "var(--medium-ink)" }}>
            <b>Not connected yet.</b> {status.message}{role === "platform_admin" && <span className="mono"> ({status.backend})</span>}</div>)}
        {status?.connected && status.backend === "stub" && <div className="note small">Stub agent: canned replies and keyword routing, for building the UI.</div>}
      </div>
      <div ref={log} role="log" aria-label="Conversation with the setup agent" tabIndex={0} style={{ flex: 1, overflow: "auto", padding: 14, display: "flex", flexDirection: "column", gap: 10, position: "relative" }}>
        {!messages.length && <div className="msg ai">{institutionId
          ? "Ask me to fill in or change any part of your profile, to check it, or how something got there. You can also pick a track above. Every change comes back for you to apply."
          : "I can set up your institution with you: what kind it is, where you operate, your customers and products, flows, rules, rivals and risks. Tell me in plain words; nothing is saved until you apply it. The forms work too."}</div>}
        {rows}
        {live && <div className="msg ai">{live}<span className="muted">▍</span></div>}
        {busy && !live && <div className="msg sys" role="status">{slow ? "Waiting for the assistant… If it was asleep, the first reply can take up to a minute." : "…"}</div>}
        {writing && !busy && <div className="msg sys">A reply is still being written… it will appear here.</div>}
      </div>
      <div style={{ borderTop: "1px solid var(--hairline)", padding: 12, display: "flex", gap: 8, alignItems: "center" }}>
        <textarea className="input" rows={2} aria-label="Message to the setup agent" style={{ flex: 1, resize: "none" }} value={draft} disabled={busy}
          placeholder={picked ? `About ${def(picked)?.label.toLowerCase()}…` : institutionId ? "Ask, check, or ask for a change…" : "e.g. We're a commercial bank in Sri Lanka with branches in Kerala"}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); if (draft.trim()) { send({ text: draft.trim() }); setDraft(""); } } }} />
        <button className="btn btn--primary" type="button" disabled={busy || writing || !draft.trim()} onClick={() => { send({ text: draft.trim() }); setDraft(""); }}>Send</button>
      </div>
    </div>
  );
}

function MessageRow({ m, proposals, flash, open, busy, onAnswer, onDecided }: {
  m: ChatMessage; proposals: Record<string, Proposal>; flash: string | null; open: boolean; busy: boolean;
  onAnswer: (questionId: string, option: string) => void; onDecided: (p: Proposal) => void;
}) {
  switch (m.kind) {
    case "session": return <div className="msg sys">New session · {dayTime(m.at)}{m.content.profile_version ? ` · profile v${m.content.profile_version}` : ""}
      {m.content.changes_since_last_session ? ` · ${plural(m.content.changes_since_last_session, "change")} since last time` : ""}</div>;
    case "track": return null;  // shown as the divider
    case "track_concluded": return <div className="msg sys">✓ {m.content.summary ?? "Track concluded"}</div>;
    case "applied": return <div className="msg sys">{m.content.status === "confirmed" ? "✓ Applied" : "✗ Not applied"}: {m.content.summary}</div>;
    case "notes": return <div className="msg sys">Noted for later: {(m.content.notes ?? []).map((n: any) => `${n.track.replace(/_/g, " ")}: ${n.text}`).join(" · ")}</div>;
    case "error": return <div className="msg sys">{m.content.message}</div>;
    case "proposal": {
      const p = proposals[m.content.proposal_id];
      return p ? <div style={flash === p.proposal_id ? { outline: "2px solid var(--accent)", borderRadius: 12 } : undefined}><ProposalCard p={p} onDecided={onDecided} /></div> : null;
    }
    case "question": return (
      <div className="col" style={{ gap: 6 }}>
        <div className="msg ai">{m.content.text}</div>
        {open && <div className="row wrap" style={{ gap: 6 }}>{(m.content.options ?? []).map((o: string) => (
          <button key={o} className="chip click" type="button" disabled={busy} onClick={() => onAnswer(m.content.question_id, o)}>{o}</button>))}</div>}
      </div>);
    default:
      if (m.role === "user") return <div className="msg me">{m.kind === "answer" ? (m.content.options ?? []).join(", ") : m.content.text}</div>;
      return <div className="msg ai">{m.content.text}
        {m.content.unverified_numbers?.length > 0 && <div className="small" style={{ marginTop: 6, color: "var(--medium-ink)" }}>
          ⚠ Not found in your data: {m.content.unverified_numbers.join(", ")}. Treat as the agent's own working, not a figure from your profile.</div>}</div>;
  }
}

/** A page with the setup agent's chat beside it (hide or show; the forms work either way). */
export function WithChat({ institutionId, onTrack, onApplied, children }: {
  institutionId: string | null; onTrack?: (t: TrackDef) => void; onApplied?: (p: Proposal) => void; children: ReactNode;
}) {
  const [open, setOpen] = useState(() => { try { return localStorage.getItem("amiri.setupChat") !== "closed"; } catch { return true; } });
  const toggle = () => { setOpen(!open); try { localStorage.setItem("amiri.setupChat", open ? "closed" : "open"); } catch { /* */ } };
  return (
    <ChatToggleCtx.Provider value={{ open, toggle }}>
    <div className={`withchat ${open ? "open" : ""}`}>
      <div style={{ minWidth: 0 }}>
        {children}
      </div>
      {open && <aside className="chatside" aria-label="Setup agent"><SetupChat key={institutionId ?? "new"} institutionId={institutionId} onTrack={onTrack} onApplied={onApplied} /></aside>}
    </div>
    </ChatToggleCtx.Provider>
  );
}
