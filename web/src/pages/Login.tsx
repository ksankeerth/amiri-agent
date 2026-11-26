// No login in the prototype, and three screens before the app, all in one calm centred column (decision D5, board 14's tone):
//   Judge login   the demo lock is on (AUTH_MODE=prototype and DEMO_LOCK=true on the server): one button, no password, no Google script (D7)
//   the box       the demo lock is off: Google reCAPTCHA's "I'm not a robot" box, checked by the server, keeps bots out
//   Paused        the database is stopped to save costs (server: app/sleep.py)
// These render outside the shell, so each puts `.v2` on its own root.
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { authApi, type AuthConfig } from "../api/auth";
import { AgentState } from "../components/v2/AgentState";
import { Button } from "../components/v2/Button";
import { BOX_LEDE, FOOT, JUDGE_LEDE, TAGLINE, boxProblem, entryProblem, pausedButton, pausedStatus, type BoxProblem, type PausedStep } from "./loginWords";
import "../styles/v2/system.css";

declare global {
  interface Window {
    grecaptcha?: { render: (el: HTMLElement, o: Record<string, unknown>) => number; reset: (id?: number) => void };
    amiriCaptchaReady?: () => void;
  }
}

const SCRIPT = "https://www.google.com/recaptcha/api.js?onload=amiriCaptchaReady&render=explicit";
const storedTheme = () => { try { return localStorage.getItem("amiri.theme"); } catch { return null; } };
const dark = () => document.documentElement.dataset.theme === "dark"
  || (!document.documentElement.dataset.theme && matchMedia("(prefers-color-scheme: dark)").matches);

/** The wordmark, centred above the one thing this screen says. Shared by the three screens. */
function Frame({ title, lede, children, fine }: { title: string; lede: ReactNode; children?: ReactNode; fine?: ReactNode }) {
  // the shell sets the theme the visitor chose; these screens come before it, so they do the same (before the box draws itself)
  useLayoutEffect(() => { document.documentElement.dataset.theme = storedTheme() || "dark"; }, []);
  return (
    <div className="v2 v2-lg">
      <main className="v2-lg__main" id="main" tabIndex={-1}>
        <div className="v2-lg__col">
          <div className="v2-lg__brand">
            <span className="v2-logo v2-lg__logo" aria-hidden="true">A</span>
            <b>AMIRI Agent</b>
            <span className="v2-lg__tag">{TAGLINE}</span>
          </div>
          <h1 className="v2-lg__h1">{title}</h1>
          <p className="v2-lg__lede">{lede}</p>
          {children}
          {fine}
          <p className="v2-lg__foot">{FOOT}</p>
        </div>
      </main>
    </div>
  );
}

/** The database is stopped to save costs (server: app/sleep.py); the bot check and this page still work. */
export function PausedPage() {
  const [step, setStep] = useState<PausedStep>("idle");
  useEffect(() => { document.title = "Paused · AMIRI Agent"; }, []);
  const check = async () => {
    if (step === "checking") return;  // aria-disabled, not disabled: focus stays on the button while it looks
    setStep("checking");
    try { const c = await authApi.config(); if (!c.asleep) { window.location.reload(); return; } setStep("still"); }
    catch { setStep("unreachable"); }
  };
  const checking = step === "checking";
  return (
    <Frame title="AMIRI Agent is paused"
      lede="To save costs, its database stops while nobody is using it, and nothing is lost. Ask whoever runs this prototype to wake it. It takes a few minutes to start; then press the button and the app opens.">
      <div className="v2-lg__act">
        <Button variant="primary" size="lg" aria-disabled={checking || undefined} aria-busy={checking} onClick={check}>{pausedButton(step)}</Button>
      </div>
      {checking
        ? <AgentState kind="waking" className="v2-lg__agent" title="Checking whether it's awake…">A stopped database can take a few minutes to start. Press the button again if it isn't yet.</AgentState>
        : <p className="v2-lg__status" role="status">{step === "idle" ? "" : <><span aria-hidden="true">◆ </span>{pausedStatus(step)}</>}</p>}
    </Frame>
  );
}

/** The demo lock is on (server: AUTH_MODE=prototype and DEMO_LOCK=true): one click, no box, no Google script. */
function JudgeLogin() {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  useEffect(() => { document.title = "AMIRI Agent"; btn.current?.focus(); }, []);
  const enter = async () => {
    if (busy) return;  // aria-disabled, not disabled: focus stays on the button, so a refused try can be pressed again
    setBusy(true); setErr(null);
    try {
      await authApi.judge();
      window.location.assign("/home");  // a full load, as after the box: the app re-checks /me and opens the Overview
    } catch (e) { setErr(entryProblem(e, "judge")); setBusy(false); }
  };
  return (
    <Frame title="Open AMIRI Agent" lede={JUDGE_LEDE}>
      <div className="v2-lg__act">
        <Button ref={btn} variant="primary" size="lg" aria-disabled={busy || undefined} busy={busy} onClick={enter}>Judge login</Button>
      </div>
      <p className="v2-lg__status" role={err ? "alert" : "status"}>{busy ? "Opening AMIRI Agent…" : err ? <><span aria-hidden="true">◆ </span>{err}</> : ""}</p>
    </Frame>
  );
}

/** The prototype has no login: one tick of "I'm not a robot" (checked by the server) and the app opens. */
export function BotCheckPage({ cfg }: { cfg: AuthConfig }) {
  return cfg.judge_login ? <JudgeLogin /> : <BoxCheck cfg={cfg} />;  // the box (and its script) only exists in BoxCheck
}

function Captcha({ siteKey, onToken, onBlocked, resetKey }: { siteKey: string; onToken: (t: string | null) => void; onBlocked: () => void; resetKey: number }) {
  const box = useRef<HTMLDivElement>(null);
  const id = useRef<number | null>(null);
  useEffect(() => {
    const draw = () => {
      if (!box.current || !window.grecaptcha || id.current !== null) return;
      id.current = window.grecaptcha.render(box.current, {
        sitekey: siteKey, theme: dark() ? "dark" : "light",
        callback: (t: string) => onToken(t), "expired-callback": () => onToken(null), "error-callback": () => { onToken(null); onBlocked(); },
      });
    };
    if (window.grecaptcha?.render) { draw(); return; }
    window.amiriCaptchaReady = draw;
    if (!document.querySelector(`script[src="${SCRIPT}"]`)) {
      const s = document.createElement("script");
      s.src = SCRIPT; s.async = true; s.defer = true; s.onerror = onBlocked;
      document.head.appendChild(s);
    }
  }, [siteKey, onToken, onBlocked]);
  useEffect(() => { if (resetKey && id.current !== null) { window.grecaptcha?.reset(id.current); onToken(null); } }, [resetKey, onToken]);
  return <div ref={box} className="v2-lg__captcha" />;
}

function BoxCheck({ cfg }: { cfg: AuthConfig }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [problem, setProblem] = useState<BoxProblem | null>(cfg.recaptcha_site_key ? null : "no_key");
  const [resetKey, setResetKey] = useState(0);
  const passed = useCallback(async (token: string | null) => {  // the box was ticked: straight in, no button
    if (!token) return;
    setBusy(true); setErr(null);
    try { await authApi.prototype(token); window.location.reload(); }
    catch (e) { setErr(entryProblem(e, "box")); setResetKey(k => k + 1); setBusy(false); }
  }, []);
  const blocked = useCallback(() => setProblem("blocked"), []);
  useEffect(() => { document.title = "AMIRI Agent"; }, []);
  const why = problem ? boxProblem(problem) : null;
  return (
    <Frame title="Open AMIRI Agent" lede={BOX_LEDE} fine={<>
      <p className="v2-lg__fine"><b>Why this check?</b> It keeps automated bots out, so the demo stays quick and its sample data stays as it is. We don't ask who you are.</p>
      <p className="v2-lg__fine">Protected by reCAPTCHA: Google's <a href="https://policies.google.com/privacy" target="_blank" rel="noreferrer">Privacy Policy</a> and <a href="https://policies.google.com/terms" target="_blank" rel="noreferrer">Terms</a> apply. AMIRI Agent asks search engines and AI crawlers to stay away.</p></>}>
      <div className="v2-lg__check">
        {cfg.recaptcha_site_key && !problem && <Captcha siteKey={cfg.recaptcha_site_key} onToken={passed} onBlocked={blocked} resetKey={resetKey} />}
        {why && <div className="v2-lg__problem" role="alert">
          <b><span aria-hidden="true">◆ </span>{why.title}</b>
          <span>{why.body}</span>
          {problem === "blocked" && <Button variant="secondary" onClick={() => window.location.reload()}>Load this page again</Button>}
        </div>}
      </div>
      <p className="v2-lg__status" role={err ? "alert" : "status"}>{busy ? "Opening AMIRI Agent…" : err ? <><span aria-hidden="true">◆ </span>{err}</> : ""}</p>
    </Frame>
  );
}
