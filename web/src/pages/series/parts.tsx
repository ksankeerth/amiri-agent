// Pieces the Market series list and the series page share: the status call, the "How this works" text, and the
// track that shows how unusual a one-day move is.
import { useCallback, useEffect, useState } from "react";
import { seriesApi, type SeriesStatus } from "../../api/series";
import { useNow, useRole } from "../../components/ui";
import { due, zx, ZONE_LABEL } from "../../format";
import { ruleText } from "../../plain";
import { trackPos } from "./words";

export function useSeriesStatus() {
  const [status, setStatus] = useState<SeriesStatus | null>(null);
  const load = useCallback(() => seriesApi.status().then(setStatus).catch(() => {}), []);
  useEffect(() => { load(); }, [load]);
  return { status, reload: load };
}

/** How prices are pulled: the text behind the page's "How this works". */
export function SeriesHelp({ status, id, open }: { status: SeriesStatus | null; id: string; open: boolean }) {
  const now = useNow(60_000);
  const { role } = useRole();
  const c = status?.provider.credits;
  return (
    <div id={id} className="rd-open rd-prose sr-help" hidden={!open}>
      <p>Amiri Agent watches these prices by itself, with plain arithmetic. It {ruleText(status?.detector_defaults.z_threshold ?? 3)} for that length of time; each flagged move becomes a finding for the investigation.</p>
      {status && <p>Prices are pulled once an hour, not streamed. The next pull is due {due(status.schedule.next_run_at, now)}{status.schedule.next_run_at && new Date(status.schedule.next_run_at) > now ? ` ${ZONE_LABEL} time` : ""}. Refresh now pulls a series' latest prices (once every {Math.round(status.refresh.cooldown_seconds / 60)} minutes). Up to {status.limits.max_series} series can be watched; {status.limits.used} are.</p>}
      {role === "platform_admin" && c && <p>Twelve Data credits today: {c.used_today} of {c.per_day}; this minute {c.used_last_minute} of {c.per_minute}.</p>}
    </div>
  );
}

/** How unusual the latest one-day move is, on a static track from 0× to the dashed flag line. `z` is the one-day
 *  window's. Past the line the dot becomes a ◆ and the words say "flagged": never colour alone. */
export function Track({ z, threshold, size = "sm" }: { z: number | null; threshold: number; size?: "sm" | "lg" }) {
  if (z === null) return <div className={`sr-track sr-${size}`}><div className="sr-tv sr-none">Not known yet</div></div>;
  const lg = size === "lg", W = lg ? 460 : 230, pad = 8, r = lg ? 11 : 8, y = lg ? 16 : 13;
  const x = (f: number) => pad + f * (W - pad * 2);
  const flagged = Math.abs(z) >= threshold;
  const cx = x(trackPos(z, threshold)), tx = x(trackPos(threshold, threshold));
  return (
    <div className={`sr-track sr-${size}`}>
      <div className="sr-tv"><b>{zx(z)}</b> a normal day{lg ? ` · flagged at ${threshold}×` : ""}
        {flagged && <span className="sr-flag"> · <span className="rd-shape rd-t-mixed" aria-hidden="true">◆</span>flagged</span>}</div>
      <svg width={W} height={y * 2 + 22} viewBox={`0 0 ${W} ${y * 2 + 22}`} aria-hidden="true">
        <line x1={x(0)} x2={x(1)} y1={y} y2={y} stroke="var(--rd-mark)" strokeWidth={lg ? 3 : 2} strokeLinecap="round" />
        <line x1={x(0)} x2={x(0)} y1={y - 6} y2={y + 6} stroke="var(--rd-mark)" strokeWidth={2} />
        <line x1={tx} x2={tx} y1={y - r - 3} y2={y + r + 3} stroke="var(--ink)" strokeWidth={2} strokeDasharray="4 3" />
        {flagged
          ? <rect x={cx - r * 0.85} y={y - r * 0.85} width={r * 1.7} height={r * 1.7} fill="var(--high-ink)" transform={`rotate(45 ${cx} ${y})`} />
          : <circle cx={cx} cy={y} r={r} fill="var(--ink)" />}
        <text x={x(0)} y={y * 2 + 18} textAnchor="start">0×</text>
        <text x={tx} y={y * 2 + 18} textAnchor="middle">{threshold}×</text>
      </svg>
      <span className="sr">{`${zx(z)} a normal day; flagged at ${threshold}×${flagged ? "; flagged" : ""}`}</span>
    </div>
  );
}
