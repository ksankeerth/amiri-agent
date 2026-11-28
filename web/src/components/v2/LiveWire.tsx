// The Live wire on the Overview (from the earlier design): a strip that pages through the open events, an unusual market
// move and the latest findings, three at a time (two on a narrower screen, one on a phone). It turns the page every 6 s,
// stops while hovered or focused, and not at all with reduced motion; ‹ › page by hand.
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { Overview } from "../../api/overview";
import { ago } from "../../format";
import { eventTitle } from "../../plain";
import "../../styles/v2/live-wire.css";

interface Entry { key: string; to: string; tag: string; tone: "ok" | "crit" | "warn" | "info"; text: string; meta?: string }

/** "Ships held at Hormuz (Nov 24, 2026)" -> "Ships held at Hormuz": a trailing date reads as noise in a one-line strip. */
const undated = (t: string) =>
  t.replace(/\s*[([]?\s*[-–—|,]?\s*(?:\w{3,9}\.?\s+\d{1,2},?\s+\d{4}|\d{1,2}\s+\w{3,9}\.?,?\s+\d{4}|\d{4}-\d{2}-\d{2})\s*[)\]]?\s*$/, "") || t;
const slotsFor = (w: number) => (w <= 680 ? 1 : w <= 1120 ? 2 : 3);

export function LiveWire({ ov, now }: { ov: Overview; now: Date }) {
  const entries = useMemo<Entry[]>(() => {
    const list: Entry[] = [];
    const moved = (ov.markets ?? []).filter(m => m.state === "moved");
    (ov.events ?? []).slice(0, 3).forEach(ev => list.push({
      key: `ev-${ev.event_id}`, to: `/events/${ev.event_id}`,
      tag: ev.tone === "bad" ? "ADVERSE" : ev.tone === "good" ? "POSITIVE" : "EVENT",
      tone: ev.tone === "bad" ? "crit" : ev.tone === "good" ? "ok" : "info",
      text: eventTitle(ev), meta: ev.effects ? `${ev.effects} ${ev.effects === 1 ? "line" : "lines"}` : undefined,
    }));
    if (moved.length > 0) list.push({
      key: `mk-${moved[0].series_id}`, to: `/series/${moved[0].series_id}`, tag: "MARKET", tone: "warn",
      text: `${moved[0].name} unusual move`, meta: `${ov.counts.series_watched} watched`,
    });
    (ov.findings ?? []).slice(0, 4).forEach(f => list.push({
      key: `fd-${f.finding_id}`, to: f.event_id ? `/events/${f.event_id}` : `/findings#f-${f.finding_id}`,
      tag: f.source === "radar" ? "RADAR" : f.source === "monitor" ? "MONITOR" : "SIGNAL", tone: "info",
      text: undated(f.title), meta: ago(f.created_at, now),
    }));
    return list;
  }, [ov, now]);

  const [slots, setSlots] = useState(() => (typeof window === "undefined" ? 3 : slotsFor(window.innerWidth)));
  const [offset, setOffset] = useState(0);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const paused = hovered || focused;

  useEffect(() => {
    const update = () => setSlots(slotsFor(window.innerWidth));
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  const total = entries.length;
  const canFlip = total > slots;
  useEffect(() => {
    if (!canFlip || paused) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const t = window.setInterval(() => setOffset(o => (o + slots) % total), 6000);
    return () => window.clearInterval(t);
  }, [canFlip, paused, slots, total]);

  if (total === 0) return null;
  const live = ov.services?.tick?.ok ? "live" : "warn";
  const count = Math.min(slots, total);
  const shown = Array.from({ length: count }, (_, i) => entries[(offset + i) % total]);
  const step = (dir: -1 | 1) => setOffset(o => ((o + dir * slots) % total + total) % total);
  const first = (offset % total) + 1, last = ((offset + count - 1) % total) + 1;

  return (
    <div className="v2-wire" role="region" aria-label="Live captured risk and news feed"
      onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)} onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocused(false); }}>
      <Link to="/findings" className="v2-wire__badge" title="View all captured findings">
        <span className={`v2-wire__dot is-${live}`} aria-hidden="true" />
        <span>LIVE WIRE</span>
      </Link>
      <div className="v2-wire__strip" key={offset}>
        {shown.map(item => (
          <Link key={item.key} className="v2-wire__item" to={item.to} title={item.text}>
            <span className={`v2-wire__tag is-${item.tone}`}>{item.tag}</span>
            <span className="v2-wire__txt">{item.text}</span>
            {item.meta && <span className="v2-wire__meta">· {item.meta}</span>}
          </Link>
        ))}
      </div>
      {canFlip && (
        <div className="v2-wire__pager">
          <span className="v2-wire__pos" aria-live="polite">{count === 1 ? `${first}/${total}` : `${first}–${last}/${total}`}</span>
          <button type="button" className="v2-wire__nav" aria-label="Previous signals" onClick={() => step(-1)}>‹</button>
          <button type="button" className="v2-wire__nav" aria-label="Next signals" onClick={() => step(1)}>›</button>
        </div>
      )}
    </div>
  );
}
