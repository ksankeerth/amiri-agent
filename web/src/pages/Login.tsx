// No login in the prototype: a visitor ticks Google reCAPTCHA's "I'm not a robot" box (checked by the server),
// which keeps bots out; the paused page shares the brand panel.
import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError } from "../api/client";
import { authApi, type AuthConfig } from "../api/auth";
import { Icon } from "../components/Icon";
import "../styles/polish-overview.css";

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

// the left panel, shared by the bot check and the paused page: name, one value line, and the four steps it takes
function Brand() {
  return (
  <header className="login-brand">
    <div className="login-logo">
      <svg viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="7" fill="#F1F5EC" /><path d="M9.2 25 15 7h2l5.8 18h-3.1L16 13.1 12.3 25z" fill="#0F3D2E" /><rect x="14.2" y="16" width="3.6" height="5.2" fill="#F05A28" /></svg>
      <b>Amiri Agent</b><span className="login-tag">Early warning for banks and insurers</span>
    </div>
    <div className="login-pitch">
      <h1>See what the world means for your balance sheet, before your numbers show it.</h1>
      <p>Amiri Agent reads the news and the markets for your institution, traces each event to the products it could move, and tells the team that owns them.</p>
      <ol className="login-flow" aria-label="How it works">
        {([["radar", "Watch", "news and markets"], ["search", "Find", "what's unusual"], ["events", "Trace", "to your products"], ["alert", "Alert", "the owning team"]] as const).map(([i, t, d]) => (
          <li key={t}><span className="ico"><Icon name={i} /></span><b>{t}</b><span>{d}</span></li>))}
      </ol>
    </div>
    <span className="login-foot">Prototype · a demo bank with sample data, no real customers</span>
  </header>
  );
}

/** The database is stopped to save costs (server: app/sleep.py); the bot check and this page still work. */
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
          <span className="login-badge is-paused"><Icon name="moon" /></span>
          <h2>Amiri Agent is paused</h2>
          <p className="login-lede">To save costs, its database stops while nobody is using it. Nothing is lost: everything comes back exactly as it was.</p>
          <ol className="login-todo" aria-label="To wake it">
            <li><span>1</span>Ask whoever runs this prototype to wake it.</li>
            <li><span>2</span>Give it a few minutes to start.</li>
            <li><span>3</span>Check again, and Amiri Agent opens.</li>
          </ol>
          {still && <div className="login-still" role="status"><Icon name="clock" />Still paused. Try again in a minute.</div>}
          <button className="btn btn--primary btn--lg" type="button" disabled={busy} onClick={check}>
            <Icon name="refresh" className={busy ? "spin" : undefined} />{busy ? "Checking…" : "Check again"}</button>
        </div>
      </main>
    </div>
  );
}

/** The prototype has no login: one tick of "I'm not a robot" (checked by the server) and the app opens. */
export function BotCheckPage({ cfg }: { cfg: AuthConfig }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [resetKey, setResetKey] = useState(0);
  const passed = useCallback(async (token: string | null) => {  // the box was ticked: straight in, no button
    if (!token) return;
    setBusy(true); setErr(null);
    try { await authApi.prototype(token); window.location.reload(); }
    catch (e) { setErr(e instanceof ApiError ? e.problem.detail : String(e)); setResetKey(k => k + 1); setBusy(false); }
  }, []);
  useEffect(() => { document.title = "Amiri Agent"; }, []);
  return (
    <div className="login">
      <Brand />
      <main className="login-main" id="main">
        <div className="login-card">
          <span className="login-eyebrow">Welcome</span>
          <h2>Open Amiri Agent</h2>
          <p className="login-lede">No password needed. Tick the box below and the app opens on a demo bank.</p>
          <div className="login-check">
            {cfg.recaptcha_site_key ? <Captcha siteKey={cfg.recaptcha_site_key} onToken={passed} resetKey={resetKey} />
              : <div className="errtext">The check isn't set up on this server yet (no reCAPTCHA key).</div>}
            {busy && <div className="login-busy" role="status"><Icon name="refresh" className="spin" />Opening Amiri Agent…</div>}
            {err && <div className="errtext" role="alert">{err}</div>}
          </div>
          <div className="login-why">
            <Icon name="help" />
            <p><b>Why this check?</b> It keeps automated bots out, so the demo stays quick and its sample data stays as it is. We don't ask who you are.</p>
          </div>
          <p className="login-legal">Protected by reCAPTCHA: Google's <a href="https://policies.google.com/privacy" target="_blank" rel="noreferrer">Privacy Policy</a> and <a href="https://policies.google.com/terms" target="_blank" rel="noreferrer">Terms</a> apply. Amiri Agent asks search engines and AI crawlers to stay away.</p>
        </div>
      </main>
    </div>
  );
}
