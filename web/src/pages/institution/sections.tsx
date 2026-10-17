// Lists of each profile section, with add / edit / delete, suggestion pickers and link grids.
import { useEffect, useState, type ReactNode } from "react";
import { ApiError } from "../../api/client";
import { showProposal } from "../../api/assistant";
import { inst, type Item, type Operation, type SectionName, type Suggestion } from "../../api/institutions";
import { dayTime, plural } from "../../format";
import { Icon } from "../../components/Icon";
import { Modal, useToast } from "../../components/ui";
import { dimWord, monthsText, PlaceName, usdText, useRoutes, valueWord } from "./fields";
import { FLOW_WORDS, ItemModal, LABELS, splitErrors, type Ctx } from "./forms";

const pn = (ctx: Ctx, c: string) => <PlaceName code={c} names={ctx.profile?.place_names} />;
const join = (xs: ReactNode[]) => xs.reduce<ReactNode[]>((a, x, i) => (i ? [...a, ", ", x] : [x]), []);
const byId = (ctx: Ctx, s: SectionName, id: string, key: string) => ctx.profile?.sections[s].find(x => x.id === id)?.[key] ?? id;

/** One row's text per section: title, details, badges. */
function describe(section: SectionName, it: Item, ctx: Ctx): { title: ReactNode; sub: ReactNode; badges?: ReactNode } {
  switch (section) {
    case "footprint":
      return { title: pn(ctx, it.code), sub: <>{it.code} · {it.role.replace(/_/g, " ")}{it.scope === "part" ? " (part)" : ""}{it.branch_count != null ? ` · ${it.branch_count} branches` : ""}</>,
        badges: it.role === "home" ? <span className="badge b-ok">HOME</span> : undefined };
    case "watch-places":
      return { title: it.name, sub: <>{it.kind}{it.code ? <> · {it.code}</> : ""}{it.reason ? ` · ${it.reason}` : ""}</> };
    case "segments":
      return { title: it.label, sub: <>{it.kind}{it.places.length ? <> · {join(it.places.map((c: string) => pn(ctx, c)))}</> : ""}
        {it.spec_mapping.length ? ` · data: ${it.spec_mapping.map((m: any) => `${dimWord(m.dimension)} = ${valueWord(m.value)}`).join(", ")}` : ""}</>,
        badges: !it.spec_mapping.length ? <span className="badge b-warn" title="Checks can't be scoped to this group">NO DATA VALUE</span> : undefined };
    case "products":
      return { title: it.name, sub: <>{it.category} › {it.product_type.replace(/_/g, " ")}{it.owner ? ` · ${it.owner}` : ""}
        {it.segments.length ? ` · for ${it.segments.map((s: string) => byId(ctx, "segments", s, "label")).join(", ")}` : ""}
        {it.book_size ? ` · book ${it.book_size.currency} ${(it.book_size.amount / 1e9).toFixed(1)} bn` : ""}</>,
        badges: <>{it.status !== "active" && <span className="badge b-paused">{it.status.toUpperCase()}</span>}
          {it.islamic && <span className="badge b-info">ISLAMIC</span>}
          {!it.segments.length && <span className="badge b-warn">NO CUSTOMER GROUP</span>}
          {!it.data?.source_id && <span className="badge b-noeffect" title="Checks need its numbers from a data connection">NO DATA YET</span>}</> };
    case "flows":
      return { title: <>{FLOW_WORDS[it.kind]} {it.goods ? `(${it.goods}) ` : ""}· {pn(ctx, it.local)} ↔ {pn(ctx, it.counterpart)}</>,
        sub: <>{it.value ? `${usdText(it.value.amount)} a year (${it.value.year})` : "no figure"} · {it.source.kind === "dataset"
          ? `${it.source.dataset}${it.source.sample ? " (sample figure)" : ""}`
          : it.source.original_amount != null ? `your figure (dataset said ${usdText(it.source.original_amount)}; changed by ${it.source.edited_by})` : "your figure"}
          {it.segments.length ? ` · ${it.segments.map((s: string) => byId(ctx, "segments", s, "label")).join(", ")}` : ""}</>,
        badges: <>{it.status === "suggested" && <span className="badge b-sub">TO CHECK</span>}{it.source.sample && <span className="badge b-warn">SAMPLE</span>}</> };
    case "regulators":
      return { title: <>{it.name}{it.short ? ` (${it.short})` : ""}</>, sub: <>{it.area.replace(/_/g, " ")} · {it.country ? pn(ctx, it.country) : "global"}{it.controls.length ? ` · ${it.controls.join(", ")}` : ""}</>,
        badges: <><span className={`badge ${it.relation === "home" ? "b-ok" : it.relation === "reach" ? "b-warn" : "b-info"}`}>{it.relation.toUpperCase()}</span>
          {it.basis === "rule" && <span className="badge b-noeffect" title="From the rule table">RULE</span>}</> };
    case "rivals":
      return { title: it.name, sub: <>{it.type.replace(/_/g, " ")}{it.places.length ? <> · {join(it.places.map((c: string) => pn(ctx, c)))}</> : ""}{it.categories.length ? ` · ${it.categories.join(", ")}` : ""}</>,
        badges: <span className={`badge ${it.overlap === "high" ? "b-down" : it.overlap === "medium" ? "b-warn" : "b-noeffect"}`}>{it.overlap.toUpperCase()} OVERLAP</span> };
    case "counterparties":
      return { title: it.name, sub: <>{it.kind.replace(/_/g, " ")}{it.places.length ? <> · {join(it.places.map((c: string) => pn(ctx, c)))}</> : ""}</>,
        badges: it.importance === "critical" ? <span className="badge b-down">CRITICAL</span> : undefined };
    case "risk-exposures": {
      const t = it.touches;
      const parts = [t.segments.length && `${plural(t.segments.length, "group")}`, t.products.length && `${plural(t.products.length, "product")}`, t.flows.length && `${plural(t.flows.length, "flow")}`, t.routes.length && `${plural(t.routes.length, "route")}`].filter(Boolean);
      return { title: it.title, sub: <>{it.kind} · {monthsText(it.months)}{parts.length ? ` · touches ${parts.join(", ")}` : ""}</>,
        badges: <>{it.status === "dismissed" && <span className="badge b-noeffect">DISMISSED</span>}{it.source === "finder" && <span className="badge b-info">FOUND</span>}</> };
    }
  }
}

/** Every section's list, with Add / Edit / Delete. */
/** Items for a section from a JSON file: a list of items, {items: [...]}, or a whole profile ({sections: {...}}).
 * Checked by the server first (a dry run), shown, and added only when confirmed, all or nothing. */
function ImportItems({ section, iid, onAdded }: { section: SectionName; iid: string; onAdded: () => void }) {
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
  return (
    <>
      <label className="btn btn--sm" title={`Import ${LABELS[section].many.toLowerCase()} from a JSON file`}><Icon name="plus" />Import
        <input type="file" accept="application/json" className="sr" onChange={e => { const f = e.target.files?.[0]; e.target.value = ""; if (f) read(f); }} /></label>
      {ops !== null && <Modal title={`Import ${LABELS[section].many.toLowerCase()}`} onClose={() => setOps(null)} footer={<>
        <button className="btn" type="button" onClick={() => setOps(null)}>Cancel</button>
        <button className="btn btn--primary" type="button" disabled={busy || !ops.length || problems.length > 0} onClick={add}>Import {ops.length || ""}</button></>}>
        {problems.length ? <div className="rawerr">{problems.join(" · ")}</div>
          : <p className="small" style={{ margin: 0 }}>{plural(ops.length, LABELS[section].one)} checked and ready to add, all together.</p>}
        <p className="small muted" style={{ margin: 0 }}>The file is a list of items, <span className="mono">{"{\"items\": [...]}"}</span>, or a whole profile (its {LABELS[section].many.toLowerCase()} are used).</p>
      </Modal>}
    </>
  );
}

export function SectionList({ section, ctx, reload, suggest, extra, compact, itemAction }: {
  section: SectionName; ctx: Ctx; reload: () => void; suggest?: boolean; extra?: ReactNode; compact?: boolean;
  itemAction?: (it: Item) => ReactNode;
}) {
  const toast = useToast();
  const [editing, setEditing] = useState<Item | null | "new">(null);
  const [deleting, setDeleting] = useState<{ item: Item; referrers?: { section: string; id: string; field: string }[] } | null>(null);
  const [suggesting, setSuggesting] = useState(false);
  const items = ctx.profile?.sections[section] ?? [];
  const archived = ctx.profile?.institution.status === "archived";
  const iid = ctx.profile?.institution.institution_id ?? "";
  const del = async (force: boolean) => {
    if (!deleting) return;
    try {
      await inst.delete_item(iid, section, deleting.item, force);
      toast("Deleted."); setDeleting(null); reload();
    } catch (e) {
      if (e instanceof ApiError && e.code === "in_use") setDeleting({ item: deleting.item, referrers: e.problem.referrers as any });
      else { toast(e instanceof ApiError ? e.full : String(e)); setDeleting(null); }
    }
  };
  return (
    <div className="card">
      <div className="hd"><h2>{LABELS[section].many}</h2><span className="tabs" style={{ border: 0, margin: 0 }}><span className="count">{items.length}</span></span>
        <span className="spacer" />
        {extra}
        {suggest && !archived && <button className="btn btn--sm" type="button" onClick={() => setSuggesting(true)}><Icon name="search" />Suggestions</button>}
        {!archived && <ImportItems section={section} iid={iid} onAdded={reload} />}
        {!archived && <button className="btn btn--sm btn--primary" type="button" onClick={() => setEditing("new")}><Icon name="plus" />Add</button>}
      </div>
      {!items.length ? <div className="bd small muted">None yet.{suggest ? " Use Suggestions to start from the usual ones, or Add your own." : ""}</div> : (
        <div className="list" style={{ marginTop: 8 }}>{items.map(it => {
          const x = describe(section, it, ctx);
          return (
            <div key={it.id} className="li">
              <div className="col" style={{ gap: 3, flex: 1, minWidth: 0 }}>
                <div className="row wrap" style={{ gap: 8 }}><span className="ttl">{x.title}</span>{x.badges}<Via o={ctx.profile?.origins?.[section]?.[it.id]} /></div>
                {!compact && <div className="meta">{x.sub}</div>}
              </div>
              {!archived && <div className="row" style={{ gap: 4 }}>
                {itemAction?.(it)}
                <button className="btn btn--sm btn--ghost" type="button" onClick={() => setEditing(it)}><Icon name="edit" />Edit</button>
                <button className="btn btn--sm btn--ghost" type="button" aria-label="Delete" onClick={() => setDeleting({ item: it })}><Icon name="trash" /></button>
              </div>}
            </div>
          );
        })}</div>
      )}
      {editing && <ItemModal section={section} ctx={ctx} editing={editing === "new" ? null : editing}
        onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); }} />}
      {deleting && (
        <Modal title={`Delete this ${LABELS[section].one}?`} onClose={() => setDeleting(null)} footer={<>
          <button className="btn" type="button" onClick={() => setDeleting(null)}>Cancel</button>
          {deleting.referrers ? <button className="btn btn--danger" type="button" onClick={() => del(true)}>Delete and remove those links</button>
            : <button className="btn btn--danger" type="button" onClick={() => del(false)}>Delete</button>}</>}>
          <p><b>{describe(section, deleting.item, ctx).title}</b></p>
          {deleting.referrers && <div className="note">Other items point at it: {deleting.referrers.map(r => `${LABELS[r.section as SectionName]?.one ?? r.section} “${byId(ctx, r.section as SectionName, r.id, LABELS[r.section as SectionName]?.nameKey ?? "id")}”`).join("; ")}.
            Deleting it also removes it from them (each change is kept in the history).</div>}
        </Modal>
      )}
      {suggesting && <Modal wide title={`Suggested ${LABELS[section].many.toLowerCase()}`} onClose={() => setSuggesting(false)}>
        <SuggestionPicker section={section} ctx={ctx} onAdded={() => { setSuggesting(false); reload(); }} />
      </Modal>}
    </div>
  );
}

/** What one suggestion looks like in the picker. */
function suggestionText(section: SectionName, s: Suggestion, ctx: Ctx, routeName: (id: string) => string): { title: ReactNode; sub: ReactNode; group?: string } {
  const i = s.item;
  switch (section) {
    case "products": return { title: i.name, sub: <>{s.typical_products}{s.islamic_variant ? ` · Islamic: ${s.islamic_variant}` : ""}</>, group: s.category_name };
    case "segments": return { title: i.label, sub: <>{i.note || i.kind}{i.spec_mapping.length ? ` · data: ${i.spec_mapping.map((m: any) => valueWord(m.value)).join(", ")}` : ""}</> };
    case "regulators": return { title: <>{i.name}{i.short ? ` (${i.short})` : ""}</>, sub: <>{s.why} · {i.area.replace(/_/g, " ")}</>, group: i.relation };
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
export function SuggestionPicker({ section, ctx, onAdded, inline }: { section: SectionName; ctx: Ctx; onAdded: () => void; inline?: boolean }) {
  const toast = useToast();
  const routes = useRoutes();
  const iid = ctx.profile?.institution.institution_id ?? "";
  const [data, setData] = useState<{ note: string; items: Suggestion[] } | null>(null);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [err, setErr] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const pv = ctx.profile?.institution.profile_version;
  useEffect(() => {
    inst.suggestions(iid, section).then(r => {
      setData(r);
      // the rule table, reference flows and the risk finder start ticked; products and groups are chosen
      const pre = section === "regulators" || section === "risk-exposures" || section === "flows";
      setPicked(new Set(pre ? r.items.map((x, i) => (x.added ? -1 : i)).filter(i => i >= 0) : []));
    }).catch(e => setErr([e instanceof ApiError ? e.full : String(e)]));
  }, [iid, section, pv]);
  if (!data) return <div className="muted small">{err.length ? err.join(" ") : "Loading…"}</div>;
  const add = async () => {
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
  data.items.forEach((s, i) => { const g = suggestionText(section, s, ctx, id => routes.find(r => r.route_id === id)?.name ?? id).group ?? ""; groups.set(g, [...(groups.get(g) ?? []), i]); });
  const open = data.items.filter(x => !x.added).length;
  return (
    <div className="col" style={{ gap: 10 }}>
      <p className="small muted" style={{ margin: 0 }}>{data.note} {open ? `${open} not added yet.` : "Everything here is already in your profile."}</p>
      <div className="results" style={{ maxHeight: inline ? 420 : 460 }}>
        {[...groups.entries()].map(([g, idx]) => (
          <div key={g}>
            {g && <div className="label" style={{ padding: "8px 12px 2px" }}>{g.replace(/_/g, " ")}</div>}
            {idx.map(i => {
              const s = data.items[i];
              const t = suggestionText(section, s, ctx, id => routes.find(r => r.route_id === id)?.name ?? id);
              return (
                <label key={i} className="check" style={{ padding: "8px 12px", borderBottom: "1px solid var(--hairline)", opacity: s.added ? 0.55 : 1 }}>
                  <input type="checkbox" disabled={s.added} checked={s.added || picked.has(i)}
                    onChange={e => setPicked(p => { const n = new Set(p); if (e.target.checked) n.add(i); else n.delete(i); return n; })} />
                  <span className="col" style={{ gap: 2 }}><b style={{ color: "var(--ink)" }}>{t.title}{s.added && <span className="badge b-ok" style={{ marginLeft: 8 }}>{s.status === "dismissed" ? "DISMISSED" : "ADDED"}</span>}</b><span className="small muted">{t.sub}</span></span>
                </label>
              );
            })}
          </div>
        ))}
      </div>
      {err.length > 0 && <div className="rawerr">{err.join(" · ")}</div>}
      <div className="row"><span className="small muted">{picked.size} ticked</span><span className="spacer" />
        {open > 0 && <button className="btn btn--sm" type="button" onClick={() => setPicked(new Set(data.items.map((x, i) => (x.added ? -1 : i)).filter(i => i >= 0)))}>Tick all</button>}
        <button className="btn btn--primary" type="button" disabled={busy || !picked.size} onClick={add}>Add {picked.size || ""}</button></div>
    </div>
  );
}

/** A checkbox grid linking rows (e.g. products) to columns (e.g. customer groups), saved in one batch. */
export function LinkGrid({ ctx, rows, cols, field, reload, title }: {
  ctx: Ctx; rows: SectionName; cols: SectionName; field: string; reload: () => void; title: string;
}) {
  const toast = useToast();
  const R = ctx.profile?.sections[rows] ?? [];
  const C = ctx.profile?.sections[cols] ?? [];
  const start = () => Object.fromEntries(R.map(r => [r.id, new Set<string>(r[field] ?? [])]));
  const [m, setM] = useState<Record<string, Set<string>>>(start);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setM(start()); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [ctx.profile?.institution.profile_version]);
  if (!R.length || !C.length) return null;
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
  const rowLabel = (r: Item) => rows === "flows" ? `${FLOW_WORDS[r.kind]} ${r.local} ↔ ${r.counterpart}${r.goods ? ` (${r.goods})` : ""}` : r[LABELS[rows].nameKey];
  return (
    <div className="card">
      <div className="hd"><h2>{title}</h2><span className="spacer" />
        {dirty.length > 0 && <><button className="btn btn--sm" type="button" onClick={() => setM(start())}>Undo</button>
          <button className="btn btn--sm btn--primary" type="button" disabled={busy} onClick={save}>Save {plural(dirty.length, "change")}</button></>}</div>
      <div className="tblwrap"><table className="tbl">
        <thead><tr><th><span className="sr">{LABELS[rows].many} and {LABELS[cols].many}</span></th>{C.map(c => <th key={c.id} style={{ textAlign: "center", whiteSpace: "normal", minWidth: 90 }}>{c[LABELS[cols].nameKey]}</th>)}</tr></thead>
        <tbody>{R.map(r => (
          <tr key={r.id}><td className="strong">{rowLabel(r)}</td>
            {C.map(c => <td key={c.id} style={{ textAlign: "center" }}>
              <input type="checkbox" aria-label={`${rowLabel(r)}: ${c[LABELS[cols].nameKey]}`} style={{ accentColor: "var(--accent)" }} checked={m[r.id]?.has(c.id) ?? false}
                onChange={e => setM(x => { const n = { ...x, [r.id]: new Set(x[r.id]) }; if (e.target.checked) n[r.id].add(c.id); else n[r.id].delete(c.id); return n; })} /></td>)}
          </tr>))}</tbody>
      </table></div>
    </div>
  );
}

/** "Via the setup agent": how an item got there, linking to the proposal in the chat. */
function Via({ o }: { o?: { source: string; by: string; at: string; proposal_id: string | null; last_source: string; last_by: string; last_at: string; last_proposal_id: string | null } }) {
  if (!o) return null;
  const pid = o.last_source === "assistant" ? o.last_proposal_id : o.source === "assistant" ? o.proposal_id : null;
  if (!pid) return null;
  const what = o.source === "assistant" ? `Added by the setup agent (${o.by}) on ${dayTime(o.at)}` : `Last changed by the setup agent on ${dayTime(o.last_at)}`;
  return <button type="button" className="badge b-info" style={{ cursor: "pointer" }} title={`${what}. Click to see it in the chat.`} onClick={() => showProposal(pid)}>
    VIA SETUP AGENT</button>;
}
