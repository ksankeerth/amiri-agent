// The points of a sparkline: the values spread across the width, the lowest at the bottom and the highest at the top,
// with `pad` px kept clear above and below so the stroke isn't clipped. A flat line sits in the middle.
export function sparkPoints(values: number[], width = 80, height = 24, pad = 3): string {
  const vs = values.filter(v => Number.isFinite(v));
  if (vs.length < 2) return "";
  const lo = Math.min(...vs), hi = Math.max(...vs), span = hi - lo;
  const r = (n: number) => String(Math.round(n * 10) / 10);
  return vs.map((v, i) => {
    const x = (i / (vs.length - 1)) * width;
    const y = span === 0 ? height / 2 : pad + (1 - (v - lo) / span) * (height - 2 * pad);
    return `${r(x)},${r(y)}`;
  }).join(" ");
}
