// Plain logic for the still dotted map: which points to frame, where the dot grid's cells are, and the words that
// stand in for the picture (A7).
import { DIRECTIONS, type DirectionTone } from "./directionWords.ts";

const MIN_SPAN = 30;  // degrees: the smallest area the map frames, so a single place still shows its neighbours (as ProfileMap does)

/** The points to frame, with two corner points added when the area is under `minSpan` degrees either way, so the box is
 *  at least that big round its centre and stays inside the map (±179°, ±89°). */
export function frameOf(points: [number, number][], minSpan = MIN_SPAN): [number, number][] {
  if (!points.length) return [];
  const lons = points.map(p => p[0]), lats = points.map(p => p[1]);
  if (Math.max(...lons) - Math.min(...lons) >= minSpan && Math.max(...lats) - Math.min(...lats) >= minSpan) return points;
  const half = minSpan / 2;
  const cx = Math.min(179 - half, Math.max(-179 + half, (Math.min(...lons) + Math.max(...lons)) / 2));
  const cy = Math.min(89 - half, Math.max(-89 + half, (Math.min(...lats) + Math.max(...lats)) / 2));
  return [...points, [cx - half, cy - half], [cx + half, cy + half]];
}

/** The centre of every cell of a size.w × size.h picture cut into `cell` px squares, row by row. */
export function gridCells(w: number, h: number, cell: number): { col: number; row: number; x: number; y: number }[] {
  const out: { col: number; row: number; x: number; y: number }[] = [];
  const cols = Math.floor(w / cell), rows = Math.floor(h / cell);
  for (let row = 0; row < rows; row++) for (let col = 0; col < cols; col++) out.push({ col, row, x: col * cell + cell / 2, y: row * cell + cell / 2 });
  return out;
}

/** "Bad for you: Austin, Texas. Mixed: Silicon Valley. Good for you: Permian." (the shape and the word, per place) */
export function describePlaces(places: { label: string; tone: DirectionTone }[], intro = "Where today's events are"): string {
  const parts = (["bad", "mixed", "good", "neutral"] as const)
    .map(t => ({ t, names: places.filter(p => p.tone === t).map(p => p.label) }))
    .filter(g => g.names.length)
    .map(g => `${DIRECTIONS[g.t].word}: ${g.names.join(", ")}.`);
  return parts.length ? `${intro}. ${parts.join(" ")}` : `${intro}: none.`;
}
