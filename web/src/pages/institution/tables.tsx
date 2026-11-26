// One section of the profile as the board draws Products (board 08): a heading with its count and actions, then a table of the
// items, one row each, with a pencil to edit. A long list shows its first six and "N more". Adding, editing, deleting, the
// suggestions and the import are here; the dialogs are in edit.tsx.
import { Checkbox } from "../../components/v2/Choice";
import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { ApiError } from "../../api/client";
import { showProposal } from "../../api/assistant";
import { inst, type Item, type SectionName } from "../../api/institutions";
import { useDemoLock } from "../../components/lock";
import { useRefusalToast, useToast } from "../../components/ui";
import { Button } from "../../components/v2/Button";
import { Dialog } from "../../components/v2/Dialog";
import { Empty } from "../../components/v2/Empty";
import { MoreMenu } from "../../components/v2/MoreMenu";
import { SectionHead } from "../../components/v2/SectionHead";
import { Cell, Row, Table } from "../../components/v2/Table";
import { usePhone } from "../../components/v2/Shell";
import { plural } from "../../format";
import { ImportItems, ItemDialog, SuggestDialog } from "./edit";
import { LABELS, type Ctx } from "./forms";
import { columnsOf, gridOf, rowText } from "./rows";
import { byId, flags, useLinkGrid, viaProposal } from "./profileKit";
import { booksTotal, unlinkedNote, viewName } from "./words";

const SHOWN = 6;     // a longer list shows this many, then "N more"
const FOLD_AT = 8;

/** The pencil: an icon button named for its row. */
const Pencil = () => <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true" focusable="false"><path d="M4 20h4L19 9l-4-4L4 16z" /></svg>;

/** "via setup agent": a small tag on a row the setup agent made or last changed; it shows the proposal in the chat. */
function Via({ o }: { o: Parameters<typeof viaProposal>[0] }) {
  const v = viaProposal(o);
  if (!v) return null;
  return <button type="button" className="v2-pill v2-pill--neutral v2-in-via" title={`${v.what}. Show it in the chat.`} onClick={() => showProposal(v.pid)}>via setup agent</button>;
}

export function SectionBlock({ section, ctx, reload, suggest, note, extra, draftable, onDraft }: {
  section: SectionName; ctx: Ctx; reload: () => void;
  /** Offers Suggestions: the usual products, the rule table's regulators, the risk finder's risks. */
  suggest?: boolean;
  note?: ReactNode;
  /** Below the table: the link grid. */
  extra?: ReactNode;
  /** Items that can be watched by a monitor: the row gets a menu with "Draft a monitor". */
  draftable?: boolean;
  onDraft?: (it: Item) => void;
}) {
  const toast = useToast(), refuse = useRefusalToast();
  const locked = useDemoLock();
  const [editing, setEditing] = useState<Item | null | "new">(null);
  const [deleting, setDeleting] = useState<{ item: Item; referrers?: { section: string; id: string; field: string }[] } | null>(null);
  const [suggesting, setSuggesting] = useState(false);
  const [all, setAll] = useState(false);
  const items = ctx.profile?.sections[section] ?? [];
  const archived = ctx.profile?.institution.status === "archived";
  const iid = ctx.profile?.institution.institution_id ?? "";
  const L = LABELS[section];
  const title = viewName(section);
  const cols = columnsOf(section, items);
  const names = ctx.profile?.place_names ?? {};
  const rc = { names, segments: ctx.profile?.sections.segments ?? [] };
  const grid = gridOf(cols).replace(/ 32px$/, draftable && !archived ? " 68px" : " 32px");
  const folded = items.length > FOLD_AT && !all;
  const shown = folded ? items.slice(0, SHOWN) : items;
  const books = section === "products" ? booksTotal(items) : null;
  const unlinked = section === "products" ? unlinkedNote(items) : null;

  const del = async (force: boolean) => {
    if (!deleting) return;
    try {
      await inst.delete_item(iid, section, deleting.item, force);
      toast("Deleted."); setDeleting(null); reload();
    } catch (e) {
      if (e instanceof ApiError && e.code === "in_use") setDeleting({ item: deleting.item, referrers: e.problem.referrers as any });
      else { refuse(e, "Couldn't delete"); setDeleting(null); reload(); }
    }
  };
  const nameOf = (it: Item) => rowText(section, it, items, rc).name;

  return (
    <section aria-labelledby={`sec-${section}`} className="v2-in-sec">
      <SectionHead title={title} id={`sec-${section}`} count={items.length} countLabel={items.length === 1 ? L.one : L.many.toLowerCase()}
        meta={books ? <span className="v2-in-sec__meta">· {books.text} in books</span> : undefined}
        action={archived ? undefined : (
          <div className="v2-in-sec__act">
            {suggest && <Button onClick={() => setSuggesting(true)}>Suggestions</Button>}
            <ImportItems section={section} iid={iid} onAdded={reload} />
            <Button variant="primary" locked={locked} onClick={() => setEditing("new")}>+ Add</Button>
          </div>)} />
      {note && <p className="v2-in-sec__note">{note}</p>}
      {unlinked && <p className="v2-in-warn"><span aria-hidden="true">◆ </span><b>{unlinked.lead}</b>{unlinked.rest}{" "}<Link className="v2-arrowlink" to="/admin/data">Import your data<span aria-hidden="true"> →</span></Link></p>}

      {!items.length ? (
        <Empty title={`No ${L.many.toLowerCase()} yet`} className="v2-in-empty" action={archived ? undefined : <>
          {suggest && <Button onClick={() => setSuggesting(true)}>Suggestions</Button>}
          <Button variant="primary" locked={locked} onClick={() => setEditing("new")}>+ Add</Button></>}>
          {suggest && !archived ? "Use Suggestions to start from the usual ones, or add your own." : archived ? "This profile is archived and can't be changed." : "Add the first one."}
        </Empty>
      ) : (
        <Table label={title} cols={grid} colsPhone={`minmax(0, 1fr) ${draftable && !archived ? "68px" : "32px"}`} className="v2-in-tbl" closed
          columns={[...cols.map(c => ({ label: c.label, align: c.align, phoneHide: c.phoneHide })), { label: "Edit", srOnly: true }]}>
          {shown.map(it => {
            const r = rowText(section, it, items, rc);
            const f = flags(section, it);
            return (
              <Row key={it.id} id={`in-row-${it.id}`} className="v2-in-row">
                <Cell className="v2-in-name">
                  <span className="v2-in-name__t">{r.name}<Via o={ctx.profile?.origins?.[section]?.[it.id]} /></span>
                  {f.length > 0 && <span className="v2-in-flags">{f.map((x, i) => <span key={i} className={x.warn ? "is-warn" : undefined}>{x.warn && <span aria-hidden="true">◆ </span>}{x.text}</span>)}</span>}
                  {r.sub && <span className="v2-in-sub">{r.sub}</span>}
                </Cell>
                {r.cells.map((c, i) => <Cell key={i} align={cols[i + 1].align} num={cols[i + 1].align === "right"} phoneHide className={i === 0 ? "v2-in-c2" : undefined}>{c}</Cell>)}
                <Cell className="v2-in-acts">
                  {!archived && <Button icon variant="quiet" size="sm" label={`Edit ${r.name}`} title={`Edit ${r.name}`} locked={locked} onClick={() => setEditing(it)}><Pencil /></Button>}
                  {!archived && draftable && <MoreMenu label={`More for ${r.name}`} items={[{ label: "Draft a monitor", locked, onSelect: () => onDraft?.(it) }]} />}
                </Cell>
              </Row>);
          })}
        </Table>)}
      {items.length > FOLD_AT && (
        <button type="button" className="v2-in-more" aria-expanded={all} onClick={() => setAll(a => !a)}>
          <span aria-hidden="true" className="v2-in-more__tri" />{all ? "Show fewer" : `${items.length - SHOWN} more`}</button>)}
      {extra}

      {editing && <ItemDialog section={section} ctx={ctx} editing={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); }}
        onDelete={editing !== "new" ? () => { setDeleting({ item: editing }); setEditing(null); } : undefined} />}
      {suggesting && <SuggestDialog section={section} ctx={ctx} onClose={() => setSuggesting(false)} onAdded={() => { setSuggesting(false); reload(); }} />}
      {deleting && (
        <Dialog tone="danger" title={`Delete this ${L.one}?`} onClose={() => setDeleting(null)} actions={<>
          <Button onClick={() => setDeleting(null)}>Cancel</Button>
          <Button variant="primary" locked={locked} onClick={() => del(!!deleting.referrers)}>{deleting.referrers ? "Delete and remove those links" : "Delete"}</Button></>}>
          <p className="v2-in-dlgtext"><b>{nameOf(deleting.item)}</b></p>
          {deleting.referrers && <p className="v2-in-dlgtext">Other items point at it: {deleting.referrers.map(r => `${LABELS[r.section as SectionName]?.one ?? r.section} “${byId(ctx, r.section as SectionName, r.id, LABELS[r.section as SectionName]?.nameKey ?? "id")}”`).join("; ")}.
            Deleting it also removes it from them (each change is kept in the history).</p>}
          {!deleting.referrers && <p className="v2-meta">History keeps it, and Undo can bring it back.</p>}
        </Dialog>)}
    </section>
  );
}

/** Who uses which product, as a grid you can tick: a fold under the table. On a phone each row is its own short list. */
export function LinkGrid({ ctx, rows, cols, field, reload, title, summary }: {
  ctx: Ctx; rows: SectionName; cols: SectionName; field: string; reload: () => void; title: string; summary: string;
}) {
  const locked = useDemoLock();
  const phone = usePhone();
  const g = useLinkGrid(ctx, rows, cols, field, reload);
  const { R, C, m, busy, dirty } = g;
  if (!R.length || !C.length || ctx.profile?.institution.status === "archived") return null;
  const box = (r: Item, c: Item, named = false) => (
    <Checkbox aria-label={named ? undefined : `${g.rowLabel(r)}: ${g.colLabel(c)}`} label={named ? g.colLabel(c) : undefined} checked={m[r.id]?.has(c.id) ?? false}
      locked={locked} onChange={e => g.toggle(r.id, c.id, e.target.checked)} />);
  return (
    <details className="v2-in-fold">
      <summary><span className="v2-in-fold__t">{title}</span><span className="v2-in-fold__m">{dirty.length ? `${plural(dirty.length, "change")} not saved yet` : summary}</span></summary>
      <div className="v2-in-grid">
        <div className="v2-in-grid__bar">
          {dirty.length > 0 ? <>
            <Button variant="quiet" onClick={g.reset}>Undo</Button>
            <Button variant="primary" locked={locked} disabled={busy} onClick={g.save}>Save {plural(dirty.length, "change")}</Button></>
            : <span className="v2-meta">Tick the customer groups each row is for. Nothing is saved until you press Save.</span>}
        </div>
        {phone ? (
          <div className="v2-in-grid__stack">{R.map(r => (
            <fieldset key={r.id} className="v2-in-grid__set"><legend>{g.rowLabel(r)}</legend>
              {C.map(c => <div key={c.id}>{box(r, c, true)}</div>)}</fieldset>))}</div>
        ) : (
          <div className="v2-in-grid__wrap" role="region" aria-label={`${title}: a grid of ticks`} tabIndex={0}>
            <table className="v2-in-grid__t">
              <thead><tr><th scope="col"><span className="v2-sr">{LABELS[rows].many} and {LABELS[cols].many}</span></th>{C.map(c => <th key={c.id} scope="col">{g.colLabel(c)}</th>)}</tr></thead>
              <tbody>{R.map(r => (
                <tr key={r.id}><th scope="row">{g.rowLabel(r)}</th>{C.map(c => <td key={c.id}>{box(r, c)}</td>)}</tr>))}</tbody>
            </table>
          </div>)}
      </div>
    </details>
  );
}
