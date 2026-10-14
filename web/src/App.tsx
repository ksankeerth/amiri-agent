import { useEffect, useRef, useState } from "react";
import { Link, Navigate, NavLink, Route, Routes, useLocation } from "react-router-dom";
import { Icon } from "./components/Icon";
import { Empty, PageHead, PageSkeleton, useNow, useRole, type Role } from "./components/ui";
import { api, ME } from "./api/client";
import { fullNow, setZone, ZONE_LABEL } from "./format";
import { InstitutionPage, NewInstitutionPage } from "./pages/institution/InstitutionPage";
import { SetupWizard } from "./pages/institution/SetupWizard";
import { EventDetailPage } from "./pages/events/EventDetail";
import { EventsPage } from "./pages/events/Events";
import { MonitorPage } from "./pages/monitors/MonitorPage";
import { MonitorsPage } from "./pages/monitors/Monitors";
import { ScenarioPage, StudioPage } from "./pages/studio/Studio";
import { StudioRunPage } from "./pages/studio/StudioRun";
import { SeriesDetail } from "./pages/SeriesDetail";
import { SeriesList } from "./pages/SeriesList";
import { OverviewPage } from "./pages/Overview";
import { RadarPage } from "./pages/radar/Radar";
import { LoginPage } from "./pages/Login";
import { authApi, type AuthConfig } from "./api/auth";
import { AlertsPage } from "./pages/Alerts";
import { alertsApi, type AlertSummary } from "./api/alerts";

// The menu follows the day: what needs me, what Amiri Agent watches, who I am, and the what-if tool.
const GROUPS: [string, string[]][] = [
  ["Today", ["/home", "/alerts"]],
  ["What Amiri Agent watches", ["/events", "/radar", "/monitors", "/series"]],
  ["Your institution", ["/institution"]],
  ["Try it", ["/studio"]],
];

const NAV: Record<Role, [string, string, string][]> = {
  risk_manager: [
    ["home", "Overview", "/home"], ["alert", "Alerts", "/alerts"], ["events", "Events", "/events"],
    ["radar", "Radar", "/radar"], ["monitor", "Monitors", "/monitors"], ["series", "Market series", "/series"],
    ["bank", "Institution", "/institution"], ["studio", "Scenario Studio", "/studio"],
  ],
  platform_admin: [
    ["health", "Health", "/admin/health"], ["usage", "Usage", "/admin/usage"], ["cost", "Costs", "/admin/costs"],
    ["data", "Data connections", "/admin/data"], ["series", "Market series", "/series"], ["bank", "Institution", "/institution"],
    ["jobs", "Schedules and queues", "/admin/jobs"], ["studio", "Scenario Studio", "/studio"],
    ["users", "Users and roles", "/admin/users"], ["audit", "Audit log", "/admin/audit"], ["settings", "Settings", "/admin/settings"],
  ],
};
export interface Installation {
  institution_id: string; profile: boolean; name: string | null; short_name?: string | null; home_country?: string;
  country_name?: string | null; base_currency?: string; time_zone: string; notes: string[];
}

const BUILT = new Set(["/home", "/events", "/radar", "/monitors", "/series", "/studio", "/alerts", "/institution"]);

function useTheme() {
  const [theme, setTheme] = useState<string | null>(() => { try { return localStorage.getItem("amiri.theme"); } catch { return null; } });
  useEffect(() => {
    if (theme) document.documentElement.dataset.theme = theme; else delete document.documentElement.dataset.theme;
  }, [theme]);
  const toggle = () => {
    const dark = theme ? theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
    const next = dark ? "light" : "dark";
    setTheme(next);
    try { localStorage.setItem("amiri.theme", next); } catch { /* private mode */ }
  };
  return toggle;
}

/** Each page's heading becomes the tab title; after a navigation focus moves to the page and a screen reader
 *  hears where it is (a single-page app does neither by itself). */
function useRouteA11y(): string {
  const { pathname } = useLocation();
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
      if (m) { m.scrollTop = 0; m.focus({ preventScroll: true }); }
    }, 250);
    const t2 = setTimeout(() => { set(); scrollers(); }, 1500);  // headings that wait for data (an event's or a monitor's name)
    const t3 = setTimeout(scrollers, 4000);
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
  }, [pathname]);
  return said;
}

function NotBuilt({ title }: { title: string }) {
  return (
    <div className="page">
      <PageHead title={title} />
      <div className="card"><Empty icon="info" title="This page isn't available" actions={<Link className="btn" to="/home">Go to the Overview</Link>}>
        It may have moved, or it isn't part of this version.
      </Empty></div>
    </div>
  );
}

export function App() {
  // first: is this browser allowed in? (AUTH_MODE=off: always)
  const [gate, setGate] = useState<{ cfg: AuthConfig; signedIn: boolean } | null>(null);
  useEffect(() => {
    Promise.all([authApi.config(), authApi.me()])
      .then(([cfg, me]) => setGate({ cfg, signedIn: me.signed_in }))
      .catch(() => setGate({ cfg: { mode: "off", recaptcha_site_key: null, access_code: false, google: false }, signedIn: true }));
    const out = () => setGate(g => (g ? { ...g, signedIn: false } : g));
    window.addEventListener("amiri:signed-out", out);
    return () => window.removeEventListener("amiri:signed-out", out);
  }, []);
  if (!gate) return <PageSkeleton />;
  if (!gate.signedIn) return <LoginPage cfg={gate.cfg} />;
  return <Installed auth={gate.cfg.mode !== "off"} />;
}

function Installed({ auth }: { auth: boolean }) {
  const [inst, setInst] = useState<Installation | null>(null);
  useEffect(() => {
    api<Installation>("/api/v1/installation")
      .then(i => { setZone(i.time_zone); setInst(i); })
      .catch(() => setInst({ institution_id: "", profile: false, name: null, time_zone: "UTC", notes: ["The Amiri Agent server didn't answer. Is it running?"] }));
  }, []);
  if (!inst) return <PageSkeleton />;
  return <Frame inst={inst} auth={auth} />;
}

function Frame({ inst, auth }: { inst: Installation; auth: boolean }) {
  const { role, setRole } = useRole();
  const toggleTheme = useTheme();
  const now = useNow(30_000);
  const nav = NAV[role].filter(([, , to]) => BUILT.has(to));  // a page that isn't built isn't offered
  const said = useRouteA11y();
  const [menu, setMenu] = useState(false);
  const { pathname } = useLocation();
  useEffect(() => setMenu(false), [pathname]);
  useEffect(() => {
    if (!menu) return;
    const k = (e: KeyboardEvent) => e.key === "Escape" && setMenu(false);
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [menu]);
  const [alerts, setAlerts] = useState<AlertSummary | null>(null);
  useEffect(() => {  // the menu badge: alerts to review
    const load = () => alertsApi.summary().then(setAlerts).catch(() => {});
    load(); const t = setInterval(load, 60_000);
    window.addEventListener("amiri:alerts", load);
    return () => { clearInterval(t); window.removeEventListener("amiri:alerts", load); };
  }, []);
  return (
    <div className="app">
      <a className="skip" href="#main" onClick={e => { e.preventDefault(); document.querySelector<HTMLElement>("main")?.focus(); }}>Skip to the page</a>
      <div className="sr" role="status" aria-live="polite">{said}</div>
      <header className="appbar">
        <button className="btn btn--ghost btn--icon menubtn" type="button" aria-label="Menu" aria-expanded={menu} aria-controls="sidenav"
          onClick={() => setMenu(m => !m)}><Icon name={menu ? "x" : "menu"} /></button>
        <Link className="brand" to="/home" aria-label="Amiri Agent home">
          <svg viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="7" fill="#0F3D2E" /><path d="M9.2 25 15 7h2l5.8 18h-3.1L16 13.1 12.3 25z" fill="#F1F5EC" /><rect x="15.4" y="13.5" width="1.2" height="10" fill="#F05A28" /><rect x="14.2" y="16" width="3.6" height="5.2" fill="#F05A28" /></svg>
          <b>Amiri Agent</b>
          <span className="inst">{inst.name ?? "No institution profile yet"}</span>
        </Link>
        <span className="worldpill" title={`Live world · times in ${ZONE_LABEL}`}><span className="dot" /><span className="wtxt">Live · {fullNow(now)} {ZONE_LABEL}</span></span>
        <span className="spacer" />
        <span className="seg" role="group" aria-label="View as">
          <button type="button" aria-pressed={role === "risk_manager"} onClick={() => setRole("risk_manager")}>Risk Manager</button>
          <button type="button" aria-pressed={role === "platform_admin"} onClick={() => setRole("platform_admin")}>Platform Admin</button>
        </span>
        <button className="btn btn--ghost btn--icon themebtn" type="button" aria-label="Switch between light and dark" onClick={toggleTheme}><Icon name="moon" /></button>
      </header>
      {menu && <div className="scrim" onClick={() => setMenu(false)} />}
      <div className="body">
        <aside className="side" id="sidenav" aria-label="Menu" data-open={menu}>
          <nav className="nav" aria-label="Main">
            {role === "platform_admin" && <div className="grp label">Platform</div>}
            {(role === "risk_manager" ? GROUPS : [["", nav.map(n => n[2])] as [string, string[]]]).map(([group, paths]) => {
              const items = nav.filter(n => paths.includes(n[2]));
              return items.length === 0 ? null : (
              <div key={group || "all"} className="navgroup">
                {group && <div className="grp label" id={`g-${group.replace(/\W+/g, "")}`}>{group}</div>}
            {items.map(([icon, label, to]) => (
              <NavLink key={to} to={to}>
                <Icon name={icon} /><span>{label}</span>
                {to === "/alerts" && alerts?.to_review ? <span className={`count ${alerts.by_level.warning ? "hot" : ""}`}>{alerts.to_review}<span className="sr"> to review</span></span> : null}
              </NavLink>
            ))}
              </div>);
            })}
          </nav>
          <div className="side-user" title={ME}>
            <span className="avatar" aria-hidden="true">{ME[0].toUpperCase()}</span>
            <span className="col" style={{ gap: 0, minWidth: 0 }}><b>{ME.split("@")[0][0].toUpperCase() + ME.split("@")[0].slice(1)}</b>
              <span className="small muted">{role === "risk_manager" ? "Risk Manager" : "Platform Admin"}</span></span>
            {auth && <button className="btn btn--sm btn--ghost" type="button" style={{ marginLeft: "auto" }}
              onClick={async () => { try { await authApi.logout(); } finally { window.location.assign("/home"); } }}>Sign out</button>}
          </div>
          <div className="side-foot">
            <span className="label">View as</span>
            <span className="seg" role="group" aria-label="View as">
              <button type="button" aria-pressed={role === "risk_manager"} onClick={() => setRole("risk_manager")}>Risk Manager</button>
              <button type="button" aria-pressed={role === "platform_admin"} onClick={() => setRole("platform_admin")}>Platform Admin</button>
            </span>
            <button className="btn btn--sm" type="button" onClick={toggleTheme}><Icon name="moon" />Light or dark</button>
          </div>
        </aside>
        <main className="main" id="main" tabIndex={-1}>
          {inst.notes.map(n => <div key={n} className="banner warn" style={{ margin: "16px 24px 0" }}><Icon name="warn" /><div>{n}</div></div>)}
          <Routes>
            <Route path="/" element={<Navigate to="/home" replace />} />
            <Route path="/home" element={<OverviewPage />} />
            <Route path="/radar" element={<RadarPage />} />
            <Route path="/alerts" element={<AlertsPage />} />
            <Route path="/events" element={<EventsPage />} />
            <Route path="/events/:id" element={<EventDetailPage />} />
            <Route path="/monitors" element={<MonitorsPage />} />
            <Route path="/monitors/:id" element={<MonitorPage />} />
            <Route path="/studio" element={<StudioPage />} />
            <Route path="/studio/run/:id" element={<StudioRunPage />} />
            <Route path="/studio/:id" element={<ScenarioPage />} />
            <Route path="/series" element={<SeriesList />} />
            <Route path="/series/:id" element={<SeriesDetail />} />
            <Route path="/institution" element={<InstitutionPage />} />
            <Route path="/institution/new" element={<NewInstitutionPage />} />
            <Route path="/institution/setup" element={<SetupWizard />} />
            <Route path="/institution/setup/:step" element={<SetupWizard />} />
            <Route path="/institution/:tab" element={<InstitutionPage />} />
            {[...NAV.risk_manager, ...NAV.platform_admin].filter(([, , to]) => !BUILT.has(to)).map(([, label, to]) => (
              <Route key={to} path={to} element={<NotBuilt title={label} />} />
            ))}
            <Route path="*" element={<NotBuilt title="Page not found" />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}
