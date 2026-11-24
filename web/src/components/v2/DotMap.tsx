// The still dotted map (board 00, top right): a grid of dots where there is land, and the events' places marked with a
// shape (▲ bad ◆ mixed ▼ good) and a name. No animation, light and dark. A picture, so it is role="img" with a label
// that names the places (A7); the page says the same places in its text.
// The dots come from the world shapes the app already ships (world-atlas), drawn once on an off-screen canvas and read
// back at the middle of each cell.
import { geoNaturalEarth1, geoPath } from "d3-geo";
import type { FeatureCollection, Geometry } from "geojson";
import { useEffect, useMemo, useState } from "react";
import { feature } from "topojson-client";
import { directionOf, type DirectionTone } from "./directionWords";
import { DirectionMark } from "./Direction";
import { describePlaces, frameOf, gridCells, pickSides } from "./dotMapMath";

export interface DotPlace {
  label: string;
  lon: number;
  lat: number;
  tone: DirectionTone | string;
  /** The place the picture is about: full-strength mark, bold name. */
  strong?: boolean;
  /** A dashed ring round it (the focus of an event). */
  halo?: boolean;
  /** Where the name sits (default: the first of right, left, top, bottom that stays on the picture and clear of other names). */
  side?: "right" | "left" | "top" | "bottom";
}
export interface DotMapProps {
  places: DotPlace[];
  /** [lon, lat] points to frame (a country's corners). Default: the places, with their neighbours (at least `minSpan`° each way). */
  fit?: [number, number][];
  /** The smallest area framed, in degrees (default 30, so one place still shows its neighbours). A small country: 10. */
  minSpan?: number;
  width?: number;
  height?: number;
  /** The start of the picture's label: "Where today's events are". */
  intro?: string;
  /** Replaces the generated label. */
  description?: string;
  /** The key under the picture: ▲ bad ◆ mixed ▼ good. */
  legend?: boolean;
  className?: string;
}

type World = FeatureCollection<Geometry, { name: string }>;
let worldP: Promise<World> | null = null;
function loadWorld(): Promise<World> {
  worldP ??= import("world-atlas/countries-50m.json").then(m => {
    const topo = (m as any).default ?? m;
    return feature(topo, topo.objects.countries) as unknown as World;
  });
  return worldP;
}

const CELL = 7, MARGIN = 10;
const cache = new Map<string, string>();

/** The dots as one path: a zero-length segment per dot, drawn with round caps. */
function dotPath(world: World, projection: ReturnType<typeof geoNaturalEarth1>, w: number, h: number): string {
  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return "";
  ctx.beginPath();
  geoPath(projection, ctx)(world);
  ctx.fill();
  const px = ctx.getImageData(0, 0, w, h).data;
  let d = "";
  for (const c of gridCells(w, h, CELL)) if (px[(Math.floor(c.y) * w + Math.floor(c.x)) * 4 + 3] > 127) d += `M${c.x} ${c.y}h0`;
  return d;
}

export function DotMap({ places, fit, minSpan, width = 511, height = 224, intro, description, legend = true, className }: DotMapProps) {
  const framed = useMemo(() => frameOf(fit ?? places.map(p => [p.lon, p.lat] as [number, number]), minSpan), [fit, places, minSpan]);
  const projection = useMemo(() => {
    const p = geoNaturalEarth1();
    if (framed.length) p.fitExtent([[MARGIN, MARGIN], [width - MARGIN, height - MARGIN]], { type: "MultiPoint", coordinates: framed });
    return p;
  }, [framed, width, height]);
  const key = `${width}x${height}:${framed.map(p => p.map(n => n.toFixed(2)).join(",")).join(";")}`;
  const [dots, setDots] = useState<string>(cache.get(key) ?? "");
  useEffect(() => {
    const hit = cache.get(key);
    if (hit !== undefined) { setDots(hit); return; }
    let live = true;
    loadWorld().then(w => {
      const d = dotPath(w, projection, width, height);
      cache.set(key, d);
      if (live) setDots(d);
    }).catch(() => { /* no dots: the markers and their names still tell it */ });
    return () => { live = false; };
  }, [key, projection, width, height]);

  const marks = places.map(p => ({ p, xy: projection([p.lon, p.lat]), tone: directionOf(p.tone) })).filter((m): m is { p: DotPlace; xy: [number, number]; tone: DirectionTone } => !!m.xy);
  const label = description ?? describePlaces(marks.map(m => ({ label: m.p.label, tone: m.tone })), intro);
  // strongest first, so the place the picture is about gets the best spot for its name
  const order = marks.map((_, i) => i).sort((a, b) => Number(!!marks[b].p.strong) - Number(!!marks[a].p.strong) || a - b);
  const picked = pickSides(order.map(i => ({ label: marks[i].p.label, x: marks[i].xy[0], y: marks[i].xy[1], side: marks[i].p.side })), width, height);
  const sideOf = new Map(order.map((i, n) => [i, picked[n]]));
  return (
    <figure className={`v2-dotmap${className ? ` ${className}` : ""}`}>
      <div className="v2-dotmap__box" role="img" aria-label={label} style={{ aspectRatio: `${width} / ${height}`, maxWidth: width }}>
        <svg className="v2-dotmap__dots" viewBox={`0 0 ${width} ${height}`} aria-hidden="true" focusable="false"><path d={dots} /></svg>
        {marks.map(({ p, xy, tone }, i) => (
          <span key={p.label} className={`v2-dotmap__pt is-${sideOf.get(i) ?? "right"}${p.strong ? " is-strong" : ""} v2-dotmap__pt--${tone}`}
            style={{ left: `${(xy[0] / width) * 100}%`, top: `${(xy[1] / height) * 100}%` }} aria-hidden="true">
            {p.halo && <span className="v2-dotmap__halo" />}
            <DirectionMark tone={tone} size={p.strong ? 14 : 13} />
            <span className="v2-dotmap__name">{p.label}</span>
          </span>
        ))}
      </div>
      {legend && (
        <figcaption className="v2-dotmap__legend">
          {(["bad", "mixed", "good"] as const).map(t => <span key={t}><DirectionMark tone={t} size={11} /> {t}</span>)}
        </figcaption>
      )}
    </figure>
  );
}
