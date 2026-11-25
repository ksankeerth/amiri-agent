// First run (board 14): what a visitor sees on the Overview until the institution is set up. With no institution: the one-click
// demo first, then setting up your own. With one that isn't live yet: the same three steps, in order, then the Scenario Studio.
// Loading a demo is the one write here (POST /prototype:demo); the demo lock greys it, and the server refuses once an institution exists.
import { useState } from "react";
import { Link } from "react-router-dom";
import { useInstallation } from "../../App";
import { api } from "../../api/client";
import { type Overview } from "../../api/overview";
import { useDemoLock } from "../../components/lock";
import { DEMOS, useRefusalToast } from "../../components/ui";
import { Button } from "../../components/v2/Button";
import { Icon } from "../../components/Icon";
import { useCrumbs } from "../../components/v2/Shell";
import { demoLine, firstSteps, resetNote, stepNote, type FirstStep } from "./firstRunWords";
import "../../styles/v2/first-run.css";

const CRUMBS = [{ label: "Overview" }];
const ICON: Record<string, string> = { bank: "bank", insurer: "audit" };

/** Load one of the two invented demos on an empty platform, then start again at the Overview with it. */
function DemoLoad() {
  const refuse = useRefusalToast();
  const locked = useDemoLock();
  const installation = useInstallation();
  const [busy, setBusy] = useState<string | null>(null);
  const load = async (kind: string) => {
    setBusy(kind);
    try {
      await api("/api/v1/prototype:demo", { method: "POST", json: { kind } });
      window.location.assign("/home");  // every page loads again, with the demo
    } catch (e) { refuse(e, "Couldn't load the demo"); setBusy(null); }
  };
  const note = resetNote(installation?.prototype_reset !== false);
  const loading = DEMOS.find(d => d.kind === busy);
  return (
    <>
      <section className="v2-fr-demo" aria-labelledby="fr-demo">
        <h2 id="fr-demo" className="v2-sr">Start with a demo</h2>
        <div className="v2-fr-demo__btns">
          {DEMOS.map((d, n) => (
            <Button key={d.kind} variant={n === 0 ? "primary" : "secondary"} className="v2-fr-demo__btn" locked={locked}
              disabled={!!busy} aria-busy={busy === d.kind} onClick={() => load(d.kind)}>
              <Icon name={ICON[d.kind] ?? "bank"} />
              <span className="v2-fr-demo__txt">
                <b>{busy === d.kind ? "Loading…" : `Load the ${d.label.toLowerCase()}`}</b>
                <span>{demoLine(d)}</span>
              </span>
            </Button>))}
        </div>
        <p className="v2-fr-fine" role="status">{loading
          ? `Setting up ${loading.name}: its whole profile, monitors and prices. This takes a few seconds.`
          : <>{note.before}{note.link && <Link to="/admin/settings">{note.link}</Link>}{note.after}</>}</p>
      </section>
    </>
  );
}

function Step({ s }: { s: FirstStep }) {
  const note = stepNote(s);
  return (
    <li className={`v2-fr-step is-${s.state === "locked" ? "wait" : s.state}`}>
      <span className="v2-fr-step__n v2-num" aria-hidden="true">{s.state === "done" ? <Icon name="check" /> : s.n}</span>
      <div className="v2-fr-step__txt">
        <h3 className="v2-fr-step__t"><span className="v2-sr">Step {s.n}: </span>{s.title}</h3>
        <p>{s.body}</p>
      </div>
      <div className="v2-fr-step__act">
        {note ? <span className="v2-fr-step__note">{note}</span>
          : s.next ? <Button as="link" to={s.to} variant="primary">{s.label} <span aria-hidden="true">→</span></Button>
            : <Button as="link" to={s.to} variant="secondary">{s.label}</Button>}
      </div>
    </li>
  );
}

export function FirstRun({ o }: { o: Overview }) {
  useCrumbs(CRUMBS);
  const i = o.institution;
  const steps = firstSteps(i, o.counts.monitors_live);
  return (
    <div className="v2-fr">
      <header className="v2-fr-head">
        <p className="v2-cap">Welcome</p>
        {i ? <h1 className="v2-hero v2-fr-h1">Welcome to Amiri Agent</h1>
          : <h1 className="v2-hero v2-fr-h1">See Amiri Agent work<br />in one click</h1>}
        <p className="v2-fr-lede">{i ? <>Three steps, and Amiri Agent starts watching the world for <b>{i.name}</b>.</>
          : "Load an invented institution with its whole profile, monitors and prices. No real customer data."}</p>
      </header>
      {!i && <DemoLoad />}
      <section className="v2-fr-own" aria-labelledby="fr-own">
        <h2 id="fr-own" className="v2-fr-h2">{i ? "Three steps to go live" : "Or set up your own institution"}</h2>
        <ol className="v2-fr-steps">{steps.map(s => <Step key={s.n} s={s} />)}</ol>
      </section>
      {i && (
        <section className="v2-fr-studio" aria-labelledby="fr-studio">
          <div>
            <h2 id="fr-studio" className="v2-fr-h2">See it work first</h2>
            <p>Run a sharp currency fall on your institution in the Scenario Studio: headlines arrive, prices move, and Amiri Agent's monitors and investigation respond. Nothing touches live data.</p>
          </div>
          <Button as="link" to="/studio" variant="secondary">Open the Scenario Studio</Button>
        </section>
      )}
    </div>
  );
}
