// Where the map's regulator labels go. Each label sits beside its point (never on it), keeps off the other labels, the marks and the
// zoom buttons, and stays inside the map. What does not fit is not squeezed: after a few labels per point the rest become one "+N" chip
// (its tooltip names them). A name is shown whole or not at all: never cut in the middle of a word. Pure, so it is tested
// (words.test.ts). Positions are in the map's own pixels (the SVG is drawn 1:1).

export interface Box { x: number; y: number; w: number; h: number }
export interface LabelIn {
  id: string;
  /** The short name to draw ("FinCEN", "Texas DOB"); null: no short name, so it only appears in the "+N" chip. */
  text: string | null;
  /** The full name, for the tooltip. */
  full: string;
  at: [number, number];
  /** Smaller is more important: placed first, kept when the room runs out. */
  rank: number;
}
export interface LabelOut { id: string; text: string; full: string; box: Box; at: [number, number]; more?: string[] }

export const LABEL_H = 24;
const PAD = 4, GAP = 9;
/** A 14 px bold label's width: a little generous, so the box never clips its text. */
export const labelWidth = (t: string) => Math.round(16 + t.length * 8.4);
const hit = (a: Box, b: Box, m = 3) => a.x < b.x + b.w + m && b.x < a.x + a.w + m && a.y < b.y + b.h + m && b.y < a.y + a.h + m;

/** A box of `size` around a point: the marks labels keep clear of. */
export const around = (p: [number, number], r: number): Box => ({ x: p[0] - r, y: p[1] - r, w: r * 2, h: r * 2 });

/** The places to try around a point, nearest first: beside it (right, left), above, below, then the corners, then one row further out. */
function spots(at: [number, number], w: number, h: number): Box[] {
  const [x, y] = at, r = GAP;
  const out: Box[] = [];
  for (const k of [0, 1]) {
    const dy = k * (h + 3);
    out.push(
      { x: x + r, y: y - h / 2 - dy, w, h }, { x: x - r - w, y: y - h / 2 - dy, w, h },
      { x: x - w / 2, y: y - r - h - dy, w, h }, { x: x - w / 2, y: y + r + dy, w, h },
      { x: x + r * 0.6, y: y - r * 0.6 - h - dy, w, h }, { x: x - r * 0.6 - w, y: y - r * 0.6 - h - dy, w, h },
      { x: x + r * 0.6, y: y + r * 0.6 + dy, w, h }, { x: x - r * 0.6 - w, y: y + r * 0.6 + dy, w, h });
  }
  return out;
}

/** Places the labels; those that do not fit within `perPoint` per point (or at all) are folded into a "+N" chip beside the point. */
export function placeLabels(items: LabelIn[], o: { width: number; height: number; avoid: Box[]; perPoint?: number }): LabelOut[] {
  const cap = o.perPoint ?? 3;
  const inside = (b: Box) => b.x >= PAD && b.y >= PAD && b.x + b.w <= o.width - PAD && b.y + b.h <= o.height - PAD;
  const taken: Box[] = [...o.avoid];
  const free = (b: Box) => inside(b) && !taken.some(t => hit(b, t));
  const out: LabelOut[] = [];
  const at = (it: LabelIn) => `${Math.round(it.at[0] / 12)},${Math.round(it.at[1] / 12)}`;  // labels within a few pixels share a point
  const groups = new Map<string, LabelIn[]>();
  for (const it of [...items].sort((a, b) => a.rank - b.rank)) groups.set(at(it), [...(groups.get(at(it)) ?? []), it]);
  for (const g of groups.values()) {
    const left: LabelIn[] = [];
    let n = 0;
    for (const it of g) {
      const w = it.text ? labelWidth(it.text) : 0;
      const spot = it.text && n < cap ? spots(it.at, w, LABEL_H).find(free) : undefined;
      if (!spot || !it.text) { left.push(it); continue; }
      taken.push(spot); n++;
      out.push({ id: it.id, text: it.text, full: it.full, box: spot, at: it.at });
    }
    if (!left.length) continue;
    const text = `+${left.length} more`, w = labelWidth(text);
    const spot = spots(g[0].at, w, LABEL_H).find(free);
    if (spot) { taken.push(spot); out.push({ id: `${g[0].id}+`, text, full: left.map(x => x.full).join(", "), box: spot, at: g[0].at, more: left.map(x => x.full) }); }
  }
  return out;
}
