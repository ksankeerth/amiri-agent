// Go to (⌘K / Ctrl+K): a jump list, not a search. No endpoint searches: it matches page names and the lists the app
// already has (open events, monitors, market series, products), fetched once with the lists' own calls and kept for
// a minute. The footer says so.
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Icon } from "../Icon";
import { useExitGhost } from "./useMotion";
import { INTENT_MS, prefetchRoute } from "./usePrefetch";
import { investigationApi } from "../../api/investigation";
import { inst as instApi } from "../../api/institutions";
import { monitorsApi } from "../../api/monitors";
import { seriesApi } from "../../api/series";
import type { NavItem } from "./nav";

/** `found`: a selector for the item on the page it leads to (a row, the event's heading), scrolled to and tinted when the page opens. */
interface Entry { key: string; label: string; to: string; extra?: string; mark?: { glyph: string; word: string }; found?: string }
interface Lists { events: Entry[]; monitors: Entry[]; series: Entry[]; products: Entry[]; failed: string[] }
const EMPTY: Lists = { events: [], monitors: [], series: [], products: [], failed: [] };

const TONE_MARK: Record<string, { glyph: string; word: string }> = {
  bad: { glyph: "▲", word: "Bad for you" }, mixed: { glyph: "◆", word: "Mixed" }, good: { glyph: "▼", word: "Good for you" },
};

let cache: { at: number; key: string; lists: Lists } | null = null;

async function load(institutionId: string | null): Promise<Lists> {
  const key = institutionId ?? "";
  if (cache && cache.key === key && Date.now() - cache.at < 60_000) return cache.lists;
  const [ev, mo, se, pr] = await Promise.allSettled([
    investigationApi.events(),
    monitorsApi.list(institutionId ?? undefined),
    seriesApi.list(),
    institutionId ? instApi.profile(institutionId) : Promise.resolve(null),
  ]);
  const failed: string[] = [];
  const got = <T,>(r: PromiseSettledResult<T>, name: string): T | null => { if (r.status === "fulfilled") return r.value; failed.push(name); return null; };
  const events = got(ev, "events"), monitors = got(mo, "monitors"), series = got(se, "market series"), profile = got(pr, "products");
  const lists: Lists = {
    events: (events ?? []).filter(e => e.world === "live" && e.status === "open")
      .map(e => ({ key: `e-${e.event_id}`, label: e.title, to: `/events/${encodeURIComponent(e.event_id)}`, mark: TONE_MARK[e.tone], found: "h1.v2-ev-h1" })),
    monitors: (monitors ?? []).filter(m => m.status !== "retired").map(m => ({ key: `m-${m.monitor_id}`, label: m.name, to: `/monitors/${encodeURIComponent(m.monitor_id)}`, found: `[id="mn-row-${m.monitor_id}"]` })),
    series: (series ?? []).map(s => ({ key: `s-${s.series_id}`, label: s.name, extra: s.symbol, to: `/series/${encodeURIComponent(s.series_id)}`, found: `[id="sr-row-${s.series_id}"]` })),
    products: (profile?.sections.products ?? []).filter(p => typeof p.name === "string" && p.name).map(p => ({ key: `p-${p.id}`, label: p.name as string, to: "/institution/products", found: `[id="in-row-${p.id}"]` })),
    failed,
  };
  if (!failed.length) cache = { at: Date.now(), key, lists };
  return lists;
}

/** Bold the part that matched. */
function Hit({ text, q }: { text: string; q: string }): ReactNode {
  const i = q ? text.toLowerCase().indexOf(q) : -1;
  if (i < 0) return text;
  return <>{text.slice(0, i)}<b>{text.slice(i, i + q.length)}</b>{text.slice(i + q.length)}</>;
}

const rank = (label: string, q: string) => { const i = label.toLowerCase().indexOf(q); return i < 0 ? -1 : /\W/.test(label[i - 1] ?? " ") ? i : i + 1000; };
function pick(list: Entry[], q: string, max: number): Entry[] {
  if (!q) return list.slice(0, max);
  return list.map(e => ({ e, r: Math.max(rank(e.label, q), e.extra ? rank(e.extra, q) : -1) })).filter(x => x.r >= 0)
    .sort((a, b) => a.r - b.r).slice(0, max).map(x => x.e);
}

export interface GoToProps {
  pages: NavItem[];  // the menu's pages for this role
  institutionId: string | null;
  admin: boolean;  // the Platform Admin's Overview asks for more (for prefetch)
  onClose: (restoreFocus: boolean) => void;
  onGo: (to: string, found?: string | null) => void;
}

export function GoTo({ pages, institutionId, admin, onClose, onGo }: GoToProps) {
  const uid = useId();
  const listId = `${uid}-list`, titleId = `${uid}-title`;
  const [q, setQ] = useState("");
  const [lists, setLists] = useState<Lists>(cache?.lists ?? EMPTY);
  const [loading, setLoading] = useState(!cache);
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const scrim = useRef<HTMLDivElement>(null);
  useExitGhost(scrim);   // F3: on close the box fades out for 120 ms (a copy of it; the page is usable at once)
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => { input.current?.focus(); }, []);
  useEffect(() => {
    let live = true;
    load(institutionId).then(l => { if (live) { setLists(l); setLoading(false); } });
    return () => { live = false; };
  }, [institutionId]);

  const needle = q.trim().toLowerCase();
  const groups = useMemo(() => {
    const pageEntries: Entry[] = pages.map(([, label, to]) => ({ key: `p-${to}`, label, to }));
    const g: { id: string; title: string; items: Entry[]; none?: string }[] = [];
    const add = (id: string, title: string, items: Entry[]) => { if (items.length) g.push({ id, title, items }); };
    add("events", "Open events", pick(lists.events, needle, needle ? 5 : 4));
    if (needle) {
      add("monitors", "Monitors", pick(lists.monitors, needle, 5));
      add("series", "Market series", pick(lists.series, needle, 5));
      add("products", "Products", pick(lists.products, needle, 5));
    }
    const pg = pick(pageEntries, needle, 8);
    g.push({ id: "pages", title: "Pages", items: pg, none: "No page matches" });
    return g;
  }, [lists, needle, pages]);
  const flat = useMemo(() => groups.flatMap(g => g.items), [groups]);
  useEffect(() => setActive(0), [needle]);
  // the highlighted result's page starts loading while it is highlighted (after a short rest, so arrowing past it asks for nothing)
  const target = flat[active]?.to;
  useEffect(() => {
    if (!target) return;
    const t = setTimeout(() => prefetchRoute(target, { admin, institutionId }), INTENT_MS);
    return () => clearTimeout(t);
  }, [target, admin, institutionId]);
  useEffect(() => { listRef.current?.querySelector(`#${CSS.escape(`${uid}-o${active}`)}`)?.scrollIntoView({ block: "nearest" }); }, [active, uid]);

  const key = (e: KeyboardEvent) => {
    if (e.key === "Escape") { e.preventDefault(); onClose(true); }
    else if (e.key === "ArrowDown") { e.preventDefault(); if (flat.length) setActive(a => (a + 1) % flat.length); }
    else if (e.key === "ArrowUp") { e.preventDefault(); if (flat.length) setActive(a => (a - 1 + flat.length) % flat.length); }
    else if (e.key === "Enter") { e.preventDefault(); const t = flat[active]; if (t) onGo(t.to, t.found); }
    else if (e.key === "Tab") e.preventDefault();  // the input is the only stop in the box; Esc leaves it
  };

  let n = -1;
  return (
    <div className="v2-goto-scrim" ref={scrim} onMouseDown={e => { if (e.target === e.currentTarget) onClose(true); }}>
      <div className="v2-goto" role="dialog" aria-modal="true" aria-labelledby={titleId} onKeyDown={key}>
        <h2 id={titleId} className="v2-sr">Go to</h2>
        <div className="v2-goto__bar">
          <Icon name="search" />
          <input ref={input} className="v2-goto__input" role="combobox" aria-expanded="true" aria-controls={listId} aria-autocomplete="list"
            aria-activedescendant={flat.length ? `${uid}-o${active}` : undefined} aria-label="Go to a page, event or series"
            placeholder="Go to a page, event or series" value={q} onChange={e => setQ(e.target.value)} autoComplete="off" spellCheck={false} />
          <button type="button" className="v2-goto__esc" onClick={() => onClose(true)} aria-label="Close Go to">esc</button>
        </div>
        <div className="v2-goto__list" role="listbox" id={listId} aria-label="Results" ref={listRef}>
          {groups.map(g => (
            <div key={g.id} role="group" aria-labelledby={`${uid}-g-${g.id}`}>
              <div className="v2-cap v2-goto__cap" id={`${uid}-g-${g.id}`}>{g.title}</div>
              {g.items.length === 0 && g.none && <div className="v2-goto__none">{g.none}</div>}
              {g.items.map(it => {
                const i = ++n;
                return (
                  <div key={it.key} id={`${uid}-o${i}`} role="option" aria-selected={i === active} className={`v2-goto__opt${i === active ? " is-active" : ""}`}
                    onMouseMove={() => active !== i && setActive(i)} onMouseDown={e => e.preventDefault()} onClick={() => onGo(it.to, it.found)}>
                    {g.id === "events" && <span aria-hidden="true" className="v2-goto__mark">{it.mark?.glyph}</span>}
                    {it.mark && <span className="v2-sr">{it.mark.word}: </span>}
                    <span className="v2-goto__label"><Hit text={it.label} q={needle} /></span>
                    {it.extra && <span className="v2-mono v2-goto__extra"><Hit text={it.extra} q={needle} /></span>}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
        <div className="v2-sr" role="status">{loading ? "Loading lists" : `${flat.length} ${flat.length === 1 ? "result" : "results"}`}</div>
        <div className="v2-goto__foot">
          Searches page names and what's already loaded: open events, monitors, series, products
          {lists.failed.length > 0 && <> (couldn't load: {lists.failed.join(", ")})</>}
        </div>
      </div>
    </div>
  );
}
