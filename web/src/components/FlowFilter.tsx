// Status filters. FlowFilter: statuses that follow one another (Waiting → Being investigated → In an event), drawn as
// steps on a line, each with its count, plus a quiet "All". ChipFilter: options that don't follow one another (teams).
import { Fragment } from "react";
import { Icon } from "./Icon";
import "../styles/polish-daily.css";

// state, when a page gives one and the count isn't 0: queued (amber, pulsing), busy (blue, a turning arc, dots running down the
// line to the next step), held (blue and still: a person has it), done (green). `toned` is for flows a person moves along (Alerts: acknowledge,
// resolve; Monitors: submit, approve): the finished step's count gets a tick ("done, by one of you"), and a selected step keeps its
// colour. Flows the system moves along (Findings) leave it off: their finished step is a green ring without the tick.
// Reduced motion keeps the colours and stops the movement.
export interface FlowStep<K extends string> { key: K; label: string; count?: number; state?: "queued" | "busy" | "held" | "done" }

/** `steps` in order; an inner array is one stage with alternative outcomes ("In an event" or "No impact found"). */
export function FlowFilter<K extends string>({ steps, value, onChange, all, label, toned }: {
  toned?: boolean; steps: (FlowStep<K> | FlowStep<K>[])[]; value: K; onChange: (k: K) => void; all: FlowStep<K>; label: string;
}) {
  const btn = (s: FlowStep<K>) => (
    <button key={s.key} type="button" className="ff-step" data-state={s.count ? s.state : undefined} aria-pressed={value === s.key} onClick={() => onChange(s.key)}>
      {s.count !== undefined && <span className={`ff-n${s.count ? "" : " zero"}`}>{s.count}
        {toned && s.state === "done" && !!s.count && <Icon name="check" className="ff-tick" />}</span>}
      <span className="ff-l">{s.label}</span>
    </button>);
  const busy = (s: FlowStep<K> | FlowStep<K>[]) => !Array.isArray(s) && s.state === "busy" && !!s.count;
  return (
    <div className={`ff${toned ? " toned" : ""}`} role="group" aria-label={label}>
      <button type="button" className="ff-all" aria-pressed={value === all.key} onClick={() => onChange(all.key)}>
        {all.label}{all.count !== undefined && <span className="ff-c">{all.count}</span>}</button>
      <span className="ff-sep" aria-hidden="true" />
      <span className="ff-flow">{steps.map((s, i) => (
        <Fragment key={i}>
          {i > 0 && <span className={`ff-line${busy(steps[i - 1]) ? " moving" : ""}`} aria-hidden="true" />}
          {Array.isArray(s)
            ? <span className="ff-alt">{s.map((x, j) => <Fragment key={x.key}>{j > 0 && <span className="ff-or">or</span>}{btn(x)}</Fragment>)}</span>
            : btn(s)}
        </Fragment>))}</span>
    </div>
  );
}

/** Options that are not a sequence, styled to match FlowFilter. The selected one shows a tick, not only a colour. */
export function ChipFilter<K extends string>({ options, value, onChange, label }: {
  options: FlowStep<K>[]; value: K; onChange: (k: K) => void; label: string;
}) {
  return (
    <div className="ffc" role="group" aria-label={label}>{options.map(o => (
      <button key={o.key} type="button" className="ffc-o" aria-pressed={value === o.key} onClick={() => onChange(o.key)}>
        {value === o.key && <Icon name="check" />}{o.label}{o.count ? <span className="ff-c">{o.count}</span> : null}</button>))}
    </div>
  );
}
