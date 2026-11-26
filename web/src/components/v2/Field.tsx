// Form fields (F6): Field (label, hint, error) and the three text controls in it: Input, Textarea, Select. Styles: styles/v2/forms.css.
// A control inside a Field takes its id, its aria-describedby (hint and error), aria-invalid and aria-required from the Field, so a page
// writes <Field label="Name" error={e}><Input .../></Field> and a screen reader hears "Name, required, edit text, <hint>, <error>".
// A Field around several controls (chips and a picker, an amount and a currency) is a named group instead: the label names the group,
// each control inside keeps its own aria-label. Every control also works alone, with an aria-label.
// `locked` is the demo lock: the control stays visible and focusable, reads as disabled, shows the reason, and cannot be changed.
import { createContext, isValidElement, useContext, useId, useLayoutEffect, useRef, type CSSProperties, type ChangeEvent, type InputHTMLAttributes, type ReactNode, type Ref, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { lockAttrs } from "../demoLock";
import { controlAttrs, describedBy, fieldIds, type FieldState } from "./fieldIds";

const FieldCtx = createContext<FieldState | null>(null);
/** The Field a control sits in (null outside one). */
export const useField = () => useContext(FieldCtx);

/** Components that are one control inside (a country select, a time-zone box) set this, so a Field around one is a labelled single control. */
type Single = { fieldControl?: true };
/** Marks a component that draws exactly one control (a country select, a time-zone box), so a Field around it labels that control. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function asControl<T extends (...a: any[]) => unknown>(c: T): T { (c as unknown as Single).fieldControl = true; return c; }
const isSingle = (c: ReactNode): boolean =>
  isValidElement(c) && (typeof c.type === "string" ? ["input", "select", "textarea"].includes(c.type) : (c.type as Single).fieldControl === true);

export interface FieldProps {
  label: string;
  hint?: ReactNode;
  error?: string;
  /** Required: a star to see and "(required)" to hear; the control gets aria-required. */
  req?: boolean;
  /** "(optional)" after the label. */
  optional?: boolean;
  /** Spans both columns of a two-column form. */
  full?: boolean;
  /** Force a group (several controls) or a single control; by default a Field with one control inside is a single control. */
  group?: boolean;
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
}
export function Field({ label, hint, error, req, optional, full, group, className, style, children }: FieldProps) {
  const ids = fieldIds(useId());
  const single = group === undefined ? isSingle(children) : !group;
  const note = describedBy(ids, { hint: hint != null && hint !== false && hint !== "", error: !!error });
  const state: FieldState = { id: single ? ids.control : undefined, labelId: ids.label, describedBy: note, invalid: !!error, required: !!req, single };
  const text = <>{label}{req && <><span className="v2-field__req" aria-hidden="true"> *</span><span className="v2-sr"> (required)</span></>}{optional && <span className="v2-field__opt"> (optional)</span>}</>;
  return (
    <div className={`v2-field${error ? " has-error" : ""}${full ? " is-full" : ""}${className ? ` ${className}` : ""}`} style={style}
      {...(single ? {} : { role: "group", "aria-labelledby": ids.label, "aria-describedby": note })}>
      {single ? <label id={ids.label} className="v2-field__label" htmlFor={ids.control}>{text}</label> : <span id={ids.label} className="v2-field__label">{text}</span>}
      <FieldCtx.Provider value={state}>{children}</FieldCtx.Provider>
      {hint != null && hint !== false && hint !== "" && <span id={ids.hint} className="v2-field__hint">{hint}</span>}
      {error && <span id={ids.error} className="v2-field__err" role="alert"><span aria-hidden="true">▲ </span>{error}</span>}
    </div>
  );
}

/** Controls that sit inside a Field's group but are not the field itself (a nested control with its own Field) start clean. */
export function FieldReset({ children }: { children: ReactNode }) {
  return <FieldCtx.Provider value={null}>{children}</FieldCtx.Provider>;
}

function useControl(own: { id?: string; "aria-label"?: string; "aria-labelledby"?: string; "aria-describedby"?: string; "aria-invalid"?: boolean | "true" | "false" | "grammar" | "spelling" }, invalid?: boolean) {
  return controlAttrs({ ...own, "aria-invalid": own["aria-invalid"] ?? (invalid ? true : undefined) }, useField());
}

// ---------------------------------------------------------------- Input
export type InputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "size"> & {
  /** Geist Mono, for codes and ids. */
  mono?: boolean;
  /** Red border without a Field's error (a Field with `error` sets it for you). */
  invalid?: boolean;
  /** The demo lock: read-only, greyed, focusable, with the reason. */
  locked?: boolean;
  /** Width of the content, not of the column. */
  inline?: boolean;
  ref?: Ref<HTMLInputElement>;
};
export function Input({ mono, invalid, locked, inline, className, ref, readOnly, onChange, ...rest }: InputProps) {
  const a = useControl(rest, invalid);
  const range = rest.type === "range";
  return <input {...rest} {...a} ref={ref} readOnly={readOnly || locked || undefined} {...(locked ? { ...lockAttrs(true), "aria-readonly": true } : {})}
    onChange={locked ? undefined : onChange}
    className={`${range ? "v2-range" : "v2-ctl v2-input"}${mono ? " is-mono" : ""}${inline ? " is-inline" : ""}${className ? ` ${className}` : ""}`} />;
}

// ---------------------------------------------------------------- Textarea
export type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & {
  mono?: boolean; invalid?: boolean; locked?: boolean;
  /** Grows with its text (up to `maxRows`) instead of scrolling. */
  autoGrow?: boolean; maxRows?: number;
  ref?: Ref<HTMLTextAreaElement>;
};
export function Textarea({ mono, invalid, locked, autoGrow, maxRows = 12, className, ref, readOnly, onChange, ...rest }: TextareaProps) {
  const a = useControl(rest, invalid);
  const own = useRef<HTMLTextAreaElement | null>(null);
  useLayoutEffect(() => {
    const t = own.current;
    if (!autoGrow || !t) return;
    t.style.height = "auto";
    const line = parseFloat(getComputedStyle(t).lineHeight) || 20;
    const pad = t.offsetHeight - t.clientHeight;
    t.style.height = `${Math.min(t.scrollHeight + pad, line * maxRows + pad + 16)}px`;
  }, [autoGrow, maxRows, rest.value]);
  return <textarea rows={2} {...rest} {...a} readOnly={readOnly || locked || undefined} {...(locked ? { ...lockAttrs(true), "aria-readonly": true } : {})}
    ref={el => { own.current = el; if (typeof ref === "function") ref(el); else if (ref) ref.current = el; }}
    onChange={locked ? undefined : onChange}
    className={`v2-ctl v2-textarea${mono ? " is-mono" : ""}${autoGrow ? " is-grow" : ""}${className ? ` ${className}` : ""}`} />;
}

// ---------------------------------------------------------------- Select
export type SelectProps = Omit<SelectHTMLAttributes<HTMLSelectElement>, "size"> & {
  invalid?: boolean; locked?: boolean;
  /** Width of the longest option, not of the column (filters). */
  inline?: boolean;
  /** Classes for the wrapper (the select is drawn inside it, with the chevron). */
  className?: string;
  ref?: Ref<HTMLSelectElement>;
};
/** A native select (the list is the browser's, so it works everywhere), drawn with the shared border and a chevron. */
export function Select({ invalid, locked, inline, className, ref, onChange, onMouseDown, children, ...rest }: SelectProps) {
  const a = useControl(rest, invalid);
  return (
    <span className={`v2-sel${inline ? " is-inline" : ""}${className ? ` ${className}` : ""}`}>
      <select {...rest} {...a} ref={ref} className="v2-ctl v2-select" {...(locked ? lockAttrs(true) : {})}
        onMouseDown={e => { if (locked) e.preventDefault(); onMouseDown?.(e); }}
        onChange={locked ? (e: ChangeEvent<HTMLSelectElement>) => e.preventDefault() : onChange}>{children}</select>
      <svg className="v2-sel__chev" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M4 6.5 8 10.5 12 6.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
    </span>
  );
}
asControl(Select); asControl(Input); asControl(Textarea);
