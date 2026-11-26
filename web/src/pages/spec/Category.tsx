// One category (board 12): its name and your products in it, the tabs (All, Starter set, Required), and its metrics as a
// table. A metric opens in place to show what it counts and how AMIRI Agent judges it. A metric replaced by another is
// dimmed and says what replaced it (board 16 section I).
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { Spec, SpecCategory, SpecMetric } from "../../api/spec";
import { Pill } from "../../components/v2/Pill";
import { SectionHead } from "../../components/v2/SectionHead";
import { Cell, Row, Table } from "../../components/v2/Table";
import { TabPanel, Tabs } from "../../components/v2/Tabs";
import {
  adverseLine, alsoLines, barLines, currencyLine, deprecationWord, historyLine, inTab, kindLine, lagLine, methodLine, metricAnchors, nameLookup,
  settlesLine, shownRows, showIslamicVariant, tabCounts, tierWord, ucFirst, unitAndGrain, words, productWord, type Tab,
} from "./words";
import { Examples } from "./Examples";

const to = (hash: string) => ({ pathname: "/spec", hash });

function Facts({ m }: { m: SpecMetric }) {
  const cur = currencyLine(m);
  const bits = [kindLine(m), cur, lagLine(m), historyLine(m), adverseLine(m.adverse)].filter(Boolean) as string[];
  return (
    <p className="v2-sx-facts">
      {bits.map((b, i) => <span key={i}>{b}</span>)}
      {m.breakdowns.length > 0 && <span>by {m.breakdowns.map((b, i) => <span key={b}>{i > 0 && ", "}<Link to={to(`#dim-${b}`)}>{words(b)}</Link></span>)}</span>}
    </p>
  );
}

function Rows({ items }: { items: [string, React.ReactNode][] }) {
  return <dl className="v2-sx-rows">{items.filter(([, v]) => v != null && v !== "").map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>;
}

function MetricDetail({ m, nameOf, id }: { m: SpecMetric; nameOf: (k: string) => string; id: string }) {
  const d = m.definition, v = m.validation;
  const bars = barLines(v?.thresholds ?? null), also = v ? alsoLines(v) : [];
  const small = [m.starter ? "In the starter set" : null, `Since version ${m.since}`,
    m.deprecated_in ? `Deprecated in version ${m.deprecated_in}${m.replaced_by ? `, replaced by ${nameOf(m.replaced_by)}` : ""}` : null].filter(Boolean) as string[];
  return (
    <div className="v2-panel v2-sx-detail" id={id}>
      <h3 className="v2-sx-q">{m.question}</h3>
      <Facts m={m} />
      <h4 className="v2-sx-subh">What it counts</h4>
      <Rows items={[
        ["Unit, how often", unitAndGrain(m)],
        ["Numerator", d.numerator && ucFirst(d.numerator)], ["Denominator", d.denominator && ucFirst(d.denominator)], ["Exposure", d.exposure && ucFirst(d.exposure)],
        ["Counts", d.includes.length ? ucFirst(d.includes.join("; ")) : null], ["Leaves out", d.excludes.length ? ucFirst(d.excludes.join("; ")) : null],
        ["Booking date", ucFirst(d.booking_date)], ["Flow basis", d.flow_basis && ucFirst(d.flow_basis)],
        ["Records behind it", m.volume && ucFirst(m.volume)],
        ["Applies to", Array.isArray(m.applies_to) ? m.applies_to.map(words).join(", ") : "Every product type"],
        ["Notes", d.notes]]} />
      {v && <>
        <h4 className="v2-sx-subh">How AMIRI Agent judges it</h4>
        <Rows items={[
          ["Compared with", methodLine(v.method)],
          ["An effect needs", bars.length ? <>{bars.map(b => <div key={b.text}>{b.text} <span className="v2-sx-fine">(in the spec: {b.spec})</span></div>)}</> : null],
          ["Settles after", settlesLine(v, m.volume)],
          ["Also", also.length ? ucFirst(also.join("; ")) : null]]} />
      </>}
      <p className="v2-sx-small">Key <code className="v2-mono">{m.key}</code>{small.map(x => <span key={x}> · {x}</span>)}</p>
    </div>
  );
}

const COLS = "minmax(0, 1.3fr) minmax(0, 1.6fr) 130px 70px";
const COLS_PHONE = "minmax(0, 1fr) auto";

export interface CategoryViewProps {
  s: Spec; c: SpecCategory;
  /** the institution's own products in this category (names), if any */
  yours: string[];
  /** the anchor of a metric to open (from #metric-key) */
  open?: string;
  /** the institution's Islamic flag (null: no institution) and home country, for the product table (C6) */
  islamic: boolean | null; home: string | null;
}
export function CategoryView({ s, c, yours, open: openId, islamic, home }: CategoryViewProps) {
  const variants = showIslamicVariant(islamic);
  const ids = useMemo(() => metricAnchors(s.categories), [s]);
  const nameOf = useMemo(() => nameLookup(s.categories), [s]);
  const all = c.metrics ?? [];  // the spec's own order
  const counts = tabCounts(all);
  const [tab, setTab] = useState<Tab>("all");
  const [more, setMore] = useState(false);
  const [open, setOpen] = useState<Set<string>>(() => new Set(openId ? [openId] : []));
  useEffect(() => { if (openId) setOpen(o => new Set(o).add(openId)); }, [openId]);
  const toggle = (id: string) => setOpen(o => { const n = new Set(o); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const list = inTab(all, tab);
  const linked = openId ? list.findIndex(m => ids.get(`${c.id}/${m.key}`) === openId) : -1;
  const shown = list.slice(0, shownRows(list.length, more, linked));
  const hidden = list.length - shown.length;
  const i = s.categories.findIndex(x => x.id === c.id), prev = s.categories[i - 1], next = s.categories[i + 1];
  const derived = c.derived_metrics ?? [];
  const tabs = [{ id: "all", label: "All", count: counts.all }, { id: "starter", label: "Starter set", count: counts.starter }, { id: "required", label: "Required", count: counts.required }];
  return (
    <>
      <div className="v2-sx-title">
        <h2 id="sx-title" className="v2-sx-h2">{c.name}</h2>
        <span className="v2-sx-yours">{yours.length
          ? <>· <span className="v2-sr">Your products: </span>{yours.join(", ")}</>
          : <>· Covers {c.product_types.map(p => productWord(p.id)).join(", ")}</>}</span>
      </div>
      {c.supervisory_note && <p className="v2-sx-note">{c.supervisory_note}</p>}
      <Tabs tabs={tabs} value={tab} onChange={t => { setTab(t as Tab); setMore(false); }} label="Which metrics to show">
        <TabPanel id={tab}>
          <Table label={`${c.name} metrics`} cols={COLS} colsPhone={COLS_PHONE} className="v2-sx-table"
            columns={[{ label: "Metric" }, { label: "What it answers" }, { label: "Tier" }, { label: "Grain" }]}>
            {shown.flatMap(m => {
              const id = ids.get(`${c.id}/${m.key}`)!, on = open.has(id), gone = deprecationWord(m, nameOf);
              return [
                <Row key={m.key} id={id} className={`v2-sx-row${gone ? " is-gone" : ""}`}>
                  <Cell className="v2-sx-name">
                    <span className="v2-sx-name__t">
                      <button type="button" className="v2-sx-mbtn" aria-expanded={on} aria-controls={`${id}-d`} onClick={() => toggle(id)}>
                        <span className="v2-sx-tri" aria-hidden="true" />{m.name}</button>
                      {m.starter && <Pill tone="good">Starter</Pill>}
                    </span>
                    <span className="v2-mono v2-sx-key">{m.key}</span>
                  </Cell>
                  <Cell className="v2-sx-ans">{m.question}</Cell>
                  <Cell className="v2-sx-tier">{gone ? <Pill tone="neutral">{gone}</Pill>
                    : <Pill tone={m.tier === "required" ? "ink" : "neutral"}>{tierWord(m.tier)}</Pill>}</Cell>
                  <Cell muted className="v2-sx-grain">{m.grain}</Cell>
                </Row>,
                ...(on ? [<Row key={`${m.key}-d`} cols="minmax(0, 1fr)" colsPhone="minmax(0, 1fr)" className="v2-sx-detailrow">
                  <Cell><MetricDetail m={m} nameOf={nameOf} id={`${id}-d`} /></Cell></Row>] : []),
              ];
            })}
          </Table>
          {list.length === 0 && <p className="v2-sx-none">{tab === "starter" ? "None of this category's metrics are in the starter set." : "No metrics here."}</p>}
          {hidden > 0 && <button type="button" className="v2-sx-more" aria-expanded={false} onClick={() => setMore(true)}>
            <span className="v2-sx-tri" aria-hidden="true" />{hidden} more</button>}
          {more && list.length > 7 && <button type="button" className="v2-sx-more" aria-expanded onClick={() => setMore(false)}>
            <span className="v2-sx-tri" aria-hidden="true" />Show fewer</button>}
        </TabPanel>
      </Tabs>
      {derived.length > 0 && <p className="v2-sx-derived"><b>Worked out by the checks, not shared:</b>{" "}
        {derived.map(x => `${words(x.key)} = ${words(x.formula)}${x.note ? ` (${x.note})` : ""}`).join("; ")}</p>}
      <section className="v2-sx-products" aria-labelledby="sx-products">
        <SectionHead title="Products it covers" level={3} size="sm" id="sx-products" />
        <Table label={`Products ${c.name} covers`} cols={variants ? "minmax(0, 1fr) minmax(0, 1.6fr) minmax(0, 1.2fr)" : "minmax(0, 1fr) minmax(0, 2fr)"} colsPhone="minmax(0, 1fr)" className="v2-sx-ptable"
          columns={variants ? [{ label: "Product type" }, { label: "Typical products" }, { label: "Islamic or takaful variant" }] : [{ label: "Product type" }, { label: "Typical products" }]}>
          {c.product_types.map(p => (
            <Row key={p.id} className="v2-sx-prow">
              <Cell className="v2-sx-ptype">{ucFirst(productWord(p.id))}</Cell>
              <Cell>{p.typical_products ? <Examples text={p.typical_products} home={home} cap /> : <span className="v2-muted">—</span>}</Cell>
              {variants && <Cell className="v2-sx-variant">
                {/* on a phone the table's header is hidden, so the variant line carries its own label */}
                {p.islamic_variant ? <><span className="v2-sx-vlabel">Islamic variant: </span>{ucFirst(p.islamic_variant)}</> : <span className="v2-muted">—</span>}
              </Cell>}
            </Row>))}
        </Table>
        <p className="v2-sx-fine">Category id <code className="v2-mono">{c.id}</code>. A metric that lists product types is shared only for those.</p>
      </section>
      <nav className="v2-sx-pn" aria-label="Other categories">
        {prev ? <Link to={to(`#cat-${prev.id}`)}><span aria-hidden="true">← </span>{prev.name}</Link> : <span />}
        {next ? <Link to={to(`#cat-${next.id}`)}>{next.name}<span aria-hidden="true"> →</span></Link> : <span />}
      </nav>
    </>
  );
}
