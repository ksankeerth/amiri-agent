import { createContext, lazy, Suspense, useContext, useEffect, useState, type ReactNode } from "react";
import { Link, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { Icon } from "./components/Icon";
import { PageTitle } from "./components/rd";
import { PageSkeleton } from "./components/ui";
import { api } from "./api/client";
import { setZone } from "./format";
import "./styles/shell.css";  // only .btn--lg is still used (Login, Studio); the shell itself is styles/v2/shell.css
import { Shell } from "./components/v2/Shell";
import { BUILT, NAV } from "./components/v2/nav";
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
import { BotCheckPage, PausedPage } from "./pages/Login";
import { authApi, type AuthConfig } from "./api/auth";
import { AlertsPage } from "./pages/Alerts";
import { DataConnectionsPage } from "./pages/admin/DataConnections";
import { SettingsPage } from "./pages/admin/Settings";
import { FindingsPage } from "./pages/findings/Findings";
import { SpecPage } from "./pages/spec/Spec";
import { SpecPrintPage } from "./pages/spec/SpecPrint";

// The v2 component gallery: dev server only. `import.meta.env.DEV` is a constant false in the production build, so the
// import below is dropped there and /dev/v2 doesn't exist (checked by grepping dist/ for the gallery's words).
const DevGallery = import.meta.env.DEV ? lazy(() => import("./pages/dev/V2Gallery")) : null;

export interface Installation {
  institution_id: string; profile: boolean; name: string | null; short_name?: string | null; home_country?: string;
  country_name?: string | null; base_currency?: string; time_zone: string; notes: string[];
  prototype_reset?: boolean;  // the server allows the prototype reset (PROTOTYPE_RESET)
  demo_lock?: boolean;  // editing, deleting and the reset are switched off for a live demo (DEMO_LOCK)
  unreachable?: boolean;  // UI only: the server didn't answer, so whether a profile exists is unknown
}

// what this installation serves; reloaded when an institution is created (event "amiri:installation")
export const InstallationCtx = createContext<Installation | null>(null);
export const useInstallation = () => useContext(InstallationCtx);

/** Pages that need the institution say so before it exists, with the way to set it up (not a spinner or an error). */
function NeedsInstitution({ title, what, children }: { title: string; what: string; children: ReactNode }) {
  const inst = useInstallation();
  if (!inst || inst.profile || inst.unreachable) return <>{children}</>;  // unreachable: the page shows the load error
  return (
    <div className="page rd">
      <PageTitle title={title} />
      <section className="rd-sec" aria-labelledby="needs-inst">
        <div className="rd-sec-h"><h2 id="needs-inst">Set up your institution first</h2></div>
        <p className="rd-row-d rd-prose">{what} come from your institution's profile: who you are, where you operate, your customers, products and
          risks. Set it up first; it takes a few minutes with the forms or the Setup agent.</p>
        <p style={{ margin: "20px 0 0" }}><Link className="btn btn--primary" to="/institution/setup">Set up the institution</Link></p>
      </section>
    </div>
  );
}


function NotBuilt({ title }: { title: string }) {
  return (
    <div className="page rd">
      <PageTitle title={title} lede="This page isn't available. It may have moved, or it isn't part of this version." />
      <p style={{ margin: "24px 0 0" }}><Link className="btn" to="/home">Go to the Overview</Link></p>
    </div>
  );
}

export function App() {
  // first: has this browser passed the bot check? (no login; AUTH_MODE=off: no check at all)
  const [gate, setGate] = useState<{ cfg: AuthConfig; signedIn: boolean } | null>(null);
  const { pathname } = useLocation();
  useEffect(() => {
    Promise.all([authApi.config(), authApi.me()])
      .then(([cfg, me]) => setGate({ cfg, signedIn: me.signed_in }))
      .catch(() => setGate({ cfg: { mode: "off", recaptcha_site_key: null }, signedIn: true }));
    const out = () => setGate(g => (g ? { ...g, signedIn: false } : g));
    const asleep = () => setGate(g => (g ? { ...g, cfg: { ...g.cfg, asleep: true } } : g));
    window.addEventListener("amiri:signed-out", out);
    window.addEventListener("amiri:asleep", asleep);
    return () => { window.removeEventListener("amiri:signed-out", out); window.removeEventListener("amiri:asleep", asleep); };
  }, []);
  if (!gate) return <PageSkeleton />;
  if (gate.cfg.asleep) return <PausedPage />;
  if (!gate.signedIn) return <BotCheckPage cfg={gate.cfg} />;
  if (pathname === "/spec/print") return <SpecPrintPage />;  // the PDF's layout: no menu, no institution needed
  return <Installed />;
}

const NAME_KEY = "amiri.institution-name";
const lastName = () => { try { return localStorage.getItem(NAME_KEY); } catch { return null; } };

function Installed() {
  const [inst, setInst] = useState<Installation | null>(null);
  useEffect(() => {
    const load = () => api<Installation>("/api/v1/installation")
      .then(i => { setZone(i.time_zone); setInst(i); try { if (i.name) localStorage.setItem(NAME_KEY, i.name); } catch { /* private mode */ } })
      // not "no profile yet": the pages show the server didn't answer, and the bar keeps the last known name
      .catch(() => setInst(x => x ?? { institution_id: "", profile: false, name: lastName(), time_zone: "UTC", notes: [], unreachable: true }));
    load();
    window.addEventListener("amiri:installation", load);  // an institution was created (forms or chat)
    return () => window.removeEventListener("amiri:installation", load);
  }, []);
  if (!inst) return <PageSkeleton />;
  return <InstallationCtx.Provider value={inst}><Frame inst={inst} /></InstallationCtx.Provider>;
}

function Frame({ inst }: { inst: Installation }) {
  return (
    <Shell inst={inst}>
      {inst.notes.map(n => <div key={n} className="banner warn"><Icon name="warn" /><div>{n}</div></div>)}
      <Routes>
        <Route path="/" element={<Navigate to="/home" replace />} />
        <Route path="/home" element={<OverviewPage />} />
        <Route path="/radar" element={<NeedsInstitution title="Radar" what="What Radar watches"><RadarPage /></NeedsInstitution>} />
        <Route path="/alerts" element={<NeedsInstitution title="Alerts" what="Alerts"><AlertsPage /></NeedsInstitution>} />
        <Route path="/findings" element={<NeedsInstitution title="Findings" what="Findings"><FindingsPage /></NeedsInstitution>} />
        <Route path="/events" element={<NeedsInstitution title="Events" what="Events"><EventsPage /></NeedsInstitution>} />
        <Route path="/events/:id" element={<NeedsInstitution title="Events" what="Events"><EventDetailPage /></NeedsInstitution>} />
        <Route path="/monitors" element={<NeedsInstitution title="Monitors" what="Monitors"><MonitorsPage /></NeedsInstitution>} />
        <Route path="/monitors/:id" element={<NeedsInstitution title="Monitors" what="Monitors"><MonitorPage /></NeedsInstitution>} />
        <Route path="/studio" element={<NeedsInstitution title="Scenario Studio" what="Scenarios"><StudioPage /></NeedsInstitution>} />
        <Route path="/studio/run/:id" element={<NeedsInstitution title="Scenario Studio" what="Scenarios"><StudioRunPage /></NeedsInstitution>} />
        <Route path="/studio/:id" element={<NeedsInstitution title="Scenario Studio" what="Scenarios"><ScenarioPage /></NeedsInstitution>} />
        <Route path="/series" element={<SeriesList />} />
        <Route path="/series/:id" element={<SeriesDetail />} />
        <Route path="/institution" element={<InstitutionPage />} />
        <Route path="/institution/new" element={<NewInstitutionPage />} />
        <Route path="/institution/setup" element={<SetupWizard />} />
        <Route path="/institution/setup/:step" element={<SetupWizard />} />
        <Route path="/institution/:tab" element={<InstitutionPage />} />
        <Route path="/admin/data" element={<DataConnectionsPage />} />
        <Route path="/admin/settings" element={<SettingsPage />} />
        <Route path="/spec" element={<SpecPage />} />
        {DevGallery && <Route path="/dev/v2" element={<Suspense fallback={<PageSkeleton bare />}><DevGallery /></Suspense>} />}
        {[...NAV.risk_manager, ...NAV.platform_admin].filter(([, , to]) => !BUILT.has(to)).map(([, label, to]) => (
          <Route key={to} path={to} element={<NotBuilt title={label} />} />
        ))}
        <Route path="*" element={<NotBuilt title="Page not found" />} />
      </Routes>
    </Shell>
  );
}
