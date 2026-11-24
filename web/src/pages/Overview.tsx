// The Overview (board 00, states in board 15 section A): a greeting, the one headline that answers "does anything need
// my teams?", the map of where, four numbered tiles, the open events, what came in, what needs you, and the prices.
// One call (GET /overview), refreshed every minute; the answer also goes to the top bar's Live pill (overviewApi).
import { useCallback, useEffect, useState } from "react";
import { alertsApi } from "../api/alerts";
import { ME } from "../api/client";
import { overviewApi, type Overview } from "../api/overview";
import { useRole, useNow } from "../components/ui";
import { LoadError } from "../components/v2/LoadError";
import { useCrumbs } from "../components/v2/Shell";
import { StaleBanner } from "../components/v2/StaleBanner";
import { TIME_ZONE } from "../format";
import { cap } from "../plain";
import { FirstRun } from "./overview/FirstRun";
import { Hero, Latest, NeedsYou, needRows, OpenEvents, OverviewSkeleton, Prices, rankEvents, ScenarioRow, Tiles } from "./overview/parts";
import "../styles/v2/overview.css";

const REFRESH_MS = 60_000;
const CRUMBS = [{ label: "Overview" }];
const NAME = cap(ME.split("@")[0]);

export function OverviewPage() {
  useCrumbs(CRUMBS);
  const now = useNow(30_000);
  const { role } = useRole();
  const admin = role === "platform_admin";
  const [o, setO] = useState<Overview | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const [loadedAt, setLoadedAt] = useState<number | null>(null);
  const [teams, setTeams] = useState<number | null>(null);  // how many teams the alerts are for (the fourth tile)

  const load = useCallback(async () => {
    try {
      const x = await overviewApi.get(admin);
      setO(x); setErr(null); setLoadedAt(Date.now());
      if (!x.first_run) alertsApi.summary().then(s => setTeams(s.teams.filter(t => t.to_review > 0).length)).catch(() => setTeams(null));
    } catch (e) { setErr(e); }
  }, [admin]);
  useEffect(() => { load(); const t = setInterval(load, REFRESH_MS); return () => clearInterval(t); }, [load]);

  if (!o) {
    return err
      ? <div className="v2-ov"><h1 className="v2-sr">Overview</h1><LoadError what="the Overview" error={err} onRetry={load} /></div>
      : <OverviewSkeleton />;
  }
  if (o.first_run) return <FirstRun o={o} />;

  const events = rankEvents(o.events);
  const rows = needRows(o.attention);
  return (
    <div className="v2-ov">
      {err != null && loadedAt != null && <StaleBanner loadedAt={loadedAt} now={now.getTime()} onRetry={load} />}
      <Hero o={o} events={events} now={now} name={NAME} timeZone={o.institution?.time_zone || TIME_ZONE} />
      <Tiles o={o} events={events} teams={teams} />
      {o.studio && <ScenarioRow studio={o.studio} />}
      <div className="v2-ov-cols">
        <div className="v2-ov-main">
          <OpenEvents events={events} places={o.map.places} now={now} />
          <Latest o={o} now={now} />
        </div>
        <aside className="v2-ov-side" aria-label="Needs you and prices">
          <NeedsYou rows={rows} more={o.attention_more} adminNotes={o.admin_notes} hasAlerts={o.counts.alerts_to_review > 0} />
          <Prices markets={o.markets} />
        </aside>
      </div>
    </div>
  );
}
