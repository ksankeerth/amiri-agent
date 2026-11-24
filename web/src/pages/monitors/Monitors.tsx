// Monitors: the list, grouped by state, and the pieces shared with the monitor page (the approval buttons, the
// last check in words, the notes about the service) and "Draft from the profile" (code fills the sentence,
// lines and names from a profile item).
import { useCallback, useEffect, useId, useMemo, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ApiError } from "../../api/client";
import { monitorsApi, type Draftable, type MonitorRow, type MonitorsStatus, type MonitorStatus } from "../../api/monitors";
import { StatusPill } from "../../components/blocks";
import { Fold, PageTitle, QuietWarn, Section, TextButton } from "../../components/rd";
import { Banner, Modal, useNow, useRole, useToast, ListSkeleton, LoadError } from "../../components/ui";
import { ago, dayTime, person } from "../../format";
import { MONITOR_CHECK, MONITOR_STATUS } from "../../plain";
import "../../styles/rd-monitors.css";
import { everyWords, isOverdue } from "./words";

/** A status as a pill: only the setup step still uses this; the Monitors pages say it in words. */
export function StatusBadge({ status }: { status: MonitorStatus }) {
  const [text, tone] = MONITOR_STATUS[status];
  return <StatusPill tone={tone}>{text}</StatusPill>;
}

/** The last check in words: "Nothing new · 2 h ago", "Found 1 · 26 min ago", or "◆ Overdue: last checked 21 h ago". */
export function LastCheck({ m, now }: { m: MonitorRow; now: Date }) {
  if (!m.last_check) return <span>Not checked yet</span>;
  const c = m.last_check;
  if (isOverdue(m, now)) return <span className="rd-warn"><span className="rd-shape" aria-hidden="true">◆</span> Overdue: last checked {ago(c.at, now)}</span>;
  const [text] = MONITOR_CHECK[c.status](c.findings);
  return c.status === "error"
    ? <span className="rd-warn"><span className="rd-shape" aria-hidden="true">◆</span> {text} · {ago(c.at, now)}</span>
    : <span>{text} · {ago(c.at, now)}</span>;
}

export const ORIGIN: Record<string, string> = { profile: "drafted from the profile", setup: "drafted in setup", radar_story: "from a Radar story", template: "from a template" };

export function useMonitorsStatus() {
  const [status, setStatus] = useState<MonitorsStatus | null>(null);
  const load = useCallback(() => monitorsApi.status().then(setStatus).catch(() => {}), []);
  useEffect(() => { load(); }, [load]);
  return { status, reload: load };
}

/** Notes about the monitor service, in words: the Platform Admin reads the server's own words; a Risk Manager reads what it means. */
export function MonitorBanners({ status }: { status: MonitorsStatus | null }) {
  const { role } = useRole();
  if (!status) return null;
  if (role === "platform_admin") return <>{status.notes.map(n => <QuietWarn key={n}>{n}</QuietWarn>)}</>;
  return !status.connected ? <QuietWarn>Monitors can't check the news right now. Your Platform Admin has been told.</QuietWarn> : null;
}

/** How monitor checks work: the text behind the page's "How this works". */
export function MonitorHelp({ status, id, open }: { status: MonitorsStatus | null; id: string; open: boolean }) {
  return (
    <div id={id} className="rd-open rd-prose mn-help" hidden={!open}>
      <p>A monitor is one question, in plain words, that a Risk Manager approved. Amiri Agent checks it against the news on a schedule. What it finds goes to the investigation like any other finding.</p>
      {status && <p>Each check reads news published since the last one (up to {status.web_queries_per_check} searches). In this prototype a monitor is checked at most {everyWords(status.min_frequency_minutes)}, and up to {status.live_max} can be live. If a check can't read the news, it tries again within the hour and nothing is lost.</p>}
    </div>
  );
}

/** The lede's "How this works" toggle and its text. */
export function useHelp() {
  const [open, setOpen] = useState(false);
  const id = useId();
  const toggle = <TextButton aria-expanded={open} aria-controls={id} onClick={() => setOpen(o => !o)}>How this works</TextButton>;
  return { open, id, toggle };
}

/** Waiting for a Risk Manager's approval: a new monitor, or a new version of a live or paused one. */
export const awaitingApproval = (m: Pick<MonitorRow, "status" | "pending">) => m.status === "submitted" || m.pending?.status === "submitted";

/** The calls behind a monitor's buttons, with their toasts. Any Risk Manager approves (prototype: no separate approver role). */
export function useMonitorAct(m: { monitor_id: string }, onChange: () => void) {
  const toast = useToast();
  const [asking, setAsking] = useState(false);
  const [note, setNote] = useState("");
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
  return { act, asking, setAsking, note, setNote, sendBack };
}

/** Pause or Resume, as a text action. */
export function PauseResume({ m, onChange }: { m: MonitorRow; onChange: () => void }) {
  const { act } = useMonitorAct(m, onChange);
  if (m.status === "live") return <TextButton onClick={() => act("pause")}>Pause</TextButton>;
  if (m.status === "paused") return <TextButton onClick={() => act("resume")}>Resume</TextButton>;
  return null;
}

/** Approve and Request changes (when a version waits), or Submit (when a draft is ready). `primary` makes Approve
 *  (or Submit) the screen's one filled button; the list keeps that for "New monitor". */
export function ApprovalActions({ m, onChange, primary }: { m: MonitorRow; onChange: () => void; primary?: boolean }) {
  const { act, asking, setAsking, note, setNote, sendBack } = useMonitorAct(m, onChange);
  const version = m.pending ? ` version ${m.pending.version}` : "";
  if (m.status === "retired") return null;
  if (asking) return (
    <span className="mn-ask">
      <input className="input" aria-label="What should change?" placeholder="What should change?" value={note} onChange={e => setNote(e.target.value)} autoFocus />
      <button className="btn" type="button" disabled={note.trim().length < 3} onClick={sendBack}>Send back</button>
      <TextButton onClick={() => setAsking(false)}>Cancel</TextButton>
    </span>
  );
  if (awaitingApproval(m)) return (
    <span className="mn-acts">
      <button className={`btn${primary ? " btn--primary" : ""}`} type="button" onClick={() => act("approve")}>Approve{version}</button>
      <TextButton onClick={() => setAsking(true)}>Request changes</TextButton>
    </span>
  );
  if (m.pending?.status === "draft" || m.status === "draft") return (
    <span className="mn-acts">{primary ? <button className="btn btn--primary" type="button" onClick={() => act("submit")}>Submit{version} for approval</button>
      : <TextButton onClick={() => act("submit")}>Submit{version} for approval</TextButton>}</span>
  );
  return null;
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


type Sent = { by: string | null; at: string | null };

/** One monitor: name, its question in full, who owns it and how often; findings in 30 days; the last check; actions. */
function MonitorRowView({ m, now, sent, onChange }: { m: MonitorRow; now: Date; sent?: Sent; onChange: () => void }) {
  const waiting = awaitingApproval(m);
  const small: ReactNode[] = [];
  if (waiting) {
    const who = sent?.by ? `Sent for approval by ${person(sent.by)}${sent.at ? `, ${dayTime(sent.at)}` : ""}` : "Sent for approval";
    small.push(m.status === "submitted" ? who : `${who}: version ${m.pending!.version}`);
    if (m.status === "live" || m.status === "paused") small.push(`${m.status === "live" ? "Live" : "Paused"} now: version ${m.live_version} ${m.status === "live" ? "keeps running" : "stays as it is"}`);
  } else if (m.pending && (m.status === "live" || m.status === "paused")) small.push(`Version ${m.pending.version} being edited`);
  small.push(`${m.owner} · ${everyWords(m.check_frequency)}`);
  if (m.status === "draft") small.push(ORIGIN[m.origin] ?? "");
  const showFigure = !waiting && m.status !== "draft";
  return (
    <li className={`mn-row${waiting ? " mn-wait" : ""}`}>
      <div className="mn-main">
        <h3 className="mn-name"><Link className="rd-name" to={`/monitors/${m.monitor_id}`}>{m.name}</Link></h3>
        <p className="mn-q">{m.sentence}</p>
        <p className="rd-fine mn-fine">{small.filter(Boolean).join(" · ")}
          {m.review_due && <span className="rd-warn"> · <span aria-hidden="true">◆</span> Review due</span>}</p>
      </div>
      {showFigure && <div className="mn-fig">
        <div className="mn-fig-v">{m.findings_30d}</div>
        <div className="mn-fig-l">{m.findings_30d === 1 ? "finding" : "findings"} in 30 days</div>
      </div>}
      <div className="mn-side">
        {!waiting && m.status !== "draft" && <span className="mn-last"><LastCheck m={m} now={now} /></span>}
        <ApprovalActions m={m} onChange={onChange} />
        {!waiting && <PauseResume m={m} onChange={onChange} />}
      </div>
    </li>
  );
}

export function MonitorsPage() {
  const now = useNow(30_000);
  const { role } = useRole();
  const { status, reload: reloadStatus } = useMonitorsStatus();
  const help = useHelp();
  const [items, setItems] = useState<MonitorRow[] | null>(null);
  const [sent, setSent] = useState<Record<string, Sent>>({});  // who sent each waiting monitor (the list doesn't say)
  const [err, setErr] = useState<unknown>(null);
  const [drafting, setDrafting] = useState(false);
  const load = useCallback(async () => {
    try {
      const xs = await monitorsApi.list();
      setItems(xs); setErr(null); reloadStatus();
      const waiting = xs.filter(awaitingApproval);
      const got = await Promise.all(waiting.map(w => monitorsApi.get(w.monitor_id).then(d => {
        const v = [...d.versions].reverse().find(x => x.status === "submitted");
        return [w.monitor_id, { by: v?.submitted_by ?? null, at: v?.submitted_at ?? null }] as const;
      }).catch(() => null)));
      setSent(Object.fromEntries(got.filter((x): x is NonNullable<typeof x> => !!x)));
    } catch (e) { setErr(e); }
  }, [reloadStatus]);
  useEffect(() => { load(); const t = setInterval(load, 30_000); return () => clearInterval(t); }, [load]);

  const groups = useMemo(() => {
    const xs = items ?? [];
    const waiting = xs.filter(awaitingApproval);
    const rest = xs.filter(m => !awaitingApproval(m));
    return {
      waiting,
      live: rest.filter(m => m.status === "live").sort((a, b) => b.findings_30d - a.findings_30d),   // busiest first
      paused: rest.filter(m => m.status === "paused"),
      draft: rest.filter(m => m.status === "draft"),
      retired: xs.filter(m => m.status === "retired"),
    };
  }, [items]);
  const empty = items !== null && !items.length;
  const nLive = (items ?? []).filter(m => m.status === "live").length;
  const nWaiting = groups.waiting.length;
  const newBtn = <Link className="btn btn--primary" to="/monitors/new">+ New monitor</Link>;
  const draftBtn = <TextButton onClick={() => setDrafting(true)}>Draft from the profile</TextButton>;
  const rows = (xs: MonitorRow[], label: string) => <ul className="mn-list" aria-label={label}>{xs.map(m =>
    <MonitorRowView key={m.monitor_id} m={m} now={now} sent={sent[m.monitor_id]} onChange={load} />)}</ul>;
  const meta = (xs: MonitorRow[], first = false) => <span className="rd-dots"><span>{xs.length}</span>{first && <span>Colombo time</span>}</span>;

  return (
    <div className="page rd rd-monitors">
      <PageTitle title="Monitors" actions={empty ? undefined : <>{draftBtn}{newBtn}</>}
        lede={items === null || empty ? undefined : <>
          <b>{nLive} live.</b> Each watches the news for one question a Risk Manager approved.
          {nWaiting > 0 && ` ${nWaiting} ${nWaiting === 1 ? "is" : "are"} waiting for your approval.`} {help.toggle}</>}
        help={!empty && <MonitorHelp status={status} id={help.id} open={help.open} />} />
      {/* with no monitors yet, "can't check the news" changes nothing for a Risk Manager: the empty state says it calmly */}
      {err != null && (items === null ? <LoadError error={err} onRetry={load} what="the monitors" />
        : <QuietWarn>Couldn't refresh the monitors. Showing what was loaded.</QuietWarn>)}
      {(!empty || role === "platform_admin") && <MonitorBanners status={status} />}

      {items === null ? (err == null && <div className="mt12"><ListSkeleton rows={3} /></div>)
        : empty ? (
          <div className="rd-empty">
            <p className="rd-lede">No monitors yet. A monitor watches the news for something you care about: a rival's prices, a regulator's rules, jobs in a remittance corridor.</p>
            {status && !status.connected && <p className="rd-fine">News checks are paused right now; a monitor you add starts once they are back.</p>}
            <div className="mn-empty-acts">{newBtn}{draftBtn}</div>
          </div>
        ) : <>
          {groups.waiting.length > 0 && <Section title="Waiting for your approval" meta={meta(groups.waiting, true)}>{rows(groups.waiting, "Waiting for your approval")}</Section>}
          {groups.live.length > 0 && <Section title="Live" meta={meta(groups.live)}
            action={<span className="rd-fine">busiest first, by findings in 30 days</span>}>{rows(groups.live, "Live monitors")}</Section>}
          {groups.paused.length > 0 && <Section title="Paused" meta={meta(groups.paused)}>{rows(groups.paused, "Paused monitors")}</Section>}
          {groups.draft.length > 0 && <Section title="Drafts" meta={meta(groups.draft)}>{rows(groups.draft, "Draft monitors")}</Section>}
          {groups.retired.length > 0 && <div className="mn-retired">
            <Fold title="Retired" summary={`${groups.retired.length} no longer checked`} remember="monitors-retired">{rows(groups.retired, "Retired monitors")}</Fold></div>}
        </>}
      <p className="rd-fine mn-note">Monitors watch the news. Price and rate moves are watched by <Link className="rd-go" to="/series">market series</Link>, without a monitor.</p>
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
      <Banner kind="info">Monitors watch the news for what your profile says matters. Draft them here, or ask the setup agent ("watch our main rival's deposit rates"). Each one runs after a Risk Manager approves it on the Monitors page. Optional: you can go live without any.</Banner>
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
