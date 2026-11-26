// The guided setup's Monitors step (P15b; no board draws it, decision D5: the Monitors page's words and pills, the Institution page's
// sections): what the profile can be watched for, and the monitors so far. A draft is only a draft: a Risk Manager approves it on the
// Monitors page before it runs, and the demo lock greys the drafting (the server guards it).
//
// Asking, and how often: what can be drafted and the monitors list, once when the step opens and again on "Try again". Nothing polls.
import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { monitorsApi, type Draftable, type MonitorRow } from "../../api/monitors";
import { useDemoLock } from "../../components/lock";
import { useNow, useRefusalToast } from "../../components/ui";
import { ArrowLink } from "../../components/v2/ArrowLink";
import { Button } from "../../components/v2/Button";
import { Empty } from "../../components/v2/Empty";
import { LoadError } from "../../components/v2/LoadError";
import { Pill } from "../../components/v2/Pill";
import { SectionHead } from "../../components/v2/SectionHead";
import { Skeleton } from "../../components/v2/Skeleton";
import { ago } from "../../format";
import { SECTION_WORDS } from "./draft";
import { rowLine, statusLook } from "./words";
import "../../styles/v2/institution.css";
import "../../styles/v2/setup.css";

/** The guided setup's Monitors step: what the profile can be watched for, and the monitors so far. */
export function MonitorsStep({ institutionId }: { institutionId: string }) {
  const nav = useNavigate();
  const refuse = useRefusalToast();
  const locked = useDemoLock();
  const now = useNow(60_000);
  const [items, setItems] = useState<Draftable[] | null>(null);
  const [mine, setMine] = useState<MonitorRow[]>([]);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const load = useCallback(() => {
    setError(null);
    return Promise.all([monitorsApi.draftable(institutionId), monitorsApi.list(institutionId)])
      .then(([d, m]) => { setItems(d); setMine(m); }).catch(setError);
  }, [institutionId]);
  useEffect(() => { load(); }, [load]);
  const draft = async (d: Draftable) => {
    setBusy(d.item_id);
    try { const m = await monitorsApi.draft(d.section, d.item_id, institutionId); nav(`/monitors/${m.monitor_id}`); }
    catch (e) { refuse(e, "Couldn't draft the monitor"); setBusy(null); }
  };
  if (error != null) return <LoadError error={error} onRetry={load} what="the monitors" safe="Your monitors are safe; this page just couldn't reach them." />;
  if (items === null) return <Skeleton rows={4} label="Loading the monitors" />;
  const open = items.filter(i => !i.monitor_id);
  return (
    <>
      <section className="v2-in-sec" aria-labelledby="sw-draft">
        <SectionHead title="Draft from your profile" id="sw-draft" />
        <p className="v2-in-sec__note">Each monitor runs after a Risk Manager approves it on the Monitors page. You can also ask the Setup agent: “watch our main rival's deposit rates”.</p>
        {!open.length
          ? <Empty title="Nothing left to draft" plain className="v2-in-empty">Everything the profile offers is watched, or there is nothing to draft from yet. Add rivals, flows or risks first, and they show up here.</Empty>
          : Object.entries(SECTION_WORDS).map(([s, w]) => {
            const xs = open.filter(i => i.section === s);
            return xs.length ? (
              <div key={s} className="v2-sw-draft">
                <h3 className="v2-cap">{w}</h3>
                <ul className="v2-sw-draft__l">{xs.map(i => (
                  <li key={i.item_id}><Button size="sm" locked={locked} disabled={!!busy && busy !== i.item_id} busy={busy === i.item_id} busyLabel="Drafting…" onClick={() => draft(i)}>
                    <span aria-hidden="true">+ </span>{i.label}</Button></li>))}</ul>
              </div>) : null;
          })}
      </section>
      <section className="v2-in-sec" aria-labelledby="sw-mons">
        <SectionHead title="Your monitors" id="sw-mons" count={mine.length} action={<ArrowLink to="/monitors">Monitors page</ArrowLink>} />
        {!mine.length ? <p className="v2-in-none">None yet. You can go live without any, and add them later.</p> : (
          <ul className="v2-sw-mons" aria-label="Monitors so far">{mine.map(m => {
            const look = statusLook(m), line = rowLine(m, now, iso => ago(iso, now));
            return (
              <li key={m.monitor_id}>
                <span className="v2-sw-mons__top"><Link className="v2-sw-mons__name" to={`/monitors/${m.monitor_id}`}>{m.name}</Link><Pill tone={look.tone} dashed={look.dashed}>{look.label}</Pill></span>
                <span className="v2-sw-mons__s">{m.sentence}</span>
                <span className="v2-meta">{line.lead}</span>
              </li>);
          })}</ul>)}
      </section>
    </>
  );
}
