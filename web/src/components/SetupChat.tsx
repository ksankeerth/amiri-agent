// The setup agent's chat: one thread per institution,
// always beside the Institution page and the guided setup. Shows which track you're in
// (not for off-topic), lets you pick a track, switches the tab with it, and shows each
// track's conclusion as a proposal to confirm. Works the same before the institution exists.
import { Fragment, useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { ApiError } from "../api/client";
import { chat, type Change, type ChatMessage, type Proposal, type TrackDef } from "../api/assistant";
import { dayTime, plural } from "../format";
import { Icon } from "./Icon";
import { LockBtn, useDemoLock } from "./lock";
import { changeWords, continuedTo, fieldWord, valueText } from "./setupFlow";
import { ChatToggleCtx, MenuButton, Modal, StatusIcon, useToast } from "./ui";
import { ASK_EVENT, MAX_CHARS, useSetupChat, type ChatAt, type SetupChatProps } from "./useSetupChat";
import "../styles/setup.css";

// the chat's state and calls are in useSetupChat.ts; these are re-exported for the pages that import them from here
export { askSetupAgent, ASK_EVENT, MAX_CHARS, useSetupChat } from "./useSetupChat";
export type { ChatAt, SetupChatProps } from "./useSetupChat";

// A proposal's state in words, with its own glyph: never colour alone.
const PSTATE: Record<Proposal["status"], [cls: string, icon: string, words: string]> = {
  pending: ["b-sub", "hourglass", "Waiting for you"], confirmed: ["b-ok", "good", "Applied"], rejected: ["b-noeffect", "x", "Not applied"],
  expired: ["b-noeffect", "clock", "Expired"], failed: ["b-down", "bad", "Failed"],
};

/** One change on a proposal card: "Add **Bank of Ceylon** as a rival", then each changed field as before → after. */
function ChangeRow({ c }: { c: Change }) {
  const w = changeWords(c, "propose");
  return (
    <div className="pchange">
      <span className="pc-line">{w.lead} {w.name && <b>{w.name}</b>} {w.tail}</span>
      {c.op === "update" && c.after && <div className="diff">{Object.keys(c.after).map(k => (
        <Fragment key={k}><span className="k">{fieldWord(k)}</span><span><del>{valueText(c.before?.[k])}</del> <span aria-hidden="true">→</span> <ins>{valueText(c.after?.[k])}</ins></span></Fragment>))}</div>}
    </div>
  );
}

function ProposalCard({ p, onDecided }: { p: Proposal; onDecided: (p: Proposal) => void }) {
  const toast = useToast();
  const locked = useDemoLock();
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
  const [badge, , said] = PSTATE[p.status];
  return (
    <div className="proposal" data-proposal={p.proposal_id}>
      <div className="ph"><b style={{ flex: 1 }}>{p.status === "pending" ? "Suggested changes" : p.summary}</b><span className={`pstate ${badge}`}>{said}</span></div>
      <div className="pb">
        {p.status === "pending" && <span className="small" style={{ color: "var(--ink)" }}>{p.summary}</span>}
        {p.kind === "monitors" ? p.changes.map((c, i) => (
          <div key={i} className="col" style={{ gap: 2 }}>
            <span className="small">{c.op === "create" ? "New monitor" : "Change monitor"} <b>{c.after?.name}</b></span>
            <span className="small muted">{c.after?.sentence}</span>
            <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>{(c.after?.tell_me_if ?? []).map((l: string) => (
              <li key={l}>{c.before && !(c.before.tell_me_if ?? []).includes(l) ? <ins>{l}</ins> : l}</li>))}</ul>
            <span className="small muted">Where: {valueText(c.after?.places)} · every {c.after?.check_frequency >= 1440 ? "day" : c.after?.check_frequency >= 360 ? "6 hours" : "hour"}</span>
          </div>)) : p.changes.map((c, i) => <ChangeRow key={i} c={c} />)}
        {p.kind === "monitors" && p.status === "pending" && <div className="note">Applying submits {p.changes.length === 1 ? "it" : "them"} for approval; a Risk Manager makes {p.changes.length === 1 ? "it" : "them"} live on the Monitors page.</div>}
        {p.kind === "monitors" && p.status === "confirmed" && <span className="small">{(p.result?.monitors ?? []).map((m: { monitor_id: string; name: string }) => (
          <Link key={m.monitor_id} to={`/monitors/${m.monitor_id}`} style={{ marginRight: 8 }}>{m.name} →</Link>))}</span>}
        {p.warnings.length > 0 && <div className="note">{p.warnings.map(w => w.message).join(" · ")}</div>}
        {p.status === "failed" && p.result && <div className="rawerr">{String(p.result.detail ?? "")}</div>}
        {p.status === "pending" && p.fits === false && <div className="rawerr">No longer fits: the profile changed since ({p.fit_errors.map(e => e.message).join("; ")}). Ask the agent to redo it.</div>}
      </div>
      {p.status === "pending" && <div className="pf"><span className="small muted" style={{ flex: 1 }}>{p.deletes >= 3 ? `Removes ${p.deletes} items. ` : ""}{locked ? "Applying is switched off for this demo." : "Nothing changes until you apply."}</span>
        <button className="btn btn--sm" type="button" disabled={busy} onClick={() => decide("reject")}>Not now</button>
        <LockBtn className="btn btn--sm btn--primary" disabled={busy || p.fits === false} onClick={() => decide("confirm")}>Apply</LockBtn></div>}
      {sure && <Modal title={`Remove ${p.deletes} items?`} onClose={() => setSure(false)} footer={<>
        <button className="btn" type="button" onClick={() => setSure(false)}>Cancel</button>
        <LockBtn className="btn btn--danger" onClick={() => decide("confirm", p.deletes)}>Yes, remove {p.deletes}</LockBtn></>}>
        <p>This proposal removes {p.deletes} items from your profile: {p.changes.filter(c => c.op === "delete").map(c => changeWords(c, "propose").name ?? c.id).join(", ")}. The history keeps them, and Undo can bring them back.</p>
      </Modal>}
    </div>
  );
}

const TRACK_STATUS = { not_started: "open", in_progress: "partial", concluded: "done" } as const;
const TRACK_WORDS = { not_started: "not started", in_progress: "in progress", concluded: "done" } as const;

/** The guided setup's panel (the Institution page has its own look). */
export function SetupChat(props: SetupChatProps) {
  const {
    chatToggle, status, role, def, tracks, picked, here, hereLabel, proposals, visible, folded, foldedTopics, setShowAll, shownTracks,
    starters, working, busy, writing, nextUp, slow, live, retryable, retry, send, pick, decided, flash, answered, lastQuestion, institutionId,
    draft, setDraft, box, log,
  } = useSetupChat(props);

  // messages, with a divider each time the track changes
  const rows: ReactNode[] = [];
  let prevTrack: string | null | undefined;
  for (const m of visible) {
    const tr = m.track && def(m.track)?.shown ? m.track : null;
    if (tr && tr !== prevTrack && m.kind !== "session") rows.push(<div key={`d${m.message_id}`} className="trackdiv"><span>{def(tr)?.label}</span></div>);
    if (tr) prevTrack = tr;
    const moved = m.role === "user" && m.kind === "text" ? continuedTo(tracks, m.content.text) : null;
    if (moved) { rows.push(<div key={m.message_id} className="msg sys">→ {moved.label}</div>); continue; }
    rows.push(<MessageRow key={m.message_id} m={m} proposals={proposals} flash={flash} open={m === lastQuestion && !answered.has(m.content.question_id)}
      busy={busy} onAnswer={(qid, options) => send({ answer: { question_id: qid, options } })} onDecided={decided} />);
  }

  return (
    <div className="col" style={{ height: "100%", minHeight: 0 }}>
      <div className="chathead">
        <div className="chat-title"><div><h2>Setup assistant</h2>
          <p>Ask, check or change your profile. Nothing is saved until you apply it.</p></div>
          {chatToggle && <button className="chat-close" type="button" onClick={chatToggle.toggle} aria-label="Hide the setup assistant" title="Hide the setup assistant"><Icon name="x" /></button>}</div>
        <div className="helping">
          <span className="helping-l">Helping with: <b>{hereLabel ?? "anything about your profile"}</b></span>
          <MenuButton label="Topic">
            {shownTracks.map(t => (
              <button key={t.track} type="button" className="btn btn--ghost" aria-current={here === t.track ? "true" : undefined}
                title={t.summary ?? undefined} onClick={() => pick(t)}>
                <StatusIcon status={TRACK_STATUS[t.status]} label={`${t.label}: ${TRACK_WORDS[t.status]}`} />{t.label}</button>))}
          </MenuButton>
        </div>
        {status && !status.connected && (status.starting
          ? <div className="note small" role="status"><b>Starting the setup assistant…</b> This can take up to a minute. You can type now: your message waits for it.</div>
          : <div className="note small" style={{ background: "var(--medium-soft)", color: "var(--medium-ink)" }}>
            <b>Not connected yet.</b> {status.message}{role === "platform_admin" && <span className="mono"> ({status.backend})</span>}</div>)}
        {status?.connected && status.backend === "stub" && role === "platform_admin" && <div className="note small">Stub agent: canned replies and keyword routing, for building the UI.</div>}
      </div>
      <div ref={log} className="chatlog" role="log" aria-label="Conversation with the setup agent" tabIndex={0}>
        {folded.length > 0 && <button type="button" className="chat-earlier" onClick={() => setShowAll(true)}>
          Earlier: {foldedTopics.join(", ")} ({folded.length === 1 ? "1 message" : `${folded.length} messages`}) · <u>Show</u></button>}
        {rows}
        {!visible.some(m => m.kind !== "session" && m.kind !== "track") && <div className="msg ai">{institutionId
          ? `Tell me about ${hereLabel ? hereLabel.replace(/^Step \d+ · /, "").toLowerCase() : "any part of your profile"} in plain words, or ask me to check it. I draft each change as a card; nothing changes until you apply it.`
          : "I can set up your institution with you: what kind it is, where you operate, your customers and products, flows, rules, rivals and risks. Tell me in plain words; nothing is saved until you apply it. The forms work too."}</div>}
        {starters.length > 0 && <div className="starters" aria-label="Things you could say">
          <span className="small muted">Try saying</span>
          {starters.map(x => <button key={x} type="button" className="starter" onClick={() => send({ text: x })}>{x}</button>)}</div>}
        {retryable && !working && <div className="row" style={{ justifyContent: "center" }}>
          <button className="btn btn--sm" type="button" onClick={retry}><Icon name="refresh" />Try again</button></div>}
        {live && <div className="msg ai">{live}<span className="muted">▍</span></div>}
        {working && <div className="agentwork" role="status" aria-live="polite"><span className="orb" aria-hidden="true" />
          <span>{busy ? (live ? "Writing…" : slow ? "Waiting for the assistant… If it was asleep, the first reply can take up to a minute."
            : "Thinking…")
            : writing ? "A reply is still being written… it will appear here."
            : `Moving on to ${(def(nextUp) ?? { label: "the next section" }).label.toLowerCase()}…`}</span></div>}
      </div>
      {draft.length >= MAX_CHARS * 0.8 && <div className="small" role="status" style={{ padding: "6px 12px 0", color: draft.length >= MAX_CHARS ? "var(--medium-ink)" : "var(--ink-3)" }}>
        {draft.length}/{MAX_CHARS}{draft.length >= MAX_CHARS ? " · That's the limit: keep to one topic, and send the rest after the reply." : ""}</div>}
      <div className="chatcomp">
        <textarea ref={box} className="input" rows={1} aria-label="Message to the setup agent" value={draft} disabled={working}
          maxLength={MAX_CHARS}
          placeholder={working ? "The setup agent is working… you can type once it's done." : picked ? `About ${def(picked)?.label.toLowerCase()}…` : institutionId ? "Ask or tell me about your institution…" : "e.g. We're a commercial bank with branches in two regions"}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); if (draft.trim() && !working) { send({ text: draft.trim() }); setDraft(""); } } }} />
        <button className="chat-send" type="button" aria-label="Send" title="Send" disabled={working || !draft.trim()} onClick={() => { send({ text: draft.trim() }); setDraft(""); }}><Icon name="arrow" /></button>
      </div>
    </div>
  );
}

/** The agent's question with its options: one click answers, or, when several may be chosen (multi), the
 *  clicks pick and Send answers with all of them. */
function QuestionRow({ m, open, busy, onAnswer }: {
  m: ChatMessage; open: boolean; busy: boolean; onAnswer: (questionId: string, options: string[]) => void;
}) {
  const [chosen, setChosen] = useState<string[]>([]);
  const multi = m.content.multi === true;
  const click = (o: string) => {
    if (!multi) { onAnswer(m.content.question_id, [o]); return; }
    setChosen(c => (c.includes(o) ? c.filter(x => x !== o) : [...c, o]));
  };
  return (
    <div className="col" style={{ gap: 6 }}>
      <div className="msg ai">{m.content.text}</div>
      {open && <div className="row wrap" role={multi ? "group" : undefined} aria-label={multi ? "Pick one or more" : undefined} style={{ gap: 6 }}>
        {(m.content.options ?? []).map((o: string) => (
          <button key={o} className={`chip click ${chosen.includes(o) ? "sel" : ""}`} type="button" disabled={busy}
            aria-pressed={multi ? chosen.includes(o) : undefined} onClick={() => click(o)}>{multi && chosen.includes(o) ? "✓ " : ""}{o}</button>))}
        {multi && <button className="btn btn--sm btn--primary" type="button" disabled={busy || !chosen.length}
          onClick={() => onAnswer(m.content.question_id, chosen)}>{chosen.length > 1 ? `Send ${chosen.length}` : "Send"}</button>}
      </div>}
      {open && multi && <span className="small muted">Pick one or more, then Send.</span>}
    </div>);
}

function MessageRow({ m, proposals, flash, open, busy, onAnswer, onDecided }: {
  m: ChatMessage; proposals: Record<string, Proposal>; flash: string | null; open: boolean; busy: boolean;
  onAnswer: (questionId: string, options: string[]) => void; onDecided: (p: Proposal) => void;
}) {
  switch (m.kind) {
    case "session": return <div className="msg sys">New session · {dayTime(m.at)}{m.content.profile_version ? ` · profile v${m.content.profile_version}` : ""}
      {m.content.changes_since_last_session ? ` · ${plural(m.content.changes_since_last_session, "change")} since last time` : ""}</div>;
    case "track": return null;  // shown as the divider
    case "track_concluded": return <div className="msg sys">✓ {m.content.summary ?? "Track concluded"}</div>;
    case "applied": return <div className="msg sys">{m.content.status === "confirmed" ? "✓ Applied" : "✗ Not applied"}: {m.content.summary}
      {m.content.status === "failed" && m.content.detail ? <span style={{ color: "var(--medium-ink)" }}> · {m.content.detail}</span> : null}</div>;
    case "notes": return <div className="msg sys">Noted for later: {(m.content.notes ?? []).map((n: any) => `${n.track.replace(/_/g, " ")}: ${n.text}`).join(" · ")}</div>;
    case "error": return <div className="msg sys chat-err"><span><span aria-hidden="true">◆ </span>{m.content.message}</span>
      {(m.content.detail || m.content.code) && <details><summary>Details</summary><div className="rawerr">{String(m.content.detail ?? m.content.code)}</div></details>}</div>;
    case "proposal": {
      const p = proposals[m.content.proposal_id];
      return p ? <div style={flash === p.proposal_id ? { outline: "2px solid var(--accent)", borderRadius: 12 } : undefined}><ProposalCard p={p} onDecided={onDecided} /></div> : null;
    }
    case "question": return <QuestionRow m={m} open={open} busy={busy} onAnswer={onAnswer} />;
    default:
      if (m.role === "user") return <div className="msg me">{m.kind === "answer" ? (m.content.options ?? []).join(", ") : m.content.text}</div>;
      return <div className="msg ai">{m.content.text}
        {m.content.unverified_numbers?.length > 0 && <div className="small" style={{ marginTop: 6, color: "var(--medium-ink)" }}>
          ⚠ Not found in your data: {m.content.unverified_numbers.join(", ")}. Treat as the agent's own working, not a figure from your profile.</div>}</div>;
  }
}

/** A page with the setup agent's chat beside it (hide or show; the forms work either way). */
export function WithChat({ institutionId, onTrack, onApplied, at, children }: {
  institutionId: string | null; onTrack?: (t: TrackDef) => void; onApplied?: (p: Proposal) => void; at?: ChatAt; children: ReactNode;
}) {
  const [open, setOpen] = useState(() => { try { return localStorage.getItem("amiri.setupChat") !== "closed"; } catch { return true; } });
  const setShown = (v: boolean) => { setOpen(v); try { localStorage.setItem("amiri.setupChat", v ? "open" : "closed"); } catch { /* */ } };
  const toggle = () => setShown(!open);
  // "Ask the Setup agent instead" (Edit details, the step's explainer): open the panel and put the cursor in it
  const [askKey, setAskKey] = useState(0);
  useEffect(() => {
    const f = () => { setShown(true); setAskKey(k => k + 1); };
    window.addEventListener(ASK_EVENT, f);
    return () => window.removeEventListener(ASK_EVENT, f);
  }, []);  // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <ChatToggleCtx.Provider value={{ open, toggle }}>
    <div className={`withchat ${open ? "open" : ""}`}>
      <div style={{ minWidth: 0 }}>
        {children}
      </div>
      {open && <aside className="chatside" aria-label="Setup agent"><SetupChat key={institutionId ?? "new"} institutionId={institutionId} onTrack={onTrack} onApplied={onApplied} at={at} askKey={askKey} /></aside>}
    </div>
    </ChatToggleCtx.Provider>
  );
}
