// The Metrics Spec laid out as a printed standard, for the PDF (`uv run amiri spec-pdf`): a cover, document control,
// contents, numbered sections with the guide's text, and every metric as a definition table drawn from the YAML.
// Headings make the PDF's outline (h1 sections, h2 their parts, h3 metrics); the PDF maker (server/app/spec/pdf.py)
// reads the page of each from that outline, fills in the contents' page numbers and adds the running header and
// footer. The /spec page (Spec.tsx) stays the reading view.
import { Fragment, useEffect, type ReactNode } from "react";
import type { Spec, SpecCategory, SpecMetric } from "../../api/spec";
import { Markdown } from "../../components/markdown";
import { useSpec } from "./Spec";

const PUBLISHER = "Amiri Agent";
const SUBTITLE = "Aggregated metrics for banks and insurers";
const SECTIONS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12", "13"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October",
  "November", "December"];
const NOT_TESTED = new Set(["context", "book_size", "mask"]);  // shown next to verdicts, never tested (° in §11)
const UNIT: Record<string, string> = { per_1000: "per 1,000" };

interface Mask { metrics: { metric: string; rise: number; unit: string }[]; relief_kind?: string | null }

const longDate = (iso: string) => { const [y, m, d] = iso.split("-").map(Number); return `${d} ${MONTHS[m - 1]} ${y}`; };
const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const plain = (md: string) => md.replace(/\*\*|`/g, "");  // a heading as the outline names it
const days = (n: number) => `${n} day${n === 1 ? "" : "s"}`;
const codes = (xs: string[]) => xs.map((x, i) => <Fragment key={x}>{i ? ", " : ""}<code>{x}</code></Fragment>);
const grain = (m: SpecMetric) => `${m.grain}${m.day_basis ? ` (${m.day_basis} days)` : ""}`;
const files = (s: Spec) => Object.fromEntries(s.files.map(f => [f.name.endsWith(".pdf") ? "pdf" : f.name.includes("openapi") ? "api" : "yaml", f.name]));

/** The guide's markdown cut into prose and tables, so a table drawn from the YAML can take a table's place. */
function blocks(md: string): { table: boolean; text: string }[] {
  const out: { table: boolean; text: string }[] = [];
  for (const line of md.split("\n")) {
    const table = line.trim().startsWith("|"), last = out[out.length - 1];
    if (last && last.table === table) last.text += `\n${line}`;
    else out.push({ table, text: line });
  }
  return out;
}

const headCells = (table: string) => table.split("\n")[0].trim().replace(/^\||\|$/g, "").split("|").map(c => c.trim());

/** Guide text, its subsections as h2; `draw` may replace a table (given its header cells) with one drawn here. */
function Guide({ md, draw }: { md: string; draw?: (head: string[]) => ReactNode }) {
  if (!draw) return <Markdown text={md} shift={-2} />;
  return <>{blocks(md).map((b, i) =>
    <Fragment key={i}>{(b.table && draw(headCells(b.text))) || <Markdown text={b.text} shift={-2} />}</Fragment>)}</>;
}

function maskText(mask: Mask): ReactNode {
  const parts = mask.metrics.map((x, i) => <Fragment key={x.metric}>{i ? " or " : ""}<code>{x.metric}</code> rise &gt; {x.rise.toFixed(1)} {UNIT[x.unit] ?? x.unit}</Fragment>);
  const relief = `relief break (${mask.relief_kind})`;
  return parts.length ? <>{parts}, else {relief}</> : relief;
}

function thresholds(t: Record<string, Record<string, number>> | null, alike: string): string {
  if (!t) return "—";
  const each = (x: Record<string, number>) => Object.entries(x).map(([k, v]) => `${k} ${v}`).join(", ");
  const sizes = Object.values(t);
  return sizes.every(x => each(x) === each(sizes[0])) ? `${each(sizes[0])}${alike}`
    : Object.entries(t).map(([size, x]) => `${size}: ${each(x)}`).join("; ");
}

function DefTable({ caption, rows }: { caption?: string; rows: [string, ReactNode][] }) {
  return (
    <table className="pr-def">
      <tbody>
        {caption && <tr className="pr-def-sub"><th colSpan={2} scope="colgroup">{caption}</th></tr>}
        {rows.map(([k, v]) => <tr key={k}><th scope="row">{k}</th><td>{v}</td></tr>)}
      </tbody>
    </table>
  );
}

type Cell = [string, ReactNode];
type Row = Cell | [Cell, Cell];  // a long value across the table, or two short ones side by side

function Grid({ rows, caption }: { rows: Row[]; caption?: string }) {
  return (
    <table className="pr-def pr-grid4">
      <colgroup><col className="pr-label" /><col /><col className="pr-label" /><col /></colgroup>
      <tbody>
        {caption && <tr className="pr-def-sub"><th colSpan={4} scope="colgroup">{caption}</th></tr>}
        {rows.map(r => typeof r[0] === "string"
          ? <tr key={r[0]}><th scope="row">{r[0]}</th><td colSpan={3}>{r[1] as ReactNode}</td></tr>
          : <tr key={(r as [Cell, Cell])[0][0]}>{(r as [Cell, Cell]).map(([k, v]) => <Fragment key={k}><th scope="row">{k}</th><td>{v}</td></Fragment>)}</tr>)}
      </tbody>
    </table>
  );
}

function MetricTable({ m, n, vp }: { m: SpecMetric; n: string; vp: string }) {
  const d = m.definition, v = m.validation;
  const list = (xs: string[]) => xs.length ? <ul>{xs.map((x, i) => <li key={i}>{x}</li>)}</ul> : "—";
  const opt = (k: string, x: ReactNode | null | undefined): Row[] => (x ? [[k, x]] : []);
  const rows: Row[] = [
    ["Question", m.question],
    [["Key", <code>{m.key}</code>], ["Since", m.since]],
    [["Tier", `${capital(m.tier)}${m.starter ? ", starter set ★" : ""}`], ["Adverse", m.adverse?.length ? m.adverse.join(", ") : "—"]],
    [["Kind · unit", <><code>{m.kind}</code> · <code>{m.unit}</code></>], ["Currency rule", <code>{m.currency_rule}</code>]],
    [["Grain", grain(m)], ["Maximum lag", `${days(m.max_lag_days)}${m.max_lag_rule ? ` (${m.max_lag_rule})` : ""}`]],
    [["History", `${m.history_months} months`], ["Scope", m.scope === "category" ? "category-level product group (§4)" : m.scope]],
    ...opt("Deprecated", m.deprecated_in && `in ${m.deprecated_in}${m.replaced_by ? `, replaced by ${m.replaced_by}` : ""}`),
    ["Applies to", Array.isArray(m.applies_to) ? codes(m.applies_to) : "every product type of the category"],
    ["Volume", m.volume ?? "—"],
    ...opt("Flow basis", d.flow_basis),
    ...opt("Numerator", d.numerator),
    ...opt("Denominator", d.denominator),
    ...opt("Exposure", d.exposure),
    ["In", list(d.includes)],
    ["Out", list(d.excludes)],
    ["Booking date", d.booking_date],
    ["Breakdowns", m.breakdowns.length ? codes(m.breakdowns) : "none"],
    ...opt("Extras", m.extras?.length ? codes(m.extras) : null),
    ...opt("Notes", d.notes),
    ["Themes", m.themes.length ? codes(m.themes) : "—"],
  ];
  const mask = opt("Masked by", v?.masked_by ? maskText(v.masked_by as Mask) : null);
  const judged: Row[] = !v ? [] : NOT_TESTED.has(v.method)
    ? [[["Method", <><code>{v.method}</code>: never tested</>], ["Stable age", v.stable_age_days != null ? days(v.stable_age_days) : "—"]], ...mask]
    : [[["Method", <><code>{v.method}</code>{v.judge_grain ? `, judged ${v.judge_grain}` : ""}</>],
        ["Stable age", v.stable_age_days != null ? days(v.stable_age_days) : "—"]],
       [["Minimums", [v.min_volume != null && `volume ${v.min_volume}`, v.min_denominator != null && `denominator ${v.min_denominator}`,
         v.min_base != null && `year-ago base ${v.min_base}`].filter(Boolean).join("; ") || "—"],
        ["Adverse allowed", v.adverse_allowed?.length ? v.adverse_allowed.join(", ") : "—"]],
       ["Thresholds", thresholds(v.thresholds, " (small, medium and large alike)")],
       ...mask,
       ...opt("Counts", v.counts && "numerator and denominator are counts: the change must also pass a 95% Wilson interval"),
       ...opt("Concentration", v.concentration_sensitive && "concentration-sensitive: without L5 (change concentration) the checks give no verdict")];
  return (
    <div className="pr-metric">
      <h3>{n} {m.name}</h3>
      <Grid rows={[...rows]} />
      {judged.length > 0 && <Grid caption={`How the checks judge it (validation parameters ${vp})`} rows={judged} />}
    </div>
  );
}

function Category({ c, n, vp }: { c: SpecCategory; n: string; vp: string }) {
  const ms = c.metrics ?? [];
  const keys = (f: (m: SpecMetric) => boolean) => ms.filter(f).map(m => m.key);
  const lists: [string, string[]][] = [["Required", keys(m => m.tier === "required")], ["In the starter set", keys(m => m.starter)],
    ["Already reported in some form", keys(m => m.commonly_reported)], ["Need new aggregation", keys(m => !m.commonly_reported)]];
  return (
    <section className="pr-cat">
      <div className="pr-keep">
        <h2>{n} {c.name}</h2>
        <p className="pr-meta">Category <code>{c.id}</code> · {c.institution === "bank" ? "banks" : "insurers"} · product types {codes(c.product_types.map(p => p.id))}</p>
        <DefTable rows={lists.filter(([k, v]) => k === "Required" || v.length).map(([k, v]) => [k, v.length ? codes(v) : "none"])} />
      </div>
      {c.supervisory_note && <p>{c.supervisory_note}</p>}
      <table className="pr-grid pr-summary">
        <thead><tr><th scope="col">No.</th><th scope="col">Key</th><th scope="col">Name</th><th scope="col">Kind · unit</th>
          <th scope="col">Grain · max lag</th><th scope="col">Tier</th></tr></thead>
        <tbody>{ms.map((m, j) => <tr key={m.key}><td>{n}.{j + 1}</td><td><code>{m.key}</code></td><td>{m.name}</td>
          <td>{m.kind} · {m.unit}</td><td>{grain(m)} · {m.max_lag_days}d</td><td>{m.tier}{m.starter ? " ★" : ""}</td></tr>)}</tbody>
      </table>
      {c.derived_metrics?.length ? <p><b>Derived by the checks (not served):</b> {c.derived_metrics.map(x =>
        <Fragment key={x.key}><code>{x.key}</code> = {x.formula}{x.note ? `: ${x.note}` : ""}. </Fragment>)}</p> : null}
      {ms.map((m, j) => <MetricTable key={m.key} m={m} n={`${n}.${j + 1}`} vp={vp} />)}
    </section>
  );
}

/** §6's parameter table, grouped by category; the same values and words as the guide's. */
function ValidationTable({ s }: { s: Spec }) {
  return (
    <table className="pr-grid pr-dense">
      <thead><tr><th scope="col">Key</th><th scope="col">Method</th><th scope="col">Stable age (d)</th><th scope="col">Min volume</th>
        <th scope="col">Min denominator</th><th scope="col">Min base</th><th scope="col">Mask</th>
        <th scope="col">Thresholds (small = medium = large)</th><th scope="col">Notes</th></tr></thead>
      <tbody>{s.categories.map(c => <Fragment key={c.id}>
        <tr className="pr-group"><th colSpan={9} scope="colgroup"><code>{c.id}</code> {c.name}</th></tr>
        {(c.metrics ?? []).map(m => {
          const v = m.validation!;
          const notes = [v.counts && "counts (Wilson)", v.concentration_sensitive && "concentration-sensitive",
            (v.adverse_allowed?.length ?? 0) > 1 && `adverse ${v.adverse_allowed!.join(" or ")}`].filter(Boolean).join("; ");
          const dash = (x: number | null) => x ?? "—";
          return <tr key={m.key}><td><code>{m.key}</code></td><td>{v.method}{v.judge_grain ? ` (judged ${v.judge_grain})` : ""}</td>
            <td>{dash(v.stable_age_days)}</td><td>{dash(v.min_volume)}</td><td>{dash(v.min_denominator)}</td><td>{dash(v.min_base)}</td>
            <td>{v.masked_by ? maskText(v.masked_by as Mask) : "—"}</td><td>{thresholds(v.thresholds, "")}</td><td>{notes || "—"}</td></tr>;
        })}
      </Fragment>)}</tbody>
    </table>
  );
}

/** §11's matrix, one row per category: each theme with the metrics that help check it (themes in the guide's order). */
function ThemeTable({ s, themes }: { s: Spec; themes: string[] }) {
  return (
    <table className="pr-grid">
      <thead><tr><th scope="col">Category</th><th scope="col">Themes, each with the metrics that help check it (° context, book-size or mask metric)</th></tr></thead>
      <tbody>{s.categories.map(c => <tr key={c.id}><td><code>{c.id}</code></td><td><dl className="pr-themes">{themes.map(t => {
        const ms = (c.metrics ?? []).filter(m => m.themes.includes(t))
          .map(m => `${m.key}${m.validation && NOT_TESTED.has(m.validation.method) ? "°" : ""}`);
        return ms.length ? <Fragment key={t}><dt>{t}</dt><dd>{ms.join(", ")}</dd></Fragment> : null;
      })}</dl></td></tr>)}</tbody>
    </table>
  );
}

function SectionBody({ s, n }: { s: Spec; n: string }) {
  const vp = s.validation_params_version;
  if (n === "5") return <>
    <Guide md={s.drawn["5"].md.split(/^### /m)[0]} />
    {s.categories.map((c, i) => <Category key={c.id} c={c} n={`5.${i + 1}`} vp={vp} />)}
  </>;
  const md = (s.guide[n] ?? s.drawn[n]).md;
  if (n === "6") return <Guide md={md} draw={h => h[0] === "Category" && h[1] === "Key" ? <ValidationTable s={s} /> : null} />;
  if (n === "11") return <Guide md={md} draw={h => h[0] === "Category" ? <ThemeTable s={s} themes={h.slice(1)} /> : null} />;
  return <Guide md={md} />;
}

/** The contents: sections and their parts, each with a page number the PDF maker fills in (data-toc = the heading). */
function contents(s: Spec): { level: 1 | 2; title: string }[] {
  const out: { level: 1 | 2; title: string }[] = [{ level: 1, title: "Document control" }, { level: 1, title: "Introduction" }];
  for (const n of SECTIONS) {
    const g = s.guide[n] ?? s.drawn[n];
    out.push({ level: 1, title: `${n} ${g.title}` });
    const parts = n === "5" ? s.categories.map((c, i) => `5.${i + 1} ${c.name}`)
      : [...g.md.matchAll(/^### (.+)$/gm)].map(m => plain(m[1]));
    out.push(...parts.map(title => ({ level: 2 as const, title })));
  }
  return out;
}

export function SpecPrintPage() {
  const [s, err] = useSpec();
  useEffect(() => { if (s) document.title = `${s.title} ${s.spec_version}`; }, [s]);
  if (err) return <main className="sp-print"><p>{err}</p></main>;
  if (!s) return <main className="sp-print"><p>Loading the spec…</p></main>;
  const f = files(s), v = s.spec_version;
  const revision = s.changelog.filter(c => c.date > s.published).sort((a, b) => b.date.localeCompare(a.date))[0];
  return (
    <main className="sp-print" data-spec-ready="">
      <section className="pr-cover">
        <div className="pr-cover-pub">{PUBLISHER}</div>
        <div className="pr-cover-main">
          <div className="pr-cover-title">{s.title}</div>
          <div className="pr-cover-sub">{SUBTITLE}</div>
          <div className="pr-cover-version">Version {v}</div>
        </div>
        <dl className="pr-cover-meta">
          <div><dt>Status</dt><dd>{capital(s.status)}</dd></div>
          <div><dt>Published</dt><dd>{longDate(s.published)}</dd></div>
          {revision && <div><dt>Revised</dt><dd>{longDate(revision.date)} ({revision.kind.toLowerCase()})</dd></div>}
          <div><dt>Publisher</dt><dd>{PUBLISHER}</dd></div>
        </dl>
        <p className="pr-cover-note">This document is the guide to the Metrics Spec {v}. The machine-readable spec
          (<code>{f.yaml}</code>) and the reference API (<code>{f.api}</code>) are published with it.</p>
      </section>

      <section className="pr-front">
        <h1>Document control</h1>
        <DefTable rows={[
          ["Title", `${s.title}: ${SUBTITLE.toLowerCase()}`],
          ["Version", v],
          ["Status", capital(s.status)],
          ["Published", longDate(s.published)],
          ...(revision ? [["Last revised", `${longDate(revision.date)} (${revision.kind.toLowerCase()})`] as [string, ReactNode]] : []),
          ["Validation parameters", `${s.validation_params_version}, versioned separately (§1.4)`],
          ["Publisher", PUBLISHER],
          ["Files", <ul>{s.files.map(x => <li key={x.name}><code>{x.name}</code>: {x.label.replace(/^The /, "the ")}{x.name === f.pdf ? ", this document" : ""}</li>)}</ul>],
        ]} />
        <h2>Change log</h2>
        <table className="pr-grid">
          <thead><tr><th scope="col">Version</th><th scope="col">Date</th><th scope="col">Change</th><th scope="col">What changed</th></tr></thead>
          <tbody>{s.changelog.map(c => <tr key={`${c.version} ${c.date}`}><td>{c.version}</td><td className="pr-nowrap">{longDate(c.date)}</td><td>{c.kind}</td><td>{c.text}</td></tr>)}</tbody>
        </table>
        {!s.aliases.length && !s.deprecations.length && <p>No aliases or deprecations in this version.</p>}
      </section>

      <section className="pr-front">
        <h1>Contents</h1>
        <ol className="pr-toc">{contents(s).map(e =>
          <li key={e.title} className={`pr-toc-${e.level}`}><span>{e.title}</span><span className="pr-toc-dots" /><span className="pr-toc-pg" data-toc={e.title} /></li>)}</ol>
      </section>

      <section className="pr-front">
        <h1>Introduction</h1>
        <Markdown text={s.guide.intro?.md ?? ""} shift={-2} />
      </section>

      {SECTIONS.map(n => <section key={n} className="pr-sec" data-sec={n}>
        <h1><span className="pr-n">{n}</span> {(s.guide[n] ?? s.drawn[n]).title}</h1>
        <SectionBody s={s} n={n} />
      </section>)}
    </main>
  );
}
