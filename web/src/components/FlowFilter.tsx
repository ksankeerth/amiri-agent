// Status filters. FlowFilter: statuses that follow one another (Waiting → Being investigated → In an event), drawn as
// steps on a line, each with its count, plus a quiet "All". ChipFilter: options that don't follow one another (teams).
import { Fragment } from "react";
import { Icon } from "./Icon";
import "../styles/polish-daily.css";

export interface FlowStep<K extends string> { key: K; label: string; count?: number }

/** `steps` in order; an inner array is one stage with alternative outcomes ("In an event" or "No impact found"). */
export function FlowFilter<K extends string>({ steps, value, onChange, all, label }: {
  steps: (FlowStep<K> | FlowStep<K>[])[]; value: K; onChange: (k: K) => void; all: FlowStep<K>; label: string;
}) {
  const btn = (s: FlowStep<K>) => (
    <button key={s.key} type="button" className="ff-step" aria-pressed={value === s.key} onClick={() => onChange(s.key)}>
      {s.count !== undefined && <span className={`ff-n${s.count ? "" : " zero"}`}>{s.count}</span>}
      <span className="ff-l">{s.label}</span>
    </button>);
  return (
    <div className="ff" role="group" aria-label={label}>
      <button type="button" className="ff-all" aria-pressed={value === all.key} onClick={() => onChange(all.key)}>
        {all.label}{all.count !== undefined && <span className="ff-c">{all.count}</span>}</button>
      <span className="ff-sep" aria-hidden="true" />
      <span className="ff-flow">{steps.map((s, i) => (
        <Fragment key={i}>
          {i > 0 && <span className="ff-line" aria-hidden="true" />}
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
