// Sign in: Google sign-in comes later; the prototype asks a person to prove they aren't a bot
// (Google reCAPTCHA v2 checkbox, checked by the server), then a session cookie.
import { useEffect, useRef, useState } from "react";
import { ApiError } from "../api/client";
import { authApi, type AuthConfig } from "../api/auth";
import { Icon } from "../components/Icon";

declare global {
  interface Window {
    grecaptcha?: { render: (el: HTMLElement, o: Record<string, unknown>) => number; reset: (id?: number) => void };
    amiriCaptchaReady?: () => void;
  }
}

const SCRIPT = "https://www.google.com/recaptcha/api.js?onload=amiriCaptchaReady&render=explicit";
const dark = () => document.documentElement.dataset.theme === "dark"
  || (!document.documentElement.dataset.theme && matchMedia("(prefers-color-scheme: dark)").matches);

function Captcha({ siteKey, onToken, resetKey }: { siteKey: string; onToken: (t: string | null) => void; resetKey: number }) {
  const box = useRef<HTMLDivElement>(null);
  const id = useRef<number | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const draw = () => {
      if (!box.current || !window.grecaptcha || id.current !== null) return;
      id.current = window.grecaptcha.render(box.current, {
        sitekey: siteKey, theme: dark() ? "dark" : "light",
        callback: (t: string) => onToken(t), "expired-callback": () => onToken(null), "error-callback": () => { onToken(null); setFailed(true); },
      });
    };
    if (window.grecaptcha?.render) { draw(); return; }
    window.amiriCaptchaReady = draw;
    if (!document.querySelector(`script[src="${SCRIPT}"]`)) {
      const s = document.createElement("script");
      s.src = SCRIPT; s.async = true; s.defer = true; s.onerror = () => setFailed(true);
      document.head.appendChild(s);
    }
  }, [siteKey, onToken]);
  useEffect(() => { if (resetKey && id.current !== null) { window.grecaptcha?.reset(id.current); onToken(null); } }, [resetKey, onToken]);
  return <>
    <div ref={box} className="captcha" />
    {failed && <div className="errtext">The check couldn't load. Turn off a blocker for google.com, or try another browser.</div>}
  </>;
}

// the left panel, shared by the sign-in and the paused page
function Brand() {
  return (
  <header className="login-brand">
    <div className="login-logo">
      <svg viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="7" fill="#F1F5EC" /><path d="M9.2 25 15 7h2l5.8 18h-3.1L16 13.1 12.3 25z" fill="#0F3D2E" /><rect x="14.2" y="16" width="3.6" height="5.2" fill="#F05A28" /></svg>
      <b>Amiri Agent</b>
    </div>
    <div className="login-pitch">
      <h1>See what the world means for your balance sheet, before your numbers show it.</h1>
      <p>Amiri Agent reads the news and the markets for your institution, traces each event to the products it could move, and tells the team that owns them.</p>
    </div>
    <ol className="login-flow" aria-label="How it works">
      {([["radar", "Watch", "news and markets"], ["search", "Find", "what's unusual"], ["events", "Trace", "to your products"], ["alert", "Alert", "the owning team"]] as const).map(([i, t, d], n) => (
        <li key={t} style={{ animationDelay: `${n * 0.9}s` }}><span className="ico"><Icon name={i} /></span><b>{t}</b><span>{d}</span></li>))}
    </ol>
    <span className="login-foot">Prototype · demo data only</span>
  </header>
  );
}

/** The database is stopped to save costs (server: app/sleep.py); sign-in and this page still work. */
export function PausedPage() {
  const [busy, setBusy] = useState(false);
  const [still, setStill] = useState(false);
  useEffect(() => { document.title = "Paused · Amiri Agent"; }, []);
  const check = async () => {
    setBusy(true); setStill(false);
    try { const c = await authApi.config(); if (!c.asleep) { window.location.reload(); return; } setStill(true); }
    catch { setStill(true); }
    finally { setBusy(false); }
  };
  return (
    <div className="login">
      <Brand />
      <main className="login-main" id="main">
        <div className="login-card">
          <h2>Amiri Agent is paused</h2>
          <p className="muted" style={{ margin: "8px 0 18px" }}>To save costs, its database is stopped while nobody is using it. Nothing is lost: everything comes back as it was when it is woken up.</p>
          <p className="small muted" style={{ marginBottom: 18 }}>Ask the person who runs this prototype to wake it. It takes a few minutes; then check again.</p>
          {still && <div className="errtext" role="status" style={{ marginBottom: 12 }}>Still paused.</div>}
          <button className="btn btn--primary btn--lg" type="button" disabled={busy} onClick={check}>{busy ? "Checking…" : "Check again"}</button>
        </div>
      </main>
    </div>
  );
}

export function LoginPage({ cfg }: { cfg: AuthConfig }) {
  const [token, setToken] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [resetKey, setResetKey] = useState(0);
  const ready = !!token && (!cfg.access_code || code.trim().length > 0);
  const go = async () => {
    if (!token) return;
    setBusy(true); setErr(null);
    try { await authApi.prototype(token, code.trim()); window.location.reload(); }
    catch (e) {
      setErr(e instanceof ApiError ? e.problem.detail : String(e));
      setResetKey(k => k + 1); setBusy(false);
    }
  };
  useEffect(() => { document.title = "Sign in · Amiri Agent"; }, []);
  return (
    <div className="login">
      <Brand />
      <main className="login-main" id="main">
        <div className="login-card">
          <h2>Sign in</h2>
          <p className="muted small" style={{ margin: "4px 0 18px" }}>This is a prototype with a demo bank. No real customer data.</p>
          <button className="btn login-google" type="button" disabled title="Comes after the prototype">
            <svg viewBox="0 0 18 18" aria-hidden="true" width="18" height="18"><path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92a8.78 8.78 0 0 0 2.68-6.62z" /><path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18z" /><path fill="#FBBC05" d="M3.97 10.72a5.4 5.4 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33z" /><path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58z" /></svg>
            Continue with Google<span className="badge b-noeffect" style={{ marginLeft: "auto" }}>SOON</span></button>
          <div className="login-or"><span>or</span></div>
          <div className="col" style={{ gap: 12 }}>
            <div><b style={{ color: "var(--ink)" }}>Prototype access</b><div className="small muted">Show you're a person and you're in for {12} hours.</div></div>
            {cfg.access_code && <label className="field"><span>Access code</span>
              <input className="input" value={code} autoComplete="off" onChange={e => setCode(e.target.value)} placeholder="The code you were given"
                onKeyDown={e => { if (e.key === "Enter" && ready) go(); }} /></label>}
            {cfg.recaptcha_site_key ? <Captcha siteKey={cfg.recaptcha_site_key} onToken={setToken} resetKey={resetKey} />
              : <div className="errtext">Sign-in isn't set up on this server yet (no reCAPTCHA key).</div>}
            {err && <div className="errtext" role="alert">{err}</div>}
            <button className="btn btn--primary btn--lg" type="button" disabled={!ready || busy} onClick={go}>{busy ? "Signing in…" : "Enter Amiri Agent"}<Icon name="play" /></button>
          </div>
          <p className="tiny muted" style={{ marginTop: 18 }}>Protected by reCAPTCHA: Google's <a href="https://policies.google.com/privacy" target="_blank" rel="noreferrer">Privacy Policy</a> and <a href="https://policies.google.com/terms" target="_blank" rel="noreferrer">Terms</a> apply. Amiri Agent asks search engines and AI crawlers to stay away.</p>
        </div>
      </main>
    </div>
  );
}
