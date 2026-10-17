// Monitors: the list, the status badges and actions shared with the monitor page, and
// "Draft from the profile" (code fills the sentence, lines and chips from a profile item).
import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ApiError } from "../../api/client";
import { EVERY, monitorsApi, type Draftable, type MonitorRow, type MonitorsStatus, type MonitorStatus } from "../../api/monitors";
import { HowItWorks, PageHeader, StatusPill } from "../../components/blocks";
import { Icon } from "../../components/Icon";
import { Banner, Empty, Modal, useNow, useRole, useToast, InlineSkeleton } from "../../components/ui";
import { ago, due, when } from "../../format";
import { count, everyText, MONITOR_CHECK, MONITOR_STATUS } from "../../plain";

export function StatusBadge({ status }: { status: MonitorStatus }) {
  const [text, tone] = MONITOR_STATUS[status];
  return <StatusPill tone={tone}>{text}</StatusPill>;
}

/** The last check in words: "Found 1 · 26 min ago", "Nothing new · 2 h ago", "Couldn't check (tries again soon)". */
export function LastCheck({ m, now }: { m: MonitorRow; now: Date }) {
  if (!m.last_check) return <span className="small muted">Not checked yet</span>;
  const c = m.last_check;
  const [text, tone] = MONITOR_CHECK[c.status](c.findings);
  return <span className="lastck"><StatusPill tone={tone}>{text}</StatusPill><span className="small muted">{ago(c.at, now)}</span></span>;
}

export const ORIGIN: Record<string, string> = { profile: "drafted from the profile", setup: "drafted in setup", radar_story: "from a Radar story", template: "from a template" };

export function useMonitorsStatus() {
  const [status, setStatus] = useState<MonitorsStatus | null>(null);
  const load = useCallback(() => monitorsApi.status().then(setStatus).catch(() => {}), []);
  useEffect(() => { load(); }, [load]);
  return { status, reload: load };
}

/** Notes about the monitor service: the Platform Admin reads the server's own words; a Risk Manager reads what it means. */
export function MonitorBanners({ status }: { status: MonitorsStatus | null }) {
  const { role } = useRole();
  if (!status) return null;
  if (role === "platform_admin") return <>{status.notes.map(n => <Banner key={n} kind="warn" icon="warn">{n}</Banner>)}</>;
  return !status.connected ? <Banner kind="warn" icon="warn">Monitors can't check the news right now. Your Platform Admin has been told.</Banner> : null;
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
export function MonitorActions({ m, onChange, compact }: { m: MonitorRow; onChange: () => void; compact?: boolean }) {
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
      {m.status === "live" && <button className="btn btn--sm" type="button" onClick={() => act("pause")}>Pause</button>}
      {m.status === "paused" && <button className="btn btn--sm" type="button" onClick={() => act("resume")}>Resume</button>}
      {!compact && <button className="btn btn--sm btn--ghost" type="button" onClick={() => act("retire")}>Retire</button>}
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
  const [loadErr, setLoadErr] = useState<string | null>(null);
  useEffect(() => { monitorsApi.draftable().then(setItems).catch(e => { setLoadErr(e instanceof ApiError ? e.full : String(e)); setItems([]); }); }, []);
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
      {loadErr ? <div className="errtext">{loadErr}</div> : items === null ? <div className="muted small">Loading…</div> : !groups.length ? <div className="muted small">The profile has no risks, regulators, rivals, flows or counterparties yet.</div> : groups.map(([s, xs]) => (
        <div key={s} className="col" style={{ gap: 6 }}>
          <span className="label">{SECTION_WORDS[s]}</span>
          <div className="row wrap" style={{ gap: 6 }}>{xs.map(i => (
            <button key={i.item_id} type="button" className="chip click" disabled={!!busy} onClick={() => draft(i)} title={i.kind}>
              {busy === i.item_id ? "Drafting…" : i.label}</button>))}</div>
        </div>))}
    </Modal>
  );
}

export function MonitorsPage() {
  const now = useNow(30_000);
  const { status, reload: reloadStatus } = useMonitorsStatus();
  const [items, setItems] = useState<MonitorRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [drafting, setDrafting] = useState(false);
  const load = useCallback(async () => {
    try { setItems(await monitorsApi.list()); setErr(null); reloadStatus(); }
    catch (e) { setErr(e instanceof ApiError ? e.full : String(e)); }
  }, [reloadStatus]);
  useEffect(() => { load(); const t = setInterval(load, 30_000); return () => clearInterval(t); }, [load]);
  const actions = <>
    <button className="btn" type="button" onClick={() => setDrafting(true)}><Icon name="bank" />Draft from the profile</button>
    <Link className="btn btn--primary" to="/monitors/new"><Icon name="plus" />New monitor</Link></>;
  const live = (items ?? []).filter(m => m.status === "live").length;
  const waiting = (items ?? []).filter(m => m.status === "submitted" || m.pending?.status === "submitted").length;
  return (
    <div className="page">
      <PageHeader title="Monitors"
        status={items === null ? "" : <><b className="ink">{count(live, "live monitor")}</b>
          {status?.next_check_at ? `, next check ${due(status.next_check_at)}` : ""}{waiting ? ` · ${waiting} waiting for approval` : ""}</>}
        actions={actions} help={<MonitorHelp status={status} />} />
      <div className="banners">{err && <Banner kind="crit" icon="warn">{err}</Banner>}<MonitorBanners status={status} /></div>
      <div className="card">
        {items === null ? <InlineSkeleton /> : !items.length ? (
          <Empty icon="monitor" title="No monitors yet" actions={actions}>
            Monitors watch the news for what you care about: a rival's prices, a regulator's rules, jobs in a remittance corridor.
          </Empty>
        ) : (
          <ul className="evlist" aria-label="Monitors">{items.map(m => (
            <li key={m.monitor_id}>
              <div className="evrow">
                <span className="evrow-ico"><Icon name="monitor" /></span>
                <span className="evrow-main">
                  <span className="row-top"><Link className="row-l" to={`/monitors/${m.monitor_id}`}>{m.name}</Link><StatusBadge status={m.status} />
                    {m.pending && (m.status === "live" || m.status === "paused") && <StatusPill tone="blue">{m.pending.status === "submitted" ? `Version ${m.pending.version} waiting for approval` : `Version ${m.pending.version} being edited`}</StatusPill>}
                    {m.review_due && <StatusPill tone="amber">Review due</StatusPill>}</span>
                  <span className="row-d">{m.sentence}</span>
                  <span className="mon-facts"><span><Icon name="clock" />{everyText(m.check_frequency)}{m.status === "live" && m.next_check_at ? `, next ${when(m.next_check_at, now)}` : ""}</span>
                    <span><Icon name="users" />{m.owner}</span>
                    {m.findings_30d > 0 && <span><Icon name="search" />{count(m.findings_30d, "finding")} in 30 days</span>}</span>
                </span>
                <span className="evrow-side">
                  <LastCheck m={m} now={now} />
                  <MonitorActions m={m} onChange={load} compact />
                </span>
              </div>
            </li>))}</ul>
        )}
      </div>
      <p className="small muted mt12">Monitors watch the news. Price and rate moves are watched by <Link to="/series">market series</Link>, without a monitor.</p>
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
