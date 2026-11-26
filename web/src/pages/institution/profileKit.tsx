// What the lists of the profile share, whichever look draws them (the Institution page's tables, the guided setup's lists): the
// plain-words flags of a row, what a suggestion says, the checks-and-adds behind "Suggestions", "Import" and the link grid, and how an
// item got there. No styles here.
import { useEffect, useState, type ReactNode } from "react";
import { ApiError } from "../../api/client";
import { inst, type Item, type Operation, type SectionName, type Suggestion } from "../../api/institutions";
import { dayTime, person, plural } from "../../format";
import { useToast } from "../../components/ui";
import { FLOW_WORDS } from "../../components/setupFlow";
import { cap } from "../../plain";
import { monthsText, PlaceName, usdText, useRoutes } from "./fields";
import { AREA_WORDS, LABELS, splitErrors, type Ctx } from "./forms";
import { cw, withShort } from "./rows";

export const pn = (ctx: Ctx, c: string) => <PlaceName code={c} names={ctx.profile?.place_names} />;
export const byId = (ctx: Ctx, s: SectionName, id: string, key: string) => ctx.profile?.sections[s].find(x => x.id === id)?.[key] ?? id;

/** Items for a section from a JSON file: a list of items, {items: [...]}, or a whole profile ({sections: {...}}).
 * Checked by the server first (a dry run), shown, and added only when confirmed, all or nothing. */
export function useImportItems(section: SectionName, iid: string, onAdded: () => void) {
  const toast = useToast();
  const [ops, setOps] = useState<Operation[] | null>(null);
  const [problems, setProblems] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const read = async (f: File) => {
    setProblems([]);
    try {
      const doc = JSON.parse(await f.text());
      const list: Record<string, any>[] = Array.isArray(doc) ? doc : doc.items ?? doc.sections?.[section] ?? [];
      if (!list.length) { setOps([]); setProblems([`No ${LABELS[section].many.toLowerCase()} in this file.`]); return; }
      const o: Operation[] = list.map(({ id, ...data }) => ({ op: "create", section, ...(id ? { id: String(id) } : {}), data }));
      await inst.batch(iid, o, true);  // checked, nothing written
      setOps(o);
    } catch (e) {
      setOps([]);
      setProblems(e instanceof ApiError ? Object.values(splitErrors(e).fields).concat(splitErrors(e).general) : [`Not a JSON file: ${String(e)}`]);
    }
  };
  const add = async () => {
    if (!ops?.length) return;
    setBusy(true);
    try { const r = await inst.batch(iid, ops); toast(`Imported ${r.results.length}.`); setOps(null); onAdded(); }
    catch (e) { setProblems(e instanceof ApiError ? [e.full] : [String(e)]); }
    finally { setBusy(false); }
  };
  return { ops, problems, busy, read, add, close: () => setOps(null), reject: (why: string) => { setOps([]); setProblems([why]); } };
}

/** What a row says in words where it used to carry a pill: "◆ No data value yet" is a warning, the rest is plain. */
export function flags(section: SectionName, it: Item): { warn: boolean; text: string }[] {
  const f: { warn: boolean; text: string }[] = [];
  const add = (text: string, warn = false) => f.push({ warn, text });
  switch (section) {
    case "footprint": if (it.role === "home") add("Home"); break;
    case "segments": if (!it.spec_mapping.length) add("No data value yet, so checks can't be scoped to this group", true); break;
    case "products":
      if (it.status !== "active") add(cap(it.status));
      if (it.islamic) add("Islamic");
      if (!it.segments.length) add("No customer group", true);
      break;
    case "flows": if (it.status === "suggested") add("To check", true); if (it.source.sample) add("Sample figure", true); break;
    case "regulators": add(it.relation === "home" ? "Home" : it.relation === "reach" ? "Reaches you from abroad" : cap(it.relation)); if (it.basis === "rule") add("From the rule table"); break;
    case "rivals": add(`${cap(it.overlap)} overlap`); break;
    case "counterparties": if (it.importance === "critical") add("Critical to you"); break;
    case "risk-exposures": if (it.status === "dismissed") add("Dismissed"); if (it.source === "finder") add("Found by the risk finder"); break;
  }
  return f;
}
/** What one suggestion looks like in the picker. */
export function suggestionText(section: SectionName, s: Suggestion, ctx: Ctx, routeName: (id: string) => string): { title: ReactNode; sub: ReactNode; group?: string } {
  const i = s.item;
  switch (section) {
    case "products": return { title: i.name, sub: <>{s.typical_products}{s.islamic_variant ? ` · Islamic: ${s.islamic_variant}` : ""}</>, group: s.category_name };
    case "segments": return { title: i.label, sub: <>{i.note || cw(i.kind)}</> };
    case "regulators": return { title: withShort(i.name, i.short), sub: <>{s.why} · {AREA_WORDS[i.area] ?? cw(i.area)}</>, group: i.relation };
    case "rivals": return { title: <>{i.name}{i.aliases?.length ? ` (${i.aliases[0]})` : ""}</>, sub: <>{s.why} · overlap {i.overlap}</>, group: `${i.overlap} overlap` };
    case "flows": return { title: <>{FLOW_WORDS[i.kind]} {i.goods ? `(${i.goods}) ` : ""}· {pn(ctx, i.local)} ↔ {pn(ctx, i.counterpart)}</>,
      sub: <>{usdText(i.value.amount)} a year · {i.source.dataset} ({i.source.dataset_year}){i.source.sample ? " · sample figure" : ""}</>, group: FLOW_WORDS[i.kind] };
    case "risk-exposures": {
      const m = s.matched;
      const what = [m.footprint.length && `footprint: ${m.footprint.join(", ")}`, m.segments.length && `${plural(m.segments.length, "customer group")}`,
        m.flows.length && `${plural(m.flows.length, "flow")}`, m.routes.length && `route: ${m.routes.map(routeName).join(", ")}`].filter(Boolean).join(" · ");
      return { title: i.title, sub: <>{s.hazard.note} <span className="muted">· {monthsText(i.months)} · meets {what}</span></>, group: s.hazard.kind };
    }
    default: return { title: JSON.stringify(i), sub: "" };
  }
}

/** Ticks of code-made suggestions, added in one batch. Already-added ones are greyed out. */
export function useSuggestionPicker(section: SectionName, ctx: Ctx, onAdded: () => void) {
  const toast = useToast();
  const routes = useRoutes();
  const iid = ctx.profile?.institution.institution_id ?? "";
  const [data, setData] = useState<{ note: string; items: Suggestion[] } | null>(null);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [err, setErr] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const pv = ctx.profile?.institution.profile_version;
  const load = () => inst.suggestions(iid, section).then(r => {
    setData(r);
    // the rule table, reference flows and the risk finder start ticked; products and groups are chosen
    const pre = section === "regulators" || section === "risk-exposures" || section === "flows";
    setPicked(new Set(pre ? r.items.map((x, i) => (x.added ? -1 : i)).filter(i => i >= 0) : []));
    setErr([]);
  }).catch(e => setErr([e instanceof ApiError ? e.full : String(e)]));
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [iid, section, pv]);
  const routeName = (id: string) => routes.find(r => r.route_id === id)?.name ?? id;
  const add = async () => {
    if (!data) return;
    setBusy(true); setErr([]);
    const ops: Operation[] = [...picked].map(i => ({ op: "create", section, data: data.items[i].item }));
    try {
      const r = await inst.batch(iid, ops);
      toast(`Added ${r.results.length}.${r.warnings.length ? ` ${plural(r.warnings.length, "note")} to look at.` : ""}`);
      setPicked(new Set()); onAdded();
    } catch (e) { setErr(splitErrors(e).general.concat(Object.values(splitErrors(e).fields))); }
    finally { setBusy(false); }
  };
  const groups = new Map<string, number[]>();
  data?.items.forEach((s, i) => { const g = suggestionText(section, s, ctx, routeName).group ?? ""; groups.set(g, [...(groups.get(g) ?? []), i]); });
  const open = data ? data.items.filter(x => !x.added).length : 0;
  const textOf = (i: number) => suggestionText(section, data!.items[i], ctx, routeName);
  const tickAll = () => data && setPicked(new Set(data.items.map((x, i) => (x.added ? -1 : i)).filter(i => i >= 0)));
  const toggle = (i: number, on: boolean) => setPicked(p => { const n = new Set(p); if (on) n.add(i); else n.delete(i); return n; });
  return { data, picked, err, busy, add, groups, open, textOf, tickAll, toggle };
}

/** A checkbox grid linking rows (e.g. products) to columns (e.g. customer groups), saved in one batch. */
export function useLinkGrid(ctx: Ctx, rows: SectionName, cols: SectionName, field: string, reload: () => void) {
  const toast = useToast();
  const R = ctx.profile?.sections[rows] ?? [];
  const C = ctx.profile?.sections[cols] ?? [];
  const start = () => Object.fromEntries(R.map(r => [r.id, new Set<string>(r[field] ?? [])]));
  const [m, setM] = useState<Record<string, Set<string>>>(start);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setM(start()); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [ctx.profile?.institution.profile_version]);
  const dirty = R.filter(r => JSON.stringify([...m[r.id] ?? []].sort()) !== JSON.stringify([...(r[field] ?? [])].sort()));
  const save = async () => {
    setBusy(true);
    try {
      await inst.batch(ctx.profile!.institution.institution_id, dirty.map(r => ({
        op: "update", section: rows, id: r.id, if_version: r.version, data: { [field]: C.map(c => c.id).filter(id => m[r.id].has(id)) } })));
      toast(`Saved ${plural(dirty.length, "change")}.`); reload();
    } catch (e) { toast(e instanceof ApiError ? e.full : String(e)); }
    finally { setBusy(false); }
  };
  const place = (c: string) => ctx.profile?.place_names?.[c] ?? c;
  const rowLabel = (r: Item): string => rows === "flows" ? `${cw(FLOW_WORDS[r.kind] ?? r.kind)}${r.goods ? ` (${r.goods})` : ""}: ${place(r.counterpart)}` : r[LABELS[rows].nameKey];
  const colLabel = (c: Item): string => c[LABELS[cols].nameKey];
  const toggle = (rid: string, cid: string, on: boolean) => setM(x => { const n = { ...x, [rid]: new Set(x[rid]) }; if (on) n[rid].add(cid); else n[rid].delete(cid); return n; });
  return { R, C, m, busy, dirty, save, rowLabel, colLabel, toggle, reset: () => setM(start()) };
}

/** How an item got there, when the setup agent made it or last changed it: the proposal's id (shown in the chat), and the words. */
export function viaProposal(o?: { source: string; by: string; at: string; proposal_id: string | null; last_source: string; last_by: string; last_at: string; last_proposal_id: string | null }): { pid: string; what: string } | null {
  if (!o) return null;
  const pid = o.last_source === "assistant" ? o.last_proposal_id : o.source === "assistant" ? o.proposal_id : null;
  if (!pid) return null;
  return { pid, what: o.source === "assistant" ? `Added by the setup agent (${person(o.by)}) on ${dayTime(o.at)}` : `Last changed by the setup agent on ${dayTime(o.last_at)}` };
}

