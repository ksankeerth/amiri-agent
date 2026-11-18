// Glowing-particle scenes beside each Overview section. Each one shows what its section is about, drawn from the
// section's own numbers: events travelling to the bank, a radar sweep, agents linked to a core. Canvas 2D, one sprite
// per colour; it runs only while on screen, and under reduced motion it draws one still frame.
import { useEffect, useRef } from "react";

export type SceneKind = "needs" | "events" | "findings" | "markets" | "radar" | "health";
export type SceneData = { n?: number; tones?: string[]; up?: boolean[]; late?: boolean; line?: number[]; labels?: string[]; home?: string };
type P = { x: number; y: number; vx: number; vy: number; life: number; max: number; c: string; s: number; k?: number; a?: number };
type Pal = Record<"accent" | "critical" | "high" | "ink3" | "ink", string>;

const rnd = (a: number, b: number) => a + Math.random() * (b - a);
/** A hex colour at an opacity, so fades stay in that colour (fading to "transparent" goes through black and leaves grey rims). */
const rgba = (c: string, a: number) => { const m = c.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i); if (!m) return c;
  const h = m[1].length === 3 ? [...m[1]].map(x => x + x).join("") : m[1], n = parseInt(h, 16);
  return `rgba(${n >> 16}, ${(n >> 8) & 255}, ${n & 255}, ${a})`; };
const TONE_C: Record<string, keyof Pal> = { bad: "critical", good: "accent", mixed: "high", neutral: "ink3" };

function sprite(color: string): HTMLCanvasElement {  // a soft glowing dot, drawn once per colour
  const c = document.createElement("canvas"); c.width = c.height = 32;
  const g = c.getContext("2d")!, r = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  r.addColorStop(0, color); r.addColorStop(.25, color); r.addColorStop(1, "transparent");
  g.fillStyle = r; g.fillRect(0, 0, 32, 32);
  return c;
}

export function ParticleScene({ kind, data, label }: { kind: SceneKind; data: SceneData; label: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const key = JSON.stringify(data);
  useEffect(() => {
    const cv = ref.current!; const g = cv.getContext("2d")!;
    const css = (n: string) => getComputedStyle(cv).getPropertyValue(n).trim();
    let pal: Pal, sp: Record<string, HTMLCanvasElement>, dark = false;
    const readPal = () => {
      pal = { accent: css("--accent"), critical: css("--critical"), high: css("--high"), ink3: css("--ink-3"), ink: css("--ink-2") };
      sp = Object.fromEntries(Object.entries(pal).map(([k, v]) => [k, sprite(v)]));
      dark = getComputedStyle(document.documentElement).colorScheme.includes("dark");  // glow adds up on dark, plain dots on light
    };
    readPal();
    let W = 0, H = 0, ps: P[] = [], t = 0, raf = 0, on = false, frame = 0;
    // radar story blips, random but by two rules: (1) each story owns an equal slice of the full circle (a third each for 3),
    // and lands somewhere inside it, away from the slice's edges, so the blips spread around the dish instead of bunching;
    // (2) its distance falls inside one of the three bands between the rings, kept clear of the ring lines by a margin;
    // (3) no two blips share a band while there are bands free: one in the inner band means the others take the middle and outer
    let blips: { a: number; r: number; band: number; moved: boolean }[] = [];
    const turn = rnd(0, Math.PI * 2);  // where the slices start, so the pattern isn't the same on every page
    const RINGS = [.12, .33, .66, 1];  // the centre gap, then the three rings, as a share of the outer radius
    const blip = (i: number, n: number, R: number, taken: number[]) => {
      const slice = Math.PI * 2 / n, pad = Math.min(.35, slice / 4), m = 12 / R;  // 12 px clear of a ring: the blip's glow plus a gap
      const free = [0, 1, 2].filter(b => !taken.includes(b)), pick = free.length ? free : [0, 1, 2];  // more than 3 stories: bands repeat
      const band = pick[Math.floor(rnd(0, pick.length))], lo = RINGS[band] + (band ? m : 0), hi = RINGS[band + 1] - m;
      return { a: turn + i * slice + rnd(pad, slice - pad), r: rnd(lo, Math.max(lo, hi)), band, moved: false };
    };
    const fit = () => { const r = cv.getBoundingClientRect(), d = Math.min(2, devicePixelRatio || 1);
      W = r.width; H = r.height; cv.width = W * d; cv.height = H * d; g.setTransform(d, 0, 0, d, 0, 0); };
    const dot = (x: number, y: number, s: number, c: string, a: number) => { g.globalAlpha = Math.max(0, Math.min(1, a)); g.drawImage(sp[c], x - s, y - s, s * 2, s * 2); };

    // ---- the scenes: spawn() adds particles, move() steps one, extra() draws anything fixed
    const home = () => ({ x: W * .8, y: H * .55 });
    const tones = data.tones?.length ? data.tones : ["neutral"];
    const src = (i: number) => ({ x: W * (.1 + .08 * (i % 3)), y: H * (.22 + (i * .27) % .56) });  // each event where its news is, home on the right
    const nodes = () => { const n = Math.max(1, data.n ?? 1); return Array.from({ length: n }, (_, i) => ({ x: W * .66, y: H * (n === 1 ? .5 : .2 + .6 * i / (n - 1)) })); };
    const agents = () => (data.up ?? []).map((u, i, a) => { const ang = -Math.PI / 2 + i * 2 * Math.PI / a.length; return { x: W / 2 + Math.cos(ang) * H * .34, y: H / 2 + Math.sin(ang) * H * .34, u }; });
    const line = () => { const v = data.line?.length ? data.line : Array.from({ length: 24 }, (_, i) => Math.sin(i / 3) + i / 12);
      const lo = Math.min(...v), hi = Math.max(...v) || 1; return v.map((y, i) => ({ x: W * (.08 + .84 * i / (v.length - 1)), y: H * (.78 - .56 * (y - lo) / (hi - lo || 1)) })); };

    const spawn = () => {
      if (kind === "events") tones.forEach((tn, i) => { if (Math.random() < .5) { const s = src(i), h = home();
        ps.push({ x: s.x + rnd(-6, 6), y: s.y + rnd(-6, 6), vx: 0, vy: 0, life: 0, max: 150, c: TONE_C[tn] ?? "ink3", s: rnd(2.5, 4.5), k: i, a: Math.atan2(h.y - s.y, h.x - s.x) }); } });
      else if (kind === "needs") { if (Math.random() < .5) { const ns = nodes(), i = Math.floor(Math.random() * ns.length);
        ps.push({ x: rnd(0, W * .3), y: rnd(0, H), vx: 0, vy: 0, life: 0, max: 220, c: "accent", s: rnd(2, 4), k: i }); } }
      else if (kind === "findings") { for (let j = 0; j < 3; j++) ps.push({ x: rnd(0, W), y: rnd(0, H), vx: rnd(-.3, .3), vy: rnd(-.3, .3), life: 0, max: rnd(120, 260), c: "ink3", s: rnd(1.5, 3), k: Math.random() < .08 ? 1 : 0 }); }
      else if (kind === "markets") { if (Math.random() < .8) ps.push({ x: 0, y: 0, vx: 0, vy: 0, life: 0, max: 200, c: "accent", s: rnd(2, 4), a: rnd(-4, 4) }); }
      else if (kind === "radar") { if (ps.length < 160) ps.push({ x: W / 2 + Math.cos(rnd(0, 7)) * rnd(10, H * .44), y: 0, vx: 0, vy: 0, life: 0, max: 1e9, c: "accent", s: rnd(1.5, 3), a: rnd(0, Math.PI * 2), k: rnd(10, H * .44) }); }
      else if (kind === "health") agents().forEach((ag, i) => { if (ag.u && Math.random() < .35) ps.push({ x: W / 2, y: H / 2, vx: 0, vy: 0, life: 0, max: 90, c: "accent", s: rnd(2, 3.5), k: i, a: Math.random() < .5 ? 1 : -1 }); });
    };
    const move = (p: P) => {
      p.life++;
      const f = p.life / p.max;
      if (kind === "events") { const s = src(p.k!), h = home(), e = f, mx = (s.x + h.x) / 2, my = Math.min(s.y, h.y) - H * .25;  // along an arc, the way the map draws it
        p.x = (1 - e) ** 2 * s.x + 2 * (1 - e) * e * mx + e * e * h.x + Math.sin(p.life / 7 + p.s) * 3; p.y = (1 - e) ** 2 * s.y + 2 * (1 - e) * e * my + e * e * h.y; }
      else if (kind === "needs") { const nd = nodes()[p.k!]; p.vx += (nd.x - p.x) * .0016; p.vy += (nd.y - p.y) * .0016; p.vx *= .95; p.vy *= .95; p.x += p.vx; p.y += p.vy;
        if (Math.hypot(nd.x - p.x, nd.y - p.y) < 22) { p.x = nd.x + Math.cos(p.life / 9 + p.s) * 18; p.y = nd.y + Math.sin(p.life / 9 + p.s) * 18; } }
      else if (kind === "findings") { if (p.k) { const fx = W * .7, fy = H * .5; p.vx += (fx - p.x) * .002; p.vy += (fy - p.y) * .002; p.vx *= .96; p.vy *= .96; p.c = "accent"; p.s = Math.min(6, p.s + .02); }
        p.x += p.vx; p.y += p.vy; }
      else if (kind === "markets") { const L = line(), u = f * (L.length - 1), i = Math.min(L.length - 2, Math.floor(u)), r = u - i;
        p.x = L[i].x + (L[i + 1].x - L[i].x) * r; p.y = L[i].y + (L[i + 1].y - L[i].y) * r + p.a!; }
      else if (kind === "radar") { p.x = W / 2 + Math.cos(p.a!) * p.k!; p.y = H / 2 + Math.sin(p.a!) * p.k!; }
      else if (kind === "health") { const ag = agents()[p.k!], e = p.a! > 0 ? f : 1 - f; p.x = W / 2 + (ag.x - W / 2) * e; p.y = H / 2 + (ag.y - H / 2) * e; }
    };
    const say = (x: number, y: number, text: string | undefined, align: CanvasTextAlign = "center") => { if (!text) return;  // a plain label, so the motion reads
      g.globalCompositeOperation = "source-over"; g.globalAlpha = .95; g.fillStyle = pal.ink; g.font = `500 14px ${css("--font-ui") || "sans-serif"}`; g.textAlign = align; g.fillText(text, x, y);
      g.globalCompositeOperation = dark ? "lighter" : "source-over"; };
    const extra = () => {
      g.globalAlpha = 1;
      if (kind === "events") { const h = home(); dot(h.x, h.y, 14 + Math.sin(t / 20) * 3, "accent", .9);
        tones.forEach((tn, i) => { const s = src(i), r = (t * .8 + i * 40) % 90; g.strokeStyle = pal[TONE_C[tn] ?? "ink3"]; g.globalAlpha = 1 - r / 90; g.beginPath(); g.arc(s.x, s.y, r, 0, 7); g.stroke(); dot(s.x, s.y, 7, TONE_C[tn] ?? "ink3", .9); say(s.x, s.y + 30, data.labels?.[i]); }); say(h.x, h.y + 36, data.home); }
      if (kind === "needs") nodes().forEach((nd, i) => dot(nd.x, nd.y, 10 + Math.sin(t / 15 + i) * 2.5, "high", .95));
      if (kind === "findings") for (let i = 0; i < Math.max(1, data.n ?? 1); i++) dot(W * .7 + Math.cos(i * 2.4) * 26 * Math.min(1, i), H * .5 + Math.sin(i * 2.4) * 26 * Math.min(1, i), 9 + Math.sin(t / 18 + i), "accent", .9);
      if (kind === "markets") { const L = line(); g.strokeStyle = pal.accent; g.globalAlpha = .25; g.lineWidth = 2; g.beginPath(); L.forEach((q, i) => i ? g.lineTo(q.x, q.y) : g.moveTo(q.x, q.y)); g.stroke(); }
      if (kind === "radar") { const R = H * .45, a = (t / 70) % (Math.PI * 2);
        g.strokeStyle = pal.accent; g.lineWidth = 1; [1, .66, .33].forEach(k => { g.globalAlpha = .18; g.beginPath(); g.arc(W / 2, H / 2, R * k, 0, 7); g.stroke(); });
        // the sweep: a trail that fades in smoothly from behind the beam (eased, in the beam's own colour, never through grey),
        // then a thin bright beam line on the leading edge, so it reads as a sweep, not a slice
        const trail = 1.6, span = trail / (Math.PI * 2), gr = g.createConicGradient(a - trail, W / 2, H / 2);
        for (let k = 0; k <= 10; k++) gr.addColorStop(span * k / 10, rgba(pal.accent, .3 * (k / 10) ** 5));
        gr.addColorStop(Math.min(1, span + .002), rgba(pal.accent, 0)); gr.addColorStop(1, rgba(pal.accent, 0));
        g.globalAlpha = 1; g.fillStyle = gr; g.beginPath(); g.moveTo(W / 2, H / 2); g.arc(W / 2, H / 2, R, a - trail, a); g.closePath(); g.fill();
        const bx = W / 2 + Math.cos(a) * R, by = H / 2 + Math.sin(a) * R, beam = g.createLinearGradient(W / 2, H / 2, bx, by);
        beam.addColorStop(0, rgba(pal.accent, .15)); beam.addColorStop(1, rgba(pal.accent, .85));
        g.strokeStyle = beam; g.lineWidth = 1.5; g.beginPath(); g.moveTo(W / 2, H / 2); g.lineTo(bx, by); g.stroke();
        const since = (ang: number) => ((a - ang) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2);
        ps.forEach(p => dot(p.x, p.y, p.s, "accent", .7 * Math.max(.08, 1 - since(p.a!) / 2.2)));
        // one red blip per story, anywhere inside the outer ring; each moves somewhere new once the beam has left it and it
        // has faded, so a story turns up in a different place on the next pass
        const nb = data.n ?? 3;
        const others = (i: number) => blips.filter((_, j) => j !== i).map(b => b.band);
        while (blips.length < nb) blips.push(blip(blips.length, nb, R, blips.map(b => b.band)));
        blips.length = nb;
        blips.forEach((bl, i) => { const s = since(bl.a);
          if (s > Math.PI && !bl.moved) { blips[i] = { ...blip(i, nb, R, others(i)), moved: true }; return; }
          if (s < 1) bl.moved = false;
          dot(W / 2 + Math.cos(bl.a) * bl.r * R, H / 2 + Math.sin(bl.a) * bl.r * R, 7, "critical", Math.max(.06, 1 - s / 2.2)); }); }
      if (kind === "health") { dot(W / 2, H / 2, 16 + Math.sin(t / 12) * 3, data.late ? "high" : "accent", .95);
        agents().forEach(ag => { g.strokeStyle = ag.u ? pal.accent : pal.ink3; g.globalAlpha = ag.u ? .35 : .2; g.setLineDash(ag.u ? [] : [4, 6]); g.beginPath(); g.moveTo(W / 2, H / 2); g.lineTo(ag.x, ag.y); g.stroke(); g.setLineDash([]);
          dot(ag.x, ag.y, ag.u ? 11 : 8, ag.u ? "accent" : "ink3", ag.u ? .95 : .5); }); agents().forEach((ag, i) => say(ag.x, ag.y + (ag.y > H / 2 ? 30 : -18), data.labels?.[i])); say(W / 2 + 26, H / 2 + 5, "AMIRI Agent", "left"); }
    };
    const step = () => {
      t++; frame++;
      if (frame % 90 === 0) readPal();
      spawn(); ps.forEach(move); ps = ps.filter(p => p.life < p.max && p.x > -20 && p.x < W + 20 && p.y > -20 && p.y < H + 20);
      g.clearRect(0, 0, W, H);
      g.globalCompositeOperation = dark ? "lighter" : "source-over";
      if (kind !== "radar") ps.forEach(p => { const f = p.life / p.max; dot(p.x, p.y, p.s, p.c, Math.min(1, f * 6, (1 - f) * 8) * (p.c === "ink3" ? .55 : 1)); });  // fade in, stay lit, fade only on arrival
      extra();
      g.globalCompositeOperation = "source-over";
    };
    const loop = () => { step(); raf = requestAnimationFrame(loop); };
    fit();
    const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (still) { for (let i = 0; i < 150; i++) { spawn(); ps.forEach(move); } step(); return; }
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting && !on) { on = true; loop(); } else if (!e.isIntersecting && on) { on = false; cancelAnimationFrame(raf); } });
    io.observe(cv);
    const ro = new ResizeObserver(fit); ro.observe(cv);
    return () => { io.disconnect(); ro.disconnect(); cancelAnimationFrame(raf); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, key]);
  return <canvas ref={ref} className="ovs-canvas" role="img" aria-label={label} />;
}
