// The open monitor (board 06; states: board 16 section G, board 13 section 3): its question, when it tells you, what each check
// found, and what can be done with it: Check now (a draft or a paused one is a test, its findings kept apart), Edit, approve or
// send back a pending version, pause, resume, retire. Shown beside the list; on a phone it is the page, with a back link.
//
// Asking, and how often (the server asks the monitor agent each time it is asked about a running check, so nothing is asked
// about unless this viewer pressed Check now; UI_POLLING_NOTE.md):
//   passive: the monitor, its checks and its findings every 60 s, and not while the tab is hidden.
//   Check now: the check every 3 s while it is `running`, up to 2 min; then one of its findings per investigation run every 3 s until it lands.
//
// Editing: monitors have no If-Match on the server, so before a save the page asks for the monitor again and compares it with
// what the form was opened on (words.ts changedSince); a 412 from the server would show the same way. The person's text is put
// on the clipboard at once.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ApiError } from "../../api/client";
import type { Profile } from "../../api/institutions";
import { monitorsApi, type CheckRow, type Monitor, type MonitorFinding, type MonitorSpec, type MonitorsStatus } from "../../api/monitors";
import { investigationApi } from "../../api/investigation";
import { useDemoLock } from "../../components/lock";
import { useNow, useRefusalToast, useToast } from "../../components/ui";
import { Button } from "../../components/v2/Button";
import { Dialog } from "../../components/v2/Dialog";
import { EditConflict } from "../../components/v2/EditConflict";
import { LoadError } from "../../components/v2/LoadError";
import { MoreMenu } from "../../components/v2/MoreMenu";
import { Skeleton } from "../../components/v2/Skeleton";
import { StaleBanner } from "../../components/v2/StaleBanner";
import { isEditConflict } from "../../components/v2/states";
import { ago, person } from "../../format";
import { landed } from "../findings/words";
import { pollRun, POLL_EVERY_MS, POLL_FOR_MS } from "../events/poll";
import { Approval, Checks, Details, Examples, PaneTop, Question, Reaches, Versions } from "./pane";
import { errorsOf, exposureOptions, MonitorForm } from "./form";
import {
  awaitingApproval, changedSince, changesText, checkDoneText, DONE_WORDS, findingsByCheck, investigatedText, refusalTitle, slotsWords, waitingOn,
  type FormErrors,
} from "./words";

const REFRESH_MS = 60_000;      // passive: no faster than every 30 s
const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

export interface PaneProps {
  /** The monitor's id, or "new". */
  id: string;
  status: MonitorsStatus | null;
  profile: Profile | null;
  /** Each event's name, as the other pages show it (loaded once the page has findings that joined events). */
  eventTitles: Record<string, string>;
  askEventTitles: () => void;
  /** The list changed (a status, a name): load it again. */
  onChanged: () => void;
  onDraft: () => void;
  /** The list is already saying it is out of date: one banner is enough. */
  listStale?: boolean;
}

export function MonitorPane({ id, status, profile, eventTitles, askEventTitles, onChanged, onDraft, listStale }: PaneProps) {
  const isNew = id === "new";
  const nav = useNavigate();
  const toast = useToast(), refuse = useRefusalToast();
  const locked = useDemoLock();
  const now = useNow(30_000);
  const [m, setM] = useState<Monitor | null>(null);
  const [runs, setRuns] = useState<CheckRow[]>([]);
  const [findings, setFindings] = useState<MonitorFinding[]>([]);
  const [err, setErr] = useState<unknown>(null);
  const [loadedAt, setLoadedAt] = useState<number | null>(null);
  const [editing, setEditing] = useState<boolean | null>(null);   // null: the default for its state
  const [epoch, setEpoch] = useState(0);                          // a form opened afresh gets a new key; a refresh of the monitor never replaces what a person is typing
  const [busy, setBusy] = useState(false);                       // a button's call is on
  const [saving, setSaving] = useState(false);
  const [starting, setStarting] = useState(false);               // Check now was pressed, the server hasn't answered
  const [runWait, setRunWait] = useState<string | null>(null);   // the check this viewer started, asked about every 3 s
  const [watching, setWatching] = useState(0);                   // findings asked about every 3 s
  const [conflict, setConflict] = useState<{ fresh: Monitor | null } | null>(null);
  const [asking, setAsking] = useState(false);                   // the "what should change?" box
  const [note, setNote] = useState("");
  const [retiring, setRetiring] = useState(false);
  const alive = useRef(true);
  const seq = useRef(0);
  const inflight = useRef(new Set<string>());
  const loaded = useRef(0);
  const copyText = useRef("");                                    // the person's unsaved text, for Copy my changes
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  // ---------------------------------------------------------------- loading
  const load = useCallback(async () => {
    if (isNew) return null;
    const mine = ++seq.current;
    try {
      const [mm, r, f] = await Promise.all([monitorsApi.get(id), monitorsApi.runs(id), monitorsApi.findings(id)]);
      if (!alive.current || mine !== seq.current) return null;
      setM(mm); setRuns(r); setFindings(f); setErr(null); setLoadedAt(Date.now()); loaded.current = Date.now();
      return { m: mm, runs: r, findings: f };
    } catch (e) { if (alive.current && mine === seq.current) setErr(e); return null; }
  }, [id, isNew]);
  useEffect(() => {
    if (isNew) return;
    load();
    const t = setInterval(() => { if (!document.hidden) load(); }, REFRESH_MS);
    const vis = () => { if (!document.hidden && Date.now() - loaded.current > 30_000) load(); };   // back on the tab: catch up, but not in a burst
    document.addEventListener("visibilitychange", vis);
    return () => { clearInterval(t); document.removeEventListener("visibilitychange", vis); };
  }, [load, isNew]);
  useEffect(() => { if (findings.some(f => f.outcome?.event_id)) askEventTitles(); }, [findings, askEventTitles]);

  // ---------------------------------------------------------------- asking: only after Check now, every 3 s, for 2 min
  const watchFindings = useCallback((ids: string[]) => {
    const todo = ids.filter(x => !inflight.current.has(x));
    if (!todo.length) return;
    todo.forEach(x => inflight.current.add(x));
    setWatching(inflight.current.size);
    const open = new Set(todo);
    let linked = 0;
    pollRun({
      wait: sleep, cancelled: () => !alive.current, every: POLL_EVERY_MS, forAtMost: POLL_FOR_MS,
      stillRunning: async () => {
        const rows = await Promise.all([...open].map(x => investigationApi.finding(x).catch(() => null)));   // a failed ask is asked again
        for (const f of rows) if (f && landed(f.status)) { open.delete(f.finding_id); if (f.status === "linked") linked++; }
        return open.size > 0;
      },
    }).then(async end => {
      todo.forEach(x => inflight.current.delete(x));
      if (!alive.current) return;
      setWatching(inflight.current.size);
      await load();
      const words = investigatedText(end, linked);
      if (words) toast(words);
    });
  }, [load, toast]);

  const checkEnded = useCallback(async (r: CheckRow, test: boolean) => {
    toast(checkDoneText(r, test));
    onChanged();   // the list's "fired 2 h ago"
    const d = await load();
    if (d && !test && r.status !== "failed") watchFindings(waitingOn(d.findings, r.run_id));
  }, [load, onChanged, toast, watchFindings]);

  const checkNow = async () => {
    if (!m) return;
    const test = m.status !== "live";
    setStarting(true);
    try {
      const first = await monitorsApi.runNow(m.monitor_id);
      if (first.status !== "running") { await checkEnded(first, test); return; }
      load();
      setRunWait(first.run_id);
      let last = first;
      const end = await pollRun({
        wait: sleep, cancelled: () => !alive.current, every: POLL_EVERY_MS, forAtMost: POLL_FOR_MS,
        stillRunning: async () => { last = await monitorsApi.check(first.run_id); return last.status === "running"; },
      });
      if (!alive.current) return;
      setRunWait(null);
      if (end === "timeout") { toast("Still working; it will appear here."); load(); return; }
      await checkEnded(last, test);
    } catch (e) {
      refuse(e, refusalTitle((e as ApiError | undefined)?.code));
      load();   // the refusal says things moved (a check already running, the agent offline): show them
    } finally { if (alive.current) { setStarting(false); setRunWait(null); } }
  };

  // ---------------------------------------------------------------- the buttons
  const openEdit = () => { setEpoch(e => e + 1); setEditing(true); };
  const act = async (a: keyof typeof DONE_WORDS) => {
    if (!m) return;
    setBusy(true);
    try {
      const r = await monitorsApi.act(m.monitor_id, a);
      toast(DONE_WORDS[a]);
      if (alive.current) setM(r);
      onChanged(); load();
    } catch (e) { refuse(e, refusalTitle((e as ApiError | undefined)?.code)); load(); onChanged(); }
    finally { if (alive.current) setBusy(false); }
  };
  const sendBack = async () => {
    if (!m) return;
    setBusy(true);
    try {
      const r = await monitorsApi.requestChanges(m.monitor_id, note.trim());
      toast("Sent back with your note");
      setAsking(false); setNote("");
      if (alive.current) setM(r);
      onChanged(); load();
    } catch (e) { refuse(e, refusalTitle((e as ApiError | undefined)?.code)); load(); }
    finally { if (alive.current) setBusy(false); }
  };

  // ---------------------------------------------------------------- saving the form
  const startConflict = (fresh: Monitor | null, spec: MonitorSpec, n: string) => {
    const text = changesText(spec, n || undefined);
    copyText.current = text;
    setConflict({ fresh });
    try { navigator.clipboard?.writeText(text)?.catch(() => {}); } catch { /* no clipboard: Copy my changes asks again */ }
  };
  const saveForm = async (spec: MonitorSpec, n: string, submit: boolean, opened: { latest_version: number; updated_at: string } | null): Promise<FormErrors | null> => {
    setSaving(true);
    try {
      if (m && opened) {
        const fresh = await monitorsApi.get(m.monitor_id);
        if (changedSince(opened, fresh)) { startConflict(fresh, spec, n); return null; }
      }
      const before = m?.latest_version;
      let saved = m ? await monitorsApi.update(m.monitor_id, spec, n || undefined) : await monitorsApi.create(spec, n || undefined);
      const unchanged = !!m && saved.latest_version === before && JSON.stringify(saved.spec) === JSON.stringify(m.spec);
      const waiting = saved.versions[saved.versions.length - 1]?.status === "submitted";
      const live = !!m && (m.status === "live" || m.status === "paused");
      if (submit && waiting) toast(unchanged ? `No changes: version ${saved.latest_version} is already waiting for approval` : "Saved");
      else if (submit) {
        saved = await monitorsApi.act(saved.monitor_id, "submit");
        toast(`Version ${saved.latest_version} submitted: a Risk Manager approves it here`);
      } else toast(unchanged ? "No changes to save" : live ? `Saved as version ${saved.latest_version}, a draft; version ${m!.live_version} keeps running` : "Draft saved");
      setConflict(null);
      onChanged();
      if (!m) nav(`/monitors/${saved.monitor_id}`, { replace: true });
      else { setM(saved); setEditing(false); load(); }
      return null;
    } catch (e) {
      if (isEditConflict(e) && m) { startConflict(await monitorsApi.get(m.monitor_id).catch(() => null), spec, n); return null; }
      const fields = errorsOf(e);
      if (fields) return fields;
      refuse(e, refusalTitle((e as ApiError | undefined)?.code) ?? "Couldn't save the monitor");
      return null;
    } finally { if (alive.current) setSaving(false); }
  };

  // ---------------------------------------------------------------- what is shown
  const labels = useMemo(() => Object.fromEntries(exposureOptions(profile).flatMap(([, xs]) => xs)), [profile]);
  const byCheck = useMemo(() => findingsByCheck(findings), [findings]);
  if (isNew) {
    return (
      <article className="v2-panel v2-mn-pane" aria-labelledby="mn-title">
        <div className="v2-mn-new">
          <h2 id="mn-title" tabIndex={-1} className="v2-mn-h2">New monitor</h2>
          <Button locked={locked} onClick={onDraft}>Draft from your profile</Button>
        </div>
        <p className="v2-mn-sentence v2-mn-sentence--new">Say in plain words what to watch for. It runs once a Risk Manager approves it.</p>
        <MonitorForm m={null} profile={profile} status={status} onSave={saveForm} busy={saving} />
      </article>
    );
  }
  if (!m) {
    return err != null
      ? <LoadError error={err} onRetry={load} what="this monitor" className="v2-mn-error" />
      : <div className="v2-panel v2-mn-pane"><Skeleton rows={6} label="Loading the monitor" /></div>;
  }

  // a check from the schedule or another viewer, started in the last half hour (an older one that never ended is the tick's to collect): not asked about here
  const elsewhere = runs.some(r => r.status === "running" && now.getTime() - new Date(r.created_at).getTime() < 30 * 60_000);
  const running = starting || !!runWait || elsewhere;
  const editMode = editing ?? (m.status === "draft" && m.drafted_fields.length > 0 && !m.last_check);
  const approving = awaitingApproval(m) || m.status === "draft" || m.pending?.status === "draft";
  const retired = m.status === "retired";
  const full = m.status === "paused" ? slotsWords(status) : null;
  const connected = status ? status.connected : true;
  const stale = err != null && loadedAt != null && !listStale;
  const test = m.status !== "live";
  const who = conflict?.fresh ? conflict.fresh.versions[conflict.fresh.versions.length - 1] : null;
  const sentBack = (() => { const l = m.versions[m.versions.length - 1]; return l?.status === "draft" && l.note && l.submitted_at ? l.note : null; })();

  const actions = retired ? null : editMode ? null : (
    <>
      <Button disabled={running || !connected} aria-describedby={!connected ? "mn-offline" : undefined} onClick={checkNow}
        title={test ? "Test it now; what it finds is kept apart from your real findings" : undefined}>
        {running ? "Checking…" : test ? "Run a test" : "Run a check now"}</Button>
      {m.status === "paused" && <Button locked={locked} disabled={busy || !!full} onClick={() => act("resume")}>Resume</Button>}
      <Button locked={locked} onClick={openEdit}>Edit</Button>
      <MoreMenu label={m.status === "live" ? "More: pause or retire" : "More: retire"} items={[
        ...(m.status === "live" ? [{ label: "Pause", locked, onSelect: () => act("pause") }] : []),
        { label: "Retire this monitor", locked, danger: true, onSelect: () => setRetiring(true) },
      ]} />
    </>);

  return (
    <article className="v2-panel v2-mn-pane" aria-labelledby="mn-title" aria-busy={running || undefined}>
      {stale && <StaleBanner loadedAt={loadedAt!} now={now.getTime()} onRetry={load} className="v2-mn-stale" />}
      {conflict && (
        <EditConflict what="this monitor" who={who ? person(who.created_by) || "A colleague" : "A colleague"} name={m.name} when={ago(conflict.fresh?.updated_at ?? m.updated_at, now)}
          onReload={() => { setConflict(null); setEditing(false); load(); onChanged(); }}
          onCopy={() => navigator.clipboard.writeText(copyText.current)} className="v2-mn-conflict" />)}
      <PaneTop m={m} now={now} actions={actions} />
      {!connected && !retired && <span id="mn-offline" className="v2-sr">Monitors can't check the news right now, so {test ? "a test" : "a check"} can't start.</span>}
      {full && <p className="v2-mn-why" role="status">{full} Resume needs a free place.</p>}
      <h2 id="mn-title" tabIndex={-1} className="v2-mn-h2">{m.name}</h2>
      {running && <p className="v2-mn-now" role="status"><span className="v2-dots" aria-hidden="true"><span /><span /><span /></span><b>{test ? "Testing…" : "Checking the news…"}</b><span className="v2-mn-now__m">{elsewhere && !starting && !runWait ? "a check is already running; it appears here when it ends" : "usually 10–40 seconds"}</span></p>}
      {!running && watching > 0 && <p className="v2-mn-now" role="status"><span className="v2-dots" aria-hidden="true"><span /><span /><span /></span><b>Working on it…</b><span className="v2-mn-now__m">The investigation is looking at what it found. Results appear here.</span></p>}

      {editMode ? (
        <>
          {sentBack && <p className="v2-mn-fine"><b>Changes requested:</b> {sentBack}</p>}
          <MonitorForm key={`${m.monitor_id}-${epoch}`} m={m} profile={profile} status={status} busy={saving} onSave={saveForm} onCancel={() => { setEditing(false); setConflict(null); }} />
        </>
      ) : (
        <>
          {approving && !retired && (
            <Approval m={m} status={status} busy={busy} onApprove={() => act("approve")} onSubmit={() => act("submit")} onAskChanges={() => setAsking(true)} onEdit={openEdit} />)}
          <Question m={m} findings={findings} />
          <div className="v2-mn-folds">
            <Reaches m={m} labels={labels} />
            <Examples m={m} />
            <Details m={m} names={profile?.place_names ?? {}} />
            <Versions m={m} />
          </div>
          <Checks m={m} runs={runs} byCheck={byCheck} events={eventTitles} now={now} checking={runWait} />
        </>
      )}

      {asking && (
        <Dialog title="What should change?" onClose={() => { setAsking(false); setNote(""); }} initialFocus="textarea"
          footer={<><Button variant="quiet" onClick={() => { setAsking(false); setNote(""); }}>Cancel</Button>
            <Button variant="primary" locked={locked} disabled={busy || note.trim().length < 3} onClick={sendBack}>Send back</Button></>}>
          <p className="v2-mn-dlg__p">The version goes back to its writer as a draft, with your note on top.</p>
          <label className="v2-mn-dlg__l" htmlFor="mn-note">Your note</label>
          <textarea id="mn-note" className="v2-mn-input" rows={4} maxLength={500} value={note} onChange={e => setNote(e.target.value)} placeholder="Add Qatar to the places, and drop the second line" />
        </Dialog>)}
      {retiring && (
        <Dialog title={`Retire ${m.name}?`} onClose={() => setRetiring(false)}
          footer={<><Button variant="quiet" onClick={() => setRetiring(false)}>Cancel</Button>
            <Button variant="primary" locked={locked} disabled={busy} onClick={async () => { setRetiring(false); await act("retire"); }}>Retire</Button></>}>
          <p className="v2-mn-dlg__p">It stops being checked and moves to Retired on the list. Its findings stay where they are. This can't be undone.</p>
        </Dialog>)}
    </article>
  );
}
