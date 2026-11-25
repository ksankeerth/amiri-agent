// The app shell: sidebar (brand, Live pill, menu, user and role switch), top bar (breadcrumbs, Go to, date and time,
// theme), and the main area. Under 720 px the sidebar becomes a top bar (logo, Live pill, Menu) and the menu opens as
// a sheet (A8). A skip link comes first (A12).
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode, type Ref } from "react";
import { Link, NavLink, useLocation, useNavigate } from "react-router-dom";
import { ME } from "../../api/client";
import { alertsApi, type AlertSummary } from "../../api/alerts";
import { OVERVIEW_EVENT, overviewApi, type Overview } from "../../api/overview";
import { clockText, TIME_ZONE, zoneName } from "../../format";
import { cap } from "../../plain";
import type { Installation } from "../../App";
import { Icon } from "../Icon";
import { DemoLockCtx, LockTip } from "../lock";
import { LOCK_TIP } from "../demoLock";
import { isDown, useNow, useRole } from "../ui";
import { GoTo } from "./GoTo";
import { LivePill, liveState } from "./LivePill";
import { GROUPS, navFor, pageOf } from "./nav";
import "../../styles/v2/shell.css";

// ---------------------------------------------------------------- breadcrumbs
export interface Crumb { label: string; to?: string }
const CrumbCtx = createContext<(c: Crumb[] | null) => void>(() => {});
/** A page sets its breadcrumbs (the last one is the page itself). Without this the bar shows the page's menu name. */
export function useCrumbs(crumbs: Crumb[] | null) {
  const set = useContext(CrumbCtx);
  const key = JSON.stringify(crumbs);
  useEffect(() => { set(crumbs); return () => set(null); }, [key]);  // eslint-disable-line react-hooks/exhaustive-deps
}

// ---------------------------------------------------------------- small hooks
function useTheme() {
  const [theme, setTheme] = useState<string | null>(() => { try { return localStorage.getItem("amiri.theme"); } catch { return null; } });
  useEffect(() => {
    if (theme) document.documentElement.dataset.theme = theme; else delete document.documentElement.dataset.theme;
  }, [theme]);
  const dark = theme ? theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
  const toggle = () => {
    const next = dark ? "light" : "dark";
    setTheme(next);
    try { localStorage.setItem("amiri.theme", next); } catch { /* private mode */ }
  };
  return { dark, toggle };
}

const PHONE = "(max-width: 719.98px)";
export function usePhone() {
  const [phone, setPhone] = useState(() => matchMedia(PHONE).matches);
  useEffect(() => {
    const m = matchMedia(PHONE), f = () => setPhone(m.matches);
    m.addEventListener("change", f);
    return () => m.removeEventListener("change", f);
  }, []);
  return phone;
}

/** Each page's heading becomes the tab title; after a navigation focus moves to the page and a screen reader
 *  hears where it is (a single-page app does neither by itself). */
function useRouteA11y(): string {
  const { pathname, hash } = useLocation();
  const first = useRef(true);
  const [said, setSaid] = useState("");
  useEffect(() => {
    const name = () => {
      if (pathname === "/home") return "Overview";
      const h = document.querySelector("main h1")?.cloneNode(true) as HTMLElement | undefined;  // the heading without its badges
      h?.querySelectorAll(".badge").forEach(b => b.remove());
      return (h?.textContent ?? "").replace(/\s+/g, " ").trim();
    };
    // a table wider than its box scrolls sideways: it must be reachable and named for keyboard users
    const scrollers = () => document.querySelectorAll<HTMLElement>(".tblwrap").forEach(el => {
      if (el.scrollWidth > el.clientWidth) { el.tabIndex = 0; el.setAttribute("role", "region"); el.setAttribute("aria-label", "Table (scrolls sideways)"); }
    });
    const set = () => { const n = name(); document.title = n ? `${n} · Amiri Agent` : "Amiri Agent"; return n; };
    const t1 = setTimeout(() => {
      const n = set();
      if (first.current) { first.current = false; return; }
      setSaid(n);
      const m = document.querySelector<HTMLElement>("main");
      if (m) { if (!hash) m.scrollTop = 0; m.focus({ preventScroll: true }); }  // a #link: the page scrolls to it itself
    }, 250);
    const t2 = setTimeout(() => { set(); scrollers(); }, 1500);  // headings that wait for data (an event's or a monitor's name)
    const t3 = setTimeout(scrollers, 4000);
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
  }, [pathname]);  // eslint-disable-line react-hooks/exhaustive-deps
  return said;
}

/** What the Live pill and the menu counts say: the one Overview call the Overview page makes, once a minute. */
function useOverview() {
  const [ov, setOv] = useState<Overview | null>(null);
  const [down, setDown] = useState(false);
  useEffect(() => {
    let last = 0;  // when it last asked, or an answer came in from the Overview page
    const got = (x: Overview) => { last = Date.now(); setOv(x); setDown(false); };
    const load = () => { last = Date.now(); overviewApi.get().catch(e => setDown(isDown(e))); };  // the answer comes back through the event
    // the Overview page already asks every minute: take its answer rather than ask a second time
    const heard = (e: Event) => got((e as CustomEvent<Overview>).detail);
    window.addEventListener(OVERVIEW_EVENT, heard);
    window.addEventListener("amiri:installation", load);  // "Try again" on a page checks again here too
    // ask only when nothing has come in for over a minute: on the Overview page its own minute's answer always has
    // (looking every 10 s, not every 60, so the two timers can't line up and both ask)
    const t = setInterval(() => { if (Date.now() - last > 65_000) load(); }, 10_000);
    load();
    return () => { clearInterval(t); window.removeEventListener("amiri:installation", load); window.removeEventListener(OVERVIEW_EVENT, heard); };
  }, []);
  return { ov, down };
}

function useAlertSummary() {
  const [alerts, setAlerts] = useState<AlertSummary | null>(null);
  useEffect(() => {  // the menu badge: alerts to review
    const load = () => alertsApi.summary().then(setAlerts).catch(() => {});
    load(); const t = setInterval(load, 60_000);
    window.addEventListener("amiri:alerts", load);
    return () => { clearInterval(t); window.removeEventListener("amiri:alerts", load); };
  }, []);
  return alerts;
}

// ---------------------------------------------------------------- the shell
const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
const focusables = (root: HTMLElement) => [...root.querySelectorAll<HTMLElement>("a[href], button:not([disabled]), input:not([disabled])")].filter(e => e.offsetParent !== null);

export function Shell({ inst, children }: { inst: Installation; children: ReactNode }) {
  const { role, setRole } = useRole();
  const { dark, toggle: toggleTheme } = useTheme();
  const now = useNow(30_000);
  const said = useRouteA11y();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const phone = usePhone();
  const { ov, down } = useOverview();
  const alerts = useAlertSummary();
  const live = liveState(ov, now, down);
  const pages = navFor(role);
  const locked = inst.demo_lock === true;

  // an admin page is the Platform Admin's: show its menu, so the page is selected in it
  useEffect(() => { if (pathname.startsWith("/admin/") && role !== "platform_admin") setRole("platform_admin"); }, [pathname]);  // eslint-disable-line react-hooks/exhaustive-deps

  // breadcrumbs: what the page set, else its menu name
  const [custom, setCustom] = useState<Crumb[] | null>(null);
  const setCrumbs = useCallback((c: Crumb[] | null) => setCustom(c), []);
  const page = pageOf(pathname);
  const crumbs: Crumb[] = custom ?? [...(role === "platform_admin" && page ? [{ label: "Platform admin" }] : []), { label: page?.[1] ?? "Not found" }];

  // the phone's menu sheet
  const [menu, setMenu] = useState(false);
  const sheet = phone && menu;
  const side = useRef<HTMLDivElement>(null), menuBtn = useRef<HTMLButtonElement>(null), closeBtn = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);
  useEffect(() => setMenu(false), [pathname]);
  useEffect(() => { if (!phone) setMenu(false); }, [phone]);
  useEffect(() => {
    if (sheet) { wasOpen.current = true; closeBtn.current?.focus(); }
    else if (wasOpen.current) { wasOpen.current = false; menuBtn.current?.focus(); }
  }, [sheet]);
  useEffect(() => {
    if (!sheet) return;
    const k = (e: KeyboardEvent) => {
      if (e.key === "Escape") { setMenu(false); return; }
      if (e.key !== "Tab" || !side.current) return;
      const f = focusables(side.current);
      if (!f.length) return;
      const [a, z] = [f[0], f[f.length - 1]], cur = document.activeElement;
      if (!side.current.contains(cur)) { e.preventDefault(); a.focus(); }
      else if (e.shiftKey && cur === a) { e.preventDefault(); z.focus(); }
      else if (!e.shiftKey && cur === z) { e.preventDefault(); a.focus(); }
    };
    document.addEventListener("keydown", k);
    return () => document.removeEventListener("keydown", k);
  }, [sheet]);

  // Go to
  const [goOpen, setGoOpen] = useState(false);
  const opener = useRef<HTMLElement | null>(null), topGo = useRef<HTMLButtonElement>(null);
  const openGo = useCallback(() => { opener.current = document.activeElement as HTMLElement | null; setMenu(false); setGoOpen(true); }, []);
  const closeGo = useCallback((restore: boolean) => {
    setGoOpen(false);
    if (!restore) return;
    const o = opener.current;
    // on a phone the opener may be inside the closed sheet: go back to the Menu button instead
    const usable = o && o !== document.body && o.isConnected && !(phone && side.current?.contains(o));
    const target = usable ? o : phone ? menuBtn.current : topGo.current;
    setTimeout(() => target?.focus(), 0);
  }, [phone]);
  const go = useCallback((to: string) => {
    closeGo(false);
    navigate(to);
    setTimeout(() => document.getElementById("main")?.focus({ preventScroll: true }), 0);
  }, [closeGo, navigate]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === "k") { e.preventDefault(); if (goOpen) closeGo(true); else openGo(); }
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [goOpen, openGo, closeGo]);

  const clock = `${clockText(now.toISOString(), TIME_ZONE)} ${zoneName(TIME_ZONE, now)}`;
  const instName = inst.name ?? (inst.unreachable ? "" : "No institution yet");
  const roleName = role === "risk_manager" ? "Risk Manager" : "Platform Admin";
  const count = (to: string) => {
    if (to === "/alerts" && alerts?.to_review) return { n: alerts.to_review, hot: true, sr: alerts.to_review === 1 ? "alert to review" : "alerts to review" };
    if (to === "/events" && ov?.counts?.open_events) return { n: ov.counts.open_events, hot: false, sr: ov.counts.open_events === 1 ? "open event" : "open events" };
    return null;
  };
  const themeLabel = dark ? "Switch to light theme" : "Switch to dark theme";
  const themeBtn = (
    <button type="button" className="v2-iconbtn" aria-label={themeLabel} onClick={toggleTheme}><Icon name={dark ? "sun" : "moon"} /></button>
  );
  const goBtn = (ref?: Ref<HTMLButtonElement>) => (
    <button ref={ref} type="button" className="v2-gobtn" aria-haspopup="dialog" onClick={openGo}>
      <Icon name="search" /><span className="v2-gobtn__t">Go to a page, event or series</span>
      <kbd className="v2-mono v2-gobtn__k" aria-hidden="true">{isMac ? "⌘K" : "Ctrl K"}</kbd>
      <span className="v2-sr">, shortcut {isMac ? "Command K" : "Control K"}</span>
    </button>
  );

  const groups: [string, typeof pages][] = role === "risk_manager"
    ? GROUPS.map(([g, paths]) => [g, paths.flatMap(to => pages.filter(n => n[2] === to))] as [string, typeof pages])
    : [["Platform admin", pages]];

  return (
    <DemoLockCtx.Provider value={locked}>
      <CrumbCtx.Provider value={setCrumbs}>
        <div className="v2 v2-shell">
          <a className="v2-skip" href="#main" onClick={e => { e.preventDefault(); document.getElementById("main")?.focus(); }}>Skip to content</a>
          <LockTip />
          <div className="v2-sr" role="status" aria-live="polite">{said}</div>

          <header className="v2-mbar" inert={sheet}>
            <Link className="v2-mbar__logo" to="/home" aria-label="Amiri Agent home"><span className="v2-logo" aria-hidden="true">A</span></Link>
            <LivePill live={live} compact />
            <button ref={menuBtn} type="button" className="v2-menubtn" aria-expanded={sheet} aria-controls="v2-side" onClick={() => setMenu(m => !m)}>
              <Icon name="menu" />Menu
            </button>
          </header>

          {sheet && <div className="v2-sheet-scrim" onClick={() => setMenu(false)} aria-hidden="true" />}
          <div ref={side} className="v2-side" id="v2-side" data-open={sheet}
            {...(sheet ? { role: "dialog", "aria-modal": true, "aria-label": "Menu" } : {})}>
            <div className="v2-side__sheethead">
              <span className="v2-cap">Menu</span>
              <button ref={closeBtn} type="button" className="v2-iconbtn" aria-label="Close menu" onClick={() => setMenu(false)}><Icon name="x" /></button>
            </div>
            <Link className="v2-brand" to="/home">
              <span className="v2-logo" aria-hidden="true">A</span>
              <span className="v2-brand__t"><b>Amiri Agent</b><span>{instName}</span></span>
            </Link>
            <div className="v2-status">
              <LivePill live={live} />
              {locked && <>
                <p className="v2-demo" title={LOCK_TIP} aria-describedby="v2-demo-why">Demo · read-only</p>
                <span id="v2-demo-why" className="v2-sr">{LOCK_TIP}</span>
              </>}
            </div>
            <div className="v2-side__tools">{goBtn()}{themeBtn}</div>
            <nav className="v2-nav" aria-label="Main">
              {groups.map(([group, items]) => items.length === 0 ? null : (
                <div key={group} className="v2-nav__g">
                  <div className="v2-cap v2-nav__cap" id={`v2g-${group.replace(/\W+/g, "")}`}>{group}</div>
                  <ul aria-labelledby={`v2g-${group.replace(/\W+/g, "")}`}>
                    {items.map(([icon, label, to]) => {
                      const c = count(to);
                      return (
                        <li key={to}>
                          <NavLink to={to} className="v2-nav__a">
                            <Icon name={icon} /><span>{label}</span>
                            {c && <span className={`v2-count${c.hot ? " is-hot" : ""}`}>{c.n}<span className="v2-sr"> {c.sr}</span></span>}
                          </NavLink>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </nav>
            <div className="v2-side__foot">
              <div className="v2-user" title={ME}>
                <span className="v2-avatar" aria-hidden="true">{ME[0].toUpperCase()}</span>
                <div><b>{cap(ME.split("@")[0])}</b><div>{roleName}</div></div>
              </div>
              <div className="v2-seg" role="group" aria-label="View as">
                <button type="button" aria-pressed={role === "risk_manager"} onClick={() => setRole("risk_manager")}>Risk Manager</button>
                <button type="button" aria-pressed={role === "platform_admin"} onClick={() => setRole("platform_admin")}>Platform Admin</button>
              </div>
            </div>
          </div>

          <div className="v2-col" inert={sheet}>
            <header className="v2-top">
              <nav className="v2-crumbs" aria-label="Breadcrumb">
                <ol>
                  {crumbs.map((c, i) => (
                    <li key={i}>
                      {i > 0 && <span className="v2-crumbs__sep" aria-hidden="true">/</span>}
                      {c.to && i < crumbs.length - 1 ? <Link to={c.to}>{c.label}</Link>
                        : <span aria-current={i === crumbs.length - 1 ? "page" : undefined}>{c.label}</span>}
                    </li>
                  ))}
                </ol>
              </nav>
              {goBtn(topGo)}
              <span className="v2-clock">{clock}</span>
              {themeBtn}
            </header>
            <main className="v2-main" id="main" tabIndex={-1}>{children}</main>
          </div>

          {goOpen && <GoTo pages={pages} institutionId={inst.profile ? inst.institution_id : null} onClose={closeGo} onGo={go} />}
        </div>
      </CrumbCtx.Provider>
    </DemoLockCtx.Provider>
  );
}
