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
