// The redesign's shared pieces (styles in styles/rd.css). Every redesigned page uses these instead of cards, pills
// and tiles, so the same thing looks and reads the same everywhere.
import { useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { VERDICT_LABEL, sourceInfo, type VerdictKey } from "../plain";
import { Icon } from "./Icon";
import { readFold, writeFold } from "./foldStore";
import "../styles/rd.css";

// ---------------------------------------------------------------- tone
export type ToneKey = "bad" | "good" | "mixed" | "neutral";
export const TONE_SHAPE: Record<ToneKey, string> = { bad: "▲", good: "●", mixed: "◆", neutral: "■" };
export const TONE_WORD: Record<ToneKey, string> = { bad: "Bad for you", good: "Good for you", mixed: "Mixed for you", neutral: "Neutral for you" };

/** The tone's shape, coloured. Decorative: put the word next to it, or pass `label` for screen readers. */
export function ToneMark({ tone, label }: { tone: ToneKey; label?: string }) {
  return <><span className={`rd-shape rd-t-${tone}`} aria-hidden="true">{TONE_SHAPE[tone]}</span>{label && <span className="sr">{label}</span>}</>;
}
/** "▲ Bad for you": the shape and the word, in the tone's ink. */
export function ToneWord({ tone, children }: { tone: ToneKey; children?: ReactNode }) {
  return <span className={`rd-toneword rd-w-${tone}`}><span className={`rd-shape rd-t-${tone}`} aria-hidden="true">{TONE_SHAPE[tone]}</span>{children ?? TONE_WORD[tone]}</span>;
}

// ---------------------------------------------------------------- a check's result, said the same way everywhere
type Mark = { shape: string; cls: string };
/** The shape and colour of a check result. Confirmed takes the tone of what it confirms; the rest are statuses. */
export function resultMark(v: VerdictKey, adverse?: boolean | null): Mark {
  switch (v) {
    case "confirms": return adverse === false ? { shape: "●", cls: "good" } : { shape: "▲", cls: "bad" };
    case "contradicts": return { shape: "◆", cls: "mixed" };
    case "no_effect": return { shape: "■", cls: "neutral" };
    case "error": return { shape: "◆", cls: "mixed" };
    case "masked": return { shape: "○", cls: "info" };
    default: return { shape: "○", cls: "ring" };  // not_yet, insufficient_data
  }
}
/** "■ No effect seen (−1.5%)": the app's own words (VERDICT_LABEL), a shape, and the figure when there is one. */
export function Result({ verdict, adverse, figure, strong }: { verdict: VerdictKey; adverse?: boolean | null; figure?: string | null; strong?: boolean }) {
  const m = resultMark(verdict, adverse);
  return <span className={`rd-toneword rd-w-${m.cls}`} style={strong ? undefined : { fontWeight: 500 }}>
    <span className={`rd-shape rd-t-${m.cls}`} aria-hidden="true">{m.shape}</span>{VERDICT_LABEL[verdict]}{figure ? ` (${figure})` : ""}</span>;
}

// ---------------------------------------------------------------- page head
export function PageTitle({ title, crumbs, lede, status, actions, help }: {
  title: ReactNode; crumbs?: ReactNode; lede?: ReactNode; status?: ReactNode; actions?: ReactNode; help?: ReactNode;
}) {
  return (
    <header className="rd-pagehead">
      {crumbs && <nav className="rd-crumb" aria-label="Breadcrumb">{crumbs}</nav>}
      <div className="rd-head"><h1 className="rd-title">{title}</h1>{actions && <div className="rd-actions">{actions}</div>}</div>
      {status && <div className="rd-status rd-dots">{status}</div>}
      {lede && <p className="rd-lede">{lede}</p>}
      {help}
    </header>
  );
}

// ---------------------------------------------------------------- sections
export function Section({ title, count, meta, action, id, children, className }: {
  title: ReactNode; count?: ReactNode; meta?: ReactNode; action?: ReactNode; id?: string; children?: ReactNode; className?: string;
}) {
  const h = useId();
  return (
    <section className={`rd-sec${className ? ` ${className}` : ""}`} id={id} aria-labelledby={h}>
      <div className="rd-sec-h"><h2 id={h}>{title}</h2>
        {count !== undefined && <span className="rd-sec-m">{count}</span>}
        {meta && <span className="rd-sec-m">{meta}</span>}
        {action && <span className="rd-sec-a">{action}</span>}</div>
      {children}
    </section>
  );
}

// ---------------------------------------------------------------- tabs (filters as text)
export interface TabItem<K extends string> { key: K; label: string; count?: number }
export function TextTabs<K extends string>({ items, value, onChange, label, end }: {
  items: TabItem<K>[]; value: K; onChange: (k: K) => void; label: string; end?: ReactNode;
}) {
  return (
    <div className="rd-tabs" role="tablist" aria-label={label}>
      {items.map(t => (
        <button key={t.key} type="button" role="tab" aria-selected={value === t.key} onClick={() => onChange(t.key)}>
          {t.label}{t.count !== undefined && <span className="rd-k">{t.count}</span>}</button>))}
      {end && <span className="rd-tabs-end">{end}</span>}
    </div>
  );
}

// ---------------------------------------------------------------- folds
const Chevron = () => (
  <svg className="rd-fold-chev" viewBox="0 0 20 20" aria-hidden="true"><path d="M7 4l6 6-6 6" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>);
/** A folded part: the whole row is a real button (aria-expanded), with a one-line summary so nothing is hidden
 *  silently. With `remember`, the viewer's choice is kept in their browser; without a saved choice it starts closed. */
export function Fold({ title, summary, children, remember, defaultOpen = false, id }: {
  title: ReactNode; summary?: ReactNode; children: ReactNode; remember?: string; defaultOpen?: boolean; id?: string;
}) {
  const [open, setOpen] = useState(() => (remember ? readFold(remember) : null) ?? defaultOpen);
  const body = useId();
  const toggle = () => { const v = !open; setOpen(v); if (remember) writeFold(remember, v); };
  return (
    <div className="rd-fold" id={id}>
      <button type="button" aria-expanded={open} aria-controls={body} onClick={toggle}>
        <Chevron /><span className="rd-fold-h">{title}</span>{summary && <span className="rd-fold-s">{summary}</span>}</button>
      <div id={body} className="rd-fold-b" hidden={!open}>{open && children}</div>
    </div>
  );
}

// ---------------------------------------------------------------- figures and chains
export interface Figure { value: ReactNode; label: ReactNode; sub?: ReactNode; to?: string; hot?: boolean; go?: boolean }
/** Key figures on one ruled line (each optionally a link). `flow` draws arrows between them (a funnel). */
export function Figures({ items, size = 44, flow, label }: { items: Figure[]; size?: number; flow?: boolean; label?: string }) {
  return (
    <div className={`rd-figs${flow ? " rd-flow" : ""}`} role="list" aria-label={label}
      style={{ ["--rd-n" as string]: items.length, ["--rd-fig" as string]: `${size}px` }}>
      {items.map((f, i) => {
        const inner = <><div className={`rd-fig-v${f.hot ? " rd-hot" : f.go ? " rd-go" : ""}`}>{f.value}</div><div className="rd-fig-l">{f.label}</div>
          {f.sub && <div className="rd-fig-s">{f.sub}</div>}</>;
        return f.to ? <Link key={i} role="listitem" className="rd-fig" to={f.to}>{inner}</Link> : <div key={i} role="listitem" className="rd-fig">{inner}</div>;
      })}
    </div>
  );
}

export type StepState = "done" | "next" | "fail" | "none" | "gone";
export interface Step { label: ReactNode; value?: ReactNode; sub?: ReactNode; state?: StepState }
/** Steps that happen one after another, as one progress line. Filled: done · ring: not reached · ◆ amber: stopped
 *  by a failure · ■ grey: stopped by a judgement (nothing more to do). `sm` for a row (Radar's stories). */
export function Chain({ steps, size = "lg", label }: { steps: Step[]; size?: "lg" | "sm"; label: string }) {
  return (
    <ol className={`rd-chain${size === "sm" ? " rd-sm" : ""}`} aria-label={label} style={{ ["--rd-n" as string]: steps.length }}>
      {steps.map((s, i) => {
        const st = s.state ?? "done", nextSt = steps[i + 1]?.state ?? "done";
        return (
          <li key={i} className="rd-step" data-s={st} data-to={nextSt === "next" ? "next" : undefined}>
            <div className="rd-step-l">{s.label}</div>
            {s.value !== undefined && <div className="rd-step-v">{s.value}</div>}
            {s.sub && <div className="rd-step-s">{s.sub}</div>}
          </li>);
      })}
    </ol>
  );
}

// ---------------------------------------------------------------- a static scale
/** A value on a line, with an optional usual range (band) and a threshold (dashed). Static SVG, no animation. */
export function Scale({ min, max, value, band, threshold, valueLabel, thresholdLabel, bandLabel, width = 900, label }: {
  min: number; max: number; value: number; band?: [number, number]; threshold?: number; valueLabel: string;
  thresholdLabel?: string; bandLabel?: string; width?: number; label: string;
}) {
  const pad = 8, w = width - pad * 2, x = (v: number) => pad + Math.max(0, Math.min(1, (v - min) / (max - min))) * w;
  return (
    <svg className="rd-scale" width={width} height={72} viewBox={`0 0 ${width} 72`} role="img" aria-label={label}>
      <line x1={pad} x2={width - pad} y1={36} y2={36} stroke="var(--rd-mark)" strokeWidth={1.5} />
      {band && <><rect x={x(band[0])} y={29} width={x(band[1]) - x(band[0])} height={14} rx={7} fill="var(--rd-band)" />
        <line x1={x(band[0])} x2={x(band[0])} y1={26} y2={46} stroke="var(--rd-mark)" strokeWidth={2} />
        <line x1={x(band[1])} x2={x(band[1])} y1={26} y2={46} stroke="var(--rd-mark)" strokeWidth={2} />
        {bandLabel && <text x={(x(band[0]) + x(band[1])) / 2} y={66} textAnchor="middle">{bandLabel}</text>}</>}
      {threshold !== undefined && <><line x1={x(threshold)} x2={x(threshold)} y1={14} y2={58} stroke="var(--ink)" strokeWidth={2} strokeDasharray="5 4" />
        {thresholdLabel && <text className="rd-scale-v" x={x(threshold) + 8} y={16}>{thresholdLabel}</text>}</>}
      <circle cx={x(value)} cy={36} r={9} fill="var(--ink)" />
      <text className="rd-scale-v" x={x(value)} y={16} textAnchor="middle">{valueLabel}</text>
    </svg>
  );
}

// ---------------------------------------------------------------- small pieces
/** "◆ Prices haven't updated since 10 Nov.": a problem said once, in words, in amber ink. */
export function QuietWarn({ children }: { children: ReactNode }) {
  return <p className="rd-warn" style={{ margin: "10px 0 0" }}><span className="rd-shape rd-t-mixed" aria-hidden="true">◆</span> {children}</p>;
}
/** A text action (the third tier): underlined, never a box. */
export function TextButton({ children, onClick, disabled, title, ...rest }: {
  children: ReactNode; onClick?: () => void; disabled?: boolean; title?: string; "aria-expanded"?: boolean; "aria-controls"?: string;
}) {
  return <button type="button" className="rd-tbtn" onClick={onClick} disabled={disabled} title={title} {...rest}>{children}</button>;
}
/** A navigation link in the action colour, with an arrow ("Open the event →"). For named things use `.rd-name`. */
export function GoLink({ to, children }: { to: string; children: ReactNode }) {
  return <Link className="rd-go" to={to}>{children} →</Link>;
}

/** A finding's source as the sidebar's icon (Monitors, Radar, Market series), named for screen readers and as a tooltip. */
const SOURCE_ICON: Record<string, string> = { monitor: "monitor", radar: "radar", timeseries: "series", studio: "studio" };
export function SourceMark({ source }: { source: string }) {
  const label = sourceInfo(source).label;
  return <span className="rd-src" role="img" aria-label={label} title={label}><Icon name={SOURCE_ICON[source] ?? "info"} /></span>;
}

/** A summary held to two lines. When it is longer, "Show more" opens the rest in place (aria-expanded); the full text
 *  is also the tooltip while it is clamped. */
export function ClampedText({ text, className = "rd-row-d rd-prose" }: { text: string; className?: string }) {
  const [open, setOpen] = useState(false);
  const [over, setOver] = useState(false);
  const ref = useRef<HTMLParagraphElement>(null);
  const id = useId();
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || open) return;
    const check = () => setOver(el.scrollHeight > el.clientHeight + 1);
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, [text, open]);
  return <>
    <p ref={ref} id={id} className={`${className}${open ? "" : " rd-clamp2"}`} title={open || !over ? undefined : text}>{text}</p>
    {(over || open) && <TextButton aria-expanded={open} aria-controls={id} onClick={() => setOpen(o => !o)}>{open ? "Show less" : "Show more"}</TextButton>}
  </>;
}
