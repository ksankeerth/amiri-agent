// The profile on a map: footprint, customer groups, flows, sea routes, regulators,
// rivals, places to watch and risk zones. Drawn from the profile and reference data
// (coordinates from the gazetteer, or a country's centre from its shape).
import { geoCentroid, geoCircle, geoNaturalEarth1, geoPath } from "d3-geo";
import type { Feature, FeatureCollection, Geometry } from "geojson";
import { useEffect, useMemo, useState } from "react";
import { feature } from "topojson-client";
import type { PlaceInfo, Profile } from "../../api/institutions";
import { ref, type Hazard, type Route } from "../../api/reference";
import { usdText, useLoad } from "./fields";
import { FLOW_WORDS } from "./forms";

type World = FeatureCollection<Geometry, { name: string }>;
const MIN_SPAN = 30;  // degrees: the smallest area the map zooms to (about Borneo with its neighbours)
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
const FLOW_COLOR: Record<string, string> = { remittances_in: "var(--accent)", remittances_out: "var(--accent)", tourism: "var(--info)", services: "var(--info)", exports: "var(--high)", imports: "var(--medium)" };

export function ProfileMap({ profile, height = 440, events = [], extraPlaces = {}, layers, compact = false, onEvent }: {
  profile: Profile; height?: number; events?: MapEvent[]; extraPlaces?: Record<string, PlaceInfo>; layers?: Layer[];
  compact?: boolean; onEvent?: (eventId: string) => void;
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
    events.forEach(e => e.places.forEach(add));
    if (view === "world") {
      S.flows.forEach(f => add(f.counterpart)); S["watch-places"].forEach(x => add(x.code));
      S.rivals.forEach(r => r.places.forEach(add)); usedRoutes.forEach(r => r.points.forEach(([la, lo]) => pts.push([lo, la])));
    }
    if (!pts.length) add(home);
    const proj = geoNaturalEarth1();
    if (pts.length) {
      // pad a small area (one country, one point) to at least MIN_SPAN degrees, so the neighbours show
      // and the place is recognisable (Brunei alone filled the map)
      const lons = pts.map(p => p[0]), lats = pts.map(p => p[1]);
      const [cx, cy] = [(Math.min(...lons) + Math.max(...lons)) / 2, (Math.min(...lats) + Math.max(...lats)) / 2];
      const pad = Math.max(0, MIN_SPAN - (Math.max(...lons) - Math.min(...lons)), MIN_SPAN - (Math.max(...lats) - Math.min(...lats))) / 2;
      if (pad > 0) pts.push([cx - pad - 1, cy - pad - 1], [cx + pad + 1, cy + pad + 1]);
      const fc = { type: "Feature", geometry: { type: "MultiPoint", coordinates: pts }, properties: {} } as Feature;
      const m = compact ? 56 : 30;  // the compact map (Overview) keeps the home country clear of the edges
      proj.fitExtent([[m + 10, m], [w - m - 10, height - m]], fc);
      if (!isFinite(proj.scale()) || proj.scale() > 2400) proj.scale(2400).center([cx, cy]).translate([w / 2, height / 2]);
    }
    return proj;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [world, w, height, view, profile.institution.profile_version, routes.length, events.length, compact]);
  const path = geoPath(projection);
  const xy = (c: [number, number] | null) => (c ? projection(c) : null);
  const show = (e: React.MouseEvent, text: string) => { const r = box!.getBoundingClientRect(); setTip({ x: e.clientX - r.left, y: e.clientY - r.top, text }); };
  const pin = (key: string, code: string, color: string, label: string, r = 5, ring = false) => {
    const p = xy(at(code));
    if (!p) return null;
    return <g key={key} transform={`translate(${p[0]},${p[1]})`} onMouseMove={e => show(e, label)} onMouseLeave={() => setTip(null)} style={{ cursor: "default" }}>
      <circle r={r} fill={ring ? "none" : color} stroke={ring ? color : "var(--surface)"} strokeWidth={ring ? 2 : 1.5} /></g>;
  };
  const maxFlow = Math.max(1, ...S.flows.map(f => f.value?.amount ?? 0));
  const homeXY = xy(at(home));
  const toggle = (l: Layer) => setOn(s => { const n = new Set(s); if (n.has(l)) n.delete(l); else n.add(l); return n; });

  return (
    <div ref={setBox} style={{ position: "relative" }}>
      <div className="row wrap" style={{ gap: 6, marginBottom: 8, display: compact ? "none" : undefined }}>
        <span className="seg"><button type="button" aria-pressed={view === "home"} onClick={() => setView("home")}>Your footprint</button>
          <button type="button" aria-pressed={view === "world"} onClick={() => setView("world")}>Everything</button></span>
        <span className="spacer" />
        {LAYERS.map(([k, label]) => <button key={k} type="button" className={`chip click ${on.has(k) ? "sel" : ""}`} onClick={() => toggle(k)}>{label}</button>)}
      </div>
      <svg width="100%" height={height} viewBox={`0 0 ${w} ${height}`} style={{ background: "var(--map-ocean)", borderRadius: 12, display: "block" }} role="img" aria-label="Map of the institution profile">
        {world && <g>{world.features.map(f => {
          const iso = Object.values(P).find(p => p.numeric && String(Number(p.numeric)) === String(Number(f.id)))?.code;
          const isHome = on.has("footprint") && iso === home;
          const inFp = on.has("footprint") && iso && fpCountries.has(iso);
          return <path key={String(f.id)} d={path(f) ?? ""} fill={isHome || (inFp && fpWhole.has(iso!)) ? "var(--map-home-fill)" : inFp ? "var(--accent-soft)" : "var(--map-land)"}
            stroke={inFp ? "var(--map-home)" : "var(--map-border)"} strokeWidth={inFp ? 1 : 0.5} />;
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
          const [from, to] = ["exports", "remittances_out"].includes(f.kind) ? [a, b] : [b, a];
          const mx = (from[0] + to[0]) / 2, my = (from[1] + to[1]) / 2 - Math.hypot(to[0] - from[0], to[1] - from[1]) * 0.22;
          const width = (compact ? 0.9 : 1) + (compact ? 2.4 : 4.5) * Math.sqrt((f.value?.amount ?? 0) / maxFlow);
          return <path key={f.id} d={`M${from[0]},${from[1]} Q${mx},${my} ${to[0]},${to[1]}`} fill="none" stroke={FLOW_COLOR[f.kind]} strokeOpacity={compact ? 0.6 : 0.7} strokeWidth={width} strokeLinecap="round"
            onMouseMove={e => show(e, `${FLOW_WORDS[f.kind]}${f.goods ? ` (${f.goods})` : ""}: ${P[f.counterpart]?.name ?? f.counterpart} ↔ ${P[f.local]?.name ?? f.local}${f.value ? ` · ${usdText(f.value.amount)} a year` : ""}`)} onMouseLeave={() => setTip(null)} />;
        })}
        {on.has("regulators") && homeXY && S.regulators.filter(r => r.relation === "reach").map((r, i) => {
          const far = xy(at(r.short === "OFAC" ? "US" : r.short === "EU" ? "BE" : r.short === "OFSI" ? "GB" : r.country));
          return far && <line key={`t${i}`} x1={homeXY[0]} y1={homeXY[1]} x2={far[0]} y2={far[1]} stroke="var(--ink-3)" strokeDasharray="2 3" />;
        })}
        {on.has("footprint") && S.footprint.filter(f => f.code.includes("-")).map(f => pin(`fp${f.id}`, f.code, "var(--map-home)", `Footprint: ${P[f.code]?.name} (${f.role})`, 6, true))}
        {on.has("watch") && S["watch-places"].filter(x => x.code).map(x => pin(`w${x.id}`, x.code, "var(--info)", `Watch: ${x.name}${x.reason ? ` · ${x.reason}` : ""}`, 4.5, true))}
        {on.has("segments") && S.segments.flatMap(s => s.places.map((c: string) => pin(`s${s.id}${c}`, c, "var(--accent)", `${s.label} · ${P[c]?.name ?? c}`, 5)))}
        {on.has("rivals") && S.rivals.flatMap(r => r.places.map((c: string) => pin(`r${r.id}${c}`, c, "var(--high)", `Rival: ${r.name} (${r.overlap} overlap) · ${P[c]?.name ?? c}`, 4)))}
        {on.has("regulators") && S.regulators.filter(r => r.country).map(r => {
          const p = xy(at(r.country));
          const n = S.regulators.filter(x => x.country === r.country).findIndex(x => x.id === r.id);  // stack labels per country
          return p && <g key={`g${r.id}`} transform={`translate(${p[0] + 26},${p[1] - 12 - n * 19})`} onMouseMove={e => show(e, `${r.name} · ${r.relation}`)} onMouseLeave={() => setTip(null)}>
            <rect x={-18} y={-9} width={36} height={16} rx={4} fill="var(--surface)" stroke="var(--hairline-2)" />
            <text textAnchor="middle" y={3} fontSize={9} fontWeight={700} fill="var(--ink-2)">{(r.short ?? r.name).slice(0, 7)}</text></g>;
        })}
        {events.flatMap(e => e.places.map(c => {
          const p = xy(at(c));
          if (!p) return null;
          const color = TONE_COLOR[e.tone];
          return <g key={`e${e.event_id}${c}`} transform={`translate(${p[0]},${p[1]})`} style={{ cursor: onEvent ? "pointer" : "default" }}
            onClick={() => onEvent?.(e.event_id)} onMouseMove={ev => show(ev, `${e.title} · ${P[c]?.name ?? c}`)} onMouseLeave={() => setTip(null)}>
            <circle r={13} fill={color} opacity={0.16} className="mappulse" />
            <circle r={6.5} fill={color} stroke="var(--surface)" strokeWidth={2} /></g>;
        }))}
      </svg>
      {tip && <div className="maptip" style={{ left: Math.min(tip.x + 12, w - 250), top: tip.y + 12 }}>{tip.text}</div>}
      {compact ? <div className="row wrap small muted" style={{ gap: 14, marginTop: 8 }}>
        <span><span className="statusdot" style={{ background: "var(--critical)" }} /> bad for you</span>
        <span><span className="statusdot" style={{ background: "var(--accent)" }} /> good for you</span>
        <span><span className="statusdot" style={{ background: "var(--high)" }} /> mixed</span>
        <span><span className="statusdot" style={{ background: "var(--ink-3)" }} /> neutral</span>
        <span><span className="statusdot" style={{ background: "var(--map-home-fill)", outline: "1px solid var(--map-home)" }} /> where you operate</span>
      </div> : <div className="row wrap small muted" style={{ gap: 14, marginTop: 6 }}>
        <span><span className="statusdot" style={{ background: "var(--accent)" }} /> customer groups · remittances</span>
        <span><span className="statusdot" style={{ background: "var(--high)" }} /> exports · rivals</span>
        <span><span className="statusdot" style={{ background: "var(--medium)" }} /> imports</span>
        <span><span className="statusdot" style={{ background: "var(--critical)" }} /> risk zones</span>
        <span>Line width: flow size · global standards are listed, not pinned</span>
      </div>}
    </div>
  );
}
