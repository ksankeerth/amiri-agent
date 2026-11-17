// Small pure helpers for charts: round axis ticks, and a one-bar spike that reverses at once.

/** 3 to 6 round ticks (1, 2, 2.5 or 5 × 10^n) inside [lo, hi], and the decimals they need. */
export function niceTicks(lo: number, hi: number): { ticks: number[]; dec: number } {
  if (!(hi > lo)) return { ticks: [lo], dec: 2 };
  const mag = 10 ** Math.floor(Math.log10((hi - lo) / 6));
  const count = (s: number) => Math.floor(hi / s + 1e-9) - Math.ceil(lo / s - 1e-9) + 1;
  const step = [1, 2, 2.5, 5, 10, 20].map(m => m * mag).find(s => count(s) <= 6)!;
  const ticks: number[] = [];
  for (let v = Math.ceil(lo / step - 1e-9) * step; v <= hi + step * 1e-9; v += step) ticks.push(Number(v.toFixed(10)));
  const dec = (String(Number(step.toFixed(10))).split(".")[1] ?? "").length;
  return { ticks, dec };
}

/** Index of a single bar that jumps far from both neighbours and comes straight back (bad print or a thin hour); -1 if none. */
export function spikeIndex(vs: number[], factor = 8): number {
  if (vs.length < 5) return -1;
  const steps = vs.slice(1).map((v, i) => Math.abs(v - vs[i])).sort((a, b) => a - b);
  const typical = steps[Math.floor(steps.length / 2)] || Math.abs(vs[0]) * 1e-4;
  let best = -1, size = 0;
  for (let i = 1; i < vs.length - 1; i++) {
    const a = vs[i] - vs[i - 1], b = vs[i + 1] - vs[i];
    if (Math.sign(a) !== Math.sign(b) && Math.abs(a) > factor * typical && Math.abs(b) > factor * typical && Math.abs(a) > size) { best = i; size = Math.abs(a); }
  }
  return best;
}

/** One tag per cluster of marks closer than `gap` px (so labels never print over each other), spanning x0 (first mark) to x (last). */
export function tagGroups<M extends { tag?: string }>(items: { m: M; x: number; ok: boolean }[], gap = 120): { m: M; x0: number; x: number; n: number }[] {
  const xs = items.filter(it => it.ok && it.m.tag).sort((a, b) => a.x - b.x);
  const out: { m: M; x0: number; x: number; n: number }[] = [];
  for (const it of xs) {
    const last = out[out.length - 1];
    if (last && last.m.tag === it.m.tag && it.x - last.x < gap) { last.m = it.m; last.x = it.x; last.n += 1; }
    else out.push({ m: it.m, x0: it.x, x: it.x, n: 1 });
  }
  return out;
}

/** p mirrored around h at k (0.6: 60 % of the way back past h), [lon, lat] in degrees. A mirror image past the
 *  edge of the map (|lon| > 179 or |lat| > 89) is pulled in along the same line, so it stays on the map and keeps
 *  its direction: New Zealand mirrored against London would land at 275° E, 96° S, which wraps round and fits the
 *  whole world. */
export function mirrorAround(h: [number, number], p: [number, number], k = 0.6): [number, number] {
  const dx = h[0] - p[0], dy = h[1] - p[1];
  const room = (c: number, d: number, edge: number) => (d > 0 ? (edge - c) / d : d < 0 ? (-edge - c) / d : Infinity);
  const t = Math.max(0, Math.min(k, room(h[0], dx, 179), room(h[1], dy, 89)));
  return [h[0] + t * dx, h[1] + t * dy];
}
