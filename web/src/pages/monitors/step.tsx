// The guided setup's Monitors step: what the profile can be watched for, and the monitors so far. (The setup wizard is
// still in its old look; it is redone with the rest of the setup pages.)
import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ApiError } from "../../api/client";
import { monitorsApi, type Draftable, type MonitorRow } from "../../api/monitors";
import { Section, TextButton } from "../../components/rd";
import { useNow, useToast } from "../../components/ui";
import { ago } from "../../format";
import { MONITOR_STATUS } from "../../plain";
import { SECTION_WORDS } from "./draft";

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
    <>
      <Section title="Draft from your profile">
        <p className="rd-fine rd-prose wz-after">Each monitor runs after a Risk Manager approves it on the Monitors page. You can also ask the Setup agent: "watch our main rival's deposit rates".</p>
        {items === null ? <p className="rd-fine">Loading…</p> : !open.length ? <p className="rd-row-d ins-none">Everything the profile offers is watched, or there is nothing to draft from yet.</p>
          : Object.entries(SECTION_WORDS).map(([s, w]) => {
            const xs = open.filter(i => i.section === s);
            return xs.length ? <div key={s} className="wz-draft"><h3 className="wz-pick-h">{w}</h3>
              <ul className="wz-draft-list">{xs.map(i => <li key={i.item_id}><TextButton edits disabled={!!busy} onClick={() => draft(i)}>{busy === i.item_id ? "Drafting…" : `+ ${i.label}`}</TextButton></li>)}</ul></div> : null;
          })}
      </Section>
      <Section title="Your monitors" count={mine.length} action={<Link className="rd-go" to="/monitors">Monitors page →</Link>}>
        {!mine.length ? <p className="rd-row-d ins-none">None yet.</p> : <ul className="ins-rows" aria-label="Monitors so far">{mine.map(m => (
          <li key={m.monitor_id} className="rd-row">
            <div className="rd-row-t"><Link className="rd-name" to={`/monitors/${m.monitor_id}`}>{m.name}</Link></div>
            <p className="rd-row-m"><b className="ins-k">{MONITOR_STATUS[m.status]?.[0] ?? m.status}</b> · {m.sentence}{m.last_check ? ` · last check ${ago(m.last_check.at, now)}` : ""}</p>
          </li>))}</ul>}
      </Section>
    </>
  );
}
