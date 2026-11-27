// The schedules pill in the middle of the top bar: three icons (Monitors, Radar, Series), each with a dot for its state.
// Hovering with a mouse, focusing it or tapping it opens the full line in place (counts, last and next runs, what is
// late), floating over the bar so nothing beside it moves. Escape or leaving it closes it.
import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { Link } from "react-router-dom";
import { quietly } from "../../api/client";
import { monitorsApi, type MonitorsStatus } from "../../api/monitors";
import type { Overview } from "../../api/overview";
import { ago, due, plural } from "../../format";
import { Icon } from "../Icon";
import "../../styles/v2/schedules.css";

type Tone = "warn" | "wait" | "ok" | null;

/** "US dollar to UAE dirham" -> "USD/AED"; short names stay as they are. */
function shortName(m: { series_id: string; name: string }): string {
  if (m.name.length <= 12) return m.name;
  if (/^[a-z]{3}_[a-z]{3}$/i.test(m.series_id)) return m.series_id.toUpperCase().replace("_", "/");
  return `${m.name.slice(0, 12).trim()}…`;
}

function useMonitorsStatus() {
  const [st, setSt] = useState<MonitorsStatus | null>(null);
  useEffect(() => {
    const load = () => quietly(() => monitorsApi.status()).then(setSt).catch(() => {});
    load();
    const t = setInterval(() => { if (!document.hidden) load(); }, 60_000);  // not while the tab is hidden
    return () => clearInterval(t);
  }, []);
  return st;
}

export function SchedulePill({ ov, now }: { ov: Overview | null; now: Date }) {
  const mon = useMonitorsStatus();
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  if (!ov || ov.first_run) return <span aria-hidden="true" />;  // keeps the bar's middle column

  const c = ov.counts, r = ov.radar;
  const moved = (ov.markets ?? []).filter(m => m.state === "moved");
  const stale = (ov.markets ?? []).filter(m => m.state === "stale");
  // Radar is late when its last run is more than two intervals old
  const radarLate = !!r.last_run_at && now.getTime() - new Date(r.last_run_at).getTime() > 2 * r.every_minutes * 60_000;

  const monTone: Tone = c.monitors_waiting_approval > 0 ? "wait" : c.monitors_live > 0 ? "ok" : null;
  const radarTone: Tone = radarLate ? "warn" : r.last_run_at ? "ok" : null;
  const seriesTone: Tone = moved.length + stale.length > 0 ? "warn" : c.series_watched > 0 ? "ok" : null;
  const seriesNote = moved.length > 0
    ? `${shortName(moved[0])}${moved.length > 1 ? ` +${moved.length - 1}` : ""} unusual`
    : stale.length > 0 ? `${stale.length} late` : null;

  const said = [
    `Monitors ${c.monitors_live}${c.monitors_waiting_approval ? `, ${plural(c.monitors_waiting_approval, "approval")} waiting` : ""}`,
    `Radar ${radarLate ? "late" : "on time"}`,
    `Series ${c.series_watched}${seriesNote ? `, ${seriesNote}` : ""}`,
  ].join("; ");

  const hover = (on: boolean) => (e: PointerEvent) => { if (e.pointerType === "mouse") setOpen(on); };
  const key = (e: KeyboardEvent) => { if (e.key === "Escape" && open) { e.stopPropagation(); setOpen(false); btn.current?.focus(); } };
  const done = () => setOpen(false);

  return (
    <div className="v2-sched" onPointerEnter={hover(true)} onPointerLeave={hover(false)} onKeyDown={key}
      onFocus={e => { if (e.target.matches(":focus-visible")) setOpen(true); }} onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOpen(false); }}>
      <button ref={btn} type="button" className="v2-sched__pill" aria-expanded={open} aria-controls="v2-sched-line"
        aria-label={`Schedules: ${said}`} onClick={() => setOpen(o => !o)}>
        {([["monitor", monTone], ["radar", radarTone], ["series", seriesTone]] as const).map(([icon, tone]) => (
          <span key={icon} className="v2-sched__ic"><Icon name={icon} />{tone && <span className={`v2-sched__dot is-${tone}`} />}</span>
        ))}
      </button>
      {open && (
        <div className="v2-sched__line" id="v2-sched-line" role="region" aria-label="Schedules">
          <Link className="v2-sched__seg" to="/monitors" onClick={done}>
            <Icon name="monitor" /><b>Monitors ({c.monitors_live})</b>
            {mon?.next_check_at && <span className="v2-sched__sub">· next <span className="v2-sched__t">{due(mon.next_check_at, now)}</span></span>}
            {c.monitors_waiting_approval > 0 && <span className="v2-sched__wait">· {plural(c.monitors_waiting_approval, "approval")}</span>}
          </Link>
          <span className="v2-sched__sep" aria-hidden="true" />
          <Link className="v2-sched__seg" to="/radar" onClick={done}>
            <Icon name="radar" /><b>Radar</b>
            {r.last_run_at && <span className="v2-sched__sub">· last <span className="v2-sched__t">{ago(r.last_run_at, now)}</span></span>}
            {r.next_run_at && <span className="v2-sched__sub">· next <span className="v2-sched__t">{due(r.next_run_at, now)}</span></span>}
          </Link>
          <span className="v2-sched__sep" aria-hidden="true" />
          <Link className="v2-sched__seg" to="/series" onClick={done}>
            <Icon name="series" /><b>Series ({c.series_watched})</b>
            {seriesNote && <span className="v2-sched__warn">· {seriesNote}</span>}
          </Link>
        </div>
      )}
    </div>
  );
}
