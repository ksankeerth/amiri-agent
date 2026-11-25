// One chapter of the guide, as a reading page. The chapters the page draws from the data (taxonomy, dimensions, conformance
// checks, the change log) keep the guide's text around tables made from the YAML, so every row can carry a link target
// (#dim-<key>, #check-<id>): the Data connection page links to the checks.
import { Link } from "react-router-dom";
import type { Spec, SpecCategory, SpecDimension } from "../../api/spec";
import { Markdown, ScrollTable } from "../../components/markdown";
import { chapterHead, chaptersOf, proseRuns, specDate, words } from "./words";

const to = (hash: string) => ({ pathname: "/spec", hash });

function dimValues(d: SpecDimension): string {
  if (typeof d.values === "string") return d.values;
  if (Array.isArray(d.values)) return d.values.join(", ");
  return Object.entries(d.values).map(([k, vs]) => `${words(k)}: ${vs.join(", ")}`).join(" · ");
}

function TaxonomyTable({ cats, label }: { cats: SpecCategory[]; label: string }) {
  return (
    <ScrollTable label={label}><table className="v2-sx-tbl">
      <thead><tr><th scope="col">Category</th><th scope="col">Product types and typical products</th><th scope="col">Islamic or takaful variants</th></tr></thead>
      <tbody>{cats.map(c => (
        <tr key={c.id}>
          <td className="is-key"><Link to={to(`#cat-${c.id}`)}>{c.name}</Link><div className="v2-mono v2-muted">{c.id}</div></td>
          <td>{c.product_types.map(p => <div key={p.id}><code className="v2-mono">{p.id}</code>{p.typical_products ? `: ${p.typical_products}` : ""}</div>)}</td>
          <td>{c.product_types.filter(p => p.islamic_variant).map(p => <div key={p.id}>{p.islamic_variant}</div>)}</td>
        </tr>))}</tbody>
    </table></ScrollTable>
  );
}

function ChapterBody({ s, id, target }: { s: Spec; id: string; target?: string }) {
  const md = (t: string | undefined, k?: string) => t ? <Markdown key={k} text={t} under={2} /> : null;
  const hit = (anchor: string) => (anchor === target ? { "data-target": "" } : {});
  if (id === "intro") return md(s.guide.intro?.md);
  if (id === "changes") return (
    <>
      <ScrollTable label="Change log"><table className="v2-sx-tbl">
        <thead><tr><th scope="col">Version</th><th scope="col">Date</th><th scope="col">Kind</th><th scope="col">What changed</th></tr></thead>
        <tbody>{s.changelog.map(c => <tr key={`${c.version} ${c.date}`}><td className="is-key">{c.version}</td><td className="is-num">{specDate(c.date)}</td><td>{c.kind}</td><td>{c.text}</td></tr>)}</tbody>
      </table></ScrollTable>
      {!s.aliases.length && !s.deprecations.length && <p className="v2-sx-fine">No aliases or deprecations in this version.</p>}
    </>
  );
  const n = id.slice(1);
  if (n === "4") {
    const runs = proseRuns(s.drawn["4"]?.md ?? "");
    const banks = s.categories.filter(c => c.institution === "bank"), insurers = s.categories.filter(c => c.institution === "insurer");
    return <>
      {md(runs[0]?.replace(/\*\*Banks\*\*\s*$/, ""), "a")}
      <h3 className="md-h">Banks</h3><TaxonomyTable cats={banks} label="Bank product taxonomy" />
      <h3 className="md-h">Insurers</h3><TaxonomyTable cats={insurers} label="Insurer product taxonomy" />
      {runs.slice(2).map((r, i) => md(r, `r${i}`))}
    </>;
  }
  if (n === "7") {
    const runs = proseRuns(s.drawn["7"]?.md ?? "");
    return <>
      {md(runs[0], "a")}
      <ScrollTable label="Standard dimensions"><table className="v2-sx-tbl">
        <thead><tr><th scope="col">Dimension</th><th scope="col">Values</th><th scope="col">About it</th></tr></thead>
        <tbody>{Object.entries(s.dimensions).map(([k, d]) => (
          <tr key={k} id={`dim-${k}`} {...hit(`dim-${k}`)}>
            <td className="is-key"><code className="v2-mono">{k}</code>{d.frozen ? <div className="v2-sx-fine">frozen at the segment date</div> : null}</td>
            <td>{dimValues(d)}</td>
            <td>{d.description}{d.source ? <div className="v2-sx-fine">Source: {d.source}</div> : null}</td>
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
      <ScrollTable label="Conformance checks"><table className="v2-sx-tbl">
        <thead><tr><th scope="col">Id</th><th scope="col">Level</th><th scope="col">Check</th><th scope="col">Passes when</th><th scope="col">Fix</th></tr></thead>
        <tbody>{s.conformance_checks.map(c => (
          <tr key={c.id} id={`check-${c.id}`} {...hit(`check-${c.id}`)}><td className="is-key v2-mono">{c.id}</td><td>{c.level}</td>
            <td><b>{c.name}.</b> {c.check}</td><td>{c.passes}</td><td>{c.fix}</td></tr>))}</tbody>
      </table></ScrollTable>
      <h3 className="md-h">Error codes</h3>
      {md(runs[1], "b")}
      <ScrollTable label="Error codes"><table className="v2-sx-tbl">
        <thead><tr><th scope="col">HTTP status</th><th scope="col">Codes</th></tr></thead>
        <tbody>{Object.entries(byStatus).map(([st, codes]) => <tr key={st}><td className="is-key is-num">{st}</td>
          <td>{codes.map((c, i) => <span key={c}>{i > 0 && ", "}<code className="v2-mono">{c}</code></span>)}</td></tr>)}</tbody>
      </table></ScrollTable>
      {runs.slice(2).map((r, i) => md(r, `r${i}`))}
    </>;
  }
  return md(s.guide[n]?.md ?? s.drawn[n]?.md);
}

export function ChapterView({ s, id, target }: { s: Spec; id: string; target?: string }) {
  const chapters = chaptersOf(s), i = chapters.findIndex(c => c.id === id), ch = chapters[i];
  if (!ch) return <><h2 id="sx-title" className="v2-sx-h2">Chapter not found</h2><p className="v2-sx-note">That chapter is not in this version of the spec.</p></>;
  const prev = chapters[i - 1], next = chapters[i + 1];
  return (
    <>
      <h2 id="sx-title" className="v2-sx-h2">{chapterHead(ch)}</h2>
      <div className="v2-sx-read"><ChapterBody s={s} id={id} target={target} /></div>
      <nav className="v2-sx-pn" aria-label="Other chapters">
        {prev ? <Link to={to(`#${prev.id}`)}><span aria-hidden="true">← </span>{chapterHead(prev)}</Link> : <span />}
        {next ? <Link to={to(`#${next.id}`)}>{chapterHead(next)}<span aria-hidden="true"> →</span></Link> : <span />}
      </nav>
    </>
  );
}
