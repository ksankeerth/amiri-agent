// No login in the prototype: a visitor ticks Google reCAPTCHA's "I'm not a robot" box (checked by the server),
// which keeps bots out; the paused page shares its calm centred column.
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ApiError } from "../api/client";
import { authApi, type AuthConfig } from "../api/auth";
import "../styles/polish-overview.css";
import "../styles/rd.css";
import "../styles/rd-login.css";

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

/** The wordmark, centred above the one thing this screen says. Shared by the bot check and the paused page. */
function Frame({ children }: { children: ReactNode }) {
  return (
    <div className="rd rd-login">
      <main className="lg-main" id="main" tabIndex={-1}>
        <div className="lg-col">
          <div className="lg-brand">
            <svg viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="7" fill="#0F3D2E" /><path d="M9.2 25 15 7h2l5.8 18h-3.1L16 13.1 12.3 25z" fill="#F1F5EC" /><rect x="14.2" y="16" width="3.6" height="5.2" fill="#F05A28" /></svg>
            <b>Amiri Agent</b>
            <span className="lg-tag">Early warning for banks and insurers</span>
          </div>
          {children}
          <p className="lg-foot">Prototype · a demo bank with sample data, no real customers</p>
        </div>
      </main>
    </div>
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
    <Frame>
      <h1>Amiri Agent is paused</h1>
      <p className="lg-lede">To save costs, its database stops while nobody is using it, and nothing is lost. Ask whoever runs this prototype to wake it, give it a few minutes to start, then check again.</p>
      <button className="btn btn--primary btn--lg" type="button" disabled={busy} onClick={check}>{busy ? "Checking…" : "Check again"}</button>
      <p className="lg-status" role="status">{still ? <><span aria-hidden="true">◆ </span>Still paused. Try again in a minute.</> : ""}</p>
    </Frame>
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
    <Frame>
      <h1>Open Amiri Agent</h1>
      <p className="lg-lede">No password needed. Tick the box below and the app opens on a demo bank.</p>
      <div className="lg-check">
        {cfg.recaptcha_site_key ? <Captcha siteKey={cfg.recaptcha_site_key} onToken={passed} resetKey={resetKey} />
          : <div className="errtext">The check isn't set up on this server yet (no reCAPTCHA key).</div>}
      </div>
      <p className="lg-status" role={err ? "alert" : "status"}>{busy ? "Opening Amiri Agent…" : err ? <><span aria-hidden="true">◆ </span>{err}</> : ""}</p>
      <p className="lg-fine"><b>Why this check?</b> It keeps automated bots out, so the demo stays quick and its sample data stays as it is. We don't ask who you are.</p>
      <p className="lg-fine">Protected by reCAPTCHA: Google's <a href="https://policies.google.com/privacy" target="_blank" rel="noreferrer">Privacy Policy</a> and <a href="https://policies.google.com/terms" target="_blank" rel="noreferrer">Terms</a> apply. Amiri Agent asks search engines and AI crawlers to stay away.</p>
    </Frame>
  );
}
