// Lists of each profile section, with add / edit / delete, suggestion pickers and link grids.
import { Fragment, useEffect, useState, type ReactNode } from "react";
import { ApiError } from "../../api/client";
import { showProposal } from "../../api/assistant";
import { inst, type Item, type Operation, type SectionName, type Suggestion } from "../../api/institutions";
import { dayTime, person, plural } from "../../format";
import { Icon } from "../../components/Icon";
import { Modal, useToast } from "../../components/ui";
import { LockBtn, LockFields, useDemoLock } from "../../components/lock";
import { lockAttrs } from "../../components/demoLock";
import { Fold, Section, TextButton } from "../../components/rd";
import { dimWord, monthsText, PlaceName, usdText, useRoutes, valueWord } from "./fields";
import { AREA_WORDS, ItemModal, LABELS, splitErrors, type Ctx } from "./forms";
import { FLOW_WORDS } from "../../components/setupFlow";
import { cap, productTypeLabel } from "../../plain";
import { Link } from "react-router-dom";
import "../../styles/polish-forms.css";

const pn = (ctx: Ctx, c: string) => <PlaceName code={c} names={ctx.profile?.place_names} />;
const join = (xs: ReactNode[]) => xs.reduce<ReactNode[]>((a, x, i) => (i ? [...a, ", ", x] : [x]), []);
const byId = (ctx: Ctx, s: SectionName, id: string, key: string) => ctx.profile?.sections[s].find(x => x.id === id)?.[key] ?? id;
/** An enum value as a word: "finance_company" → "Finance company". */
const cw = (s: string) => cap(s.replace(/_/g, " "));
/** "US Treasury sanctions (OFAC)" stays as it is; "Central Bank of Sri Lanka" gets "(CBSL)". */
const withShort = (name: string, short?: string | null) => (short && !name.includes(`(${short})`) ? `${name} (${short})` : name);

/** A row's details as separate pieces: [label, value]. A piece without a label is the item's kind, shown as a quiet tag. */
type Meta = [string | null, ReactNode][];
const keep = (xs: (Meta[number] | false | null | undefined | "" | 0)[]): Meta => xs.filter(Boolean) as Meta;
const places = (ctx: Ctx, xs: string[]) => (xs.length ? join(xs.map(c => pn(ctx, c))) : null);

/** One row's text per section: title, details, badges. */
function describe(section: SectionName, it: Item, ctx: Ctx): { title: ReactNode; meta: Meta; badges?: ReactNode } {
  switch (section) {
    case "footprint":
      return { title: pn(ctx, it.code), meta: keep([[null, `${it.role === "home" ? "Home country" : cw(it.role)}${it.scope === "part" ? " (part)" : ""}`],
        it.branch_count != null && ["Branches", it.branch_count]]),
        badges: it.role === "home" ? <span className="badge b-ok">HOME</span> : undefined };
    case "watch-places":
      return { title: it.name, meta: keep([[null, cw(it.kind)], it.reason && ["Why", it.reason]]) };
    case "segments":
      return { title: it.label, meta: keep([[null, cw(it.kind)], it.places.length && ["Places", places(ctx, it.places)],
        it.spec_mapping.length && ["In your data", it.spec_mapping.map((m: any) => `${dimWord(m.dimension).toLowerCase().replace("isic", "ISIC")} “${valueWord(m.value)}”`).join(", ")]]),
        badges: !it.spec_mapping.length ? <span className="badge b-warn" title="Checks can't be scoped to this group">NO DATA VALUE</span> : undefined };
    case "products":
      return { title: it.name, meta: keep([[null, productTypeLabel(it.product_type)], it.owner && ["Owner", it.owner],
        it.segments.length && ["For", it.segments.map((s: string) => byId(ctx, "segments", s, "label")).join(", ")],
        it.book_size && ["Book", `${it.book_size.currency} ${(it.book_size.amount / 1e9).toFixed(1)} bn`]]),
        badges: <>{it.status !== "active" && <span className="badge b-paused">{it.status.toUpperCase()}</span>}
          {it.islamic && <span className="badge b-info">ISLAMIC</span>}
          {!it.segments.length && <span className="badge b-warn">NO CUSTOMER GROUP</span>}
          {!it.data?.source_id && <span className="badge b-noeffect" title="Checks need its numbers from a data connection">NO DATA YET</span>}</> };
    case "flows":
      return { title: <>{cap(FLOW_WORDS[it.kind] ?? "")} {it.goods ? `(${it.goods}) ` : ""}· {pn(ctx, it.local)} ↔ {pn(ctx, it.counterpart)}</>,
        meta: keep([["Value", it.value ? `${usdText(it.value.amount)} a year (${it.value.year})` : "no figure"],
          ["Source", it.source.kind === "dataset" ? `${it.source.dataset}${it.source.sample ? " (sample figure)" : ""}`
            : it.source.original_amount != null ? `your figure (dataset said ${usdText(it.source.original_amount)}; changed by ${person(it.source.edited_by)})` : "your figure"],
          it.segments.length && ["Groups", it.segments.map((s: string) => byId(ctx, "segments", s, "label")).join(", ")]]),
        badges: <>{it.status === "suggested" && <span className="badge b-sub">TO CHECK</span>}{it.source.sample && <span className="badge b-warn">SAMPLE</span>}</> };
    case "regulators":
      return { title: withShort(it.name, it.short), meta: keep([[null, AREA_WORDS[it.area] ?? cw(it.area)], ["Where", it.country ? pn(ctx, it.country) : "global"],
        it.controls.length && ["Controls", it.controls.join(", ")]]),
        badges: <><span className={`badge ${it.relation === "home" ? "b-ok" : it.relation === "reach" ? "b-warn" : "b-info"}`}>{it.relation.toUpperCase()}</span>
          {it.basis === "rule" && <span className="badge b-noeffect" title="From the rule table">RULE</span>}</> };
    case "rivals":
      return { title: it.name, meta: keep([[null, cw(it.type)], it.places.length && ["Where", places(ctx, it.places)],
        it.categories.length && ["Competes in", it.categories.map(productTypeLabel).join(", ")]]),
        badges: <span className={`badge ${it.overlap === "high" ? "b-down" : it.overlap === "medium" ? "b-warn" : "b-noeffect"}`}>{it.overlap.toUpperCase()} OVERLAP</span> };
    case "counterparties":
      return { title: it.name, meta: keep([[null, cw(it.kind)], it.places.length && ["Where", places(ctx, it.places)]]),
        badges: it.importance === "critical" ? <span className="badge b-down">CRITICAL</span> : undefined };
    case "risk-exposures": {
      const t = it.touches;
      const parts = [t.segments.length && `${plural(t.segments.length, "group")}`, t.products.length && `${plural(t.products.length, "product")}`, t.flows.length && `${plural(t.flows.length, "flow")}`, t.routes.length && `${plural(t.routes.length, "route")}`].filter(Boolean);
      return { title: it.title, meta: keep([[null, cw(it.kind)], ["When", monthsText(it.months)], parts.length && ["Touches", parts.join(", ")]]),
        badges: <>{it.status === "dismissed" && <span className="badge b-noeffect">DISMISSED</span>}{it.source === "finder" && <span className="badge b-info">FOUND</span>}</> };
    }
  }
}

/** The details line: the kind as a quiet tag, then labelled pieces spaced apart (not one long dot-joined string). */
function MetaLine({ meta }: { meta: Meta }) {
  if (!meta.length) return null;
  return <div className="pf-meta">{meta.map(([k, v], i) => k
    ? <span key={i} className="pf-m"><span className="pf-mk">{k}</span><span>{v}</span></span>
    : <span key={i} className="pf-tag">{v}</span>)}</div>;
}

/** Every section's list, with Add / Edit / Delete. */
/** Items for a section from a JSON file: a list of items, {items: [...]}, or a whole profile ({sections: {...}}).
 * Checked by the server first (a dry run), shown, and added only when confirmed, all or nothing. */
function ImportItems({ section, iid, onAdded, text }: { section: SectionName; iid: string; onAdded: () => void; text?: boolean }) {
  const toast = useToast();
  const locked = useDemoLock();
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
      {locked ? <LockBtn className={text ? "rd-tbtn ins-import" : "btn btn--sm"}>{!text && <Icon name="plus" />}Import</LockBtn>
        : <label className={text ? "rd-tbtn ins-import" : "btn btn--sm"} title={`Import ${LABELS[section].many.toLowerCase()} from a JSON file`}>{!text && <Icon name="plus" />}Import
          <input type="file" accept="application/json" className="sr" onChange={e => { const f = e.target.files?.[0]; e.target.value = ""; if (f) read(f); }} /></label>}
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

export function SectionList({ section, ctx, reload, suggest, extra, compact, itemAction, rd, note }: {
  section: SectionName; ctx: Ctx; reload: () => void; suggest?: boolean; extra?: ReactNode; compact?: boolean;
  itemAction?: (it: Item) => ReactNode;
  /** The redesigned look (the Institution page): a section under a rule, ruled rows, no cards. The setup steps keep the old one. */
  rd?: boolean;
  /** One line of small print under the title (rd only). */
  note?: ReactNode;
}) {
  const toast = useToast();
  const [editing, setEditing] = useState<Item | null | "new">(null);
  const [deleting, setDeleting] = useState<{ item: Item; referrers?: { section: string; id: string; field: string }[] } | null>(null);
  const [suggesting, setSuggesting] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);  // rd products table: the opened row
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
  const modals = (
    <>
        {editing && <ItemModal section={section} ctx={ctx} editing={editing === "new" ? null : editing}
          onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); }}
          onDelete={rd && editing !== "new" ? () => { setDeleting({ item: editing }); setEditing(null); } : undefined} />}
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
    </>
  );
  if (rd) return <RdSection section={section} ctx={ctx} items={items} archived={archived} suggest={suggest} note={note} itemAction={itemAction}
    picked={picked} setPicked={setPicked} onAdd={() => setEditing("new")} onEdit={setEditing} onSuggest={() => setSuggesting(true)} reload={reload} iid={iid} modals={modals} />;
  return (
    <div className="card pf-list">
      <div className="hd"><h2>{LABELS[section].many}</h2><span className="tabs" style={{ border: 0, margin: 0 }}><span className="count">{items.length}</span></span>
        <span className="spacer" />
        {extra}
        {suggest && !archived && <LockBtn className="btn btn--sm" onClick={() => setSuggesting(true)}><Icon name="search" />Suggestions</LockBtn>}
        {!archived && <ImportItems section={section} iid={iid} onAdded={reload} />}
        {!archived && <LockBtn className="btn btn--sm" onClick={() => setEditing("new")}><Icon name="plus" />Add</LockBtn>}
      </div>
      {!items.length ? <div className="bd pf-none">None yet.{suggest ? " Use Suggestions to start from the usual ones, or Add your own." : ""}</div> : (
        <div className="list">{items.map(it => {
          const x = describe(section, it, ctx);
          // icon buttons named for their row: "Delete rival Sampath Bank", not five identical "Delete"s
          const what = `${LABELS[section].one} ${typeof x.title === "string" ? x.title : String((it as Record<string, unknown>)[LABELS[section].nameKey] ?? "")}`.trim();
          return (
            <div key={it.id} className="li pf-row">
              <div className="pf-row-main">
                <div className="pf-row-t"><span className="ttl">{x.title}</span>{x.badges}<Via o={ctx.profile?.origins?.[section]?.[it.id]} /></div>
                {!compact && <MetaLine meta={x.meta} />}
              </div>
              {!archived && <div className="pf-acts">
                {itemAction?.(it)}
                <LockBtn className="btn btn--sm btn--ghost pf-ib" aria-label={`Edit ${what}`} title={`Edit ${what}`} onClick={() => setEditing(it)}><Icon name="edit" /></LockBtn>
                <LockBtn className="btn btn--sm btn--ghost pf-ib pf-del" aria-label={`Delete ${what}`} title={`Delete ${what}`} onClick={() => setDeleting({ item: it })}><Icon name="trash" /></LockBtn>
              </div>}
            </div>
          );
        })}</div>
      )}
      {modals}
    </div>
  );
}

// ---------------------------------------------------------------- the redesigned look (Institution page)

/** What a row says in words where it used to carry a pill: "◆ No data value yet" is a warning, the rest is plain. */
function flags(section: SectionName, it: Item): { warn: boolean; text: string }[] {
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
const RD_TITLE: Partial<Record<SectionName, string>> = { "risk-exposures": "Known risks" };

/** The details line of a row: the facts as small print, labels in ink ("in your data: …"), warnings with ◆. */
function RdMeta({ section, it, meta }: { section: SectionName; it: Item; meta: Meta }) {
  const bits: ReactNode[] = [
    ...meta.map(([k, v], i) => <span key={`m${i}`}>{k && <b className="ins-k">{k.toLowerCase()}: </b>}{v}</span>),
    ...flags(section, it).map((x, i) => x.warn ? <span key={`f${i}`} className="rd-warn"><span className="rd-shape rd-t-mixed" aria-hidden="true">◆</span> {x.text}</span> : <span key={`f${i}`}>{x.text}</span>),
  ];
  if (!bits.length) return null;
  return <p className="rd-row-m ins-meta">{bits.map((b, i) => <Fragment key={i}>{i > 0 && <span className="ins-sep" aria-hidden="true"> · </span>}{b}</Fragment>)}</p>;
}

function RdSection({ section, ctx, items, archived, suggest, note, itemAction, picked, setPicked, onAdd, onEdit, onSuggest, reload, iid, modals }: {
  section: SectionName; ctx: Ctx; items: Item[]; archived: boolean; suggest?: boolean; note?: ReactNode; itemAction?: (it: Item) => ReactNode;
  picked: string | null; setPicked: (id: string | null) => void; onAdd: () => void; onEdit: (it: Item) => void; onSuggest: () => void;
  reload: () => void; iid: string; modals: ReactNode;
}) {
  const actions = archived ? undefined : <>
    {suggest && <TextButton edits onClick={onSuggest}>Suggestions</TextButton>}
    <ImportItems section={section} iid={iid} onAdded={reload} text />
    <TextButton edits onClick={onAdd}>+ Add</TextButton></>;
  const title = RD_TITLE[section] ?? LABELS[section].many;
  return (
    <Section title={title} count={items.length} action={actions} className={`ins-sec ins-${section}`}>
      {note && <p className="rd-fine rd-prose ins-note">{note}</p>}
      {!items.length ? <p className="rd-row-d ins-none">None yet.{suggest && !archived ? " Use Suggestions to start from the usual ones, or add your own." : ""}</p>
        : section === "products" ? <ProductsTable ctx={ctx} items={items} archived={archived} picked={picked} setPicked={setPicked} onEdit={onEdit} itemAction={itemAction} />
        : <ul className="ins-rows" aria-label={title}>{items.map(it => {
          const x = describe(section, it, ctx);
          const what = `${LABELS[section].one} ${typeof x.title === "string" ? x.title : String((it as Record<string, unknown>)[LABELS[section].nameKey] ?? "")}`.trim();
          return (
            <li key={it.id} className="rd-row ins-row">
              <div className="ins-main">
                <div className="rd-row-t">{x.title}</div>
                <RdMeta section={section} it={it} meta={x.meta} />
                <Via rd o={ctx.profile?.origins?.[section]?.[it.id]} />
              </div>
              {!archived && <div className="ins-acts">
                {itemAction?.(it)}
                <TextButton edits onClick={() => onEdit(it)} title={`Edit ${what}`} aria-label={`Edit ${what}`}>Edit</TextButton>
              </div>}
            </li>);
        })}</ul>}
      {modals}
    </Section>
  );
}

/** Products as one table: product · type · owner · for (the customer groups, in full) · book. A row opens to edit it. */
function ProductsTable({ ctx, items, archived, picked, setPicked, onEdit, itemAction }: {
  ctx: Ctx; items: Item[]; archived: boolean; picked: string | null; setPicked: (id: string | null) => void; onEdit: (it: Item) => void; itemAction?: (it: Item) => ReactNode;
}) {
  const unlinked = items.filter(p => !p.data?.source_id).length;
  const [lead, rest] = unlinked === 0 ? ["", ""]
    : unlinked === items.length
      ? items.length === 1 ? ["This product is not linked to a data connection yet", ", so its checks can't use your numbers."]
        : [`None of the ${items.length} is linked to a data connection yet`, ", so their checks can't use your numbers."]
      : [`${unlinked} of the ${items.length} ${unlinked === 1 ? "is" : "are"} not linked to a data connection yet`, `, so ${unlinked === 1 ? "its" : "their"} checks can't use your numbers.`];
  return (
    <>
      {unlinked > 0 && <p className="rd-warn ins-nodata"><span className="rd-shape rd-t-mixed" aria-hidden="true">◆</span> <b>{lead}</b>{rest}{" "}
        <Link className="rd-go" to="/admin/data">Link {unlinked === 1 ? "it" : "them"} →</Link></p>}
      <table className="rd-table ins-products">
        <thead><tr><th scope="col">Product</th><th scope="col">Type</th><th scope="col">Owner</th><th scope="col">For</th><th scope="col" className="rd-num">Book</th></tr></thead>
        <tbody>{items.map(p => {
          const open = picked === p.id;
          const f = flags("products", p);
          return (
            <Fragment key={p.id}>
              <tr className={open ? "ins-picked" : undefined}>
                <td className="rd-strong"><button type="button" className="ins-pick" aria-expanded={open} onClick={() => setPicked(open ? null : p.id)}>{p.name}</button></td>
                <td>{productTypeLabel(p.product_type)}</td>
                <td>{p.owner ?? "—"}</td>
                <td>{p.segments.length ? p.segments.map((s: string) => byId(ctx, "segments", s, "label")).join("; ") : "—"}</td>
                <td className="rd-num">{p.book_size ? `${p.book_size.currency} ${(p.book_size.amount / 1e9).toFixed(1)} bn` : "—"}</td>
              </tr>
              {open && <tr className="ins-opened"><td colSpan={5}>
                <div className="rd-open ins-open">
                  {f.length > 0 && <p className="rd-row-m ins-meta">{f.map((x, i) => <Fragment key={i}>{i > 0 && " · "}{x.warn ? <span className="rd-warn">◆ {x.text}</span> : x.text}</Fragment>)}</p>}
                  <div className="ins-acts ins-acts-open">
                    {!archived && <TextButton edits onClick={() => onEdit(p)}>Edit {p.name}</TextButton>}
                    {!archived && itemAction?.(p)}
                    <Via rd o={ctx.profile?.origins?.products?.[p.id]} />
                  </div>
                </div>
              </td></tr>}
            </Fragment>);
        })}</tbody>
      </table>
      {!archived && <p className="rd-fine ins-hint">Select a product to edit it.</p>}
    </>
  );
}

/** What one suggestion looks like in the picker. */
function suggestionText(section: SectionName, s: Suggestion, ctx: Ctx, routeName: (id: string) => string): { title: ReactNode; sub: ReactNode; group?: string } {
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
  const textOf = (i: number) => suggestionText(section, data.items[i], ctx, id => routes.find(r => r.route_id === id)?.name ?? id);
  const tickAll = () => setPicked(new Set(data.items.map((x, i) => (x.added ? -1 : i)).filter(i => i >= 0)));
  if (inline) return (
    <div className="wz-pick">
      <p className="rd-fine rd-prose wz-pick-note">{data.note} {open ? `${open} not added yet.` : "Everything here is already in your profile."}</p>
      <LockFields><div className="wz-pick-list" role="group" aria-label="Suggestions">
        {[...groups.entries()].map(([g, idx]) => (
          <div key={g} className="wz-pick-group">
            {g && <h3 className="wz-pick-h">{g.replace(/_/g, " ")}</h3>}
            {idx.map(i => {
              const s = data.items[i], t = textOf(i);
              return (
                <label key={i} className="wz-pick-row">
                  <input type="checkbox" disabled={s.added} checked={s.added || picked.has(i)}
                    onChange={e => setPicked(p => { const n = new Set(p); if (e.target.checked) n.add(i); else n.delete(i); return n; })} />
                  <span><span className="wz-pick-t">{t.title}{s.added && <span className="wz-pick-added"> · {s.status === "dismissed" ? "dismissed" : "already added"}</span>}</span>
                    <span className="wz-pick-s">{t.sub}</span></span>
                </label>);
            })}
          </div>))}
      </div></LockFields>
      {err.length > 0 && <p className="rd-warn" role="alert"><span className="rd-shape rd-t-mixed" aria-hidden="true">◆</span> {err.join(" · ")}</p>}
      <div className="wz-pick-bar">
        <LockBtn className="btn" disabled={busy || !picked.size} onClick={add}>{picked.size ? `Add the ${picked.size} ticked` : "Add the ticked"}</LockBtn>
        {open > 0 && <TextButton edits onClick={tickAll}>Tick all</TextButton>}
        <span className="rd-fine" aria-live="polite">{picked.size} ticked</span>
      </div>
    </div>
  );
  return (
    <div className="col" style={{ gap: 10 }}>
      <p className="small muted" style={{ margin: 0 }}>{data.note} {open ? `${open} not added yet.` : "Everything here is already in your profile."}</p>
      <div className="results" style={{ maxHeight: 460 }}>
        {[...groups.entries()].map(([g, idx]) => (
          <div key={g}>
            {g && <div className="label" style={{ padding: "8px 12px 2px" }}>{g.replace(/_/g, " ")}</div>}
            {idx.map(i => {
              const s = data.items[i];
              const t = textOf(i);
              return (
                <label key={i} className="check" style={{ padding: "8px 12px", borderBottom: "1px solid var(--hairline)" }}>
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
        {open > 0 && <button className="btn btn--sm" type="button" onClick={tickAll}>Tick all</button>}
        <LockBtn className="btn btn--primary" disabled={busy || !picked.size} onClick={add}>Add {picked.size || ""}</LockBtn></div>
    </div>
  );
}

/** A checkbox grid linking rows (e.g. products) to columns (e.g. customer groups), saved in one batch. */
export function LinkGrid({ ctx, rows, cols, field, reload, title, rd, summary }: {
  ctx: Ctx; rows: SectionName; cols: SectionName; field: string; reload: () => void; title: string;
  /** The redesigned look: a fold ("Edit who uses which product"), the grid inside it. */
  rd?: boolean; summary?: ReactNode;
}) {
  const toast = useToast();
  const locked = useDemoLock();
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
  const place = (c: string) => ctx.profile?.place_names?.[c] ?? c;
  const rowLabel = (r: Item) => rows === "flows" ? `${cw(FLOW_WORDS[r.kind] ?? r.kind)}${r.goods ? ` (${r.goods})` : ""}: ${place(r.counterpart)}` : r[LABELS[rows].nameKey];
  const grid = (
    <table className={rd ? "rd-table ins-linkgrid" : "tbl"}>
      <thead><tr><th><span className="sr">{LABELS[rows].many} and {LABELS[cols].many}</span></th>{C.map(c => <th key={c.id} style={{ textAlign: "center", whiteSpace: "normal", minWidth: 90 }}>{c[LABELS[cols].nameKey]}</th>)}</tr></thead>
      <tbody>{R.map(r => (
        <tr key={r.id}><td className={rd ? "rd-strong" : "strong"}>{rowLabel(r)}</td>
          {C.map(c => <td key={c.id} style={{ textAlign: "center" }}>
            <input type="checkbox" aria-label={`${rowLabel(r)}: ${c[LABELS[cols].nameKey]}`} style={{ accentColor: "var(--accent)" }} checked={m[r.id]?.has(c.id) ?? false}
              {...lockAttrs(locked)} onChange={e => locked ? undefined : setM(x => { const n = { ...x, [r.id]: new Set(x[r.id]) }; if (e.target.checked) n[r.id].add(c.id); else n[r.id].delete(c.id); return n; })} /></td>)}
        </tr>))}</tbody>
    </table>);
  if (rd) return (
    <Fold title={title} summary={dirty.length ? `${plural(dirty.length, "change")} not saved yet` : summary} remember={`inst-grid-${rows}`}>
      <div className="ins-grid">
        <div className="ins-grid-bar">{dirty.length > 0 ? <>
          <TextButton onClick={() => setM(start())}>Undo</TextButton>
          <LockBtn className="btn btn--primary" disabled={busy} onClick={save}>Save {plural(dirty.length, "change")}</LockBtn></>
          : <span className="rd-fine">Tick the customer groups each row is for. Nothing is saved until you press Save.</span>}</div>
        <div className="ins-grid-wrap">{grid}</div>
      </div>
    </Fold>
  );
  return (
    <div className="card">
      <div className="hd"><h2>{title}</h2><span className="spacer" />
        {dirty.length > 0 && <><button className="btn btn--sm" type="button" onClick={() => setM(start())}>Undo</button>
          <LockBtn className="btn btn--sm btn--primary" disabled={busy} onClick={save}>Save {plural(dirty.length, "change")}</LockBtn></>}</div>
      <div className="tblwrap">{grid}</div>
    </div>
  );
}

/** "Via the setup agent": how an item got there, linking to the proposal in the chat. */
function Via({ o, rd }: { rd?: boolean; o?: { source: string; by: string; at: string; proposal_id: string | null; last_source: string; last_by: string; last_at: string; last_proposal_id: string | null } }) {
  if (!o) return null;
  const pid = o.last_source === "assistant" ? o.last_proposal_id : o.source === "assistant" ? o.proposal_id : null;
  if (!pid) return null;
  const what = o.source === "assistant" ? `Added by the setup agent (${person(o.by)}) on ${dayTime(o.at)}` : `Last changed by the setup agent on ${dayTime(o.last_at)}`;
  if (rd) return <button type="button" className="rd-tbtn ins-via" title={`${what}. Click to see it in the chat.`} onClick={() => showProposal(pid)}>Made by the Setup agent</button>;
  return <button type="button" className="badge b-info" style={{ cursor: "pointer" }} title={`${what}. Click to see it in the chat.`} onClick={() => showProposal(pid)}>
    VIA SETUP AGENT</button>;
}
