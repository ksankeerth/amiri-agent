// The Metrics Spec (board 12; states: board 16 section I), for both roles. Inside /spec the URL hash chooses the view, so every
// old link keeps working: a category (#cat-<id>; #metric-<key> opens that metric in its category), a chapter of the guide
// (#s<n>, #intro, #changes; #dim-<key> and #check-<id> open the chapter that holds them), or, with none, the first category
// for the institution's own products. The PDF has its own layout (SpecPrint.tsx).
import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import type { Spec, SpecFile } from "../../api/spec";
import { Pill } from "../../components/v2/Pill";
import { ArrowLink } from "../../components/v2/ArrowLink";
import { btnClass } from "../../components/v2/Button";
import { LoadError } from "../../components/v2/LoadError";
import { Skeleton } from "../../components/v2/Skeleton";
import { useCrumbs, usePhone } from "../../components/v2/Shell";
import { CategoryView } from "./Category";
import { ChapterView } from "./Chapter";
import { RailLists, RailSearch } from "./Rail";
import { useConnection, useMine } from "./useAround";
import { useSpec } from "./useSpec";
import { chaptersOf, defaultCategory, metricAnchors, metricCount, searchMetrics, sizeText, specDate, viewOf, type View } from "./words";
import "../../styles/v2/spec.css";

const CRUMBS = [{ label: "Your institution" }, { label: "Metrics Spec" }];
const to = (hash: string) => ({ pathname: "/spec", hash });

// the three downloads, in the words a person uses for them
const FILES: [RegExp, string, string][] = [[/\.pdf$/i, "Guide", "PDF"], [/openapi/i, "Reference API", "OpenAPI"], [/\.ya?ml$/i, "Spec", "YAML"]];
const fileWords = (f: SpecFile): [string, string] => { const m = FILES.find(([re]) => re.test(f.name)); return m ? [m[1], m[2]] : [f.label, ""]; };

function Downloads({ files }: { files: SpecFile[] }) {
  const order = (f: SpecFile) => FILES.findIndex(([re]) => re.test(f.name));
  return (
    <div className="v2-sx-dl" role="group" aria-label="Downloads">
      {[...files].sort((a, b) => order(a) - order(b)).map(f => {
        const [name, kind] = fileWords(f), label = kind ? `${name} · ${kind}` : name;
        return f.available
          ? <a key={f.name} className={btnClass("secondary")} href={f.href} download={f.name} title={`${f.name}${f.bytes != null ? `, ${sizeText(f.bytes)}` : ""}`}>
            <span aria-hidden="true">↓</span>{label}<span className="v2-sr">{f.bytes != null ? `, ${sizeText(f.bytes)}` : ""}</span></a>
          : <span key={f.name} className="v2-sx-dl__off">{label} (not made yet)</span>;
      })}
    </div>
  );
}

function Head({ s }: { s?: Spec }) {
  const [about, setAbout] = useState(false);
  const nMetrics = s ? s.categories.reduce((n, c) => n + metricCount(c), 0) : 0;
  return (
    <header className="v2-sx-head">
      <div className="v2-sx-head__t">
        <div className="v2-sx-head__row">
          <h1 className="v2-sx-h1">{s?.title ?? "Metrics Spec"}</h1>
          {s && <Pill tone="neutral">{s.spec_version} · published {specDate(s.published)}</Pill>}
        </div>
        {s && <>
          <p className="v2-sx-lede">The summary figures a bank or insurer shares, per product, so expectations can be checked · {nMetrics} metrics in {s.categories.length} categories
            {" "}<button type="button" className="v2-sx-link-btn" aria-expanded={about} aria-controls="sx-about" onClick={() => setAbout(a => !a)}>About this version</button></p>
          <dl id="sx-about" className="v2-sx-about" hidden={!about}>
            <div><dt>Version</dt><dd>{s.spec_version}</dd></div><div><dt>Status</dt><dd>{s.status}</dd></div>
            <div><dt>Published</dt><dd>{specDate(s.published)}</dd></div><div><dt>Validation parameters</dt><dd>version {s.validation_params_version}</dd></div>
          </dl>
        </>}
      </div>
      {s && <Downloads files={s.files} />}
    </header>
  );
}

function Connection() {
  const line = useConnection();
  if (!line) return null;
  return (
    <div className="v2-sx-conn">
      <Pill tone={line.tone === "good" ? "good" : "neutral"} mark={line.tone === "good" ? "●" : "○"}>{line.pill}</Pill>
      <p className="v2-sx-conn__t">{line.text}</p>
      <ArrowLink to="/admin/data">Data connection</ArrowLink>
    </div>
  );
}

function Search({ s, q, onPick }: { s: Spec; q: string; onPick: () => void }) {
  const ids = useMemo(() => metricAnchors(s.categories), [s]);
  const found = useMemo(() => searchMetrics(s.categories, q), [s, q]);
  return (
    <section aria-labelledby="sx-title" className="v2-sx-found">
      <h2 id="sx-title" className="v2-sx-h2">Search results</h2>
      <p className="v2-sx-fine" role="status">{found.length ? `${found.length} metric${found.length === 1 ? "" : "s"} match “${q.trim()}”.` : `No metric matches “${q.trim()}”.`}</p>
      <ul className="v2-sx-hits">{found.map(({ c, m }) => (
        <li key={`${c.id}/${m.key}`}>
          <Link to={to(`#${ids.get(`${c.id}/${m.key}`)}`)} onClick={onPick}>{m.name}</Link>
          <span className="v2-mono v2-sx-key">{m.key}</span>
          <span className="v2-sx-hit__q">{m.question}</span>
          <span className="v2-sx-hit__c">{c.name} · {m.tier}</span>
        </li>))}</ul>
    </section>
  );
}

export function SpecPage() {
  useCrumbs(CRUMBS);
  const [s, err, reload] = useSpec();
  const mine = useMine();
  const { hash } = useLocation();
  const phone = usePhone();
  const [query, setQuery] = useState("");
  const [browse, setBrowse] = useState(false);
  const view: View = useMemo(() => s ? viewOf(hash, s.categories) : { kind: "home" }, [s, hash]);
  const def = s && mine ? defaultCategory(s.categories, mine.counts, mine.kind) : undefined;
  const catId = view.kind === "category" ? view.id : view.kind === "home" ? def?.id : undefined;
  const chapterId = view.kind === "chapter" ? view.id : undefined;
  const where = catId ? `cat-${catId}` : chapterId ?? "home";
  const q = query.trim();

  useEffect(() => { setBrowse(false); }, [hash]);
  useEffect(() => {  // a new view opens at its top; a link to a metric, dimension or check scrolls to that row
    if (!s || !mine) return;
    const h = decodeURIComponent(hash.replace(/^#/, ""));
    const target = view.kind === "category" ? view.open : view.kind === "chapter" ? view.target : undefined;
    const t = requestAnimationFrame(() => {
      const el = target ? document.getElementById(target) : null;
      if (el) el.scrollIntoView({ block: "start" }); else if (h || where) document.querySelector("main")?.scrollTo({ top: 0 });
    });
    const name = catId ? s.categories.find(c => c.id === catId)?.name : chapterId ? chaptersOf(s).find(c => c.id === chapterId)?.title : null;
    document.title = name ? `${name} · Metrics Spec · Amiri Agent` : "Metrics Spec · Amiri Agent";
    return () => cancelAnimationFrame(t);
  }, [s, !!mine, where, hash]);  // eslint-disable-line react-hooks/exhaustive-deps

  if (err != null) return <div className="v2-sx"><Head /><LoadError error={err} onRetry={reload} what="the Metrics Spec" safe="The spec is safe; this page just couldn't reach it." /></div>;
  if (!s || !mine) return <div className="v2-sx"><Head /><Skeleton rows={8} label="Loading the Metrics Spec" /></div>;

  const cat = catId ? s.categories.find(c => c.id === catId) : undefined;
  const chapters = chaptersOf(s);
  const showName = cat?.name ?? (chapterId ? chapters.find(c => c.id === chapterId)?.title : null) ?? "Metrics Spec";
  const lists = <RailLists s={s} counts={mine.counts} catId={catId} chapterId={chapterId} chapters={chapters} />;
  return (
    <div className="v2-sx">
      <Head s={s} />
      <Connection />
      <div className="v2-sx-cols">
        <nav className="v2-sx-rail" aria-label="Categories and guide">
          <RailSearch query={query} onQuery={setQuery} />
          {phone ? <>
            <button type="button" className="v2-sx-browse" aria-expanded={browse} aria-controls="sx-rail" onClick={() => setBrowse(b => !b)}>
              <span><span className="v2-sx-tri" aria-hidden="true" />Categories and guide</span><span className="v2-sx-browse__now">{showName}</span></button>
            <div id="sx-rail" className="v2-sx-rail__in" hidden={!browse}>{lists}</div>
          </> : <div className="v2-sx-rail__in">{lists}</div>}
        </nav>
        <section className="v2-sx-view" aria-labelledby="sx-title">
          <p className="v2-sr" role="status">{q ? "" : `Showing ${showName}`}</p>
          {q ? <Search s={s} q={q} onPick={() => setQuery("")} />
            : cat ? <CategoryView key={cat.id} s={s} c={cat} yours={mine.names.get(cat.id) ?? []} open={view.kind === "category" ? view.open : undefined} />
            : chapterId ? <ChapterView key={chapterId} s={s} id={chapterId} target={view.kind === "chapter" ? view.target : undefined} />
            : <h2 id="sx-title" className="v2-sx-h2">No categories</h2>}
        </section>
      </div>
    </div>
  );
}
