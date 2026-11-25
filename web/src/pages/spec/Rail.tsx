// The left rail (board 12): find a metric, the categories for the institution's own products (all of them under "All N
// categories"), and the guide's chapters. Every row is a link: the page's view comes from the URL hash.
import { useId, useState } from "react";
import { Link } from "react-router-dom";
import type { Spec, SpecCategory } from "../../api/spec";
import { Icon } from "../../components/Icon";
import { chapterHead, metricCount, productsWord, splitChapters, type Chapter } from "./words";

const to = (hash: string) => ({ pathname: "/spec", hash });

function CatLink({ c, on, note }: { c: SpecCategory; on: boolean; note: string }) {
  return (
    <li><Link className={`v2-sx-link${on ? " is-on" : ""}`} to={to(`#cat-${c.id}`)} aria-current={on ? "page" : undefined}>
      <span>{c.name}</span><span className="v2-sx-link__n">{note}</span></Link></li>
  );
}
const metricsNote = (c: SpecCategory) => `${metricCount(c)} metric${metricCount(c) === 1 ? "" : "s"}`;

function Fold({ label, open, onToggle, children }: { label: string; open: boolean; onToggle: () => void; children: React.ReactNode }) {
  const id = useId();
  return (
    <>
      <button type="button" className="v2-sx-fold" aria-expanded={open} aria-controls={id} onClick={onToggle}>
        <span className="v2-sx-tri" aria-hidden="true" />{label}</button>
      <div id={id} hidden={!open}>{children}</div>
    </>
  );
}

export function RailSearch({ query, onQuery }: { query: string; onQuery: (q: string) => void }) {
  return (
    <label className="v2-sx-search">
      <Icon name="search" />
      <input type="search" aria-label="Find a metric" placeholder="Find a metric" autoComplete="off" value={query}
        onChange={e => onQuery(e.target.value)} onKeyDown={e => { if (e.key === "Escape" && query) { e.stopPropagation(); onQuery(""); } }} />
    </label>
  );
}

export interface RailProps {
  s: Spec;
  /** products per category: empty when the institution has none (every category then shows) */
  counts: Map<string, number>;
  /** the category on show, and the chapter on show */
  catId?: string; chapterId?: string;
  chapters: Chapter[];
}

export function RailLists({ s, counts, catId, chapterId, chapters }: RailProps) {
  const mine = s.categories.filter(c => (counts.get(c.id) ?? 0) > 0);
  const banks = s.categories.filter(c => c.institution === "bank"), insurers = s.categories.filter(c => c.institution === "insurer");
  const outsideMine = !!catId && !mine.some(c => c.id === catId);
  const [allCats, setAllCats] = useState(false), [allChapters, setAllChapters] = useState(false);
  const { shown, rest, openRest } = splitChapters(chapters, chapterId);
  const catsOpen = allCats || outsideMine, chaptersOpen = allChapters || openRest;
  const group = (label: string, cats: SpecCategory[]) => (
    <>
      <p className="v2-cap v2-sx-cap" id={`sx-${label.replace(/\W+/g, "")}`}>{label}</p>
      <ul aria-labelledby={`sx-${label.replace(/\W+/g, "")}`}>{cats.map(c => <CatLink key={c.id} c={c} on={c.id === catId} note={metricsNote(c)} />)}</ul>
    </>
  );
  const chapter = (c: Chapter) => (
    <li key={c.id}><Link className={`v2-sx-link is-guide${c.id === chapterId ? " is-on" : ""}`} to={to(`#${c.id}`)} aria-current={c.id === chapterId ? "page" : undefined}>
      <span>{chapterHead(c)}</span></Link></li>
  );
  return (
    <>
      {mine.length > 0 ? (
        <>
          <p className="v2-cap v2-sx-cap" id="sx-yours">For your products</p>
          <ul aria-labelledby="sx-yours">{mine.map(c => <CatLink key={c.id} c={c} on={c.id === catId} note={productsWord(counts.get(c.id) ?? 0)} />)}</ul>
          <Fold label={`All ${s.categories.length} categories`} open={catsOpen} onToggle={() => setAllCats(o => !o)}>
            {group("For banks", banks)}{group("For insurers", insurers)}
          </Fold>
        </>
      ) : <>{group("For banks", banks)}{group("For insurers", insurers)}</>}
      <p className="v2-cap v2-sx-cap" id="sx-guide">The guide</p>
      <ul aria-labelledby="sx-guide">{shown.map(chapter)}</ul>
      <Fold label={`All ${chapters.length} chapters`} open={chaptersOpen} onToggle={() => setAllChapters(o => !o)}>
        <ul aria-label="The other chapters">{rest.map(chapter)}</ul>
      </Fold>
    </>
  );
}
