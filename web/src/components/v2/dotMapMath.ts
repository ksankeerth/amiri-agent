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

// ---------------------------------------------------------------- where each name goes
export type Side = "right" | "left" | "top" | "bottom";
const NAME_H = 12, NAME_GAP = 11, CHAR_W = 6.6;  // 12 px Geist: about 6.6 px a letter, measured on the board's names
interface Box { x0: number; y0: number; x1: number; y1: number }
const overlap = (a: Box, b: Box) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
const nameBox = (x: number, y: number, w: number, side: Side): Box =>
  side === "right" ? { x0: x + NAME_GAP, y0: y - NAME_H / 2, x1: x + NAME_GAP + w, y1: y + NAME_H / 2 }
    : side === "left" ? { x0: x - NAME_GAP - w, y0: y - NAME_H / 2, x1: x - NAME_GAP, y1: y + NAME_H / 2 }
      : side === "top" ? { x0: x - w / 2, y0: y - NAME_GAP - NAME_H, x1: x + w / 2, y1: y - NAME_GAP }
        : { x0: x - w / 2, y0: y + NAME_GAP, x1: x + w / 2, y1: y + NAME_GAP + NAME_H };

/** Which side of its mark each name goes, so no name runs off the picture or over another name or mark. The places are
 *  tried in the order given (the strongest first); each takes the first of right, left, top, bottom that fits, and a
 *  `side` already chosen is kept. If nothing fits, right. */
export function pickSides(marks: { label: string; x: number; y: number; side?: Side }[], width: number, height: number): Side[] {
  const points: Box[] = marks.map(m => ({ x0: m.x - 8, y0: m.y - 8, x1: m.x + 8, y1: m.y + 8 }));
  const placed: Box[] = [];
  return marks.map((m, i) => {
    const w = m.label.length * CHAR_W;
    const tryOrder: Side[] = m.side ? [m.side] : ["right", "left", "top", "bottom"];
    const fits = (s: Side) => {
      const b = nameBox(m.x, m.y, w, s);
      return b.x0 >= 0 && b.x1 <= width && b.y0 >= 0 && b.y1 <= height
        && !placed.some(p => overlap(p, b)) && !points.some((p, j) => j !== i && overlap(p, b));
    };
    const side = tryOrder.find(fits) ?? tryOrder[0];
    placed.push(nameBox(m.x, m.y, w, side));
    return side;
  });
}
