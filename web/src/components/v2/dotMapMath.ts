// Plain logic for the still dotted map: which points to frame, where the dot grid's cells are, and the words that
// stand in for the picture (A7).
import { DIRECTIONS, type DirectionTone } from "./directionWords.ts";

const MIN_SPAN = 30;  // degrees: the smallest area the map frames when nothing says how big the place is, so a single place still shows its neighbours (as ProfileMap does)

/** The corners of the area to frame ([west, south], [east, north]) round `points`: `pad` of each side added on every side (0.2 =
 *  a fifth, so marks and their names are not at the edge), then widened to at least `minSpan` degrees each way round its
 *  centre, and kept inside the map (±179°, ±89°). Nothing to frame: nothing. */
export function frameBox(points: [number, number][], minSpan = MIN_SPAN, pad = 0): [number, number][] {
  if (!points.length) return [];
  const lons = points.map(p => p[0]), lats = points.map(p => p[1]);
  const widen = (lo: number, hi: number, limit: number): [number, number] => {
    const span = hi - lo, padded = span * (1 + 2 * pad);
    const size = Math.min(2 * limit, Math.max(padded, minSpan)), half = size / 2;
    const c = Math.min(limit - half, Math.max(-limit + half, (lo + hi) / 2));
    return [c - half, c + half];
  };
  const [w, e] = widen(Math.min(...lons), Math.max(...lons), 179);
  const [s, n] = widen(Math.min(...lats), Math.max(...lats), 89);
  return [[w, s], [e, n]];
}

/** The smallest area (degrees) worth framing round a place `dim` degrees across: the place fills about half of the picture,
 *  never under `floor` (a single city or an island nation still shows its neighbours) nor over `ceil`. */
export function minSpanFor(dim: number, floor = 2, ceil = 30): number {
  return Math.min(ceil, Math.max(floor, dim * 1.8));
}

/** The box of a country's main land, from its parts ({ area, box: [[west, south], [east, north]] }): the biggest part and
 *  the parts whose middle is near its middle (within 0.6 of its size, and at least `near` degrees), so the US is the lower 48
 *  (not Alaska and Hawaii) and Japan is its main islands. A box that crosses the date line (west beyond east) can't be
 *  framed: nothing. */
export function mainBounds(parts: { area: number; box: [[number, number], [number, number]] }[], near = 10): [[number, number], [number, number]] | null {
  if (!parts.length) return null;
  const mid = (b: [[number, number], [number, number]]) => [(b[0][0] + b[1][0]) / 2, (b[0][1] + b[1][1]) / 2];
  const big = parts.reduce((a, b) => (b.area > a.area ? b : a));
  const reach = Math.max(near, 0.6 * Math.max(big.box[1][0] - big.box[0][0], big.box[1][1] - big.box[0][1]));
  const [bx, by] = mid(big.box);
  const keep = parts.filter(p => p === big || Math.hypot(mid(p.box)[0] - bx, mid(p.box)[1] - by) <= reach);
  const box: [[number, number], [number, number]] = [
    [Math.min(...keep.map(p => p.box[0][0])), Math.min(...keep.map(p => p.box[0][1]))],
    [Math.max(...keep.map(p => p.box[1][0])), Math.max(...keep.map(p => p.box[1][1]))],
  ];
  return box[0][0] > box[1][0] ? null : box;
}

export const CELL_MIN = 4, CELL_MAX = 8;
const COLS_COARSE = 70, COLS_FINE = 92, SPAN_COARSE = 90, SPAN_FINE = 6;
/** How many dots across the picture for a picture that shows `degAcross` degrees of longitude: 70 for a continent or more
 *  (90°+), 92 for a country or a state (6° or less), steadily in between. */
export function columnsFor(degAcross: number): number {
  const t = Math.log(SPAN_COARSE / Math.max(SPAN_FINE, Math.min(SPAN_COARSE, degAcross))) / Math.log(SPAN_COARSE / SPAN_FINE);
  return COLS_COARSE + (COLS_FINE - COLS_COARSE) * t;
}
/** The dot grid for a picture `width` px wide showing `degAcross` degrees: a whole number of columns, so the grid fills the
 *  width exactly, with the cell kept between 4 and 8 px (a narrow picture has fewer, not tiny, dots). */
export function cellSize(width: number, degAcross: number): { cell: number; cols: number } {
  const cell = Math.min(CELL_MAX, Math.max(CELL_MIN, width / columnsFor(degAcross)));
  const cols = Math.max(1, Math.round(width / cell));
  return { cell: width / cols, cols };
}

/** How far a dot is inside a soft halo of radius `r` round a place: 2 in the inner part, 1 in the outer ring, 0 outside. */
export function haloLevel(dx: number, dy: number, r: number): 0 | 1 | 2 {
  const d = Math.hypot(dx, dy);
  return d <= r * 0.55 ? 2 : d <= r ? 1 : 0;
}

/** The centre of every cell of a size.w × size.h picture cut into `cell` px squares, row by row. */
export function gridCells(w: number, h: number, cell: number): { col: number; row: number; x: number; y: number }[] {
  const out: { col: number; row: number; x: number; y: number }[] = [];
  const cols = Math.floor(w / cell), rows = Math.floor(h / cell);
  for (let row = 0; row < rows; row++) for (let col = 0; col < cols; col++) out.push({ col, row, x: col * cell + cell / 2, y: row * cell + cell / 2 });
  return out;
}

/** "Bad for you: Austin, Texas. Mixed: Silicon Valley. Good for you: Permian." (the shape and the word, per place); `shaded` names the home footprint ("Shaded: Texas, California."). */
export function describePlaces(places: { label: string; tone: DirectionTone }[], intro = "Where today's events are", shaded = ""): string {
  const parts = (["bad", "mixed", "good", "neutral"] as const)
    .map(t => ({ t, names: places.filter(p => p.tone === t).map(p => p.label) }))
    .filter(g => g.names.length)
    .map(g => `${DIRECTIONS[g.t].word}: ${g.names.join(", ")}.`);
  const base = parts.length ? `${intro}. ${parts.join(" ")}` : `${intro}: none.`;
  return shaded ? `${base} Shaded: ${shaded}.` : base;
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
 *  `side` already chosen is kept. If nothing fits at the safe width estimate, the first that fits at the width measured
 *  on the page (a name is about 12% narrower than the estimate), then the first that at least stays on the picture, then right. */
export function pickSides(marks: { label: string; x: number; y: number; side?: Side }[], width: number, height: number): Side[] {
  const points: Box[] = marks.map(m => ({ x0: m.x - 8, y0: m.y - 8, x1: m.x + 8, y1: m.y + 8 }));
  const placed: Box[] = [];
  return marks.map((m, i) => {
    const w = m.label.length * CHAR_W;
    const tryOrder: Side[] = m.side ? [m.side] : ["right", "left", "top", "bottom"];
    const on = (b: Box) => b.x0 >= 0 && b.x1 <= width && b.y0 >= 0 && b.y1 <= height;
    const clear = (b: Box) => !placed.some(p => overlap(p, b)) && !points.some((p, j) => j !== i && overlap(p, b));
    const side = tryOrder.find(s => { const b = nameBox(m.x, m.y, w, s); return on(b) && clear(b); })
      ?? tryOrder.find(s => { const b = nameBox(m.x, m.y, w * 0.88, s); return on(b) && clear(b); })
      ?? tryOrder.find(s => on(nameBox(m.x, m.y, w * 0.88, s)))
      ?? tryOrder[0];
    placed.push(nameBox(m.x, m.y, w * 0.88, side));
    return side;
  });
}
