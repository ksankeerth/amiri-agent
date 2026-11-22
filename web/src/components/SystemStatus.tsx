// "Is AMIRI Agent working?" in the side bar, under Scenario Studio: an orbit of four arcs around a core, one per agent.
// A working agent's arc is green with a light running round it; one that isn't connected stays grey. The core is green
// when everything is connected and updates run on time, and amber (pulsing) otherwise. Clicking opens the detail.
// It reads the Overview data the shell already loads every minute, so it makes no calls of its own.
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import type { Overview } from "../api/overview";
import { ago } from "../format";
import "../styles/system-status.css";

const rgba = (c: string, a: number) => { const m = c.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i); if (!m) return c;
  const h = m[1].length === 3 ? [...m[1]].map(x => x + x).join("") : m[1], n = parseInt(h, 16);
  return `rgba(${n >> 16}, ${(n >> 8) & 255}, ${n & 255}, ${a})`; };

function Orbit({ up, good }: { up: boolean[]; good: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const key = up.join() + good;
  useEffect(() => {
    const cv = ref.current!, ctx = cv.getContext("2d")!, S = 52, d = Math.min(2, devicePixelRatio || 1);
    cv.width = S * d; cv.height = S * d; ctx.setTransform(d, 0, 0, d, 0, 0);
    const css = (n: string) => getComputedStyle(cv).getPropertyValue(n).trim();
    const dot = (x: number, y: number, r: number, c: string, a: number) => { const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, rgba(c, a)); g.addColorStop(.35, rgba(c, a * .8)); g.addColorStop(1, rgba(c, 0)); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill(); };
    let raf = 0, t = 0;  // t in seconds, so the speed is the same on a 60 Hz projector and a 120 Hz laptop
    const t0 = performance.now();
    const draw = () => {
      const G = css("--accent"), Y = css("--high"), K = css("--ink-3"), dark = getComputedStyle(document.documentElement).colorScheme.includes("dark");
      const c = S / 2, R = 19;
      ctx.clearRect(0, 0, S, S); ctx.globalCompositeOperation = dark ? "lighter" : "source-over";
      up.forEach((u, i) => {  // Investigation at the top, then Monitors, Setup agent and Radar clockwise
        const a0 = -Math.PI * .75 + i * Math.PI / 2 + .14, a1 = a0 + Math.PI / 2 - .28;
        ctx.strokeStyle = rgba(u ? G : K, u ? .6 : .35); ctx.lineWidth = 3; ctx.lineCap = "round"; ctx.beginPath(); ctx.arc(c, c, R, a0, a1); ctx.stroke();
        // a dot glides along its arc once every 4 s, fading in at the start and out at the end, so it never snaps back
        if (u) { const f = (t / 4 + i * .25) % 1, a = a0 + (a1 - a0) * f; dot(c + Math.cos(a) * R, c + Math.sin(a) * R, 4, G, .95 * Math.sin(Math.PI * f)); }
      });
      dot(c, c, 8 + Math.sin(t * Math.PI * 2 / 3) * 1.5, good ? G : Y, .95);
      ctx.globalCompositeOperation = "source-over";
    };
    const loop = () => { if (!document.hidden) { t = (performance.now() - t0) / 1000; draw(); } raf = requestAnimationFrame(loop); };
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) draw(); else loop();
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return <canvas ref={ref} className="sbs-orbit" style={{ width: 52, height: 52 }} aria-hidden="true" />;
}

export function SystemStatus({ o, now }: { o: Overview | null; now: Date }) {
  const [open, setOpen] = useState(false);
  if (!o || o.first_run || !o.services) return null;
  const s = o.services;
  const agents = [["Investigation", s.investigation.connected], ["Monitors", s.monitor.connected], ["Setup agent", s.assistant.connected], ["Radar", s.radar.connected]] as const;
  const up = agents.filter(([, u]) => u).length, good = s.tick.ok && up === agents.length;
  const state = good ? "All working" : up === agents.length ? "Updates late" : `${up} of ${agents.length} connected`;
  const when = s.tick.last_at ? ago(s.tick.last_at, now) : null;
  const upd = !when ? "Updates haven't run yet" : s.tick.ok ? `Updated ${when}` : `Updates late · last ran ${when}`;
  return (
    <div className="navgroup sbs" data-state={good ? "ok" : "warn"}>
      <div className="grp label">System</div>
      <button type="button" className="sbs-box" aria-expanded={open} aria-controls="sbs-detail" onClick={() => setOpen(x => !x)}
        aria-label={`Is AMIRI Agent working? ${state}. ${upd}. Show the detail.`}>
        <Orbit up={agents.map(([, u]) => u)} good={good} />
        <span className="sbs-txt"><b>AMIRI Agent</b><span className="sbs-word">{state}</span><span className={`sbs-upd${s.tick.ok ? "" : " late"}`}>{upd}</span></span>
      </button>
      {open && <ul className="sbs-detail" id="sbs-detail">
        <li><span className={`statusdot ${s.tick.ok ? "sd-ok" : "sd-down"}`} aria-hidden="true" />Updates: {when ? `${s.tick.ok ? "last ran" : "late; last ran"} ${when}` : "haven't run yet"}</li>
        {agents.map(([n, u]) => <li key={n}><span className={`statusdot ${u ? "sd-ok" : "sd-off"}`} aria-hidden="true" />{n}: {u ? "working" : "not connected"}</li>)}
        {o.studio && <li><span className="statusdot sd-warn" aria-hidden="true" /><Link to={`/studio/run/${o.studio.sim_id}`}>Studio: {o.studio.title}, day {o.studio.step} of {o.studio.steps}</Link></li>}
      </ul>}
    </div>
  );
}
