// The Setup agent's panel on the Institution page (board 08; states: board 15 section C, board 13 section 6): a chat beside the
// profile, with the agent's proposed changes as cards you apply or reject. Nothing is saved until Apply. On a phone it is a
// full-screen sheet that a button opens. The chat's state and its calls are useSetupChat (components/useSetupChat.ts, shared with
// the guided setup); this file is only how it looks.
//
// Asking, and how often: the server's thread is one for everybody, so the panel looks at it when it opens, when you send, and
// now and then while a reply is being written (every 15 s, or every 3 s when you sent it). Nothing else polls.
import { Fragment, useCallback, useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import { chat, showProposal, type ChatMessage, type Proposal, type TrackDef } from "../../api/assistant";
import { ASK_EVENT, MAX_CHARS, useSetupChat, type ChatAt } from "../../components/useSetupChat";
import { continuedTo } from "../../components/setupFlow";
import { useDemoLock } from "../../components/lock";
import { useRefusalToast, useToast } from "../../components/ui";
import { AgentState } from "../../components/v2/AgentState";
import { Button } from "../../components/v2/Button";
import { Dialog } from "../../components/v2/Dialog";
import { usePhone } from "../../components/v2/Shell";
import { dayTime, plural } from "../../format";
import { cantApplyWhy, changeRows, expiredWhy, proposalLook, removesText } from "./words";
import "../../styles/v2/setup-chat.css";

// ---------------------------------------------------------------- open and closed

const OPEN_KEY = "amiri.setupChat";   // "closed" once hidden (desktop); the guided setup reads the same key
export interface AgentPanel { open: boolean; setOpen: (v: boolean) => void; askKey: number; sheet: boolean }

/** Whether the panel is showing. On a desktop it stays as you left it; on a phone it is a sheet, closed until asked for. */
export function useAgentPanel(): AgentPanel {
  const sheet = usePhone();
  const [desk, setDesk] = useState(() => { try { return localStorage.getItem(OPEN_KEY) !== "closed"; } catch { return true; } });
  const [sheetOpen, setSheetOpen] = useState(false);
  const [askKey, setAskKey] = useState(0);
  const open = sheet ? sheetOpen : desk;
  const setOpen = useCallback((v: boolean) => {
    if (sheet) { setSheetOpen(v); return; }
    setDesk(v);
    try { localStorage.setItem(OPEN_KEY, v ? "open" : "closed"); } catch { /* private mode */ }
  }, [sheet]);
  const openRef = useRef(open);
  openRef.current = open;
  useEffect(() => {
    // "Ask the Setup agent instead": open the panel and put the cursor in its message box
    const ask = () => { setOpen(true); setAskKey(k => k + 1); };
    // "Made by the Setup agent" on a row: open the panel, then show that proposal once its thread has loaded
    const show = (e: Event) => {
      if (openRef.current) return;
      setOpen(true);
      const id = (e as CustomEvent<string>).detail;
      setTimeout(() => showProposal(id), 900);
    };
    window.addEventListener(ASK_EVENT, ask);
    window.addEventListener("amiri:show-proposal", show);
    return () => { window.removeEventListener(ASK_EVENT, ask); window.removeEventListener("amiri:show-proposal", show); };
  }, [setOpen]);
  return { open, setOpen, askKey, sheet };
}

const SPARK = <svg width="14" height="14" viewBox="0 0 24 24" fill="none" strokeWidth="2" aria-hidden="true" focusable="false" className="v2-sa__spark"><path d="M12 3l2 5 5 2-5 2-2 5-2-5-5-2 5-2z" /></svg>;
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export interface SetupAgentProps {
  panel: AgentPanel;
  institutionId: string | null;
  onTrack?: (t: TrackDef) => void;
  onApplied?: (p: Proposal) => void;
  at?: ChatAt;
  /** The profile as it is now: an expired proposal says whether it moved on, and changes are named by its places. */
  profileVersion: number | null;
  names: Record<string, string | null>;
}

/** The panel: nothing while it is closed. */
export function SetupAgent(props: SetupAgentProps) {
  return props.panel.open ? <Agent {...props} /> : null;
}

function Agent({ panel, institutionId, onTrack, onApplied, at, profileVersion, names }: SetupAgentProps) {
  const c = useSetupChat({ institutionId, onTrack, onApplied, at, askKey: panel.askKey });
  const { status, role, def, tracks, here, picked, hereLabel, proposals, visible, folded, foldedTopics, shownTracks, starters, working, busy, writing,
    nextUp, slow, live, retryable, retry, send, pick, decided, flash, answered, lastQuestion, draft, setDraft, box, log } = c;
  const root = useRef<HTMLElement>(null);
  const topicId = useId();
  const closeBtn = useRef<HTMLButtonElement>(null);
  const close = () => panel.setOpen(false);

  // a sheet is a dialog: focus goes in and stays in, Esc closes it, and focus goes back to the button that opened it
  useEffect(() => {
    if (!panel.sheet) return;
    const opener = document.activeElement as HTMLElement | null;
    closeBtn.current?.focus({ preventScroll: true });
    const key = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") { if (document.querySelector(".v2-dlg")) return; e.preventDefault(); panel.setOpen(false); return; }
      if (e.key !== "Tab" || !root.current) return;
      if (document.querySelector(".v2-dlg")) return;   // a dialog over the sheet traps its own focus
      const items = [...root.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(x => x.offsetParent !== null);
      if (!items.length) return;
      const a = items[0], z = items[items.length - 1];
      if (e.shiftKey && document.activeElement === a) { e.preventDefault(); z.focus(); }
      else if (!e.shiftKey && document.activeElement === z) { e.preventDefault(); a.focus(); }
    };
    document.addEventListener("keydown", key);
    document.body.classList.add("modal-open");
    return () => { document.removeEventListener("keydown", key); document.body.classList.remove("modal-open"); opener?.focus?.({ preventScroll: true }); };
  }, [panel.sheet]);   // eslint-disable-line react-hooks/exhaustive-deps

  const submit = () => { const t = draft.trim(); if (!t || working) return; send({ text: t }); setDraft(""); };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); } };

  // the thread, with a small heading each time the topic changes
  const rows: ReactNode[] = [];
  let prev: string | null | undefined;
  for (const m of visible) {
    const tr = m.track && def(m.track)?.shown ? m.track : null;
    if (tr && tr !== prev && m.kind !== "session") rows.push(<div key={`d${m.message_id}`} className="v2-sa__div"><span>{def(tr)?.label}</span></div>);
    if (tr) prev = tr;
    const moved = m.role === "user" && m.kind === "text" ? continuedTo(tracks, m.content.text) : null;
    if (moved) { rows.push(<div key={m.message_id} className="v2-sa__sys">→ {moved.label}</div>); continue; }
    rows.push(<Message key={m.message_id} m={m} proposals={proposals} flash={flash} open={m === lastQuestion && !answered.has(m.content.question_id)} busy={busy}
      onAnswer={(qid, options) => send({ answer: { question_id: qid, options } })} onDecided={decided} profileVersion={profileVersion} names={names}
      askAgain={t => { setDraft(t); box.current?.focus(); }} />);
  }
  const empty = !visible.some(m => m.kind !== "session" && m.kind !== "track");
  const waking = status && !status.connected && status.starting;
  const offline = status && !status.connected && !status.starting;
  const left = draft.length >= MAX_CHARS * 0.8;

  const aside = (
    <aside ref={root} className={`v2-sa${panel.sheet ? " is-sheet" : ""}`} aria-label="Setup agent" {...(panel.sheet ? { role: "dialog", "aria-modal": true } : {})}>
      <div className="v2-sa__head">
        {SPARK}
        <h2 className="v2-sa__t">Setup agent</h2>
        <label className="v2-sr" htmlFor={topicId}>Helping with</label>
        <select id={topicId} className="v2-sa__topic" value={here ?? ""} onChange={e => { const t = tracks.find(x => x.track === e.target.value); if (t) pick(t); }}>
          {!here && <option value="">{hereLabel ?? "Anything about your profile"}</option>}
          {shownTracks.map(t => <option key={t.track} value={t.track}>{t.label}{t.track !== here && t.status === "concluded" ? " (done)" : t.track !== here && t.status === "in_progress" ? " (in progress)" : ""}</option>)}
        </select>
        <button ref={closeBtn} type="button" className="v2-sa__x" aria-label={panel.sheet ? "Back to the profile" : "Hide the setup agent"} onClick={close}><span aria-hidden="true">✕</span></button>
      </div>

      {waking && <AgentState kind="waking" className="v2-sa__state">It sleeps when nobody's using it. Usually about 20 seconds; you can type now and your message waits for it.</AgentState>}
      {offline && (
        <AgentState kind="offline" className="v2-sa__state" title="The setup agent isn't connected.">
          {status?.message ? `${status.message} ` : ""}The forms still work{role === "platform_admin" ? ` (${status?.backend})` : ""}.
        </AgentState>)}
      {status?.connected && status.backend === "stub" && role === "platform_admin" && <p className="v2-sa__fine">Stub agent: canned replies and keyword routing, for building the UI.</p>}

      <div ref={log} className="v2-sa__log" role="log" aria-label="Conversation with the setup agent" aria-live="polite" aria-relevant="additions" tabIndex={0}>
        {folded.length > 0 && (
          <div className="v2-sa__earlier">Earlier: {foldedTopics.join(", ")} · <button type="button" className="v2-sa__link" onClick={() => c.setShowAll(true)}>show {folded.length}<span className="v2-sr"> earlier {folded.length === 1 ? "message" : "messages"}</span></button></div>)}
        {rows}
        {empty && <div className="v2-sa__ai">{institutionId
          ? `Tell me about ${hereLabel ? hereLabel.replace(/^Step \d+ · /, "").toLowerCase() : "any part of your profile"} in plain words, or ask me to check it. I draft each change as a card; nothing changes until you apply it.`
          : "I can set up your institution with you: what kind it is, where you operate, your customers and products, flows, rules, rivals and risks. Tell me in plain words; nothing is saved until you apply it. The forms work too."}</div>}
        {retryable && !working && <div className="v2-sa__retry"><Button size="sm" onClick={retry}>Try again</Button></div>}
        {live && <div className="v2-sa__ai">{live}<span className="v2-sa__caret" aria-hidden="true" /></div>}
        {working && (
          <div className="v2-sa__work" role="status">
            <span className="v2-dots" aria-hidden="true"><span /><span /><span /></span>
            <span>{busy ? (live ? "Writing…" : slow ? "Waiting for the setup agent… If it was asleep, the first reply can take up to a minute." : "Thinking…")
              : writing ? "A reply is still being written… it will appear here."
              : `Moving on to ${(def(nextUp) ?? { label: "the next section" }).label.toLowerCase()}…`}</span>
          </div>)}
      </div>

      <div className="v2-sa__foot">
        {starters.length > 0 && !working && (
          <div className="v2-sa__starters" role="group" aria-label="Things you could say">
            {starters.map(x => <button key={x} type="button" className="v2-sa__start" onClick={() => send({ text: x })}>{x}</button>)}
          </div>)}
        {left && <p className="v2-sa__count" role="status">{draft.length}/{MAX_CHARS}{draft.length >= MAX_CHARS ? " · That's the limit: keep to one topic, and send the rest after the reply." : ""}</p>}
        <div className="v2-sa__comp">
          <textarea ref={box} className="v2-sa__input" rows={2} aria-label="Message the setup agent" value={draft} maxLength={MAX_CHARS}
            placeholder={picked || here ? `About ${(picked ? def(picked)?.label : hereLabel)?.toLowerCase() ?? "your profile"}…` : institutionId ? "Ask or tell me about your institution…" : "e.g. We're a commercial bank with branches in two regions"}
            onChange={e => setDraft(e.target.value)} onKeyDown={onKey} />
          <Button variant="primary" aria-disabled={working || !draft.trim() ? true : undefined} onClick={submit} className={working || !draft.trim() ? "is-idle" : undefined}>Send</Button>
        </div>
        {working && <p className="v2-sa__fine" aria-live="polite">You can keep typing; Send works once the reply is done.</p>}
      </div>
    </aside>
  );
  // a sheet is drawn into <body>, so the page's own layout can't clip or trap it (as a Dialog is)
  return panel.sheet ? createPortal(<div className="v2 v2-sa-sheet">{aside}</div>, document.body) : aside;
}

// ---------------------------------------------------------------- one message

function Message({ m, proposals, flash, open, busy, onAnswer, onDecided, profileVersion, names, askAgain }: {
  m: ChatMessage; proposals: Record<string, Proposal>; flash: string | null; open: boolean; busy: boolean;
  onAnswer: (questionId: string, options: string[]) => void; onDecided: (p: Proposal) => void; profileVersion: number | null;
  names: Record<string, string | null>; askAgain: (text: string) => void;
}) {
  switch (m.kind) {
    case "session": return <div className="v2-sa__sys">New session · {dayTime(m.at)}{m.content.profile_version ? ` · profile v${m.content.profile_version}` : ""}
      {m.content.changes_since_last_session ? ` · ${plural(m.content.changes_since_last_session, "change")} since last time` : ""}</div>;
    case "track": return null;
    case "track_concluded": return <div className="v2-sa__sys">✓ {m.content.summary ?? "Track concluded"}</div>;
    case "applied": return <div className="v2-sa__sys">{m.content.status === "confirmed" ? "✓ Applied" : "✗ Not applied"}: {m.content.summary}
      {m.content.status === "failed" && m.content.detail ? ` · ${m.content.detail}` : ""}</div>;
    case "notes": return <div className="v2-sa__sys">Noted for later: {(m.content.notes ?? []).map((n: { track: string; text: string }) => `${n.track.replace(/_/g, " ")}: ${n.text}`).join(" · ")}</div>;
    case "error": return (
      <div className="v2-sa__sys v2-sa__err"><span><span aria-hidden="true">◆ </span>{m.content.message}</span>
        {(m.content.detail || m.content.code) && <details><summary>Details</summary><div className="v2-mono">{String(m.content.detail ?? m.content.code)}</div></details>}</div>);
    case "proposal": {
      const p = proposals[m.content.proposal_id];
      return p ? <ProposalCard p={p} flash={flash === p.proposal_id} onDecided={onDecided} profileVersion={profileVersion} names={names} askAgain={askAgain} /> : null;
    }
    case "question": return <Question m={m} open={open} busy={busy} onAnswer={onAnswer} />;
    default:
      if (m.role === "user") return <div className="v2-sa__me">{m.kind === "answer" ? (m.content.options ?? []).join(", ") : m.content.text}</div>;
      return (
        <div className="v2-sa__ai">{m.content.text}
          {m.content.unverified_numbers?.length > 0 && <div className="v2-sa__warn">◆ Not found in your data: {m.content.unverified_numbers.join(", ")}. Treat as the agent's own working, not a figure from your profile.</div>}</div>);
  }
}

/** The agent's question with its options: one button answers, or, when several may be chosen, the buttons pick and Send answers with all of them. */
function Question({ m, open, busy, onAnswer }: { m: ChatMessage; open: boolean; busy: boolean; onAnswer: (questionId: string, options: string[]) => void }) {
  const [chosen, setChosen] = useState<string[]>([]);
  const multi = m.content.multi === true;
  const click = (o: string) => { if (!multi) { onAnswer(m.content.question_id, [o]); return; } setChosen(c => (c.includes(o) ? c.filter(x => x !== o) : [...c, o])); };
  return (
    <>
      <div className="v2-sa__ai">{m.content.text}</div>
      {open && (
        <div className="v2-sa__chips" role="group" aria-label={multi ? "Pick one or more, then Send" : "Quick replies"}>
          {(m.content.options ?? []).map((o: string) => (
            <button key={o} type="button" className={`v2-sa__chip${chosen.includes(o) ? " is-on" : ""}`} aria-disabled={busy || undefined} aria-pressed={multi ? chosen.includes(o) : undefined}
              onClick={() => { if (!busy) click(o); }}>{multi && chosen.includes(o) ? "✓ " : ""}{o}</button>))}
          {multi && <Button size="sm" variant="primary" aria-disabled={busy || !chosen.length || undefined} onClick={() => { if (!busy && chosen.length) onAnswer(m.content.question_id, chosen); }}>{chosen.length > 1 ? `Send ${chosen.length}` : "Send"}</Button>}
        </div>)}
    </>
  );
}

// ---------------------------------------------------------------- a proposed change

const OP_TONE = { Add: "good", Change: "neutral", Remove: "bad" } as const;

function ProposalCard({ p, flash, onDecided, profileVersion, names, askAgain }: {
  p: Proposal; flash: boolean; onDecided: (p: Proposal) => void; profileVersion: number | null; names: Record<string, string | null>; askAgain: (text: string) => void;
}) {
  const toast = useToast(), refuse = useRefusalToast();
  const locked = useDemoLock();
  const [busy, setBusy] = useState(false);
  const [sure, setSure] = useState(false);
  const look = proposalLook(p);
  const decide = async (a: "confirm" | "reject", confirmDeletes?: number) => {
    if (a === "confirm" && p.deletes >= 3 && !confirmDeletes) { setSure(true); return; }
    setSure(false);
    setBusy(true);
    try { const x = await chat.decide(p.proposal_id, a, confirmDeletes); toast(a === "confirm" ? "Applied." : "Rejected; nothing changed."); onDecided(x); }
    catch (e) { refuse(e, a === "confirm" ? "Couldn't apply it" : "Couldn't reject it"); chat.proposal(p.proposal_id).then(onDecided).catch(() => {}); }
    finally { setBusy(false); }
  };
  const rows = p.kind === "monitors" ? [] : changeRows(p.changes, names);
  const pending = p.status === "pending";
  const titleId = useId(), whyId = useId();
  return (
    <section className={`v2-sa__card is-${look.kind}${flash ? " is-flash" : ""}`} data-proposal={p.proposal_id} aria-labelledby={titleId}>
      <div className="v2-sa__card-top">
        <span className="v2-cap v2-sa__card-cap">{look.cap}</span>
        <b id={titleId} className="v2-sa__card-t">{p.summary}</b>
        {look.kind === "expired" && <span className="v2-sa__card-why">{expiredWhy(p, profileVersion)}{" "}
          <button type="button" className="v2-sa__link" onClick={() => askAgain(`Please redo this: ${p.summary}`)}>Ask again</button></span>}
        {look.kind === "cant" && <span id={whyId} className="v2-sa__card-why is-bad">{cantApplyWhy(p)}</span>}
      </div>

      {look.kind !== "expired" && (p.kind === "monitors" ? (
        <ul className="v2-sa__chg">{p.changes.map((c, i) => (
          <li key={i} className="v2-sa__chg-m">
            <span className="v2-sa__chg-w">{c.op === "create" ? "New monitor" : "Change monitor"}</span>
            <span><b>{c.after?.name}</b><br />{c.after?.sentence}
              <ul className="v2-sa__tell">{(c.after?.tell_me_if ?? []).map((l: string) => <li key={l}>{c.before && !(c.before.tell_me_if ?? []).includes(l) ? <ins>{l}</ins> : l}</li>)}</ul>
              <span className="v2-sa__chg-d">Where: {Array.isArray(c.after?.places) ? c.after.places.join(", ") : String(c.after?.places ?? "")} · every {c.after?.check_frequency >= 1440 ? "day" : c.after?.check_frequency >= 360 ? "6 hours" : "hour"}</span></span>
          </li>))}
        </ul>) : rows.length > 0 && (
        <ul className="v2-sa__chg">{rows.map((r, i) => (
          <li key={i}>
            <span className={`v2-pill v2-pill--${OP_TONE[r.op]} v2-sa__op`}>{r.op}</span>
            <span className="v2-sa__chg-w">{r.what}</span>
            <span className="v2-sa__chg-n">{r.name}{r.detail ? <span className="v2-sa__chg-d"> · {r.detail}</span> : null}
              {r.fields.length > 0 && <span className="v2-sa__diff">{r.fields.map(f => (
                <Fragment key={f.label}><span className="v2-sa__diff-k">{f.label}</span><span><del>{f.before}</del> <span aria-hidden="true">→</span><span className="v2-sr"> became </span> <ins>{f.after}</ins></span></Fragment>))}</span>}</span>
          </li>))}
        </ul>))}

      {p.kind === "monitors" && pending && <p className="v2-sa__card-note">Applying submits {p.changes.length === 1 ? "it" : "them"} for approval; a Risk Manager makes {p.changes.length === 1 ? "it" : "them"} live on the Monitors page.</p>}
      {p.kind === "monitors" && p.status === "confirmed" && (p.result?.monitors ?? []).length > 0 && (
        <p className="v2-sa__card-note">{(p.result?.monitors ?? []).map((m: { monitor_id: string; name: string }) => <Link key={m.monitor_id} to={`/monitors/${m.monitor_id}`}>{m.name} →</Link>)}</p>)}
      {p.warnings.length > 0 && look.kind !== "expired" && <p className="v2-sa__card-note">{p.warnings.map(w => w.message).join(" · ")}</p>}
      {p.status === "failed" && p.result && <p className="v2-sa__card-note is-bad">{String(p.result.detail ?? "")}</p>}

      {pending && (
        <div className="v2-sa__card-foot">
          <span className="v2-sa__fits">{look.kind === "cant" ? "" : locked ? "Applying is switched off for this demo." : p.deletes >= 3 ? `✓ Fits the profile · removes ${p.deletes} items` : "✓ Fits the profile"}</span>
          <Button size="sm" disabled={busy} onClick={() => decide("reject")}>{look.kind === "cant" ? "Dismiss" : "Reject"}</Button>
          <Button size="sm" variant="primary" locked={locked} disabled={busy || p.fits === false} aria-describedby={look.kind === "cant" ? whyId : undefined} onClick={() => decide("confirm")}>Apply</Button>
        </div>)}

      {sure && (
        <Dialog title={`This change deletes ${p.deletes} items`} onClose={() => setSure(false)} footer={<>
          <Button onClick={() => setSure(false)}>Cancel</Button>
          <Button className="v2-btn--danger" locked={locked} onClick={() => decide("confirm", p.deletes)}>Delete {p.deletes} and apply</Button></>}>
          <p className="v2-in-dlgtext">{removesText(p.changes) || `${p.deletes} items`}. History keeps them, and you can undo the whole change.</p>
        </Dialog>)}
    </section>
  );
}
