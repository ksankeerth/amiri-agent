// Market series: the plain words and numbers both pages share (kept free of React so node can test them).

interface WindowLike { days: number; z: number | null; change_pct?: number }

/** The latest one-day move's z. The list and the series page show this one, never `max_z`: that is the largest over
 *  the 1-, 3- and 5-day windows, so it can come from a longer window than the "day" the page says. */
export function oneDayZ(latest: { windows: WindowLike[] } | null | undefined): number | null {
  return latest?.windows.find(w => w.days === 1)?.z ?? null;
}

/** Where a track puts a value: 0 at the left, `threshold` at the dashed line, a little room beyond it. */
export function trackSpan(threshold: number): number { return threshold * 1.4; }
export function trackPos(z: number, threshold: number): number {
  return Math.min(Math.abs(z), trackSpan(threshold)) / trackSpan(threshold);
}

/** The short form of what a move means ("A rise means a weaker rupee"): the part about a rise, for a row. */
export function shortMeaning(text: string): string {
  return text.replace(/,\s*a fall .*$/i, "").replace(/^[A-Za-z ]+ price \(([^)]+)\): /, "$1: ").replace(/^./, c => c.toUpperCase());
}

const NOT_CONFIGURED = "Twelve Data isn't configured. Set TWELVEDATA_API_KEY in the server's environment; until then nothing can be added, refreshed or pulled.";

/** The list's one "not updated" line, said once; null when every price is current. A Platform Admin also gets the
 *  server's reason when the provider isn't set up. */
export function listNotice(o: { total: number; stale: number; oldestDay: string | null; configured: boolean; admin: boolean }): string | null {
  const { total, stale, oldestDay, configured, admin } = o;
  const base = stale === 0 ? null
    : stale === total ? `Prices haven't updated since ${oldestDay}.`
    : `${stale} of ${total} prices haven't updated; the oldest since ${oldestDay}.`;
  if (admin) return [base, configured ? null : NOT_CONFIGURED].filter(Boolean).join(" ") || null;
  if (base) return `${base} Your Platform Admin has been told.`;
  return configured ? null : "Prices can't be updated right now. Your Platform Admin has been told.";
}

/** The series page's one problem line (stale, failed fetch, provider not set up), said once. */
export function seriesNotice(o: {
  stale: boolean; since: string | null; configured: boolean; admin: boolean;
  failed: { at: string; code: string; http: number | null; message: string } | null;
}): string | null {
  const { stale, since, configured, admin, failed } = o;
  const base = stale ? `Not updated since ${since}.` : null;
  if (admin) {
    const err = failed ? `The last fetch failed (${failed.at}). Twelve Data returned: ${failed.code}${failed.http ? ` ${failed.http}` : ""}: ${failed.message}.` : null;
    return [base, configured ? null : NOT_CONFIGURED, err].filter(Boolean).join(" ") || null;
  }
  if (base) return `${base} Your Platform Admin has been told.`;
  if (failed) return "The last price update failed. The prices below are the last ones received; your Platform Admin has been told.";
  return configured ? null : "Prices can't be updated right now. Your Platform Admin has been told.";
}

/** A flagged move in a line: "Down 13.10% in 3 trading days (3.3× typical)", or the finding's own title. */
export function moveLine(f: { title: string; evidence?: { signals?: { change_pct: number; window_days: number; z: number; direction?: string }[] } | null }): string {
  const s = f.evidence?.signals?.[0];
  if (!s) return f.title;
  const z = (Math.floor(Math.abs(s.z) * 10) / 10).toFixed(1);
  const up = s.direction ? s.direction === "up" : s.change_pct > 0;
  return `${up ? "Up" : "Down"} ${Math.abs(s.change_pct).toFixed(2)}% in ${s.window_days} trading day${s.window_days === 1 ? "" : "s"} (${z}× typical)`;
}
