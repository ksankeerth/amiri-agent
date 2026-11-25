// Lists of each profile section, with add / edit / delete, suggestion pickers and link grids.
import { Fragment, useState, type ReactNode } from "react";
import { ApiError } from "../../api/client";
import { showProposal } from "../../api/assistant";
import { inst, type Item, type SectionName } from "../../api/institutions";
import { dayTime, person, plural } from "../../format";
import { Icon } from "../../components/Icon";
import { Modal, useToast } from "../../components/ui";
import { LockBtn, LockFields, useDemoLock } from "../../components/lock";
import { lockAttrs } from "../../components/demoLock";
import { Fold, Section, TextButton } from "../../components/rd";
import { dimWord, monthsText, usdText, valueWord } from "./fields";
import { AREA_WORDS, ItemModal, LABELS, type Ctx } from "./forms";
import { FLOW_WORDS } from "../../components/setupFlow";
import { cap, productTypeLabel } from "../../plain";
import { Link } from "react-router-dom";
import "../../styles/polish-forms.css";
import { cw, withShort } from "./rows";
import { byId, flags, pn, useImportItems, useLinkGrid, useSuggestionPicker } from "./profileKit";

// the hooks and the plain words are in profileKit.tsx, shared with the Institution page; re-exported for the guided setup
export { byId, flags, suggestionText, useImportItems, useLinkGrid, useSuggestionPicker, viaProposal } from "./profileKit";

const join = (xs: ReactNode[]) => xs.reduce<ReactNode[]>((a, x, i) => (i ? [...a, ", ", x] : [x]), []);

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
          {!it.data?.source_id && <span className="badge b-noeffect" title="Checks need its numbers from your institution's imported data">NO DATA YET</span>}</> };
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

function ImportItems({ section, iid, onAdded, text }: { section: SectionName; iid: string; onAdded: () => void; text?: boolean }) {
  const locked = useDemoLock();
  const imp = useImportItems(section, iid, onAdded);
  const { ops, problems, busy } = imp;
  return (
    <>
      {locked ? <LockBtn className={text ? "rd-tbtn ins-import" : "btn btn--sm"}>{!text && <Icon name="plus" />}Import</LockBtn>
        : <label className={text ? "rd-tbtn ins-import" : "btn btn--sm"} title={`Import ${LABELS[section].many.toLowerCase()} from a JSON file`}>{!text && <Icon name="plus" />}Import
          <input type="file" accept="application/json" className="sr" onChange={e => { const f = e.target.files?.[0]; e.target.value = ""; if (f) imp.read(f); }} /></label>}
      {ops !== null && <Modal title={`Import ${LABELS[section].many.toLowerCase()}`} onClose={imp.close} footer={<>
        <button className="btn" type="button" onClick={imp.close}>Cancel</button>
        <button className="btn btn--primary" type="button" disabled={busy || !ops.length || problems.length > 0} onClick={imp.add}>Import {ops.length || ""}</button></>}>
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
      ? items.length === 1 ? ["This product is not linked to your institution's data yet", ", so its checks can't use your numbers."]
        : [`None of the ${items.length} is linked to your institution's data yet`, ", so their checks can't use your numbers."]
      : [`${unlinked} of the ${items.length} ${unlinked === 1 ? "is" : "are"} not linked to your institution's data yet`, `, so ${unlinked === 1 ? "its" : "their"} checks can't use your numbers.`];
  return (
    <>
      {unlinked > 0 && <p className="rd-warn ins-nodata"><span className="rd-shape rd-t-mixed" aria-hidden="true">◆</span> <b>{lead}</b>{rest}{" "}
        <Link className="rd-go" to="/admin/data">Import your data →</Link></p>}
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

export function SuggestionPicker({ section, ctx, onAdded, inline }: { section: SectionName; ctx: Ctx; onAdded: () => void; inline?: boolean }) {
  const { data, picked, err, busy, add, groups, open, textOf, tickAll, toggle } = useSuggestionPicker(section, ctx, onAdded);
  if (!data) return <div className="muted small">{err.length ? err.join(" ") : "Loading…"}</div>;
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
                  <input type="checkbox" disabled={s.added} checked={s.added || picked.has(i)} onChange={e => toggle(i, e.target.checked)} />
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
                  <input type="checkbox" disabled={s.added} checked={s.added || picked.has(i)} onChange={e => toggle(i, e.target.checked)} />
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

export function LinkGrid({ ctx, rows, cols, field, reload, title, rd, summary }: {
  ctx: Ctx; rows: SectionName; cols: SectionName; field: string; reload: () => void; title: string;
  /** The wizard's look: a fold ("Edit who uses which product"), the grid inside it. */
  rd?: boolean; summary?: ReactNode;
}) {
  const locked = useDemoLock();
  const g = useLinkGrid(ctx, rows, cols, field, reload);
  const { R, C, m, busy, dirty } = g;
  if (!R.length || !C.length) return null;
  const grid = (
    <table className={rd ? "rd-table ins-linkgrid" : "tbl"}>
      <thead><tr><th><span className="sr">{LABELS[rows].many} and {LABELS[cols].many}</span></th>{C.map(c => <th key={c.id} style={{ textAlign: "center", whiteSpace: "normal", minWidth: 90 }}>{g.colLabel(c)}</th>)}</tr></thead>
      <tbody>{R.map(r => (
        <tr key={r.id}><td className={rd ? "rd-strong" : "strong"}>{g.rowLabel(r)}</td>
          {C.map(c => <td key={c.id} style={{ textAlign: "center" }}>
            <input type="checkbox" aria-label={`${g.rowLabel(r)}: ${g.colLabel(c)}`} style={{ accentColor: "var(--accent)" }} checked={m[r.id]?.has(c.id) ?? false}
              {...lockAttrs(locked)} onChange={e => locked ? undefined : g.toggle(r.id, c.id, e.target.checked)} /></td>)}
        </tr>))}</tbody>
    </table>);
  if (rd) return (
    <Fold title={title} summary={dirty.length ? `${plural(dirty.length, "change")} not saved yet` : summary} remember={`inst-grid-${rows}`}>
      <div className="ins-grid">
        <div className="ins-grid-bar">{dirty.length > 0 ? <>
          <TextButton onClick={g.reset}>Undo</TextButton>
          <LockBtn className="btn btn--primary" disabled={busy} onClick={g.save}>Save {plural(dirty.length, "change")}</LockBtn></>
          : <span className="rd-fine">Tick the customer groups each row is for. Nothing is saved until you press Save.</span>}</div>
        <div className="ins-grid-wrap">{grid}</div>
      </div>
    </Fold>
  );
  return (
    <div className="card">
      <div className="hd"><h2>{title}</h2><span className="spacer" />
        {dirty.length > 0 && <><button className="btn btn--sm" type="button" onClick={g.reset}>Undo</button>
          <LockBtn className="btn btn--sm btn--primary" disabled={busy} onClick={g.save}>Save {plural(dirty.length, "change")}</LockBtn></>}</div>
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
