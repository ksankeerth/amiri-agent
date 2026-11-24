// The Metrics Spec, for both roles, as three kinds of view inside /spec, chosen by the URL hash so every old link keeps
// working: the home (what it is, downloads, search, the categories, the guide's contents), one category with its metrics
// (#cat-<id>; #metric-<key> opens that metric in its category), and one chapter of the guide (#s<n>, #intro, #changes;
// #dim-<key> and #check-<id> open the chapter that holds them). The PDF has its own layout (SpecPrint.tsx).
import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { specApi, type Spec, type SpecCategory, type SpecDimension, type SpecMetric } from "../../api/spec";
import { Markdown, ScrollTable } from "../../components/markdown";
import { PageTitle, Section, TextButton } from "../../components/rd";
import { LoadError, PageSkeleton } from "../../components/ui";
import "../../styles/rd-spec.css";
import {
  adverseLine, alsoLines, barLines, countLine, currencyLine, historyLine, kindLine, lagLine, methodLine, metricAnchors,
  metricCount, proseRuns, settlesLine, sizeText, specDate, ucFirst, unitAndGrain, viewOf, words, type View,
} from "./words";

const to = (hash: string) => ({ pathname: "/spec", hash });

export function useSpec(): [Spec | null, unknown, () => Promise<void>] {
  const [s, setS] = useState<Spec | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const load = () => specApi.get().then(x => { setS(x); setErr(null); }).catch(setErr);
  useEffect(() => { load(); }, []);
  return [s, err, load];
}

// ---------------------------------------------------------------- the guide's chapters, in the spec's own numbering
interface Chapter { id: string; n: string; title: string }
function chaptersOf(s: Spec): Chapter[] {
  const title = (n: string) => s.guide[n]?.title ?? s.drawn[n]?.title ?? `Chapter ${n}`;
  const out: Chapter[] = [{ id: "intro", n: "", title: "Introduction" }];
  for (let i = 1; i <= 13; i++) if (i !== 5) out.push({ id: `s${i}`, n: String(i), title: title(String(i)) });
  out.push({ id: "changes", n: "", title: "Change log" });
  return out;
}

const Chevron = () => (
  <svg className="sx-chev" viewBox="0 0 20 20" aria-hidden="true"><path d="M7 4l6 6-6 6" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>);

function Crumbs({ items }: { items: ({ label: string; hash?: string })[] }) {
  return <>{items.map((c, i) => <span key={i}>{i > 0 && " / "}{c.hash !== undefined ? <Link to={to(c.hash)}>{c.label}</Link> : c.label}</span>)}</>;
}

// ---------------------------------------------------------------- the home
const FILE_WORDS: [RegExp, string, string][] = [[/openapi/i, "the reference API", "OpenAPI"], [/\.pdf$/i, "the guide", "PDF"], [/\.ya?ml$/i, "the spec", "YAML"]];

function Downloads({ s }: { s: Spec }) {
  return (
    <p className="sx-dl">Download:{" "}{s.files.map((f, i) => {
      const [, name, kind] = FILE_WORDS.find(([re]) => re.test(f.name)) ?? [null, f.label, ""];
      return <span key={f.name}>{i > 0 && " · "}{f.available
        ? <><a className="rd-go" href={f.href} download={f.name}>{name}</a> <span className="rd-fine">{kind ? `${kind}, ` : ""}{sizeText(f.bytes)}</span></>
        : <span className="rd-fine">{name} (not made yet)</span>}</span>;
    })}</p>
  );
}

function CategoryList({ title, cats, id }: { title: string; cats: SpecCategory[]; id?: string }) {
  const metrics = cats.reduce((n, c) => n + metricCount(c), 0);
  return (
    <Section title={title} meta={`${cats.length} categories · ${metrics} metrics`} id={id}>
      <ul className="sx-list">{cats.map(c => (
        <li key={c.id} className="rd-row sx-catrow">
          <Link className="rd-name" to={to(`#cat-${c.id}`)}>{c.name}</Link>
          <span className="rd-fine">{countLine(c)}</span>
        </li>))}</ul>
    </Section>
  );
}

function Search({ s, q }: { s: Spec; q: string }) {
  const found = useMemo(() => s.categories.flatMap(c => (c.metrics ?? [])
    .filter(m => [m.key, m.name, m.question, c.name].some(x => x.toLowerCase().includes(q))).map(m => ({ c, m }))), [s, q]);
  const ids = useMemo(() => metricAnchors(s.categories), [s]);
  return (
    <section aria-label="Search results" className="sx-found">
      <p className="rd-fine" role="status">{found.length ? `${found.length} metric${found.length === 1 ? "" : "s"} match` : `No metric matches “${q}”.`}</p>
      {found.map(({ c, m }) => (
        <div key={`${c.id}/${m.key}`} className="rd-row">
          <div className="rd-row-t"><Link className="rd-name" to={to(`#${ids.get(`${c.id}/${m.key}`)}`)}>{m.name}</Link></div>
          <div className="rd-row-d">{m.question}</div>
          <div className="rd-row-m">{c.name} · {m.tier}</div>
        </div>))}
    </section>
  );
}

function Home({ s }: { s: Spec }) {
  const [query, setQuery] = useState("");
  const [about, setAbout] = useState(false);
  const q = query.trim().toLowerCase();
  const chapters = chaptersOf(s);
  // chapter 5 is the categories themselves: its row scrolls to them
  const at4 = chapters.findIndex(c => c.id === "s4");
  const contents = [...chapters.slice(0, at4 + 1), { id: "categories", n: "5", title: s.drawn["5"]?.title ?? "Metrics per category" }, ...chapters.slice(at4 + 1)];
  const nMetrics = s.categories.reduce((n, c) => n + metricCount(c), 0);
  const banks = s.categories.filter(c => c.institution === "bank"), insurers = s.categories.filter(c => c.institution === "insurer");
  const note = (id: string) => id === "s7" ? `${Object.keys(s.dimensions).length} dimensions` : id === "s9" ? `${s.conformance_checks.length} checks` : null;
  return (
    <>
      <PageTitle title={s.title}
        status={<><span>version {s.spec_version}</span><span>{s.status}</span><span>published {specDate(s.published)}</span></>}
        lede={<>The figures a bank or insurer shares, per product, and how Amiri Agent judges them: <b>{s.categories.length} categories, {nMetrics} metrics.</b>{" "}
          <TextButton aria-expanded={about} aria-controls="sx-about" onClick={() => setAbout(a => !a)}>About this spec</TextButton></>}
        help={<>
          {about && <dl id="sx-about" className="sx-rows sx-about">
            <dt>Version</dt><dd>{s.spec_version}</dd><dt>Status</dt><dd>{s.status}</dd><dt>Published</dt><dd>{specDate(s.published)}</dd>
            <dt>Validation parameters</dt><dd>version {s.validation_params_version}</dd></dl>}
          <Downloads s={s} />
        </>} />
      <div className="sx-searchbox">
        <label htmlFor="sx-search" className="sx-searchlabel">Find a metric</label>
        <input id="sx-search" className="input sx-search" type="search" autoComplete="off" placeholder="e.g. letters of credit, new pledges, claims"
          value={query} onChange={e => setQuery(e.target.value)} />
      </div>
      {q ? <Search s={s} q={q} /> : <>
        <div className="sx-two" id="categories">
          <CategoryList title="For banks" cats={banks} />
          <CategoryList title="For insurers" cats={insurers} />
        </div>
        <Section title="The guide" meta="each chapter opens as its own page" id="guide">
          <ol className="sx-list sx-contents">{contents.map(ch => (
            <li key={ch.id} className="rd-row sx-tocrow">
              <span className="sx-n">{ch.n}</span>
              <Link className="rd-name" to={to(`#${ch.id}`)}>{ch.title}</Link>
              {note(ch.id) && <span className="rd-fine">{note(ch.id)}</span>}
              {ch.id === "categories" && <span className="rd-fine">the categories, above</span>}
            </li>))}
          </ol>
        </Section>
      </>}
    </>
  );
}

// ---------------------------------------------------------------- one category
function Facts({ m }: { m: SpecMetric }) {
  const cur = currencyLine(m);
  return (
    <div className="rd-status rd-dots sx-facts">
      <span>{kindLine(m)}</span>{cur && <span>{cur}</span>}<span>{lagLine(m)}</span><span>{historyLine(m)}</span><span>{adverseLine(m.adverse)}</span>
      {m.breakdowns.length > 0 && <span>by {m.breakdowns.map((b, i) => <span key={b}>{i > 0 && ", "}<Link className="rd-name" to={to(`#dim-${b}`)}>{words(b)}</Link></span>)}</span>}
    </div>
  );
}

function Rows({ items }: { items: [string, React.ReactNode][] }) {
  return <dl className="sx-rows">{items.filter(([, v]) => v != null && v !== "").map(([k, v]) => <div key={k} className="sx-rowpair"><dt>{k}</dt><dd>{v}</dd></div>)}</dl>;
}

function MetricDetail({ m, id }: { m: SpecMetric; id: string }) {
  const d = m.definition, v = m.validation;
  const bars = barLines(v?.thresholds ?? null), also = v ? alsoLines(v) : [];
  const small = [`Key ${m.key}`, m.starter ? "In the starter set" : null, `Since version ${m.since}`,
    m.deprecated_in ? `Deprecated in version ${m.deprecated_in}${m.replaced_by ? `, replaced by ${words(m.replaced_by)}` : ""}` : null].filter(Boolean) as string[];
  return (
    <div className="rd-open sx-detail" id={`${id}-d`}>
      <h3 className="sx-q">{m.question}</h3>
      <Facts m={m} />
      <h4 className="sx-sub">What it counts</h4>
      <Rows items={[
        ["Numerator", d.numerator && ucFirst(d.numerator)], ["Denominator", d.denominator && ucFirst(d.denominator)], ["Exposure", d.exposure && ucFirst(d.exposure)],
        ["Counts", d.includes.length ? ucFirst(d.includes.join("; ")) : null], ["Leaves out", d.excludes.length ? ucFirst(d.excludes.join("; ")) : null],
        ["Booking date", ucFirst(d.booking_date)], ["Flow basis", d.flow_basis && ucFirst(d.flow_basis)],
        ["Records behind it", m.volume && ucFirst(m.volume)],
        ["Applies to", Array.isArray(m.applies_to) ? m.applies_to.map(words).join(", ") : "Every product type"],
        ["Notes", d.notes]]} />
      {v && <>
        <h4 className="sx-sub">How Amiri Agent judges it</h4>
        <Rows items={[
          ["Compared with", methodLine(v.method)],
          ["An effect needs", bars.length ? <>{bars.map(b => <div key={b.text}>{b.text} <span className="rd-fine">(in the spec: {b.spec})</span></div>)}</> : null],
          ["Settles after", settlesLine(v, m.volume)],
          ["Also", also.length ? ucFirst(also.join("; ")) : null]]} />
      </>}
      <p className="rd-fine sx-small">{small.map((x, i) => <span key={i}>{i > 0 && " · "}{x.startsWith("Key ") ? <>Key <code>{m.key}</code></> : x}</span>)}</p>
    </div>
  );
}

function CategoryView({ s, c, open: openId }: { s: Spec; c: SpecCategory; open?: string }) {
  const ids = useMemo(() => metricAnchors(s.categories), [s]);
  const [open, setOpen] = useState<Set<string>>(() => new Set(openId ? [openId] : []));
  useEffect(() => { if (openId) setOpen(o => new Set(o).add(openId)); }, [openId]);
  const toggle = (id: string) => setOpen(o => { const n = new Set(o); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const i = s.categories.findIndex(x => x.id === c.id), prev = s.categories[i - 1], next = s.categories[i + 1];
  const ms = [...(c.metrics ?? [])];  // the spec's own order; required ones are marked in words, not sorted away
  const label = c.institution === "bank" ? "For banks" : "For insurers";
  const derived = c.derived_metrics ?? [];
  return (
    <>
      <PageTitle title={c.name} crumbs={<Crumbs items={[{ label: "Metrics Spec", hash: "" }, { label, hash: "#categories" }, { label: c.name }]} />}
        status={<span>{countLine(c)}</span>} lede={c.supervisory_note || undefined} />
      <Section title="The metrics" count={metricCount(c)}>
        <table className="rd-table sx-metrics">
          <thead><tr><th scope="col">Metric</th><th scope="col">The question it answers</th><th scope="col">Tier</th><th scope="col">Unit, how often</th></tr></thead>
          {ms.map(m => {
            const id = ids.get(`${c.id}/${m.key}`)!, on = open.has(id);
            return (
              <tbody key={m.key} className={on ? "sx-on" : undefined}>
                <tr id={id}>
                  <td className="rd-strong"><button type="button" className="sx-mbtn" aria-expanded={on} aria-controls={`${id}-d`} onClick={() => toggle(id)}>
                    <Chevron /><span>{m.name}</span></button></td>
                  <td>{m.question}</td>
                  <td className={m.tier === "required" ? "rd-strong" : undefined}>{m.tier}</td>
                  <td>{unitAndGrain(m)}</td>
                </tr>
                {on && <tr><td colSpan={4} className="sx-detailcell"><MetricDetail m={m} id={id} /></td></tr>}
              </tbody>);
          })}
        </table>
        {derived.length > 0 && <p className="rd-row-d sx-derived"><b>Worked out by the checks, not shared:</b>{" "}
          {derived.map(x => `${words(x.key)} = ${words(x.formula)}${x.note ? ` (${x.note})` : ""}`).join("; ")}</p>}
      </Section>
      <Section title="Products it covers">
        <table className="rd-table">
          <thead><tr><th scope="col">Product type</th><th scope="col">Typical products</th><th scope="col">Islamic or takaful variant</th></tr></thead>
          <tbody>{c.product_types.map(p => <tr key={p.id}><td className="rd-strong">{ucFirst(words(p.id))}</td><td>{p.typical_products ? ucFirst(p.typical_products) : ""}</td><td>{p.islamic_variant ? ucFirst(p.islamic_variant) : ""}</td></tr>)}</tbody>
        </table>
        <p className="rd-fine sx-small">Category id <code>{c.id}</code>. A metric that lists product types is shared only for those.</p>
      </Section>
      <nav className="sx-pn" aria-label="Other categories">
        {prev ? <Link className="rd-go" to={to(`#cat-${prev.id}`)}>← {prev.name}</Link> : <span />}
        {next ? <Link className="rd-go" to={to(`#cat-${next.id}`)}>{next.name} →</Link> : <span />}
      </nav>
    </>
  );
}

// ---------------------------------------------------------------- one chapter
function dimValues(d: SpecDimension): string {
  if (typeof d.values === "string") return d.values;
  if (Array.isArray(d.values)) return d.values.join(", ");
  return Object.entries(d.values).map(([k, vs]) => `${words(k)}: ${vs.join(", ")}`).join(" · ");
}

function TaxonomyTable({ cats }: { cats: SpecCategory[] }) {
  return (
    <ScrollTable label="Product taxonomy"><table className="rd-table">
      <thead><tr><th scope="col">Category</th><th scope="col">Product types and typical products</th><th scope="col">Islamic or takaful variants</th></tr></thead>
      <tbody>{cats.map(c => (
        <tr key={c.id}>
          <td className="rd-strong"><Link className="rd-name" to={to(`#cat-${c.id}`)}>{c.name}</Link><div className="rd-fine"><code>{c.id}</code></div></td>
          <td>{c.product_types.map(p => <div key={p.id}><code>{p.id}</code>{p.typical_products ? `: ${p.typical_products}` : ""}</div>)}</td>
          <td>{c.product_types.filter(p => p.islamic_variant).map(p => <div key={p.id}>{p.islamic_variant}</div>)}</td>
        </tr>))}</tbody>
    </table></ScrollTable>
  );
}

function ChapterBody({ s, id }: { s: Spec; id: string }) {
  const md = (t: string | undefined, k?: string) => t ? <Markdown key={k} text={t} under={1} /> : null;
  if (id === "intro") return md(s.guide.intro?.md);
  if (id === "changes") return (
    <>
      <ScrollTable label="Change log"><table className="rd-table">
        <thead><tr><th scope="col">Version</th><th scope="col">Date</th><th scope="col">Kind</th><th scope="col">What changed</th></tr></thead>
        <tbody>{s.changelog.map(c => <tr key={`${c.version} ${c.date}`}><td className="rd-strong">{c.version}</td><td className="rd-num">{specDate(c.date)}</td><td>{c.kind}</td><td>{c.text}</td></tr>)}</tbody>
      </table></ScrollTable>
      {!s.aliases.length && !s.deprecations.length && <p className="rd-fine">No aliases or deprecations in this version.</p>}
    </>
  );
  const n = id.slice(1);
  if (n === "4") {
    const runs = proseRuns(s.drawn["4"]?.md ?? "");
    const banks = s.categories.filter(c => c.institution === "bank"), insurers = s.categories.filter(c => c.institution === "insurer");
    return <>
      {md(runs[0]?.replace(/\*\*Banks\*\*\s*$/, ""), "a")}
      <h2 className="md-h">Banks</h2><TaxonomyTable cats={banks} />
      <h2 className="md-h">Insurers</h2><TaxonomyTable cats={insurers} />
      {runs.slice(2).map((r, i) => md(r, `r${i}`))}
    </>;
  }
  if (n === "7") {
    const runs = proseRuns(s.drawn["7"]?.md ?? "");
    return <>
      {md(runs[0], "a")}
      <ScrollTable label="Standard dimensions"><table className="rd-table">
        <thead><tr><th scope="col">Dimension</th><th scope="col">Values</th><th scope="col">About it</th></tr></thead>
        <tbody>{Object.entries(s.dimensions).map(([k, d]) => (
          <tr key={k} id={`dim-${k}`}>
            <td className="rd-strong"><code>{k}</code>{d.frozen ? <div className="rd-fine">frozen at the segment date</div> : null}</td>
            <td>{dimValues(d)}</td>
            <td>{d.description}{d.source ? <div className="rd-fine">Source: {d.source}</div> : null}</td>
          </tr>))}</tbody>
      </table></ScrollTable>
      {runs.slice(1).map((r, i) => md(r, `r${i}`))}
    </>;
  }
  if (n === "9") {
    const runs = proseRuns(s.drawn["9"]?.md ?? "");
    const byStatus = Object.entries(s.vocabularies.error_codes ?? {}).reduce<Record<string, string[]>>((acc, [code, st]) =>
      ({ ...acc, [String(st)]: [...(acc[String(st)] ?? []), code] }), {});
    return <>
      {md(runs[0], "a")}
      <ScrollTable label="Conformance checks"><table className="rd-table">
        <thead><tr><th scope="col">Id</th><th scope="col">Level</th><th scope="col">Check</th><th scope="col">Passes when</th><th scope="col">Fix</th></tr></thead>
        <tbody>{s.conformance_checks.map(c => (
          <tr key={c.id} id={`check-${c.id}`}><td className="rd-strong">{c.id}</td><td>{c.level}</td>
            <td><b>{c.name}.</b> {c.check}</td><td>{c.passes}</td><td>{c.fix}</td></tr>))}</tbody>
      </table></ScrollTable>
      <h2 className="md-h">Error codes</h2>
      {md(runs[1], "b")}
      <ScrollTable label="Error codes"><table className="rd-table">
        <thead><tr><th scope="col">HTTP status</th><th scope="col">Codes</th></tr></thead>
        <tbody>{Object.entries(byStatus).map(([st, codes]) => <tr key={st}><td className="rd-strong rd-num">{st}</td>
          <td>{codes.map((c, i) => <span key={c}>{i > 0 && ", "}<code>{c}</code></span>)}</td></tr>)}</tbody>
      </table></ScrollTable>
      {runs.slice(2).map((r, i) => md(r, `r${i}`))}
    </>;
  }
  return md(s.guide[n]?.md ?? s.drawn[n]?.md);
}

function ChapterView({ s, id }: { s: Spec; id: string }) {
  const chapters = chaptersOf(s), i = chapters.findIndex(c => c.id === id), ch = chapters[i];
  if (!ch) return <><PageTitle title="Chapter not found" crumbs={<Crumbs items={[{ label: "Metrics Spec", hash: "" }]} />} lede="That chapter is not in this version of the spec." /></>;
  const prev = chapters[i - 1], next = chapters[i + 1];
  const head = (c: Chapter) => c.n ? `${c.n}. ${c.title}` : c.title;
  return (
    <>
      <PageTitle title={head(ch)} crumbs={<Crumbs items={[{ label: "Metrics Spec", hash: "" }, { label: "The guide", hash: "#guide" }, { label: head(ch) }]} />} />
      <div className="sx-read"><ChapterBody s={s} id={id} /></div>
      <nav className="sx-pn" aria-label="Other chapters">
        {prev ? <Link className="rd-go" to={to(`#${prev.id}`)}>← {head(prev)}</Link> : <span />}
        {next ? <Link className="rd-go" to={to(`#${next.id}`)}>{head(next)} →</Link> : <span />}
      </nav>
    </>
  );
}

// ---------------------------------------------------------------- the page
export function SpecPage() {
  const [s, err, reload] = useSpec();
  const { hash } = useLocation();
  const view: View = useMemo(() => s ? viewOf(hash, s.categories) : { kind: "home" }, [s, hash]);
  const where = view.kind === "category" ? `cat-${view.id}` : view.kind === "chapter" ? view.id : "home";
  useEffect(() => {  // a new view opens at its top; a link to a metric, dimension or check scrolls to that row
    if (!s) return;
    const h = decodeURIComponent(hash.replace(/^#/, ""));
    const target = view.kind === "category" ? view.open : view.kind === "chapter" ? view.target
      : h === "s5" ? "categories" : h === "categories" || h === "guide" ? h : undefined;
    const t = requestAnimationFrame(() => {
      const el = target ? document.getElementById(target) : null;
      if (el) el.scrollIntoView({ block: "start" }); else document.querySelector("main")?.scrollTo({ top: 0 });
    });
    const name = view.kind === "category" ? s.categories.find(c => c.id === view.id)?.name
      : view.kind === "chapter" ? chaptersOf(s).find(c => c.id === view.id)?.title : null;
    document.title = name ? `${name} · Metrics Spec · Amiri Agent` : "Metrics Spec · Amiri Agent";
    return () => cancelAnimationFrame(t);
  }, [s, where, hash]);  // eslint-disable-line react-hooks/exhaustive-deps
  if (err != null) return <div className="page rd rd-spec"><PageTitle title="Metrics Spec" /><LoadError error={err} onRetry={reload} what="the Metrics Spec" /></div>;
  if (!s) return <div className="page"><PageSkeleton bare /></div>;
  const cat = view.kind === "category" ? s.categories.find(c => c.id === view.id) : undefined;
  return (
    <div className="page rd rd-spec">
      {view.kind === "category" && cat ? <CategoryView key={cat.id} s={s} c={cat} open={view.open} />
        : view.kind === "chapter" ? <ChapterView key={view.id} s={s} id={view.id} />
        : <Home s={s} />}
    </div>
  );
}
