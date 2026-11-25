// The profile on a map: footprint, customer groups, flows, sea routes, regulators,
// rivals, places to watch and risk zones. Drawn from the profile and reference data
// (coordinates from the gazetteer, or a country's centre from its shape).
import { geoCentroid, geoCircle, geoNaturalEarth1, geoPath } from "d3-geo";
import type { Feature, FeatureCollection, Geometry } from "geojson";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { feature } from "topojson-client";
import type { PlaceInfo, Profile } from "../../api/institutions";
import { ref, type Hazard, type Route } from "../../api/reference";
import { usdText, useLoad } from "./fields";
import { mirrorAround } from "../../components/chartMath";
import { FLOW_WORDS, moneyGoesOut } from "../../components/setupFlow";

type World = FeatureCollection<Geometry, { name: string }>;
const MIN_SPAN = 30;  // degrees: the smallest area the map zooms to (about Borneo with its neighbours)
const ZOOM_MIN = 0.5, ZOOM_MAX = 16, ZOOM_STEP = 1.6;
let worldP: Promise<World> | null = null;
function loadWorld(): Promise<World> {
  worldP ??= import("world-atlas/countries-50m.json").then(m => {
    const topo = (m as any).default ?? m;
    return feature(topo, topo.objects.countries) as unknown as World;
  });
  return worldP;
}

const LAYERS = [["footprint", "Footprint"], ["segments", "Customer groups"], ["flows", "Flows"], ["routes", "Sea routes"],
  ["regulators", "Regulators"], ["rivals", "Rivals"], ["watch", "Places to watch"], ["risks", "Risk zones"]] as const;
export type Layer = (typeof LAYERS)[number][0];
/** An event to mark on the map (the Overview): its places, coloured by what it means for the institution. */
export interface MapEvent { event_id: string; title: string; tone: "good" | "bad" | "mixed" | "neutral"; places: string[] }
const TONE_COLOR: Record<MapEvent["tone"], string> = { bad: "var(--critical)", good: "var(--accent)", mixed: "var(--high)", neutral: "var(--ink-3)" };
/** The event's marker: a shape per tone as well as a colour, so it reads without colour (▲ bad, ● good, ◆ mixed, ■ neutral). */
function ToneShape({ tone, s = 1, stroke = "var(--surface)", sw = 2 }: { tone: MapEvent["tone"]; s?: number; stroke?: string; sw?: number }) {
  const p = { fill: TONE_COLOR[tone], stroke, strokeWidth: sw, strokeLinejoin: "round" as const };
  if (tone === "bad") return <path d={`M0,${-8.5 * s}L${8 * s},${6 * s}L${-8 * s},${6 * s}Z`} {...p} />;
  if (tone === "mixed") return <path d={`M0,${-8 * s}L${8 * s},0L0,${8 * s}L${-8 * s},0Z`} {...p} />;
  if (tone === "neutral") return <rect x={-5.5 * s} y={-5.5 * s} width={11 * s} height={11 * s} rx={1} {...p} />;
  return <circle r={6.5 * s} {...p} />;
}
const Key = ({ tone }: { tone: MapEvent["tone"] }) => <svg width={14} height={14} viewBox="-8 -9 16 16" aria-hidden="true" style={{ verticalAlign: -2 }}><ToneShape tone={tone} s={0.85} sw={0} /></svg>;
const FLOW_COLOR: Record<string, string> = { remittances_in: "var(--accent)", remittances_out: "var(--accent)", tourism: "var(--info)", services: "var(--info)", exports: "var(--high)", imports: "var(--medium-stroke)" };

export function ProfileMap({ profile, height = 440, events = [], extraPlaces = {}, layers, compact = false, onEvent, title, legend = true, labelTones, focusTones, markScale }: {
  profile: Profile; height?: number; events?: MapEvent[]; extraPlaces?: Record<string, PlaceInfo>; layers?: Layer[];
  compact?: boolean; onEvent?: (eventId: string) => void; title?: ReactNode;
  /** false: the page draws its own key (the Overview does). The default keeps the map's own legend under it. */
  legend?: boolean;
  /** Name the events of these tones on the map, beside their first place (the Overview names the bad ones). Default: none. */
  labelTones?: MapEvent["tone"][];
  /** Fit the first view to the events of these tones only (the rest are still drawn, and zooming out shows them).
   *  Default: every event, as before. */
  focusTones?: MapEvent["tone"][];
  /** The event marks' size at the whole-picture view (1 = full size; the Overview's big map uses larger marks).
   *  Default: 0.55 compact, 0.7 otherwise, as before. */
  markScale?: number;
}) {
  const world = useLoad(loadWorld);
  const routes = useLoad(() => ref.routes()) ?? [];
  const hazards = useLoad(() => ref.hazards()) ?? [];
  const [on, setOn] = useState<Set<Layer>>(new Set(layers ?? ["footprint", "segments", "flows", "routes", "regulators", "rivals", "watch", "risks"]));
  const [view, setView] = useState<"home" | "world">("home");
  const [tip, setTip] = useState<{ x: number; y: number; text: string } | null>(null);
  const [w, setW] = useState(900);
  const [box, setBox] = useState<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!box) return;
    const ro = new ResizeObserver(e => setW(Math.max(320, e[0].contentRect.width)));
    ro.observe(box);
    return () => ro.disconnect();
  }, [box]);

  const S = profile.sections;
  const P = useMemo(() => ({ ...extraPlaces, ...profile.places }), [extraPlaces, profile.places]);
  const home = profile.institution.home_country;
  const byNumeric = useMemo(() => new Map((world?.features ?? []).map(f => [String(f.id), f])), [world]);

  /** [lon, lat] of a place: the gazetteer, or the centre of its country's shape. */
  const at = (code: string | null | undefined): [number, number] | null => {
    if (!code) return null;
    const p = P[code];
    if (p?.lat != null && p?.lon != null) return [p.lon, p.lat];
    const num = p?.numeric ?? (p?.country ? P[p.country]?.numeric : null);
    const f = num ? byNumeric.get(String(Number(num)).padStart(3, "0")) ?? byNumeric.get(String(num)) : null;
    if (f) return geoCentroid(f) as [number, number];
    if (p?.country && p.country !== code) return at(p.country);
    return null;
  };

  const usedRoutes: Route[] = routes.filter(r => S.flows.some(f => f.route_id === r.route_id) || S["risk-exposures"].some(x => x.touches.routes.includes(r.route_id)));
  const risks = S["risk-exposures"].filter(x => x.status === "active");
  const riskHazards: Hazard[] = risks.map(x => hazards.find(h => h.hazard_id === x.hazard_id)).filter((h): h is Hazard => !!h);
  const fpCountries = new Set(S.footprint.map(f => (f.code.includes("-") ? f.code.split("-")[0] : f.code)));
  const fpWhole = new Set(S.footprint.filter(f => !f.code.includes("-")).map(f => f.code));

  const projection = useMemo(() => {
    const pts: [number, number][] = [];
    const add = (c: string | null | undefined) => { const p = c ? at(c) : null; if (p) pts.push(p); };
    S.footprint.forEach(f => add(f.code));
    events.filter(e => !focusTones || focusTones.includes(e.tone)).forEach(e => e.places.forEach(add));
    riskHazards.forEach(h => h.centre && pts.push([h.centre[1], h.centre[0]]));  // the risk zones are in view too
    if (view === "world") {
      S.flows.forEach(f => add(f.counterpart)); S["watch-places"].forEach(x => add(x.code));
      S.rivals.forEach(r => r.places.forEach(add)); usedRoutes.forEach(r => r.points.forEach(([la, lo]) => pts.push([lo, la])));
    }
    if (!pts.length) add(home);
    // the full map keeps home in its middle third: each point gets a 60 % mirror image around home, so the fit leans
    // towards it (Sri Lanka sat in the bottom corner, under the zoom buttons, with the Gulf risks pulling the view north-west)
    const h0 = !compact && view === "home" ? at(home) : null;
    if (h0) pts.push(...pts.map(p => mirrorAround(h0, p)));
    const proj = geoNaturalEarth1();
    if (pts.length) {
      // pad a small area (one country, one point) to at least MIN_SPAN degrees, so the neighbours show
      // and the place is recognisable (Brunei alone filled the map)
      const lons = pts.map(p => p[0]), lats = pts.map(p => p[1]);
      const pad = Math.max(0, MIN_SPAN - (Math.max(...lons) - Math.min(...lons)), MIN_SPAN - (Math.max(...lats) - Math.min(...lats))) / 2;
      // keep the padded box inside ±180°/±90°: past the antimeridian it wraps, and New Zealand got the whole world
      const [cx, cy] = [Math.min(179 - pad, Math.max(-179 + pad, (Math.min(...lons) + Math.max(...lons)) / 2)),
        Math.min(89 - pad, Math.max(-89 + pad, (Math.min(...lats) + Math.max(...lats)) / 2))];
      if (pad > 0) pts.push([cx - pad - 1, cy - pad - 1], [cx + pad + 1, cy + pad + 1]);
      const fc = { type: "Feature", geometry: { type: "MultiPoint", coordinates: pts }, properties: {} } as Feature;
      const m = compact ? 56 : 30;  // the compact map (Overview) keeps the home country clear of the edges
      proj.fitExtent([[m + 10, m], [w - m - 10, height - m]], fc);
      if (!isFinite(proj.scale()) || proj.scale() > 2400) proj.scale(2400).center([cx, cy]).translate([w / 2, height / 2]);
    }
    return proj;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [world, w, height, view, profile.institution.profile_version, routes.length, events.length, compact, focusTones?.join()]);
  // The person's pan and zoom on top of the fit: k scales about the view's centre, x/y move it (screen pixels).
  // Applied to the projection, not as an SVG transform, so pins, labels and line widths keep their size.
  const [zoom, setZoom] = useState({ k: 1, x: 0, y: 0 });
  useEffect(() => setZoom({ k: 1, x: 0, y: 0 }), [projection]);  // a new fit starts from the whole picture
  const view0 = [w / 2, height / 2];
  const zoomed = useMemo(() => {
    const [tx, ty] = projection.translate();
    return geoNaturalEarth1().center(projection.center()).scale(projection.scale() * zoom.k)
      .translate([tx * zoom.k + (1 - zoom.k) * view0[0] + zoom.x, ty * zoom.k + (1 - zoom.k) * view0[1] + zoom.y]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projection, zoom, w, height]);
  /** Zoom to k, keeping the screen point q (default: the view's centre) where it is. */
  const zoomTo = (k: number, q: number[] = view0) => setZoom(z => {
    const k2 = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, k));
    const p0 = [0, 1].map(i => (q[i] - (1 - z.k) * view0[i] - (i ? z.y : z.x)) / z.k);
    const [x, y] = [0, 1].map(i => q[i] - k2 * p0[i] - (1 - k2) * view0[i]);
    return { k: k2, x, y };
  });
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<{ x: number; y: number } | null>(null);
  useEffect(() => {  // pinch on a trackpad, or ctrl/⌘ + scroll; a plain scroll still scrolls the page
    const el = svgRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const r = el.getBoundingClientRect();
      zoomTo(zoomRef.current.k * Math.exp(-e.deltaY * 0.01), [e.clientX - r.left, e.clientY - r.top]);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [w, height]);
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const path = geoPath(zoomed);
  const xy = (c: [number, number] | null) => (c ? zoomed(c) : null);
  const show = (e: React.MouseEvent, text: string) => { const r = box!.getBoundingClientRect(); setTip({ x: e.clientX - r.left, y: e.clientY - r.top, text }); };
  // pins differ by shape as well as colour: ring = a place, filled dot = a customer group, cross = a rival
  const pin = (key: string, code: string, color: string, label: string, r = 5, ring = false, cross = false) => {
    const p = xy(at(code));
    if (!p) return null;
    return <g key={key} transform={`translate(${p[0]},${p[1]})`} onMouseMove={e => show(e, label)} onMouseLeave={() => setTip(null)} style={{ cursor: "default" }}>
      {cross ? <>
        <path d={`M${-r},${-r}L${r},${r}M${r},${-r}L${-r},${r}`} stroke="var(--surface)" strokeWidth={5} strokeLinecap="round" />
        <path d={`M${-r},${-r}L${r},${r}M${r},${-r}L${-r},${r}`} stroke={color} strokeWidth={2.5} strokeLinecap="round" /></>
        : <circle r={r} fill={ring ? "none" : color} stroke={ring ? color : "var(--surface)"} strokeWidth={ring ? 2 : 1.5} />}</g>;
  };
  const maxFlow = Math.max(1, ...S.flows.map(f => f.value?.amount ?? 0));
  // Which money flows an open event reaches: its place is the flow's far end (same country), or it sits in a risk zone
  // from the profile whose exposure names that flow or its sea route. These light up and carry a pulse home.
  const reached = useMemo(() => {
    const country = (c: string) => P[c]?.country ?? c.split("-")[0];
    const km = (a: [number, number], lat: number, lon: number) => {
      const r = Math.PI / 180, dLat = (lat - a[1]) * r, dLon = (lon - a[0]) * r;
      const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * r) * Math.cos(lat * r) * Math.sin(dLon / 2) ** 2;
      return 12742 * Math.asin(Math.sqrt(h));
    };
    const hit = new Map<string, MapEvent>();
    for (const e of events.filter(x => x.tone !== "neutral")) for (const c of e.places) {  // a neutral event doesn't reach the bank
      const pt = at(c), cc = country(c);
      if (cc === home) continue;  // an event at home isn't carried in along a flow
      for (const f of S.flows) if (country(f.counterpart) === cc && !hit.has(f.id)) hit.set(f.id, e);
      for (const x of risks) {
        const hz = hazards.find(h => h.hazard_id === x.hazard_id);
        const inside = hz && ((hz.places ?? []).includes(cc) || (pt && hz.centre && km(pt, hz.centre[0], hz.centre[1]) <= (hz.radius_km ?? 100) * 1.5));
        if (!inside) continue;
        for (const f of S.flows) if ((x.touches.flows ?? []).includes(f.id) || (f.route_id && (x.touches.routes ?? []).includes(f.route_id))) if (!hit.has(f.id)) hit.set(f.id, e);
      }
    }
    return hit;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [events, S.flows, risks.length, hazards.length, P, home]);
  const homeXY = xy(at(home));
  // event symbols: small at the whole-picture view so they don't hide a country (Sri Lanka vanished under a square),
  // growing as you zoom in, up to the full size
  const m0 = markScale ?? (compact ? 0.55 : 0.7);
  const ms = Math.min(1, Math.max(m0, m0 * Math.sqrt(zoom.k)));
  const toggle = (l: Layer) => setOn(s => { const n = new Set(s); if (n.has(l)) n.delete(l); else n.add(l); return n; });

  return (
    <div ref={setBox} style={{ position: "relative" }}>
      {!compact && <div className="pmap-bar">
        {title && <h2 className="pmap-title">{title}</h2>}
        <span className="spacer" />
        <span className="seg"><button type="button" aria-pressed={view === "home"} onClick={() => setView("home")}>Your footprint</button>
          <button type="button" aria-pressed={view === "world"} onClick={() => setView("world")}>Everything</button></span>
        <details className="menu pmap-layers">
          <summary className="btn btn--sm">Layers · {on.size} of {LAYERS.length}<span aria-hidden="true" className="caret">▾</span></summary>
          <div className="menu-pop" role="group" aria-label="Map layers">
            {LAYERS.map(([k, label]) => <label key={k} className="check"><input type="checkbox" checked={on.has(k)} onChange={() => toggle(k)} />{label}</label>)}
          </div>
        </details>
      </div>}
      <div style={{ position: "relative" }} className={compact ? undefined : "pmap-full"}>
      <svg ref={svgRef} width="100%" height={height} viewBox={`0 0 ${w} ${height}`} role="img" aria-label="Map of the institution profile"
        style={{ background: "var(--map-ocean)", borderRadius: 12, display: "block", cursor: drag.current ? "grabbing" : "grab", touchAction: "none" }}
        onPointerDown={e => { drag.current = { x: e.clientX, y: e.clientY }; }}
        onPointerMove={e => {
          const d = drag.current;
          if (!d || !e.buttons) { drag.current = null; return; }
          const [dx, dy] = [e.clientX - d.x, e.clientY - d.y];
          drag.current = { x: e.clientX, y: e.clientY };
          setZoom(z => ({ ...z, x: z.x + dx, y: z.y + dy }));
        }}
        onPointerUp={() => { drag.current = null; }} onPointerLeave={() => { drag.current = null; }}>
        {world && <g>{world.features.map((f, k) => {
          const iso = Object.values(P).find(p => p.numeric && String(Number(p.numeric)) === String(Number(f.id)))?.code;
          const isHome = on.has("footprint") && iso === home;
          const inFp = on.has("footprint") && iso && fpCountries.has(iso);
          return <path key={`${f.id}-${k}`} d={path(f) ?? ""} fill={isHome || (inFp && fpWhole.has(iso!)) ? "var(--map-home-fill)" : inFp ? "var(--accent-soft)" : "var(--map-land)"}
            stroke={inFp ? "var(--map-home)" : "var(--map-border)"} strokeWidth={inFp ? 1 : 0.75} />;
        })}</g>}
        {on.has("risks") && riskHazards.map(h => {
          const c = h.centre ? geoCircle().center([h.centre[1], h.centre[0]]).radius((h.radius_km ?? 100) / 111)() : null;
          return c && <path key={h.hazard_id} d={path(c) ?? ""} fill="var(--critical-soft)" stroke="var(--critical)" strokeDasharray="4 3" strokeWidth={1}
            onMouseMove={e => show(e, `Risk: ${risks.find(x => x.hazard_id === h.hazard_id)?.title}`)} onMouseLeave={() => setTip(null)} />;
        })}
        {on.has("routes") && usedRoutes.map(r => (
          <path key={r.route_id} d={path({ type: "LineString", coordinates: r.points.map(([la, lo]) => [lo, la]) }) ?? ""} fill="none" stroke="var(--low)" strokeWidth={1.5} strokeDasharray="1 5" strokeLinecap="round"
            onMouseMove={e => show(e, `Sea route: ${r.name}`)} onMouseLeave={() => setTip(null)} />))}
        {on.has("flows") && S.flows.map(f => {
          const a = xy(at(f.local)), b = xy(at(f.counterpart));
          if (!a || !b) return null;
          const out = moneyGoesOut(f.kind);  // the money's way, not the goods': an export's payment comes in
          const [from, to] = out ? [a, b] : [b, a];
          const mx = (from[0] + to[0]) / 2, my = (from[1] + to[1]) / 2 - Math.hypot(to[0] - from[0], to[1] - from[1]) * 0.22;
          const share = Math.sqrt((f.value?.amount ?? 0) / maxFlow);
          const width = (compact ? 0.9 : 1) + (compact ? 2.4 : 4.5) * share;
          const d = `M${from[0]},${from[1]} Q${mx},${my} ${to[0]},${to[1]}`;
          const inward = `M${b[0]},${b[1]} Q${mx},${my} ${a[0]},${a[1]}`;  // the event's pulse always runs from the far end to home
          const ev = reached.get(f.id), quiet = reached.size > 0 && !ev;  // when an event reaches some flows, the rest step back
          const gap = Math.round(30 - 14 * share);  // bigger flows carry more particles
          return <g key={f.id} className={ev ? "mapflow is-hit" : quiet ? "mapflow is-quiet" : "mapflow"}
            onMouseMove={e => show(e, `${FLOW_WORDS[f.kind]}${f.goods ? ` (${f.goods})` : ""}: ${P[f.counterpart]?.name ?? f.counterpart} ${out ? "←" : "→"} ${P[f.local]?.name ?? f.local}${f.value ? ` · ${usdText(f.value.amount)} a year` : ""}${ev ? ` · reached by: ${ev.title}` : ""}`)} onMouseLeave={() => setTip(null)}>
            <path d={d} fill="none" stroke={FLOW_COLOR[f.kind]} strokeOpacity={quiet ? 0.28 : compact ? 0.75 : 0.85} strokeWidth={width} strokeLinecap="round" />
            {/* the direction: small particles travel from where the money starts to where it goes */}
            <path className="flowdots" d={d} fill="none" stroke="var(--map-particle)" strokeOpacity={quiet ? 0.3 : 0.9} strokeWidth={Math.max(2, width * 0.7)} strokeLinecap="round"
              strokeDasharray={`0.1 ${gap}`} style={{ ["--cycle" as string]: `${gap + 0.1}px` }} />
            {/* an event on this flow: a pulse in the event's colour runs along it to the bank's home */}
            {ev && <path className="flowpulse" d={inward} pathLength={100} fill="none" stroke={TONE_COLOR[ev.tone]} strokeWidth={width + 2.5} strokeLinecap="round" strokeDasharray="10 90" style={{ color: TONE_COLOR[ev.tone] }} />}
          </g>;
        })}
        {/* the glow lands where the pulses arrive: each reached flow's own end in the bank's footprint (its home country, or a place in it) */}
        {[...new Set(S.flows.filter(f => reached.has(f.id)).map(f => f.local))].map(code => {
          const p = xy(at(code)), tones = S.flows.filter(f => f.local === code && reached.has(f.id)).map(f => reached.get(f.id)!.tone);
          return p && <circle key={`glow${code}`} className="homeglow" cx={p[0]} cy={p[1]} r={16} fill="none" strokeWidth={2}
            stroke={TONE_COLOR[tones.includes("bad") ? "bad" : tones.includes("mixed") ? "mixed" : tones[0]]} />;
        })}
        {on.has("regulators") && homeXY && S.regulators.filter(r => r.relation === "reach").map((r, i) => {
          const far = xy(at(r.short === "OFAC" ? "US" : r.short === "EU" ? "BE" : r.short === "OFSI" ? "GB" : r.country));
          return far && <line key={`t${i}`} x1={homeXY[0]} y1={homeXY[1]} x2={far[0]} y2={far[1]} stroke="var(--ink-3)" strokeDasharray="2 3" />;
        })}
        {on.has("footprint") && S.footprint.filter(f => f.code.includes("-")).map(f => pin(`fp${f.id}`, f.code, "var(--map-home)", `Footprint: ${P[f.code]?.name} (${f.role})`, 6, true))}
        {on.has("watch") && S["watch-places"].filter(x => x.code).map(x => pin(`w${x.id}`, x.code, "var(--info)", `Watch: ${x.name}${x.reason ? ` · ${x.reason}` : ""}`, 4.5, true))}
        {on.has("segments") && S.segments.flatMap(s => s.places.map((c: string) => pin(`s${s.id}${c}`, c, "var(--accent)", `${s.label} · ${P[c]?.name ?? c}`, 5)))}
        {on.has("rivals") && S.rivals.flatMap(r => r.places.map((c: string) => pin(`r${r.id}${c}`, c, "var(--high)", `Rival: ${r.name} (${r.overlap} overlap) · ${P[c]?.name ?? c}`, 4.5, false, true)))}
        {on.has("regulators") && S.regulators.filter(r => r.country).map(r => {
          const p = xy(at(r.country));
          const n = S.regulators.filter(x => x.country === r.country).findIndex(x => x.id === r.id);  // stack labels per country
          const t = (r.short ?? r.name).slice(0, 7), hw = 8 + t.length * 4.6;  // a 14 px label (the floor), kept inside the map
          return p && <g key={`g${r.id}`} transform={`translate(${Math.min(p[0] + 30, w - hw - 4)},${p[1] - 12 - n * 26})`} onMouseMove={e => show(e, `${r.name} · ${r.relation}`)} onMouseLeave={() => setTip(null)}>
            <rect x={-hw} y={-12} width={hw * 2} height={23} rx={6} fill="var(--surface)" stroke="var(--line-strong)" />
            <text textAnchor="middle" y={4.5} fontSize={14} fontWeight={700} fill="var(--ink-2)">{t}</text></g>;
        })}
        {events.flatMap(e => e.places.map(c => {
          const p = xy(at(c));
          if (!p) return null;
          const color = TONE_COLOR[e.tone];
          return <g key={`e${e.event_id}${c}`} transform={`translate(${p[0]},${p[1]})`} style={{ cursor: onEvent ? "pointer" : "default" }}
            onClick={() => onEvent?.(e.event_id)} onMouseMove={ev => show(ev, `${e.title} · ${P[c]?.name ?? c}`)} onMouseLeave={() => setTip(null)}>
            {[0, 1].map(i => <circle key={i} r={9 * ms} fill="none" stroke={color} strokeWidth={1.25} className="mapripple" style={{ animationDelay: `${i * 1.3}s` }} />)}
            <circle r={13 * ms} fill={color} opacity={0.16} />
            <ToneShape tone={e.tone} s={ms} sw={1.5} /></g>;
        }))}
        {labelTones && events.filter(e => labelTones.includes(e.tone)).map(e => {
          const p = e.places.map(c => xy(at(c))).find(Boolean);
          if (!p) return null;
          const left = p[0] > w - 200;  // near the right edge the name goes to the left of its marker
          return <text key={`l${e.event_id}`} x={p[0] + (left ? -14 : 14)} y={p[1] - 10} textAnchor={left ? "end" : "start"} fontSize={16} fontWeight={700}
            fill="var(--ink)" stroke="var(--map-halo)" strokeWidth={4} strokeLinejoin="round" paintOrder="stroke" style={{ pointerEvents: "none" }}>{e.title}</text>;
        })}
      </svg>
      <div className="mapzoom">
        <button type="button" aria-label="Zoom in" title="Zoom in" onClick={() => zoomTo(zoom.k * ZOOM_STEP)} disabled={zoom.k >= ZOOM_MAX}>+</button>
        <button type="button" aria-label="Zoom out" title="Zoom out" onClick={() => zoomTo(zoom.k / ZOOM_STEP)} disabled={zoom.k <= ZOOM_MIN}>−</button>
        <button type="button" title="Back to the whole picture" onClick={() => setZoom({ k: 1, x: 0, y: 0 })}
          disabled={zoom.k === 1 && !zoom.x && !zoom.y}>Reset</button>
      </div>
      </div>
      {tip && <div className="maptip" style={{ left: Math.min(tip.x + 12, w - 250), top: tip.y + 12 }}>{tip.text}</div>}
      {!legend ? null : compact ? <div className="row wrap small muted" style={{ gap: 14, marginTop: 8 }}>
        <span><Key tone="bad" /> bad for you</span>
        <span><Key tone="good" /> good for you</span>
        <span><Key tone="mixed" /> mixed</span>
        <span><Key tone="neutral" /> neutral</span>
        <span><span className="statusdot" style={{ background: "var(--map-home-fill)", outline: "1px solid var(--map-home)" }} /> where you operate</span>
        {layers?.includes("risks") !== false && <span><svg width={14} height={14} aria-hidden="true" style={{ verticalAlign: -2 }}><circle cx={7} cy={7} r={5.5} fill="var(--critical-soft)" stroke="var(--critical)" strokeDasharray="3 2" /></svg> risk areas in your profile</span>}
        {layers?.includes("flows") !== false && <span><svg width={16} height={10} aria-hidden="true"><path d="M1 8Q8 0 15 8" fill="none" stroke="var(--accent)" strokeWidth={2} /></svg> money flows, moving the way the money goes</span>}
        {reached.size > 0 && <span><svg width={16} height={10} aria-hidden="true"><path d="M1 8Q8 0 15 8" fill="none" stroke="var(--critical)" strokeWidth={3} /></svg> flows an open event reaches</span>}
      </div> : <div className="row wrap small muted" style={{ gap: 14, marginTop: 6 }}>
        <span><span className="statusdot" style={{ background: "var(--accent)" }} /> customer groups · remittances</span>
        <span><span className="statusdot" style={{ background: "var(--high)" }} /> exports</span>
        <span><svg width={14} height={14} viewBox="-7 -7 14 14" aria-hidden="true" style={{ verticalAlign: -2 }}><path d="M-5,-5L5,5M5,-5L-5,5" stroke="var(--high)" strokeWidth={2.5} strokeLinecap="round" /></svg> rivals</span>
        <span><span className="statusdot" style={{ background: "var(--medium-stroke)" }} /> imports</span>
        <span><span className="statusdot" style={{ background: "var(--critical)" }} /> risk zones</span>
        <span>Line width: flow size · global standards are listed, not pinned</span>
      </div>}
    </div>
  );
}
