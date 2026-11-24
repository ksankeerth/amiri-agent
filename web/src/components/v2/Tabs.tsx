// Tabs (board 00 / 01 / 04): a real tablist. role=tablist / tab / tabpanel, aria-selected, one tab stop (the selected tab),
// arrows move and select, Home and End jump (tabsNav.ts). A tab can carry a count chip: "Findings 18", "New 3" in red.
import { createContext, useContext, useId, useRef, type KeyboardEvent, type ReactNode } from "react";
import { Count } from "./Count";
import { nextTabIndex } from "./tabsNav";

export interface TabItem {
  id: string;
  label: string;
  count?: number | string;
  countTone?: "neutral" | "hot" | "unusual";
  /** Read after the count ("alerts to review"). */
  countLabel?: string;
}
interface Ctx { base: string; value: string }
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
  const current = Math.max(0, tabs.findIndex(t => t.id === value));
  const key = (e: KeyboardEvent<HTMLDivElement>) => {
    const i = nextTabIndex(e.key, current, tabs.length);
    if (i === null) return;
    e.preventDefault();
    onChange(tabs[i].id);
    list.current?.querySelectorAll<HTMLElement>('[role="tab"]')[i]?.focus();
  };
  return (
    <TabsCtx.Provider value={{ base, value }}>
      <div className={`v2-tabs${className ? ` ${className}` : ""}`}>
        <div className="v2-tabs__bar">
          <div className="v2-tabs__list" role="tablist" aria-label={label} ref={list} onKeyDown={key}>
            {tabs.map((t, i) => (
              <button key={t.id} type="button" role="tab" id={`${base}-tab-${t.id}`} className="v2-tab" aria-selected={t.id === value}
                aria-controls={`${base}-panel-${t.id}`} tabIndex={i === current ? 0 : -1} onClick={() => onChange(t.id)}>
                <span className="v2-tab__t" data-label={t.label}>{t.label}</span>
                {t.count != null && <Count n={t.count} tone={t.countTone} label={t.countLabel} />}
              </button>
            ))}
          </div>
          {trailing != null && <><span className="v2-tabs__gap" />{trailing}</>}
        </div>
        {children}
      </div>
    </TabsCtx.Provider>
  );
}

/** The panel for one tab. Only the selected one is on the page unless `keepMounted`. */
export function TabPanel({ id, children, keepMounted = false, className }: { id: string; children: ReactNode; keepMounted?: boolean; className?: string }) {
  const ctx = useContext(TabsCtx);
  if (!ctx) throw new Error("TabPanel belongs inside Tabs");
  const on = ctx.value === id;
  if (!on && !keepMounted) return null;
  return <div role="tabpanel" id={`${ctx.base}-panel-${id}`} aria-labelledby={`${ctx.base}-tab-${id}`} hidden={!on} className={className}>{children}</div>;
}
