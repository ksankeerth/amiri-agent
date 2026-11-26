// The still dotted map (board 00, top right): a grid of dots where there is land, and the events' places marked with a
// shape (▲ bad ◆ mixed ▼ good) and a name. No animation, light and dark. A picture, so it is role="img" with a label
// that names the places (A7); the page says the same places in its text.
// The dots come from the world shapes the app already ships (world-atlas), drawn once on an off-screen canvas (at the
// screen's pixel density) and read back over each cell. The picture is framed on what it is about (F5): the home footprint
// (a country, or a state or city) and the events' places; the dots get finer the smaller the area framed (70 across for a
// continent, 92 for a country or a state). The home footprint is shaded lightly: a country by its shape, a state or a city by
// a soft halo (the shapes have countries only).
import { geoArea, geoBounds, geoNaturalEarth1, geoPath } from "d3-geo";
import type { Feature, FeatureCollection, Geometry } from "geojson";
import { useEffect, useMemo, useState } from "react";
import { feature } from "topojson-client";
import { directionOf, type DirectionTone } from "./directionWords";
import { DirectionMark } from "./Direction";
import { cellSize, describePlaces, frameBox, haloLevel, mainBounds, minSpanFor, pickSides } from "./dotMapMath";

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
/** The home footprint, shaded lightly and framed with the events' places. */
export interface DotShade {
  /** ISO numeric ids of countries shaded whole. */
  countries?: string[];
  /** A soft halo of `r` degrees round a state or a city (and only over `within`'s land, a country's numeric id). */
  halos?: { lat: number; lon: number; r: number; within?: string | null }[];
  /** The names, for the picture's words. */
  names?: string[];
}
export interface DotMapProps {
  places: DotPlace[];
  /** [lon, lat] points to frame (a country's corners). Default: the places and the shaded footprint, with a little room round them. */
  fit?: [number, number][];
  /** The smallest area framed, in degrees (default: from the size of the footprint, else 30, so one place still shows its neighbours). */
  minSpan?: number;
  shade?: DotShade;
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
let worldNow: World | null = null;
function loadWorld(): Promise<World> {
  worldP ??= import("world-atlas/countries-50m.json").then(m => {
    const topo = (m as any).default ?? m;
    worldNow = feature(topo, topo.objects.countries) as unknown as World;
    return worldNow;
  });
  return worldP;
}

const MARGIN = 10, PAD = 0.18, LAND_HITS = 3;  // a cell is land when 3 of 9 points sampled in it are
const cache = new Map<string, Dots>();
interface Dots { base: string; soft: string; tint: string; stroke: number }

const polygonsOf = (f: Feature<Geometry>): number[][][][] =>
  f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.type === "MultiPolygon" ? f.geometry.coordinates : [];
/** The box of a country's main land (not its far islands), or null when it has none that can be framed. */
function countryBox(world: World, numeric: string): [[number, number], [number, number]] | null {
  const f = world.features.find(x => String(x.id) === numeric);
  if (!f) return null;
  return mainBounds(polygonsOf(f).map(c => {
    const g = { type: "Polygon", coordinates: c } as const;
    return { area: geoArea(g), box: geoBounds(g) as [[number, number], [number, number]] };
  }));
}

interface HaloPx { x: number; y: number; r: number; within: string | null }
/** The dots as paths (a zero-length segment per dot, drawn with round caps): the plain ones, and the ones in the soft ring and
 *  the inner part of the footprint. */
function dotPaths(world: World, projection: ReturnType<typeof geoNaturalEarth1>, w: number, h: number, cell: number,
  countries: string[], halos: HaloPx[]): Omit<Dots, "stroke"> {
  const dpr = Math.min(3, Math.max(1, window.devicePixelRatio || 1));
  const layer = (features: Feature<Geometry>[]) => {
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(w * dpr); canvas.height = Math.ceil(h * dpr);
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    ctx.scale(dpr, dpr);
    ctx.beginPath();
    geoPath(projection, ctx)({ type: "FeatureCollection", features });
    ctx.fill();
    const px = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    const o = cell / 3;
    return (cx: number, cy: number) => {
      let hits = 0;
      for (const dy of [-o, 0, o]) for (const dx of [-o, 0, o]) {
        const x = Math.min(canvas.width - 1, Math.max(0, Math.floor((cx + dx) * dpr))), y = Math.min(canvas.height - 1, Math.max(0, Math.floor((cy + dy) * dpr)));
        if (px[(y * canvas.width + x) * 4 + 3] > 127) hits++;
      }
      return hits >= LAND_HITS;
    };
  };
  const land = layer(world.features);
  if (!land) return { base: "", soft: "", tint: "" };
  const ids = new Set(countries);
  const home = ids.size ? layer(world.features.filter(f => ids.has(String(f.id)))) : null;
  const inside = new Map<string, ReturnType<typeof layer>>();
  for (const id of new Set(halos.map(x => x.within).filter((x): x is string => !!x))) inside.set(id, layer(world.features.filter(f => String(f.id) === id)));
  let base = "", soft = "", tint = "";
  const cols = Math.round(w / cell), rows = Math.floor(h / cell);
  for (let row = 0; row < rows; row++) for (let col = 0; col < cols; col++) {
    const x = col * cell + cell / 2, y = row * cell + cell / 2;
    if (!land(x, y)) continue;
    let level = home?.(x, y) ? 2 : 0;
    for (const hl of halos) {
      if (level === 2) break;
      if (hl.within && !inside.get(hl.within)?.(x, y)) continue;
      level = Math.max(level, haloLevel(x - hl.x, y - hl.y, hl.r)) as 0 | 1 | 2;
    }
    const seg = `M${+x.toFixed(2)} ${+y.toFixed(2)}h0`;
    if (level === 2) tint += seg; else if (level === 1) soft += seg; else base += seg;
  }
  return { base, soft, tint };
}

export function DotMap({ places, fit, minSpan, shade, width = 511, height = 224, intro, description, legend = true, className }: DotMapProps) {
  const [world, setWorld] = useState<World | null>(worldNow);
  useEffect(() => { if (!world) loadWorld().then(setWorld).catch(() => { /* no dots: the markers and their names still tell it */ }); }, [world]);

  const countries = shade?.countries, halos = shade?.halos;
  // the home footprint's boxes: a halo's square, a country's main land (once the shapes are in)
  const boxes = useMemo(() => {
    const out: [[number, number], [number, number]][] = (halos ?? []).map(x => [[x.lon - x.r, x.lat - x.r], [x.lon + x.r, x.lat + x.r]]);
    if (world) for (const id of countries ?? []) { const b = countryBox(world, id); if (b) out.push(b); }
    return out;
  }, [halos, countries, world]);
  const framed = useMemo(() => {
    if (fit) return frameBox(fit, minSpan);
    const pts = [...places.map(p => [p.lon, p.lat] as [number, number]), ...boxes.flatMap(b => [b[0], b[1]])];
    const dim = Math.max(0, ...boxes.map(b => Math.max(b[1][0] - b[0][0], b[1][1] - b[0][1])));
    return frameBox(pts, minSpan ?? (dim > 0 ? minSpanFor(dim) : undefined), PAD);
  }, [fit, places, boxes, minSpan]);
  const projection = useMemo(() => {
    const p = geoNaturalEarth1();
    if (framed.length) p.fitExtent([[MARGIN, MARGIN], [width - MARGIN, height - MARGIN]], { type: "MultiPoint", coordinates: framed });
    return p;
  }, [framed, width, height]);
  // dots follow the area shown: about 70 across for a continent, 92 for a country or a state
  const degAcross = width / (projection.scale() * 0.8707 * Math.PI / 180);  // 0.8707: Natural Earth's width at the equator, per radian
  const { cell } = cellSize(width, degAcross);
  const stroke = Math.max(2, Math.round(cell * 0.43 * 2) / 2);
  const halosPx = useMemo<HaloPx[]>(() => (halos ?? []).flatMap(x => {
    const c = projection([x.lon, x.lat]), n = projection([x.lon, x.lat + x.r]), e = projection([x.lon + x.r, x.lat]);
    return c && n && e ? [{ x: c[0], y: c[1], r: (Math.abs(n[1] - c[1]) + Math.abs(e[0] - c[0])) / 2, within: x.within ?? null }] : [];
  }), [halos, projection]);
  const dpr = typeof window === "undefined" ? 1 : Math.round(window.devicePixelRatio || 1);
  const key = `${width}x${height}@${dpr}:${cell.toFixed(3)}:${framed.map(p => p.map(n => n.toFixed(2)).join(",")).join(";")}|${(countries ?? []).join(",")}|${halosPx.map(x => `${x.x.toFixed(1)},${x.y.toFixed(1)},${x.r.toFixed(1)},${x.within}`).join(";")}`;
  const [dots, setDots] = useState<Dots | undefined>(cache.get(key));
  useEffect(() => {
    const hit = cache.get(key);
    if (hit) { setDots(hit); return; }
    if (!world) return;
    const d = { ...dotPaths(world, projection, width, height, cell, countries ?? [], halosPx), stroke };
    cache.set(key, d);
    setDots(d);
  }, [key, world, projection, width, height, cell, countries, halosPx, stroke]);

  const marks = places.map(p => ({ p, xy: projection([p.lon, p.lat]), tone: directionOf(p.tone) })).filter((m): m is { p: DotPlace; xy: [number, number]; tone: DirectionTone } => !!m.xy);
  const label = description ?? describePlaces(marks.map(m => ({ label: m.p.label, tone: m.tone })), intro, shade?.names?.join(", "));
  // strongest first, so the place the picture is about gets the best spot for its name
  const order = marks.map((_, i) => i).sort((a, b) => Number(!!marks[b].p.strong) - Number(!!marks[a].p.strong) || a - b);
  const picked = pickSides(order.map(i => ({ label: marks[i].p.label, x: marks[i].xy[0], y: marks[i].xy[1], side: marks[i].p.side })), width, height);
  const sideOf = new Map(order.map((i, n) => [i, picked[n]]));
  return (
    <figure className={`v2-dotmap${className ? ` ${className}` : ""}`}>
      <div className="v2-dotmap__box" role="img" aria-label={label} style={{ aspectRatio: `${width} / ${height}`, maxWidth: width }}>
        <svg className="v2-dotmap__dots" viewBox={`0 0 ${width} ${height}`} strokeWidth={dots?.stroke ?? stroke} aria-hidden="true" focusable="false">
          <path d={dots?.base ?? ""} />
          <path className="is-soft" d={dots?.soft ?? ""} />
          <path className="is-tint" d={dots?.tint ?? ""} />
        </svg>
        {marks.map(({ p, xy, tone }, i) => (
          <span key={`${p.label}:${i}`} className={`v2-dotmap__pt is-${sideOf.get(i) ?? "right"}${p.strong ? " is-strong" : ""} v2-dotmap__pt--${tone}`}
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
