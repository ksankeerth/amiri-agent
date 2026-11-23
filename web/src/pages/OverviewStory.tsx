// The Overview below its first screen, in rows: two sections side by side (lists only), Radar with its sweep beside its
// list, and a full-width row. Items are green bulletin cards; only the radar row moves.
import type { ReactNode } from "react";
import { useState } from "react";
import { ParticleScene, type SceneData, type SceneKind } from "./ParticleScene";

export type StorySection = { id: string; label: string; count?: number; warn?: boolean; body: ReactNode; wide?: boolean;
  scene?: { kind: SceneKind; data: SceneData; label: string } };
export type StoryRow = StorySection | [StorySection, StorySection];

function Head({ x }: { x: StorySection }) {
  return <h2 id={`${x.id}-h`}>{x.label}{x.count != null && <span className="ovs-n">{x.count}</span>}
    {x.warn && <span className="ovs-warn">◆ check</span>}</h2>;
}

function Section({ x, className }: { x: StorySection; className: string }) {
  return <section id={x.id} className={className} aria-labelledby={`${x.id}-h`}>
    <div className="ovs-text"><Head x={x} /><div className="ovs-cards">{x.body}</div></div>
    {x.scene && <div className="ovs-art"><ParticleScene {...x.scene} /></div>}
  </section>;
}

export function OverviewStory({ rows }: { rows: StoryRow[] }) {
  return <div className="ovs-wrap">{rows.map(r => Array.isArray(r)
    ? <div key={r[0].id} className="ovs-pair">{r.map(x => <Section key={x.id} x={x} className="ovs-col" />)}</div>
    : <Section key={r.id} x={r} className={r.scene ? "ovs" : "ovs-col ovs-wide"} />)}</div>;
}

/** "Show N more" / "Show fewer" in place, for a list without a page of its own. */
export function MoreInPlace({ rest, label }: { rest: ReactNode[]; label: (n: number) => string }) {
  const [open, setOpen] = useState(false);
  if (!rest.length) return null;
  return <>{open && rest}<button type="button" className="ovt-more" aria-expanded={open} onClick={() => setOpen(o => !o)}>
    {open ? "Show fewer" : label(rest.length)}</button></>;
}

/** An event's products and themes, opened in place inside its card. */
export function Reveal({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return <><button type="button" className="ovt-more" aria-expanded={open} onClick={() => setOpen(o => !o)}>{label}</button>{open && children}</>;
}
