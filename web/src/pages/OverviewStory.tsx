// The Overview below its first screen: one section at a time, its list in one column on one side and a glowing-particle
// scene about that section on the other; the sides alternate down the page. Items are green bulletin cards.
import type { ReactNode } from "react";
import { useState } from "react";
import { ParticleScene, type SceneData, type SceneKind } from "./ParticleScene";

export type StorySection = { id: string; label: string; count?: number; warn?: boolean; body: ReactNode;
  scene: { kind: SceneKind; data: SceneData; label: string } };

export function OverviewStory({ sections }: { sections: StorySection[] }) {
  return <div className="ovs-wrap">{sections.map((x, i) => (
    <section key={x.id} id={x.id} className="ovs" data-flip={i % 2 ? "" : undefined} aria-labelledby={`${x.id}-h`}>
      <div className="ovs-text">
        <h2 id={`${x.id}-h`}>{x.label}{x.count != null && <span className="ovs-n">{x.count}</span>}
          {x.warn && <span className="ovs-warn">◆ check</span>}</h2>
        <div className="ovs-cards">{x.body}</div>
      </div>
      <div className="ovs-art"><ParticleScene {...x.scene} /></div>
    </section>))}</div>;
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
