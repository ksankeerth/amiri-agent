// First run, as the Overview shows it until the first-run page is redone (P14): the one-click demo first, your own
// setup second. Still on the old look (rd-overview.css), so it stays here, apart from the new Overview.
import { useState } from "react";
import { Link } from "react-router-dom";
import { type Overview } from "../../api/overview";
import { isDemoLocked, LOCK_TOAST } from "../../components/demoLock";
import { LockBtn } from "../../components/lock";
import { GoLink } from "../../components/rd";
import { DEMOS } from "../../components/ui";
import { plural } from "../../format";
import "../../styles/rd-overview.css";

// ================================================================ first run
export function FirstRun({ o }: { o: Overview }) {
  const i = o.institution;
  const steps: { done: boolean; title: string; body: string; to: string; label: string }[] = [
    { done: !!i, title: "Tell Amiri Agent about your institution", body: "Where you operate, your customers, products, flows, regulators, rivals and risks.",
      to: i ? "/institution/setup" : "/institution/new", label: i ? "Continue setup" : "Start setup" },
    { done: !!i && i.readiness.ready && i.status === "active", title: "Check it and go live",
      body: i ? (i.readiness.ready ? "Everything required is there. Activate the profile so Amiri Agent starts using it." : `${plural(i.readiness.missing_required, "required item")} still missing.`) : "Once the profile has what's required, activate it.",
      to: "/institution/setup/review", label: "Review" },
    { done: o.counts.monitors_live > 0, title: "Choose what to watch", body: "Draft monitors from your profile. A Risk Manager approves each one.",
      to: "/monitors", label: "Monitors" },
  ];
  const next = steps.findIndex(s => !s.done);
  return (
    <div className="page rd rd-overview">
      <h1 className="rd-ov-h1">Welcome to Amiri Agent</h1>
      <p className="rd-lede rd-prose">{i ? <>Three steps, and Amiri Agent starts watching the world for <b>{i.name}</b>.</>
        : <>See it work on a demo institution in one click, or set up your own.</>}</p>
      {!i && <DemoLoad />}
      <section className={i ? "rd-fr-demo" : "rd-fr-steps-sec"} aria-labelledby="fr-steps-h">
        <h2 id="fr-steps-h">{i ? "Three steps to go live" : "Or set up your own institution"}</h2>
        <ol className="rd-fr-steps">{steps.map((st, n) => {
          const locked = n > 0 && !steps[n - 1].done && !st.done;  // a step opens once the one before it is done
          return (
            <li key={st.title} data-s={st.done ? "done" : locked ? "locked" : "open"}>
              <span className="rd-fr-n" aria-hidden="true">{n + 1}</span>
              <h3><span className="sr">Step {n + 1}: </span>{st.title}</h3>
              <p>{st.body}</p>
              <div>{st.done ? <span className="rd-fr-done">Done</span>
                : locked ? <span className="rd-fr-state">After step {n}</span>
                  : i && n === next ? <Link className="btn btn--primary btn--lg" to={st.to}>{st.label} →</Link>
                    : <GoLink to={st.to}>{st.label}</GoLink>}</div>
            </li>);
        })}</ol>
      </section>
      {i && <section className="rd-fr-studio" aria-labelledby="fr-studio-h">
        <div><h2 id="fr-studio-h">See it work first</h2>
          <p className="rd-prose" style={{ margin: "4px 0 0" }}>Run a sharp currency fall on your institution in the Scenario Studio: headlines arrive, prices move, and Amiri Agent's monitors and investigation respond. Nothing touches live data.</p></div>
        <Link className="btn btn--lg" to="/studio">Open the Scenario Studio</Link></section>}
    </div>
  );
}

/** No institution yet: load one of the two invented demos in one click (the server refuses once an institution exists). */
function DemoLoad() {
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = async (kind: string) => {
    setBusy(kind); setErr(null);
    try {
      const r = await fetch("/api/v1/prototype:demo", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind }) });
      if (!r.ok) { const p = await r.json().catch(() => ({})); throw new Error(isDemoLocked(p) ? LOCK_TOAST : p.detail ?? `HTTP ${r.status}`); }
      window.location.assign("/home");  // every page loads again, with the demo
    } catch (e) { setErr(String((e as Error).message ?? e)); setBusy(null); }
  };
  return (
    <section className="rd-fr-demo" aria-labelledby="demo-h">
      <div className="rd-fine">Fastest way in</div>
      <h2 id="demo-h">Start with a demo</h2>
      <p>An invented institution with its whole profile, ready to try everything on. No real customer data.</p>
      <div className="rd-fr-btns">{DEMOS.map((d, n) => (
        <LockBtn key={d.kind} className={`btn${n === 0 ? " btn--primary" : ""}`} disabled={!!busy} onClick={() => load(d.kind)}>
          <b>{busy === d.kind ? "Loading…" : `Load the ${d.label.toLowerCase()}`}</b>
          <span>{d.name}, {d.what.charAt(0).toLowerCase()}{d.what.slice(1)}</span></LockBtn>))}</div>
      {err && <p className="rd-warn" role="alert"><span className="rd-shape rd-t-mixed" aria-hidden="true">◆</span> Couldn't load the demo: {err}</p>}
    </section>
  );
}

