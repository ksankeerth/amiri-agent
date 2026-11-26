// One row per product, metric and direction: the merge the Alerts pane and the Event page both use. Plain logic, no React,
// so `npm test` covers it. Lives here (not in alerts/) so the event page can use it without importing the alerts words.

export interface EffectKey { product_id: string; metric: string; direction: string; size: string | null; timing: string | null; chain_label: string; hypothesis_id: string }
export type Merged<E extends EffectKey> = E & {
  /** every why that leads to this row's expectation, in order (one when nothing was merged) */
  reasons: string[];
  /** the effects folded into this row */
  members: E[];
};
const SIZE_ORDER = ["small", "low", "medium", "moderate", "large", "big", "high"];
const TIMING_ORDER = ["days", "weeks", "months"];
const rank = (order: string[], v: string | null) => { const i = order.indexOf((v ?? "").toLowerCase()); return i < 0 ? order.length : i; };
/** Two effects for the same product and metric moving the same way read as one expectation with two reasons. They stay apart
 *  when they move opposite ways. The merged row shows the larger size and the span of timings ("within weeks to months").
 *  The row keeps the first effect's other fields, so pass the effects most important first. */
export function mergeEffects<E extends EffectKey>(effects: E[]): Merged<E>[] {
  const out: Merged<E>[] = [];
  const at = new Map<string, number>();
  for (const e of effects) {
    const k = `${e.product_id}\u0000${e.metric}\u0000${e.direction}`;
    const i = at.get(k);
    if (i === undefined) { at.set(k, out.length); out.push({ ...e, reasons: e.chain_label ? [e.chain_label] : [], members: [e] }); continue; }
    const m = out[i];
    m.members.push(e);
    if (e.chain_label && !m.reasons.includes(e.chain_label)) m.reasons.push(e.chain_label);
    if (e.size && (!m.size || SIZE_ORDER.indexOf(e.size.toLowerCase()) > SIZE_ORDER.indexOf(m.size.toLowerCase()))) m.size = e.size;
  }
  for (const m of out) if (m.members.length > 1) {
    const ts = [...new Set(m.members.map(x => x.timing).filter((x): x is string => !!x))].sort((a, b) => rank(TIMING_ORDER, a) - rank(TIMING_ORDER, b));
    m.timing = ts.length > 1 ? `${ts[0]} to ${ts[ts.length - 1]}` : ts[0] ?? null;
  }
  return out;
}
