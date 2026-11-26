// Tabs (board 00 / 01 / 04): a real tablist. role=tablist / tab / tabpanel, aria-selected, one tab stop (the selected tab),
// arrows move and select, Home and End jump (tabsNav.ts). A tab can carry a count chip: "Findings 18", "New 3" in red.
//
// Motion (F3): one line slides between the tabs (it is positioned from the active tab's size, so it follows a count that grows or a row
// that wraps); the panel that comes in fades in over 120 ms; and the panel area holds the old content's height until the new content has
// laid out, then eases to its height, so what is below doesn't jump. A small change snaps. Reduced motion: the line moves at once, no fade, no hold.
import { createContext, useContext, useEffect, useId, useLayoutEffect, useRef, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import { Count } from "./Count";
import { holdMs, holdPlan, prefersReducedMotion } from "./motion";
import { nextTabIndex } from "./tabsNav";
import { useSlideIndicator } from "./useMotion";
import { useTabScroll } from "./useTabScroll";

export interface TabItem {
  id: string;
  label: string;
  count?: number | string;
  countTone?: "neutral" | "hot" | "unusual";
  /** Read after the count ("alerts to review"). */
  countLabel?: string;
}
interface Ctx { base: string; value: string; /** counts the tab switches; 0 until the first one */ epoch: number }
const TabsCtx = createContext<Ctx | null>(null);

export interface TabsProps {
  tabs: TabItem[];
  value: string;
  onChange: (id: string) => void;
  /** Names the tab row for assistive technology ("Status"). */
  label: string;
  /** Beside the tabs, on the same rule: filters (a Team select) and the like. */
  trailing?: ReactNode;
  /** The panels. */
  children?: ReactNode;
  className?: string;
}

export function Tabs({ tabs, value, onChange, label, trailing, children, className }: TabsProps) {
  const base = useId();
  const list = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const slide = useSlideIndicator(list, '[role="tab"][aria-selected="true"]', "bottom", 2, value);
  const hold = usePanelHold(body, value);
  const edges = useTabScroll(list, value);
  const current = Math.max(0, tabs.findIndex(t => t.id === value));
  const key = (e: KeyboardEvent<HTMLDivElement>) => {
    const i = nextTabIndex(e.key, current, tabs.length);
    if (i === null) return;
    e.preventDefault();
    onChange(tabs[i].id);
    list.current?.querySelectorAll<HTMLElement>('[role="tab"]')[i]?.focus();
  };
  return (
    <TabsCtx.Provider value={{ base, value, epoch: hold.epoch }}>
      <div className={`v2-tabs${className ? ` ${className}` : ""}`}>
        <div className="v2-tabs__bar">
          <div className="v2-tabs__list" role="tablist" aria-label={label} ref={list} onKeyDown={key} data-more-start={edges.start || undefined} data-more-end={edges.end || undefined}>
            {tabs.map((t, i) => (
              <button key={t.id} type="button" role="tab" id={`${base}-tab-${t.id}`} className="v2-tab" aria-selected={t.id === value}
                aria-controls={`${base}-panel-${t.id}`} tabIndex={i === current ? 0 : -1} onClick={() => onChange(t.id)}>
                <span className="v2-tab__t" data-label={t.label}>{t.label}</span>
                {t.count != null && <Count n={t.count} tone={t.countTone} label={t.countLabel} />}
              </button>
            ))}
            {slide && <span className={`v2-tabs__ind${slide.animate ? " is-anim" : ""}`} aria-hidden="true"
              style={{ width: slide.box.w, transform: `translate(${slide.box.x}px, ${slide.box.y}px)` }} />}
          </div>
          {trailing != null && <><span className="v2-tabs__gap" />{trailing}</>}
        </div>
        <div className="v2-tabs__body" ref={body}>{children}</div>
      </div>
    </TabsCtx.Provider>
  );
}

/** Holds the panel area at the old height while a new tab's content comes in, then eases to the new height. Returns how many switches
 *  there have been, so the incoming panel knows to fade in (and the first paint doesn't). */
function usePanelHold(body: RefObject<HTMLDivElement | null>, value: string): { epoch: number } {
  const prevValue = useRef(value);
  const epoch = useRef(0);
  if (prevValue.current !== value) { prevValue.current = value; epoch.current += 1; }
  const last = useRef(0);          // the area's height as last laid out
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const settled = useRef(epoch.current);
  useEffect(() => {
    const el = body.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => { last.current = el.offsetHeight; });
    ro.observe(el);
    last.current = el.offsetHeight;
    return () => { ro.disconnect(); clearTimeout(timer.current); };
  }, [body]);
  useLayoutEffect(() => {
    if (settled.current === epoch.current) return;   // not a tab switch (first paint, or other content changed)
    settled.current = epoch.current;
    const el = body.current;
    if (!el) return;
    const mid = timer.current !== undefined;         // switching again while the last switch is still easing
    const prev = mid ? el.getBoundingClientRect().height : last.current;
    clearTimeout(timer.current); timer.current = undefined;
    el.style.transition = "none"; el.style.height = ""; el.style.overflow = "";
    const next = el.offsetHeight;                    // the new content, at its own height
    if (holdPlan(prev, next, prefersReducedMotion()) === "none") { el.style.transition = ""; return; }
    el.style.height = `${prev}px`; el.style.overflow = "clip";
    void el.offsetHeight;                            // lay out at the old height, then move
    const ms = holdMs(prev, next);
    requestAnimationFrame(() => {
      el.style.transition = `height ${ms}ms var(--v2-ease)`;
      el.style.height = `${next}px`;
    });
    timer.current = setTimeout(() => { el.style.transition = ""; el.style.height = ""; el.style.overflow = ""; timer.current = undefined; }, ms + 60);
  }, [value, body]);
  return { epoch: epoch.current };
}

/** The panel for one tab. Only the selected one is on the page unless `keepMounted`. On a tab switch it fades in (120 ms). */
export function TabPanel({ id, children, keepMounted = false, className }: { id: string; children: ReactNode; keepMounted?: boolean; className?: string }) {
  const ctx = useContext(TabsCtx);
  if (!ctx) throw new Error("TabPanel belongs inside Tabs");
  const on = ctx.value === id;
  const el = useRef<HTMLDivElement>(null);
  const epoch = ctx.epoch;
  useEffect(() => {
    if (!on || epoch === 0 || prefersReducedMotion() || !el.current?.animate) return;
    const a = el.current.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 120, easing: "cubic-bezier(.2,.7,.2,1)" });
    return () => a.cancel();
  }, [on, epoch]);
  if (!on && !keepMounted) return null;
  return <div ref={el} role="tabpanel" id={`${ctx.base}-panel-${id}`} aria-labelledby={`${ctx.base}-tab-${id}`} hidden={!on} className={className}>{children}</div>;
}
