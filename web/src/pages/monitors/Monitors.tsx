// Monitors: the list, the status badges and actions shared with the monitor page, and
// "Draft from the profile" (code fills the sentence, lines and chips from a profile item).
import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ApiError } from "../../api/client";
import { EVERY, monitorsApi, type CheckRow, type Draftable, type MonitorFinding, type MonitorRow, type MonitorsStatus, type MonitorStatus } from "../../api/monitors";
import { HowItWorks, PageHeader, StatusPill } from "../../components/blocks";
import { FlowFilter } from "../../components/FlowFilter";
import { Icon } from "../../components/Icon";
import { Banner, Empty, Modal, useNow, useRole, useToast, InlineSkeleton, LoadError } from "../../components/ui";
import { ago, due } from "../../format";
import { count, everyText, MONITOR_STATUS, undated } from "../../plain";
import "../../styles/monitors.css";

export function StatusBadge({ status }: { status: MonitorStatus }) {
  const [text, tone] = MONITOR_STATUS[status];
  return <StatusPill tone={tone}>{text}</StatusPill>;
}

export const ORIGIN: Record<string, string> = { profile: "drafted from the profile", setup: "drafted in setup", radar_story: "from a Radar story", template: "from a template" };

export function useMonitorsStatus() {
  const [status, setStatus] = useState<MonitorsStatus | null>(null);
  const load = useCallback(() => monitorsApi.status().then(setStatus).catch(() => {}), []);
  useEffect(() => { load(); }, [load]);
  return { status, reload: load };
}

/** How monitor checks work: behind the page's "How this works" link. */
export function MonitorHelp({ status }: { status: MonitorsStatus | null }) {
  return (
    <HowItWorks>
      <p>A monitor watches the news for something you care about. It runs once a Risk Manager approves it. What it finds goes to the investigation like any other finding.</p>
      {status && <p>Each check reads news published since the last one (up to {status.web_queries_per_check} searches). In this prototype a monitor is checked at most every {EVERY[status.min_frequency_minutes] ?? `${status.min_frequency_minutes} minutes`}, and up to {status.live_max} can be live. If a check can't read the news, it tries again within the hour and nothing is lost.</p>}
    </HowItWorks>
  );
}

/** The buttons for a monitor's state. Any Risk Manager approves (prototype: no separate approver role). */
/** `only="pending"`: just the actions on a pending version (submit, approve, request changes), for a list of what waits on a person. */
export function MonitorActions({ m, onChange, compact, only }: { m: MonitorRow; onChange: () => void; compact?: boolean; only?: "pending" }) {
  const toast = useToast();
  const [asking, setAsking] = useState(false);
  const [note, setNote] = useState("");
  const pendingSubmitted = m.pending?.status === "submitted" || m.status === "submitted";
  const pendingDraft = m.pending?.status === "draft" || m.status === "draft";
  const act = async (a: "submit" | "approve" | "pause" | "resume" | "retire") => {
    try {
      await monitorsApi.act(m.monitor_id, a);
      toast({ submit: "Submitted for approval", approve: "Approved: live within a few minutes", pause: "Paused", resume: "Resumed: checked again within a few minutes", retire: "Retired" }[a]);
      onChange();
    } catch (e) { toast(e instanceof ApiError ? e.full : String(e)); }
  };
  const sendBack = async () => {
    try { await monitorsApi.requestChanges(m.monitor_id, note); toast("Sent back with your note"); setAsking(false); setNote(""); onChange(); }
    catch (e) { toast(e instanceof ApiError ? e.full : String(e)); }
  };
  if (m.status === "retired") return null;
  if (asking) return (
    <span className="row" style={{ gap: 6 }}>
      <input className="input" style={{ width: compact ? 200 : 260 }} placeholder="What should change?" value={note} onChange={e => setNote(e.target.value)} autoFocus />
      <button className="btn btn--sm btn--primary" type="button" disabled={note.trim().length < 3} onClick={sendBack}>Send back</button>
      <button className="btn btn--sm" type="button" onClick={() => setAsking(false)}>Cancel</button>
    </span>
  );
  return (
    <span className="row wrap" style={{ gap: 6 }}>
      {pendingDraft && <button className="btn btn--sm" type="button" onClick={() => act("submit")}>Submit{m.pending ? ` version ${m.pending.version}` : ""} for approval</button>}
      {pendingSubmitted && <>
        <button className="btn btn--sm btn--primary" type="button" onClick={() => act("approve")}>Approve{m.pending ? ` version ${m.pending.version}` : ""}</button>
        <button className="btn btn--sm" type="button" onClick={() => setAsking(true)}>Request changes</button></>}
      {!only && m.status === "live" && <button className="btn btn--sm" type="button" onClick={() => act("pause")}>Pause</button>}
      {!only && m.status === "paused" && <button className="btn btn--sm" type="button" onClick={() => act("resume")}>Resume</button>}
      {!compact && !only && <button className="btn btn--sm btn--ghost" type="button" onClick={() => act("retire")}>Retire</button>}
    </span>
  );
}

const SECTION_WORDS: Record<string, string> = {
  "risk-exposures": "Known risks", regulators: "Regulators", rivals: "Rivals", flows: "Money and trade flows", counterparties: "Counterparties",
};

export function DraftFromProfile({ onClose, only }: { onClose: () => void; only?: { section: string; item_id: string } }) {
  const nav = useNavigate();
  const toast = useToast();
  const [items, setItems] = useState<Draftable[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [loadErr, setLoadErr] = useState<unknown>(null);
  const loadItems = () => monitorsApi.draftable().then(x => { setItems(x); setLoadErr(null); }).catch(setLoadErr);
  useEffect(() => { loadItems(); }, []);
  const draft = async (d: { section: string; item_id: string }) => {
    setBusy(d.item_id);
    try { const m = await monitorsApi.draft(d.section, d.item_id); onClose(); nav(`/monitors/${m.monitor_id}`); }
    catch (e) { toast(e instanceof ApiError ? e.full : String(e)); setBusy(null); }
  };
  useEffect(() => { if (only) draft(only); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  if (only) return null;
  const groups = Object.keys(SECTION_WORDS).map(s => [s, (items ?? []).filter(i => i.section === s)] as const).filter(([, xs]) => xs.length);
  return (
    <Modal title="Draft a monitor from the profile" onClose={onClose} wide>
      <p className="small muted">Pick something from your institution profile. Code drafts the name, the sentence, the "tell me if" lines, the chips, the places and the exposure from it; you check and edit them before submitting. Nothing runs until someone approves it.</p>
      {loadErr != null ? <LoadError error={loadErr} onRetry={loadItems} what="what can be drafted" /> : items === null ? <div className="muted small">Loading…</div> : !groups.length ? <div className="muted small">The profile has no risks, regulators, rivals, flows or counterparties yet.</div> : groups.map(([s, xs]) => (
        <div key={s} className="col" style={{ gap: 6 }}>
          <span className="label">{SECTION_WORDS[s]}</span>
          <div className="row wrap" style={{ gap: 6 }}>{xs.map(i => (
            <button key={i.item_id} type="button" className="chip click" disabled={!!busy} onClick={() => draft(i)} title={i.kind}>
              {busy === i.item_id ? "Drafting…" : i.label}</button>))}</div>
        </div>))}
    </Modal>
  );
}

// ---------------------------------------------------------------- the Monitors page, by state
// The headline says how many monitors are watching and what waits for a person; then one section per state: waiting for you
// (the only lines with buttons), watching the news (each line says what its last check found), paused. Facts every monitor in a
// section shares (how often, who owns it) are said once in its sub-line; a line opens the sentence, what it found, and the rest.
type Run = CheckRow | undefined;
type Show = "all" | "draft" | "submitted" | "live" | "paused" | "retired";
const waitsApproval = (m: MonitorRow) => m.status === "submitted" || m.pending?.status === "submitted";
// a draft not sent yet: a new monitor, or the next version of a live or paused one
const isDraft = (m: MonitorRow) => m.status === "draft" || m.pending?.status === "draft";
/** A person has to act on it: approve it, or finish the draft and send it. Live ones are also listed under "Watching the news". */
const needsYou = (m: MonitorRow) => m.status !== "retired" && (waitsApproval(m) || isDraft(m));
/** The value every monitor in a group shares, or null when they differ (then each line says its own). */
const shared = <T,>(xs: MonitorRow[], f: (m: MonitorRow) => T) => (xs.length && xs.every(m => f(m) === f(xs[0])) ? f(xs[0]) : null);

/** What the last check found, in words: "Found 1: <headline>", or the check's own summary of the quiet. */
function lastWords(m: MonitorRow, run: Run, found: MonitorFinding[] | undefined) {
  const c = m.last_check;
  if (!c) return m.status === "paused" ? "Paused before its first check" : "Not checked yet";
  if (c.status === "error") return "Couldn't check: it tries again within the hour";
  if (c.status === "fired") { const t0 = found?.[0]?.evidence?.headlines?.[0]?.title, t = t0 ? undated(t0) : found?.[0]?.title; return `Found ${c.findings}${t ? `: ${t}` : ""}`; }
  return run?.summary ? `Nothing new. ${run.summary}` : "Nothing new";
}

function MonitorLine({ m, run, found, onChange, common, waiting }: { m: MonitorRow; run: Run; found?: MonitorFinding[]; onChange: () => void; common: { owner: string | null; every: number | null }; waiting?: boolean }) {
  const now = useNow(30_000);
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const act = async (a: "pause" | "retire" | "run") => {
    try {
      if (a === "run") { await monitorsApi.runNow(m.monitor_id); toast("Checking now: the result shows here in a minute or two"); }
      else { await monitorsApi.act(m.monitor_id, a); toast(a === "pause" ? "Paused" : "Retired"); }
      onChange();
    } catch (e) { toast(e instanceof ApiError ? e.full : String(e)); }
  };
  const differs = [common.every === null && everyText(m.check_frequency), common.owner === null && m.owner].filter(Boolean) as string[];
  // under "Waiting for you" a line is about its pending version (a live monitor's next version too); elsewhere, about its checks
  const id = `mon-${m.monitor_id}${waiting ? "-w" : ""}`, watching = m.status === "live" && !waiting;
  const next = m.pending?.version ?? m.latest_version;
  return (
    <li className={`mon-line ${m.status}`}>
      <button type="button" className="mon-t" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>
        <span className="mon-name">{m.name}</span>
        {differs.length > 0 && <span className="mon-sub">{differs.join(" · ")}</span>}</button>
      <span className="mon-what">{!waiting ? lastWords(m, run, found)
        : waitsApproval(m) ? `Version ${next} sent for approval ${ago(m.updated_at, now)}${m.pending?.note ? `: “${m.pending.note}”` : ""}${m.status === "live" ? `; version ${m.live_version} keeps running` : ""}`
        : m.status === "draft" ? `A draft, last edited ${ago(m.updated_at, now)}` : `Version ${next} is being edited, not sent yet; version ${m.live_version} keeps running`}</span>
      <span className="mon-end">
        {m.review_due && <span className="mon-due">Review due</span>}
        {watching && m.last_check && <time dateTime={m.last_check.at}>{ago(m.last_check.at, now)}</time>}
        {(waiting || m.status !== "live") && <MonitorActions m={m} onChange={onChange} compact only={waiting ? "pending" : undefined} />}
      </span>
      {watching && m.pending && <p className="mon-note">Version {m.pending.version} {m.pending.status === "submitted" ? "is waiting for approval" : "is being edited"}; version {m.live_version} keeps running.</p>}
      {open && <div className="mon-x" id={id}>
        <p>{m.sentence}</p>
        {run?.summary && m.last_check?.status === "fired" && <p className="mon-why"><b>Last check, {ago(m.last_check.at, now)}.</b> {run.summary}</p>}
        {found?.length ? <ul className="mon-found">{found.slice(0, 3).map(f => { const h = f.evidence?.headlines?.[0]; return <li key={f.finding_id}>
          {h?.url ? <a href={h.url} target="_blank" rel="noreferrer">{undated(h.title)}<Icon name="external" className="src-ext" /></a> : f.title}
          <span> · {f.outcome?.event_id ? <Link to={`/events/${f.outcome.event_id}`}>in an event</Link> : f.status === "set_aside" ? "no impact found" : "being investigated"}</span></li>; })}</ul> : null}
        <p className="mon-acts">
          <Link to={`/monitors/${m.monitor_id}`}>Open the monitor<Icon name="arrow" /></Link>
          {watching && <button type="button" className="mon-quiet" onClick={() => act("run")}><Icon name="play" />Check now</button>}
          {watching && <button type="button" className="mon-quiet" onClick={() => act("pause")}>Pause</button>}
          {m.status !== "retired" && <button type="button" className="mon-quiet" onClick={() => act("retire")}>Retire</button>}
        </p>
      </div>}
    </li>);
}

export function MonitorsPage() {
  const now = useNow(30_000);
  const { role } = useRole();
  const { status, reload: reloadStatus } = useMonitorsStatus();
  const [items, setItems] = useState<MonitorRow[] | null>(null);
  // each monitor's last check and findings, tagged with the check they belong to: a newer check shows its own count at once,
  // never beside the previous check's headline, while its details load
  const [runs, setRuns] = useState<Record<string, { at: string; v: Run }>>({});
  const [found, setFound] = useState<Record<string, { at: string; v: MonitorFinding[] }>>({});
  const [err, setErr] = useState<unknown>(null);
  const [drafting, setDrafting] = useState(false);
  const [show, setShow] = useState<Show>("all");
  // the list, then each checked monitor's latest check and findings: the lines say what it last found
  const load = useCallback(async () => {
    try {
      const xs = await monitorsApi.list(); setItems(xs); setErr(null); reloadStatus();
      const checked = xs.filter(m => m.last_check);
      const [r, f] = await Promise.all([
        Promise.all(checked.map(m => monitorsApi.runs(m.monitor_id).then(rs => [m.monitor_id, { at: m.last_check!.at, v: rs.find(x => x.world === "live") ?? rs[0] }] as const).catch(() => null))),
        Promise.all(checked.filter(m => m.findings_30d).map(m => monitorsApi.findings(m.monitor_id).then(fs => [m.monitor_id, { at: m.last_check!.at, v: fs }] as const).catch(() => null))),
      ]);
      setRuns(Object.fromEntries(r.filter(x => x !== null))); setFound(Object.fromEntries(f.filter(x => x !== null)));
    } catch (e) { setErr(e); }
  }, [reloadStatus]);
  useEffect(() => { load(); const t = setInterval(load, 30_000); return () => clearInterval(t); }, [load]);
  const actions = <>
    <button className="btn" type="button" onClick={() => setDrafting(true)}><Icon name="bank" />Draft from the profile</button>
    <Link className="btn btn--primary" to="/monitors/new"><Icon name="plus" />New monitor</Link></>;
  const xs = items ?? [], empty = items !== null && !items.length;
  const down = !!status && !status.connected;

  // the answer: how many are watching, what waits for a person, what the last check found
  const allLive = xs.filter(m => m.status === "live"), approve = xs.filter(m => m.status !== "retired" && waitsApproval(m)), drafts = xs.filter(m => m.status !== "retired" && isDraft(m));
  // the latest check across the live monitors: its time, its monitor and its result are said together
  const latest = allLive.filter(m => m.last_check).sort((a, b) => (a.last_check!.at < b.last_check!.at ? 1 : -1))[0];
  const lc = latest?.last_check;
  const title = items === null ? "Monitors" : !allLive.length ? "No monitor is watching the news yet"
    : <><span className="mon-n">{count(allLive.length, "monitor")}</span> {down ? "live, checks on hold" : allLive.length === 1 ? "is watching the news" : "are watching the news"}</>;
  const asks = [approve.length > 0 && <><b>{approve.length}</b> {approve.length === 1 ? "waits" : "wait"} for your approval</>,
    drafts.length > 0 && <><b>{drafts.length}</b> {drafts.length === 1 ? "draft isn't" : "drafts aren't"} sent yet</>].filter(Boolean);
  // whether the news service is connected is the side bar's system status; the Platform Admin also gets the server's own notes
  const said = items === null || empty ? "" : <>
    {asks.length ? <>{asks.map((a, i) => <span key={i}>{i ? " and " : ""}{a}</span>)}. </> : null}
    {lc && <>The last check was {ago(lc.at, now)}{lc.status === "fired" ? <>: <Link className="mon-ev" to={`/monitors/${latest.monitor_id}`}>{latest.name}</Link> found {count(lc.findings, "thing")}.</>
      : lc.status === "error" ? <>: <Link className="mon-ev" to={`/monitors/${latest.monitor_id}`}>{latest.name}</Link> couldn't check the news; it tries again within the hour.</>
      : ", and nothing new turned up."}</>}
    {role === "platform_admin" && status?.notes.length ? <span className="mon-down"> {status.notes.join(" ")}</span> : null}</>;

  // Draft and Waiting for approval count pending versions too (a live monitor's next version), as "Waiting for you" lists them
  const inStep = (m: MonitorRow, s: Show) => s === "all" || (s === "draft" ? m.status !== "retired" && isDraft(m) : s === "submitted" ? m.status !== "retired" && waitsApproval(m) : m.status === s);
  const n = (s: Show) => xs.filter(m => inStep(m, s)).length;
  const pick = (m: MonitorRow) => inStep(m, show);
  const yours = xs.filter(m => needsYou(m) && (show === "all" || show === "draft" || show === "submitted") && pick(m));
  const live = xs.filter(m => m.status === "live" && (show === "all" || show === "live")), paused = xs.filter(m => m.status === "paused" && (show === "all" || show === "paused"));
  const retired = show === "retired" ? xs.filter(m => m.status === "retired") : [];
  const common = { owner: shared(live, m => m.owner), every: shared(live, m => m.check_frequency) };
  const commonAll = { owner: shared(xs, m => m.owner), every: shared(xs, m => m.check_frequency) };
  const next = live.map(m => m.next_check_at).filter(Boolean).sort()[0];
  // details only from the check the row shows: a newer check waits for its own instead of borrowing the last one's
  const mine = <T,>(x: { at: string; v: T } | undefined, m: MonitorRow) => (x && x.at === m.last_check?.at ? x.v : undefined);
  const line = (m: MonitorRow, c = commonAll, waiting = false) => <MonitorLine key={m.monitor_id} m={m} run={mine(runs[m.monitor_id], m)}
    found={mine(found[m.monitor_id], m)} onChange={load} common={c} waiting={waiting} />;
  return (
    <div className="page mon">
      <PageHeader eyebrow="Monitors" title={title} status={said} actions={empty ? undefined : actions} help={<MonitorHelp status={status} />} />
      {err != null && <LoadError error={err} onRetry={load} what="the monitors" />}
      {items === null ? (err == null && <InlineSkeleton />) : empty ? (
        <Empty icon="monitor" title="No monitors yet" actions={actions}>
          Monitors watch the news for what you care about: a rival's prices, a regulator's rules, jobs in a remittance corridor.
          {down && <span className="small" style={{ display: "block", marginTop: 8 }}>News checks are paused right now; a monitor you add starts once they are back.</span>}
        </Empty>
      ) : <>
        <div className="mon-filters"><FlowFilter toned label="Which monitors" value={show} onChange={setShow} all={{ key: "all", label: "All", count: xs.length }}
          steps={[{ key: "draft", label: "Draft", count: n("draft"), state: "queued" }, { key: "submitted", label: "Waiting for approval", count: n("submitted"), state: "queued" },
            [{ key: "live", label: "Live", count: n("live"), state: "done" }, { key: "paused", label: "Paused", count: n("paused") },
              ...(n("retired") ? [{ key: "retired" as const, label: "Retired", count: n("retired") }] : [])]]} /></div>
        <div className="mon-groups">
          {yours.length > 0 && <section aria-labelledby="mon-y"><h2 id="mon-y">Waiting for you <span>{yours.length}</span></h2>
            <p className="mon-sub2">Nothing runs until a Risk Manager approves it. In this prototype the person who sent it can also approve it.</p>
            <ol className="mon-lines">{yours.map(m => line(m, commonAll, true))}</ol></section>}
          {live.length > 0 && <section aria-labelledby="mon-w"><h2 id="mon-w">Watching the news <span>{live.length}</span></h2>
            <p className="mon-sub2">{[common.every && everyText(common.every), common.owner && `owned by ${common.owner}`].filter(Boolean).join(", ") || "Each line says how often and who owns it"}.
              {down ? " Not being checked right now; nothing is lost, the next check reads everything since the last." : next ? ` Next check ${due(next, now)}.` : ""}</p>
            <ol className="mon-lines">{live.map(m => line(m, common))}</ol></section>}
          {paused.length > 0 && <section className="quiet" aria-labelledby="mon-p"><h2 id="mon-p">Paused <span>{paused.length}</span></h2>
            <p className="mon-sub2">Not checking the news. Resume picks up within a few minutes.</p>
            <ol className="mon-lines">{paused.map(m => line(m))}</ol></section>}
          {retired.length > 0 && <section className="quiet" aria-labelledby="mon-r"><h2 id="mon-r">Retired <span>{retired.length}</span></h2>
            <p className="mon-sub2">No longer checking. What they found stays in Findings.</p>
            <ol className="mon-lines">{retired.map(m => line(m))}</ol></section>}
          {!yours.length && !live.length && !paused.length && !retired.length && <p className="mon-sub2">None in this step. Choose another above.</p>}
        </div>
      </>}
      <p className="mon-foot">Monitors watch the news. Price and rate moves are watched by <Link to="/series">market series</Link>, without a monitor.</p>
      {drafting && <DraftFromProfile onClose={() => setDrafting(false)} />}
    </div>
  );
}

/** The guided setup's Monitors step: what the profile can be watched for, and the monitors so far. */
export function MonitorsStep({ institutionId }: { institutionId: string }) {
  const nav = useNavigate();
  const toast = useToast();
  const now = useNow(60_000);
  const [items, setItems] = useState<Draftable[] | null>(null);
  const [mine, setMine] = useState<MonitorRow[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => {
    Promise.all([monitorsApi.draftable(institutionId), monitorsApi.list(institutionId)])
      .then(([d, m]) => { setItems(d); setMine(m); }).catch(e => toast(e instanceof ApiError ? e.full : String(e)));
  }, [institutionId, toast]);
  const draft = async (d: Draftable) => {
    setBusy(d.item_id);
    try { const m = await monitorsApi.draft(d.section, d.item_id, institutionId); nav(`/monitors/${m.monitor_id}`); }
    catch (e) { toast(e instanceof ApiError ? e.full : String(e)); setBusy(null); }
  };
  const open = (items ?? []).filter(i => !i.monitor_id);
  return (
    <div className="col gap16">
      <Banner kind="info">Monitors watch the news for what your profile says matters. Draft them here, or ask the setup agent ("watch Gulf jobs for our migrant families"). Each one runs after a Risk Manager approves it on the Monitors page. Optional: you can go live without any.</Banner>
      <div className="card"><div className="hd"><h2>Draft from your profile</h2></div><div className="bd col" style={{ gap: 10 }}>
        {items === null ? <span className="muted small">Loading…</span> : !open.length ? <span className="small muted">Everything the profile offers is watched, or there is nothing to draft from yet.</span>
          : Object.entries(SECTION_WORDS).map(([s, w]) => {
            const xs = open.filter(i => i.section === s);
            return xs.length ? <div key={s} className="col" style={{ gap: 6 }}><span className="label">{w}</span>
              <div className="row wrap" style={{ gap: 6 }}>{xs.map(i => <button key={i.item_id} type="button" className="chip click" disabled={!!busy}
                onClick={() => draft(i)}>{busy === i.item_id ? "Drafting…" : i.label}</button>)}</div></div> : null;
          })}
      </div></div>
      <div className="card"><div className="hd"><h2>Monitors</h2><span className="spacer" /><Link className="small" to="/monitors">Monitors page →</Link></div>
        {!mine.length ? <div className="bd small muted">None yet.</div> : <div className="list">{mine.map(m => (
          <div key={m.monitor_id} className="li"><div className="col" style={{ gap: 2, flex: 1 }}>
            <span className="row" style={{ gap: 8 }}><Link className="ttl" to={`/monitors/${m.monitor_id}`}>{m.name}</Link><StatusBadge status={m.status} /></span>
            <span className="meta">{m.sentence}{m.last_check ? ` · last check ${ago(m.last_check.at, now)}` : ""}</span></div></div>))}</div>}
      </div>
    </div>
  );
}
