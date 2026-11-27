// The schedules pill in the top bar: three icons (Monitors, Radar, Series) on the bar itself, no box; a dot marks one
// that wants attention (amber: late or unusual; green: waiting for approval). It sits centred in the space between the
// breadcrumbs and Go to. Hovering with a mouse, focusing it or tapping it opens the full line: in place when the line fits
// that space, else as a panel under the bar, so it never covers the breadcrumbs or Go to. On a phone (`phone`) it sits in the phone bar and opens as a full-width panel under it.
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { Link } from "react-router-dom";
import { quietly } from "../../api/client";
import { monitorsApi, type MonitorsStatus } from "../../api/monitors";
import type { Overview } from "../../api/overview";
import { ago, due, plural } from "../../format";
import { Icon } from "../Icon";
import "../../styles/v2/schedules.css";

type Tone = "warn" | "wait" | null;  // a dot only when something wants attention
const EDGE = 8;  // the panel keeps this far inside the top bar

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

export function SchedulePill({ ov, now, phone }: { ov: Overview | null; now: Date; phone?: boolean }) {
  const mon = useMonitorsStatus();
  const [open, setOpen] = useState(false);
  const [panel, setPanel] = useState(false);  // false: the line in place; true: a panel under the bar
  const [shift, setShift] = useState(0);      // px the panel moves sideways to stay inside the bar
  const btn = useRef<HTMLButtonElement>(null), box = useRef<HTMLDivElement>(null), line = useRef<HTMLDivElement>(null);
  const back = useRef(false);  // focus coming back after Escape: don't open again

  const show = () => { if (!open) { setPanel(!!phone); setShift(0); setOpen(true); } };

  // before it is painted: does the line fit the space between the breadcrumbs and Go to? If not, a panel; then keep
  // the panel inside the bar
  useLayoutEffect(() => {
    if (!open || phone || !box.current || !line.current) return;
    if (!panel) { if (line.current.offsetWidth > box.current.clientWidth) setPanel(true); return; }
    const bar = box.current.closest(".v2-top")?.getBoundingClientRect(), r = line.current.getBoundingClientRect();
    if (!bar) return;
    const left = r.left - shift, right = r.right - shift;
    setShift(left < bar.left + EDGE ? bar.left + EDGE - left : right > bar.right - EDGE ? bar.right - EDGE - right : 0);
  }, [open, panel, phone]);  // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {  // a tap or click elsewhere closes it (a touch screen has no "leave"); so does a resize
    if (!open) return;
    const away = (e: Event) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const shut = () => setOpen(false);
    document.addEventListener("pointerdown", away);
    window.addEventListener("resize", shut);
    return () => { document.removeEventListener("pointerdown", away); window.removeEventListener("resize", shut); };
  }, [open]);

  if (!ov || ov.first_run) return <span className="v2-top__mid" aria-hidden="true" />;

  const c = ov.counts, r = ov.radar;
  const moved = (ov.markets ?? []).filter(m => m.state === "moved");
  const stale = (ov.markets ?? []).filter(m => m.state === "stale");
  // Radar is late when its last run is more than two intervals old
  const radarLate = !!r.last_run_at && now.getTime() - new Date(r.last_run_at).getTime() > 2 * r.every_minutes * 60_000;

  const monTone: Tone = c.monitors_waiting_approval > 0 ? "wait" : null;
  const radarTone: Tone = radarLate ? "warn" : null;
  const seriesTone: Tone = moved.length + stale.length > 0 ? "warn" : null;
  const seriesNote = moved.length > 0
    ? `${shortName(moved[0])}${moved.length > 1 ? ` +${moved.length - 1}` : ""} unusual`
    : stale.length > 0 ? `${stale.length} late` : null;

  const said = [
    `Monitors ${c.monitors_live}${c.monitors_waiting_approval ? `, ${plural(c.monitors_waiting_approval, "approval")} waiting` : ""}`,
    `Radar ${radarLate ? "late" : "on time"}`,
    `Series ${c.series_watched}${seriesNote ? `, ${seriesNote}` : ""}`,
  ].join("; ");

  const hover = (on: boolean) => (e: PointerEvent) => { if (e.pointerType === "mouse") { if (on) show(); else setOpen(false); } };
  const key = (e: KeyboardEvent) => { if (e.key === "Escape" && open) { e.stopPropagation(); setOpen(false); back.current = true; btn.current?.focus(); back.current = false; } };
  const done = () => setOpen(false);
  const cls = `v2-sched__line ${panel ? "is-panel" : "is-line"}`;

  return (
    <div ref={box} className={`v2-sched v2-top__mid${phone ? " is-phone" : ""}`} onPointerEnter={hover(true)} onPointerLeave={hover(false)} onKeyDown={key}
      onFocus={e => { if (!back.current && e.target.matches(":focus-visible")) show(); }}
      onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOpen(false); }}>
      <button ref={btn} type="button" className="v2-sched__pill" aria-expanded={open} aria-controls="v2-sched-line"
        aria-label={`Schedules: ${said}`} onClick={() => (open ? setOpen(false) : show())}>
        {([["monitor", monTone], ["radar", radarTone], ["series", seriesTone]] as const).map(([icon, tone]) => (
          <span key={icon} className="v2-sched__ic"><Icon name={icon} />{tone && <span className={`v2-sched__dot is-${tone}`} />}</span>
        ))}
      </button>
      {open && (
        <div ref={line} className={cls} id="v2-sched-line" role="region" aria-label="Schedules"
          style={shift ? { ["--v2-sched-shift" as string]: `${Math.round(shift)}px` } : undefined}>
          <Link className="v2-sched__seg" to="/monitors" onClick={done}>
            <Icon name="monitor" /><b>Monitors ({c.monitors_live})</b>
            {mon?.next_check_at && <span className="v2-sched__sub">· next <span className="v2-sched__t">{due(mon.next_check_at, now)}</span></span>}
            {c.monitors_waiting_approval > 0 && <span className="v2-sched__wait">· {plural(c.monitors_waiting_approval, "approval")}</span>}
          </Link>
          <span className="v2-sched__sep" aria-hidden="true" />
          <Link className="v2-sched__seg" to="/radar" onClick={done}>
            <Icon name="radar" /><b>Radar</b>
            {r.last_run_at && <span className="v2-sched__sub">· last {ago(r.last_run_at, now)}</span>}
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
