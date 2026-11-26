// Form choices (F6): Checkbox, RadioGroup (a list, or cards), Switch, Segmented. Styles: styles/v2/forms.css.
// All are real inputs (checkbox, radio), so the keyboard, Space and the arrow keys work as the browser does them; the box, ring or
// track is drawn beside the input and the input's own focus ring is drawn around it. `locked` is the demo lock: visible, focusable,
// greyed, with the reason, and a click changes nothing.
import { useId, type ChangeEvent, type InputHTMLAttributes, type ReactNode, type Ref } from "react";
import { lockAttrs } from "../demoLock";
import { joinIds } from "./fieldIds";

const labelLock = (locked?: boolean) => (locked ? { "data-lock": "", title: lockAttrs(true).title } : {});

// ---------------------------------------------------------------- Checkbox
export type CheckboxProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "size"> & {
  /** The words beside the box. Without them, give the box an aria-label. */
  label?: ReactNode;
  /** A quieter line under the label, tied to the box with aria-describedby. */
  hint?: ReactNode;
  locked?: boolean;
  ref?: Ref<HTMLInputElement>;
};
export function Checkbox({ label, hint, locked, className, onChange, onClick, ref, ...rest }: CheckboxProps) {
  const hintId = useId();
  return (
    <label className={`v2-check${locked ? " is-locked" : ""}${className ? ` ${className}` : ""}`} {...labelLock(locked)}>
      <input {...rest} ref={ref} type="checkbox" className="v2-check__in" aria-describedby={joinIds(rest["aria-describedby"], hint != null && hintId)}
        {...(locked ? lockAttrs(true) : {})} onClick={locked ? e => e.preventDefault() : onClick} onChange={locked ? undefined : onChange} />
      <span className="v2-check__box" aria-hidden="true">
        <svg viewBox="0 0 16 16" focusable="false"><path d="M3.5 8.5 6.5 11.5 12.5 4.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </span>
      {(label != null || hint != null) && (
        <span className="v2-check__text">{label}{hint != null && <span id={hintId} className="v2-check__hint">{hint}</span>}</span>)}
    </label>
  );
}

// ---------------------------------------------------------------- Switch
export type SwitchProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "role" | "size"> & {
  /** The words beside the switch. Without them, give it an aria-label. */
  label?: ReactNode;
  large?: boolean;
  locked?: boolean;
  ref?: Ref<HTMLInputElement>;
};
/** An on/off switch: a checkbox with the switch role, so Space toggles it and a screen reader says "on" or "off". */
export function Switch({ label, large, locked, className, onChange, onClick, ref, ...rest }: SwitchProps) {
  return (
    <label className={`v2-switch${large ? " is-lg" : ""}${locked ? " is-locked" : ""}${className ? ` ${className}` : ""}`} {...labelLock(locked)}>
      <input {...rest} ref={ref} type="checkbox" role="switch" className="v2-switch__in" {...(locked ? lockAttrs(true) : {})}
        onClick={locked ? e => e.preventDefault() : onClick} onChange={locked ? undefined : onChange} />
      <span className="v2-switch__track" aria-hidden="true"><span className="v2-switch__knob" /></span>
      {label != null && <span className="v2-switch__text">{label}</span>}
    </label>
  );
}

// ---------------------------------------------------------------- RadioGroup
export interface RadioOption<T extends string> {
  value: T;
  label: ReactNode;
  /** A quieter line under the label. */
  description?: ReactNode;
  disabled?: boolean;
  /** Why it is disabled, said under it and tied to the radio. */
  why?: ReactNode;
}
export interface RadioGroupProps<T extends string> {
  legend: ReactNode;
  /** The legend is read, not drawn. */
  legendHidden?: boolean;
  name?: string;
  value: T | null;
  onChange: (v: T) => void;
  options: RadioOption<T>[];
  /** "list": rings in a column. "cards": each option a box with the ring, the title and the line (Data connection sources). */
  variant?: "list" | "cards";
  locked?: boolean;
  hint?: ReactNode;
  error?: string;
  className?: string;
}
export function RadioGroup<T extends string>({ legend, legendHidden, name, value, onChange, options, variant = "list", locked, hint, error, className }: RadioGroupProps<T>) {
  const id = useId();
  const group = name ?? id;
  const note = joinIds(hint != null && `${id}-h`, error && `${id}-e`);
  return (
    <fieldset className={`v2-radios is-${variant}${error ? " has-error" : ""}${className ? ` ${className}` : ""}`} aria-describedby={note} aria-invalid={error ? true : undefined}>
      <legend className={legendHidden ? "v2-sr" : "v2-radios__legend"}>{legend}</legend>
      {options.map((o, i) => {
        const why = o.why != null ? `${id}-w${i}` : undefined;
        const on = value === o.value;
        return (
          <label key={o.value} className={`v2-radio${on ? " is-on" : ""}${o.disabled ? " is-off" : ""}${locked ? " is-locked" : ""}`} {...labelLock(locked)}>
            <input type="radio" className="v2-radio__in" name={group} value={o.value} checked={on} disabled={o.disabled} aria-describedby={why}
              {...(locked ? lockAttrs(true) : {})} onClick={locked ? e => e.preventDefault() : undefined}
              onChange={(e: ChangeEvent<HTMLInputElement>) => { if (!locked && e.target.checked) onChange(o.value); }} />
            <span className="v2-radio__ring" aria-hidden="true" />
            <span className="v2-radio__text">
              <span className="v2-radio__t">{o.label}</span>
              {o.description != null && <span className="v2-radio__d">{o.description}</span>}
              {o.why != null && <span id={why} className="v2-radio__why">{o.why}</span>}
            </span>
          </label>);
      })}
      {hint != null && <span id={`${id}-h`} className="v2-field__hint">{hint}</span>}
      {error && <span id={`${id}-e`} className="v2-field__err" role="alert"><span aria-hidden="true">▲ </span>{error}</span>}
    </fieldset>
  );
}

// ---------------------------------------------------------------- Segmented
export interface SegmentedProps<T extends string> {
  /** Names the group for a screen reader (and is drawn above it when `caption` is set). */
  label: string;
  caption?: boolean;
  value: T;
  options: { value: T; label: ReactNode; disabled?: boolean }[];
  onChange: (v: T) => void;
  locked?: boolean;
  name?: string;
  className?: string;
}
/** A small set of choices in one box (Low, Medium, High; Bank, Insurer): real radio buttons, so the arrow keys move between them. */
export function Segmented<T extends string>({ label, caption, value, options, onChange, locked, name, className }: SegmentedProps<T>) {
  const id = useId();
  return (
    <div className={`v2-seg-wrap${className ? ` ${className}` : ""}`}>
      {caption && <div className="v2-cap" id={`${id}-l`}>{label}</div>}
      <div role="radiogroup" className="v2-seg" {...(caption ? { "aria-labelledby": `${id}-l` } : { "aria-label": label })}>
        {options.map(o => (
          <label key={o.value} className={`v2-seg__o${value === o.value ? " is-on" : ""}${locked ? " is-locked" : ""}`} {...labelLock(locked)}>
            <input type="radio" className="v2-seg__in" name={name ?? id} value={o.value} checked={value === o.value} disabled={o.disabled}
              {...(locked ? lockAttrs(true) : {})} onClick={locked ? e => e.preventDefault() : undefined}
              onChange={() => { if (!locked) onChange(o.value); }} />
            <span className="v2-seg__t">{o.label}</span>
          </label>))}
      </div>
    </div>
  );
}
