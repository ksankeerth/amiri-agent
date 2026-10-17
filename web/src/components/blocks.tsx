// The building blocks every page is made of: a header, a strip of key facts, rows with a fixed anatomy, status pills
// with one colour meaning, and detail on demand. Pages compose these instead of writing their own markup.
import { useContext, useEffect, useId, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { ref } from "../api/reference";
import { placeName, placeOrder } from "../format";
import type { Tone } from "../plain";
import { Icon } from "./Icon";
import { ChatToggleCtx } from "./ui";

/** A page's opening: a short title, one plain status line, the main action on the right, and a "How this works" link
 *  that opens the explanation in place (instead of a paragraph under every title). */
export function PageHeader({ title, status, actions, crumbs, pills, help, helpLabel = "How this works", eyebrow }: {
  title: ReactNode; status?: ReactNode; actions?: ReactNode; crumbs?: ReactNode; pills?: ReactNode; help?: ReactNode; helpLabel?: string; eyebrow?: ReactNode;
}) {
  const chat = useContext(ChatToggleCtx);
  const [open, setOpen] = useState(false);
  const panel = useId();
  return (
    <header className="ph">
      {crumbs && <nav className="crumbs" aria-label="Breadcrumb">{crumbs}</nav>}
      <div className="ph-row">
        <div className="ph-titles">
          {eyebrow && <span className="label">{eyebrow}</span>}
          <div className="ph-title"><h1>{title}</h1>{pills}</div>
          {(status || help) && <div className="ph-status">
            {status && <span>{status}</span>}
            {help && <button type="button" className="ph-help" aria-expanded={open} aria-controls={panel} onClick={() => setOpen(o => !o)}>
              <Icon name="help" />{helpLabel}</button>}
          </div>}
        </div>
        {(actions || (chat && !chat.open)) && <div className="ph-actions">{actions}
          {chat && !chat.open && <button className="btn" type="button" onClick={chat.toggle}><Icon name="chat" />Setup agent</button>}</div>}
      </div>
      {help && <div id={panel} className="ph-panel" hidden={!open}>{help}</div>}
    </header>
  );
}

/** One status, one colour meaning (see Tone in plain.ts). Sentence case: calmer than capitals, easier to read. */
export function StatusPill({ tone, icon, children, title }: { tone: Tone; icon?: string; children: ReactNode; title?: string }) {
  return <span className={`pill t-${tone}`} title={title}>{icon ? <Icon name={icon} /> : <span className="pd" aria-hidden="true" />}{children}</span>;
}

/** Bad or good for the institution: a word and a shape, never a bare arrow (a rise can be either). */
export function ImpactMarker({ adverse }: { adverse: boolean | null }) {
  if (adverse === null) return <StatusPill tone="grey">Unclear for you</StatusPill>;
  return adverse ? <StatusPill tone="red" icon="bad">Bad for you</StatusPill> : <StatusPill tone="green" icon="good">Good for you</StatusPill>;
}

/** An event's overall effect on the institution. */
export function TonePill({ tone }: { tone: "good" | "bad" | "mixed" | "neutral" }) {
  if (tone === "bad") return <ImpactMarker adverse={true} />;
  if (tone === "good") return <ImpactMarker adverse={false} />;
  return tone === "mixed" ? <StatusPill tone="amber">Mixed for you</StatusPill> : <StatusPill tone="grey">Neutral for you</StatusPill>;
}

export interface Tile { value: ReactNode; label: string; sub?: ReactNode; tone?: Tone; icon?: string }
/** Two to four key facts: the number big, the label small. */
export function StatTiles({ items, label }: { items: Tile[]; label?: string }) {
  return (
    <ul className="tiles" aria-label={label}>{items.map((t, i) => (
      <li key={i} className={`tile${t.tone ? ` t-${t.tone}` : ""}`}>
        {t.icon && <Icon name={t.icon} className="tile-ico" />}
        <span className="tile-v">{t.value}</span>
        <span className="tile-l">{t.label}</span>
        {t.sub && <span className="tile-s">{t.sub}</span>}
      </li>))}
    </ul>
  );
}

/** A card with a short heading, an optional count and a link on the right. */
export function Section({ title, count, action, children, flush, id }: { title: string; count?: ReactNode; action?: ReactNode; children: ReactNode; flush?: boolean; id?: string }) {
  return (
    <section className="card sec" aria-labelledby={id}>
      <div className="sec-hd"><h2 id={id}>{title}</h2>{count !== undefined && <span className="sec-n">{count}</span>}<span className="spacer" />{action}</div>
      <div className={flush ? "sec-bd flush" : "sec-bd"}>{children}</div>
    </section>
  );
}

/** A list row: a marker, a bold short label, one line of plain detail, and a meta on the right. */
export function Row({ marker, label, detail, meta, to, icon }: { marker?: ReactNode; label: ReactNode; detail?: ReactNode; meta?: ReactNode; to?: string; icon?: string }) {
  const body = <>
    {icon && <span className="row-ico"><Icon name={icon} /></span>}
    <span className="row-main"><span className="row-top">{marker}<b className="row-l">{label}</b></span>{detail && <span className="row-d">{detail}</span>}</span>
    {meta && <span className="row-meta">{meta}</span>}
    {to && <Icon name="chevron" className="row-go" />}
  </>;
  return to ? <Link className="lrow click" to={to}>{body}</Link> : <div className="lrow">{body}</div>;
}

/** A possible impact on one product: what may happen, bad or good for you, how big and when, and the check against your
 *  data. Its detail opens on demand. */
export function ImpactRow({ product, kind, impact, adverse, size, status, children }: {
  product: string; kind?: string; impact: ReactNode; adverse?: boolean | null; size?: string; status?: ReactNode; children?: ReactNode;
}) {  // adverse left out: the marker is said once elsewhere (an alert's impacts are all bad for you)
  const cells = <>
    <span className="ir-prod"><b>{product}</b>{kind && <span className="ir-kind">{kind}</span>}</span>
    <span className="ir-impact">{impact}</span>
    <span className="ir-marks">{adverse !== undefined && <ImpactMarker adverse={adverse} />}{size && <span className="ir-size">{size}</span>}</span>
    <span className="ir-status">{status}</span>
  </>;
  if (!children) return <div className="ir"><div className="ir-row">{cells}</div></div>;
  return (
    <details className="ir">
      <summary className="ir-row">{cells}<Icon name="chevron" className="ir-chev" /></summary>
      <div className="ir-body">{children}</div>
    </details>
  );
}

/** Label and value pairs, instead of a string joined with dots. */
export function FactList({ items, inline }: { items: [string, ReactNode][]; inline?: boolean }) {
  const shown = items.filter(([, v]) => v !== null && v !== undefined && v !== "" && v !== false);
  return <dl className={inline ? "facts inline" : "facts"}>{shown.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>;
}

export interface Step { label: string; detail?: ReactNode; state: "done" | "now" | "next"; icon: string }
/** How far something has got through Amiri Agent's flow: noticed, investigated, impacts, alerts, checks. */
export function Steps({ steps, label = "Progress" }: { steps: Step[]; label?: string }) {
  return (
    <ol className="steps" aria-label={label}>{steps.map((s, i) => (
      <li key={i} className={`step s-${s.state}`}>
        <span className="step-dot"><Icon name={s.state === "done" ? "check" : s.icon} /></span>
        <span className="step-txt"><b>{s.label}</b>{s.detail && <span>{s.detail}</span>}</span>
        <span className="sr">{s.state === "done" ? "(done)" : s.state === "now" ? "(in progress)" : "(next)"}</span>
      </li>))}
    </ol>
  );
}

/** Ids, versions, scores and raw reasons: closed until someone wants them. */
export function TechnicalDetails({ children, summary = "Technical details" }: { children: ReactNode; summary?: string }) {
  return <details className="tech"><summary>{summary}</summary><div className="tech-bd">{children}</div></details>;
}

/** A finding, as where it came from: the source, the headline (linked when there is one) and one line about it. */
export function SourceCard({ icon, source, title, href, outlet, when, detail, to, toLabel, note }: {
  icon: string; source: string; title: string; href?: string | null; outlet?: string | null; when?: string; detail?: string; to?: string; toLabel?: string; note?: string;
}) {
  return (
    <article className="src">
      <span className="src-ico"><Icon name={icon} /></span>
      <div className="src-main">
        <div className="src-top"><span>{source}</span>{outlet && <span>{outlet}</span>}{when && <span>{when}</span>}</div>
        <h3 className="src-t">{href ? <a href={href} target="_blank" rel="noreferrer">{title}<Icon name="external" className="src-ext" /><span className="sr"> (opens the article)</span></a> : title}</h3>
        {detail && <p className="src-d">{detail}</p>}
        {to && <Link className="src-to" to={to}>{toLabel ?? "Open"} <Icon name="arrow" /></Link>}
        {note && <span className="src-note">{note}</span>}
      </div>
    </article>
  );
}

const HOW: { icon: string; t: string; d: string }[] = [
  { icon: "eye", t: "Watches", d: "News through your monitors, market prices and Radar." },
  { icon: "search", t: "Notices", d: "A finding: something worth a closer look, like a strike on Gulf ports." },
  { icon: "events", t: "Investigates", d: "Links it to an event and works out which of your products it could hit." },
  { icon: "alert", t: "Alerts", d: "Tells the team that owns each product, so someone takes it on." },
  { icon: "data", t: "Checks", d: "Tests each possible impact against your own figures as they're published." },
];
/** What Amiri Agent does, in five steps: the explainer behind every "How this works" link. */
export function HowItWorks({ children }: { children?: ReactNode }) {
  return (
    <div className="how">
      <ol className="how-steps">{HOW.map((s, i) => (
        <li key={s.t}><span className="how-ico"><Icon name={s.icon} /></span><span><b>{i + 1}. {s.t}</b><span>{s.d}</span></span></li>))}</ol>
      {children && <div className="how-more">{children}</div>}
    </div>
  );
}

// ---------------------------------------------------------------- places
const named = new Map<string, string>();
/** Place codes as names. Seas, straits and regions are looked up in the reference data once (countries are named by
 *  the browser), so a page shows "Strait of Hormuz", never "chk:hormuz". */
export function usePlaceNames(codes: string[]): (code: string) => string {
  const [, bump] = useState(0);
  const key = codes.join(",");
  useEffect(() => {
    const todo = codes.filter(c => !/^[A-Z]{2}$/.test(c) && !named.has(c));
    if (!todo.length) return;
    let live = true;
    Promise.all(todo.map(c => ref.place(c).then(p => { if (p.name) named.set(c, p.name); }).catch(() => {})))
      .then(() => { if (live) bump(n => n + 1); });
    return () => { live = false; };
  }, [key]);  // eslint-disable-line react-hooks/exhaustive-deps
  return (c: string) => named.get(c) ?? placeName(c);
}

/** Where something happened, short: the first few names, then "+5 more" with the rest on hover. */
export function Places({ codes, max = 3 }: { codes: string[]; max?: number }) {
  const name = usePlaceNames(codes);
  const all = placeOrder(codes).map(name);
  if (!all.length) return null;
  const shown = all.slice(0, max), rest = all.length - shown.length;
  return <span className="places" title={rest ? all.join(", ") : undefined}>{shown.join(", ")}{rest > 0 && <span className="muted"> +{rest} more</span>}</span>;
}
