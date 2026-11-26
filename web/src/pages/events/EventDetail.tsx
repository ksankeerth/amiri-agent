// One event as a chain (board 02): the news, the event, and what it traced to your products with what your data says,
// then AMIRI Agent's assessment, the alerts raised and when you'll know. GET /events/:id (with the alerts for the event);
// the page refreshes itself every minute (not while the tab is hidden). Opening an impact shows it as expected (the
// AI's assessment) against your data (counted by code). The states: nothing exposed, closed, stopped early, running.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useParams } from "react-router-dom";
import { alertsApi, type AlertItem } from "../../api/alerts";
import { ApiError, peek } from "../../api/client";
import { investigationApi, type EventDetail, type Hypothesis } from "../../api/investigation";
import { useRefusalToast, useToast, useNow } from "../../components/ui";
import { LoadError } from "../../components/v2/LoadError";
import { SkBar, Skeleton } from "../../components/v2/Skeleton";
import { useCrumbs, type Crumb } from "../../components/v2/Shell";
import { StaleBanner } from "../../components/v2/StaleBanner";
import { earliest, eventTitle, metricWords, splitCheckText } from "../../plain";
import { plural } from "../../format";
import { adverseFor, toneFrom } from "./eventWords";
import { Assessment, Chain, EventHead, ImpactPanel, NotFound, RunBanner, SideColumn, TechnicalDetails, type EventModel, type Task } from "./parts";
import { usePolling } from "../../components/usePolling";
import { useEnterFade } from "../../components/v2/useItemFade";
import "../../styles/v2/event.css";

const REFRESH_MS = 60_000;
const scrollTo = (id: string) => document.getElementById(id)?.scrollIntoView({ block: "start" });

/** One event. Another event (same page, F4b) is drawn fresh, so it never shows the last one's words for a moment, and its column fades in. */
export function EventDetailPage() {
  const { id = "" } = useParams();
  const last = useRef<string | null>(null);
  const enter = last.current !== null && last.current !== id;
  useEffect(() => { last.current = id; });
  return <EventDetailView key={id} id={id} enter={enter} />;
}

function EventDetailView({ id, enter }: { id: string; enter: boolean }) {
  const root = useRef<HTMLDivElement>(null);
  useEnterFade(root, enter);
  const loc = useLocation();
  const now = useNow(30_000);
  const [e, setE] = useState<EventDetail | null>(() => peek(() => investigationApi.event(id)) ?? null);  // seen before: shown at once, refreshed below
  const [err, setErr] = useState<unknown>(null);
  const [loadedAt, setLoadedAt] = useState<number | null>(null);
  const [alerts, setAlerts] = useState<AlertItem[]>(() => peek(() => alertsApi.list({ event_id: id })) ?? []);
  // Which side an effect falls on ("Bad for you") comes from the alerts. Until they have answered the page waits, rather than draw a
  // "Neutral" that turns into "Bad for you" a moment later (F4b: that is text blinking).
  const [alertsReady, setAlertsReady] = useState(() => peek(() => alertsApi.list({ event_id: id })) !== undefined);
  const [open, setOpen] = useState<string | null>(null);
  const [reportOpen, setReportOpen] = useState(false);
  const [asideOpen, setAsideOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const toast = useToast(), refuse = useRefusalToast();

  const load = useCallback(async () => {
    try {
      const x = await investigationApi.event(id);
      setE(x); setErr(null); setLoadedAt(Date.now());
      alertsApi.list({ event_id: id }).then(a => { setAlerts(a); setAlertsReady(true); }).catch(() => { setAlertsReady(true); /* the chain still reads without them */ });
    } catch (x) { setErr(x); }
  }, [id]);
  useEffect(() => { load(); }, [load]);
  usePolling(load, REFRESH_MS);  // passive: every minute, not while hidden (even while a run is going)

  // a link to one impact (#impact-<id>) opens it
  useEffect(() => {
    const m = loc.hash.match(/^#impact-(.+)$/);
    if (!e || !m || !e.hypotheses.some(h => h.hypothesis_id === m[1])) return;
    setOpen(m[1]);
    requestAnimationFrame(() => scrollTo(`impact-${m[1]}-open`));
  }, [e, loc.hash]);

  const title = e ? eventTitle(e) : undefined;
  const crumbs = useMemo<Crumb[]>(() => [{ label: "What it found" }, { label: "Events", to: "/events" }, ...(title ? [{ label: title }] : [])], [title]);
  useCrumbs(crumbs);

  const toggle = (hid: string) => {
    const next = open === hid ? null : hid;
    setOpen(next);
    if (next) setTimeout(() => scrollTo(`impact-${next}-open`));
    else setTimeout(() => document.querySelector<HTMLElement>(`#impact-${hid} .v2-ev-open`)?.focus());
    try { window.history.replaceState(window.history.state, "", next ? `#impact-${next}` : window.location.pathname + window.location.search); } catch { /* */ }
  };
  const again = async () => {
    setBusy(true);
    try {
      const out = await investigationApi.investigateNow();
      const sent = out.items.reduce((n, r) => n + r.finding_ids.length, 0);
      toast(sent ? `Sent ${plural(sent, "finding")} to the investigation agent.` : "Nothing new to investigate.");
      load();
    } catch (x) { refuse(x); }
    finally { setBusy(false); }
  };

  if (!e || (!alertsReady && err == null)) {
    if (!e && err instanceof ApiError && err.status === 404) return <NotFound />;
    return err != null && !e
      ? <div ref={root} className="v2-ev"><h1 className="v2-sr">Event</h1><LoadError what="this event" error={err} onRetry={load} /></div>
      : <div ref={root} className="v2-ev">
        <h1 className="v2-sr">Event</h1>
        <div className="v2-ev-skhead" aria-hidden="true">
          <SkBar w={200} h={24} />
          <SkBar w="min(460px, 100%)" h={46} />
          <SkBar w="min(640px, 100%)" h={32} />
        </div>
        <Skeleton rows={5} label="Loading the event" />
      </div>;
  }
  const m = modelOf(e, alerts, title!);
  return (
    <div ref={root} className="v2-ev">
      {err != null && loadedAt != null && <StaleBanner loadedAt={loadedAt} now={now.getTime()} onRetry={load} />}
      <EventHead m={m} />
      <RunBanner status={e.run.status} busy={busy} onAgain={again} />
      <Chain m={m} open={open} onToggle={toggle} onSeeWhy={() => {
        if (e.set_aside.length) { setAsideOpen(true); } else { setReportOpen(true); }
        setTimeout(() => scrollTo(e.set_aside.length ? "set-aside" : "ev-as"));
      }} />
      {open && <ImpactPanel m={m} hid={open} onClose={() => toggle(open)} />}
      <div className="v2-ev-cols">
        <Assessment m={m} reportOpen={reportOpen} onReport={setReportOpen} asideOpen={asideOpen} onAside={setAsideOpen} />
        <SideColumn m={m} />
      </div>
      <TechnicalDetails e={e} />
    </div>
  );
}

/** What the parts need, worked out once: the tone, which impacts are bad for you, the metric's name, who was alerted. */
function modelOf(e: EventDetail, alerts: AlertItem[], title: string): EventModel {
  const tasks = new Map(e.tasks.map(t => [t.hypothesis_id, t as Task]));
  // the spec's metric name and whether the move is bad for you: from the alerts when they carry it, else from the task
  const effects = new Map(alerts.flatMap(a => a.effects).map(x => [x.hypothesis_id, x]));
  const alertOf = new Map(alerts.flatMap(a => a.effects.map(x => [x.hypothesis_id, a] as const)));
  const metricName = (h: Hypothesis) => effects.get(h.hypothesis_id)?.metric_name
    ?? (tasks.get(h.hypothesis_id)?.check ? splitCheckText(tasks.get(h.hypothesis_id)!.check!.what)[0] : metricWords(h.expected.metric));
  const adverseOf = (h: Hypothesis) => adverseFor(h.expected.direction, tasks.get(h.hypothesis_id), effects.get(h.hypothesis_id), e.tone);
  const nBad = e.hypotheses.filter(h => adverseOf(h) === true).length, nGood = e.hypotheses.filter(h => adverseOf(h) === false).length;
  const checked = e.hypotheses.filter(h => { const v = tasks.get(h.hypothesis_id)?.check?.verdict; return v && v !== "not_yet"; }).length;
  return {
    e, alerts, title, tone: toneFrom(nBad, nGood), tasks, metricName, adverseOf, alertOf, checked,
    teams: new Set(alerts.map(a => a.owner)).size, pickedUp: earliest(e.findings.map(f => f.created_at)),
  };
}
