// The setup agent's chat, without a look: its state and its calls, for whichever panel draws it. One thread per institution
// (shared by every viewer), the topic ("track") the chat is on, the proposals to apply or reject, the agent waking or offline.
// Drawn by the Institution page's panel (pages/institution/SetupAgent.tsx) and by the guided setup's (SetupChat.tsx, until P15).
//
// Asking, and how often: the thread and the agent's status when the panel opens, and after each turn. The agent's status again every
// 10 s while it is starting (every 2.5 s if this viewer has sent something), and every few minutes only while someone is using the
// page (when the server asks for keep-warm). A reply being written by someone else is looked at every 15 s, for a few minutes at most.
// No polling while the tab is hidden.
import { useCallback, useContext, useEffect, useRef, useState } from "react";
import { ApiError } from "../api/client";
import { chat, type AssistantStatus, type ChatMessage, type Proposal, type TrackDef, type TrackState } from "../api/assistant";
import { useInstallation } from "../App";
import { continuedTo, continueText, nextOpen, startersFor, trackFor, waitingForAnswer } from "./setupFlow";
import { ChatToggleCtx, useRole, useToast } from "./ui";

// Applying the new institution remounts the chat (it now belongs to the institution): the move to the next
// track is handed over through here, and dropped if nobody picks it up soon.
const NEXT_KEY = "amiri.setupNext";
// One message, one topic: room for a few sentences (the longest real answers are about 250 characters), not a pasted
// essay covering every section at once. The server's own limit (4,000) stays as the backstop.
export const MAX_CHARS = 600;
// Errors that waiting can fix, so the chat offers "Try again" (the agent's, then the server's codes).
const RETRYABLE = new Set(["models_busy", "turn_timeout", "server_unavailable",
  "assistant_timeout", "assistant_unavailable", "assistant_not_connected", "agent_session_lost"]);

/** Where the page is: a guided-setup step or an Institution tab, and how to name it ("Step 3 · Customers"). */
export interface ChatAt { step?: string; tab?: string; label?: string }

export interface SetupChatProps {
  institutionId: string | null;
  onTrack?: (t: TrackDef) => void;                         // the tab (or setup step) to follow
  onApplied?: (p: Proposal) => void;                       // a proposal was applied (reload; a new institution)
  at?: ChatAt;                                             // the page's place: the chat follows it
  askKey?: number;                                         // bumped by "Ask the Setup agent": focus the message box
}

/** The chat's state and actions, for whichever look draws it: the Institution page's panel (pages/institution/SetupAgent.tsx)
 *  or the guided setup's (SetupChat below, until P15). */
export function useSetupChat({ institutionId, onTrack, onApplied, at, askKey = 0 }: SetupChatProps) {
  const chatToggle = useContext(ChatToggleCtx);
  const toast = useToast();
  const { role } = useRole();
  const installation = useInstallation();  // the chat's starters follow the institution's home country
  const country = institutionId && installation?.institution_id === institutionId ? installation.home_country : null;
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
  const box = useRef<HTMLTextAreaElement>(null);
  const def = (id: string | null) => defs.find(d => d.track === id);

  const [writing, setWriting] = useState(false);  // a reply still being written (after a reload or from another tab)
  const load = useCallback(async () => {
    const th = await chat.thread(institutionId);
    setTracks(th.tracks); setCurrent(th.current_track); setMessages(th.messages); setSessionId(th.active_session_id);
    setProposals(Object.fromEntries(th.proposals.map(p => [p.proposal_id, p])));
    setWriting(th.turn_in_progress);
    return th;
  }, [institutionId]);
  // Every viewer shares the one thread, so a reply being written may be someone else's: look at it now and then (slowly,
  // not while the tab is hidden, and for a few minutes at most). Only a viewer who sent something looks every few seconds.
  const acted = useRef(false);
  useEffect(() => {
    if (!writing || busy) return;
    const until = Date.now() + 3 * 60_000;
    const t = setInterval(() => { if (!document.hidden && Date.now() < until) load().catch(() => {}); }, acted.current ? 3000 : 15_000);
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
    const t = setInterval(() => { if (!document.hidden && Date.now() < until) checkStatus(); }, acted.current ? 2500 : 10_000);
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
  // new words scroll the log to the end, unless the reader has scrolled up to look at something (then it stays put)
  const shown = useRef(0);
  useEffect(() => {
    const el = log.current;
    if (!el) return;
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < 160;
    const mine = messages[messages.length - 1]?.role === "user";
    if (near || mine || shown.current === 0) el.scrollTo({ top: el.scrollHeight });
    shown.current = messages.length;
  }, [messages.length, live]);
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

  const send = async (body: { text?: string; answer?: { question_id: string; options: string[] } }, to?: string) => {
    if (busy) return;
    acted.current = true;
    setBusy(true); setHeard(false);
    const track = to ?? picked;
    try {
      let sid = sessionId;
      if (!sid) { const s = await chat.start(institutionId); sid = s.session_id; setSessionId(sid); await load(); }
      const mine: ChatMessage = { message_id: -Date.now(), session_id: sid, track: track ?? current, role: "user",
        kind: body.text ? "text" : "answer", content: body.text ? { text: body.text } : body.answer!, at: new Date().toISOString() };
      setMessages(m => [...m, mine]);
      let text = "";
      let here = track ?? current, ended: string | null = null;  // the turn's track, and a track the agent concluded in it
      let leftOpen = false;  // the reply asked a new question or brought a card to apply
      const onEvent = ({ event, data }: { event: string; data: Record<string, any> }) => {
        if (event !== "start") setHeard(true);
        if (event === "text_delta") { text += data.text; setLive(text); return; }
        if (event === "start" || event === "done") return;
        if (event === "track") {
          here = data.track;
          setCurrent(data.track); markTrack(data.track, "in_progress"); follow(data.track);
          setMessages(m => m.map(x => (x.message_id === mine.message_id ? { ...x, track: data.track } : x)));  // it led here
        }
        if (event === "track_concluded") { markTrack(data.track, "concluded"); ended = data.track; }
        if (event === "question" || event === "proposal") leftOpen = true;
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
      // The agent closed the track it was in without anything to apply ("nothing to add here"): move on, as an
      // applied proposal does. A track closed in passing, while the chat is elsewhere, doesn't move it.
      if (ended && ended === here) {
        const next = nextOpen(tracks.map(t => (t.track === ended ? { ...t, status: "concluded" as const } : t)), ended);
        if (next) setNextUp(next.track);
        setHeld(null);
      } else if (held) {
        // The question that held a move back is answered. Still in that track and nothing new to apply or answer:
        // go ahead. A new card or question keeps waiting (its Apply moves on as usual); another track drops it.
        if (here !== held.from) setHeld(null);
        else if (!leftOpen) { setNextUp(held.to); setHeld(null); }
      }
    } catch (e) {
      if (e instanceof ApiError && e.code === "turn_in_progress") { setWriting(true); setMessages(m => m.filter(x => x.message_id >= 0)); }
      toast(e instanceof ApiError ? e.full : String(e));
    }
    finally { setBusy(false); setLive(null); load().catch(() => {}); checkStatus(); }
  };

  const pick = (t: TrackState) => {
    setPicked(t.track); follow(t.track); setHeld(null);  // steering by hand: no move waits any more
  };
  // Moving on: the next track's tab, and a turn in it, so the agent leads with its first question (using what was
  // noted for it) instead of waiting for the person to type.
  const advance = (t: TrackState) => { follow(t.track); send({ text: continueText(t.label) }, t.track); };
  // The move waits here until the agent's turn is over: a card can be applied while the agent is still writing
  // the text after it, and a new turn can't start until that one ends.
  const [nextUp, setNextUp] = useState<string | null>(null);
  // A move held back by a question the agent asked with its proposal: it goes ahead once that question is answered
  // and the reply leaves nothing else open (no new card to apply, no new question) in the same track.
  const [held, setHeld] = useState<{ from: string; to: string } | null>(null);
  const decided = (p: Proposal) => {
    setProposals(ps => ({ ...ps, [p.proposal_id]: p }));
    setHeld(null);  // an apply moves on by itself (below); "Not now" stays
    if (p.status !== "confirmed") return;
    markTrack(p.track, "concluded");
    // only for the track the chat is in, so applying an older card from the history doesn't move it
    const next = p.track === (picked ?? current) ? nextOpen(tracks, p.track) : null;
    if (next && p.kind === "create_institution") {
      try { sessionStorage.setItem(NEXT_KEY, JSON.stringify({ track: next.track, at: Date.now() })); } catch { /* */ }
    }
    follow(p.track); onApplied?.(p); load().catch(() => {});  // the page follows the move itself (advance), not before it
    if (next && p.kind !== "create_institution") setNextUp(next.track);
  };
  useEffect(() => {  // the handed-over move, once this chat (the new institution's) has loaded
    if (!institutionId || !tracks.length || !defs.length) return;
    let next: { track: string; at: number } | null = null;
    try { next = JSON.parse(sessionStorage.getItem(NEXT_KEY) ?? "null"); sessionStorage.removeItem(NEXT_KEY); } catch { /* */ }
    if (next && Date.now() - next.at < 60_000) setNextUp(next.track);
  }, [institutionId, tracks.length, defs.length]);
  useEffect(() => {  // the queued move, once no turn is running
    if (!nextUp || busy || writing || !tracks.length) return;
    const t = tracks.find(x => x.track === nextUp);
    setNextUp(null);
    if (!t) return;
    // The agent asked something along with its proposal ("any places to watch?") and it isn't answered yet:
    // stay for the answer, and move on after it (see send).
    if (waitingForAnswer(messages)) { const from = picked ?? current; if (from) setHeld({ from, to: t.track }); }
    else advance(t);
  }, [nextUp, busy, writing, tracks.length]);  // eslint-disable-line react-hooks/exhaustive-deps
  // the agent is busy with something: this chat's reply, one still running on the server (a reload, another tab), or
  // the move to the next section waiting its turn. The message box waits too.
  const working = busy || writing || nextUp !== null;
  // The last turn failed in a way that waiting can fix (models busy or out of quota, a timeout, the agent starting
  // or unreachable): offer to send the same message again. Errors that would fail the same way get no button.
  const lastMsg = messages[messages.length - 1];
  const retryable = lastMsg?.kind === "error" && RETRYABLE.has(lastMsg.content.code);
  const retry = () => {
    const u = [...messages].reverse().find(m => m.role === "user" && (m.kind === "text" || m.kind === "answer"));
    if (!u) return;
    const moved = u.kind === "text" ? continuedTo(tracks, u.content.text) : null;  // a "continue with …" keeps its track
    send(u.kind === "answer" ? { answer: { question_id: u.content.question_id, options: u.content.options } } : { text: u.content.text },
      moved?.track);
  };
  const here = picked ?? current;
  const [showAll, setShowAll] = useState(false);
  useEffect(() => setShowAll(false), [here]);  // a new topic starts folded again
  // The page is the single source of "where": a step or tab clicked there sets the chat's topic, as picking it here would.
  // (a tab two topics share keeps the one the chat is on: Verification opens the overview, as Institution does)
  const atTrack = trackFor(defs, at ?? {}, here)?.track ?? null;
  useEffect(() => {
    if (!atTrack || atTrack === (picked ?? current)) return;
    setPicked(atTrack); setHeld(null);
  }, [atTrack]);  // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (askKey) box.current?.focus(); }, [askKey]);
  useEffect(() => {  // the message box grows with what is typed, up to about eight lines
    const t = box.current; if (!t) return;
    if (!draft) { t.style.height = ""; return; }
    t.style.height = "auto"; t.style.height = `${Math.min(t.scrollHeight + 2, 200)}px`;
  }, [draft]);
  const hereLabel = here && here === atTrack && at?.label ? at.label : def(here)?.label ?? null;
  const starters = here && !working && !messages.some(m => m.track === here && m.role === "user") ? startersFor(country)[here] ?? [] : [];
  const answered = new Set(messages.filter(m => m.kind === "answer").map(m => m.content.question_id));
  const lastQuestion = [...messages].reverse().find(m => m.kind === "question");
  const shownTracks = tracks.filter(t => t.shown);

  // The thread follows the topic: other topics' messages fold into one "Earlier" line (while a reply is coming the
  // latest exchange always shows, so a reply that moves to another topic isn't hidden).
  const lastUser = busy || writing ? messages.map(m => m.role === "user").lastIndexOf(true) : messages.length;
  const trackOf = (m: ChatMessage) => (m.track && def(m.track)?.shown ? m.track : null);
  const visible = showAll || !here ? messages : messages.filter((m, k) => k >= lastUser || !trackOf(m) || trackOf(m) === here);
  const folded = messages.filter(m => !visible.includes(m) && m.kind !== "track" && m.kind !== "session");
  const foldedTopics = [...new Set(folded.map(m => def(trackOf(m))?.label).filter(Boolean))];
  return {
    chatToggle, toast, status, role, def, tracks, current, picked, here, hereLabel, atTrack, messages, proposals, visible, folded, foldedTopics,
    setShowAll, shownTracks, starters, working, busy, writing, nextUp, slow, live, retryable, retry, send, pick, decided, flash, answered,
    lastQuestion, institutionId, draft, setDraft, box, log, country,
  };
}

export const ASK_EVENT = "amiri:ask-setup";
/** Opens the setup agent beside the page and focuses its message box. */
export const askSetupAgent = () => window.dispatchEvent(new Event(ASK_EVENT));

