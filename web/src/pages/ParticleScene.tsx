// The radar sweep beside Overview's "Latest from Radar": each story is a blip, labelled with its place, lit as the beam
// passes. Canvas 2D, one sprite per colour; it runs only while on screen, and under reduced motion it draws one still frame.
import { useEffect, useRef } from "react";

export type SceneData = { n?: number; labels?: string[]; ids?: string[]; scores?: number[] };
type P = { x: number; y: number; vx: number; vy: number; life: number; max: number; c: string; s: number; k?: number; a?: number };
type Pal = Record<"accent" | "critical" | "ink", string>;

const rnd = (a: number, b: number) => a + Math.random() * (b - a);
/** A hex colour at an opacity, so fades stay in that colour (fading to "transparent" goes through black and leaves grey rims). */
const rgba = (c: string, a: number) => { const m = c.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i); if (!m) return c;
  const h = m[1].length === 3 ? [...m[1]].map(x => x + x).join("") : m[1], n = parseInt(h, 16);
  return `rgba(${n >> 16}, ${(n >> 8) & 255}, ${n & 255}, ${a})`; };

function sprite(color: string): HTMLCanvasElement {  // a soft glowing dot, drawn once per colour
  const c = document.createElement("canvas"); c.width = c.height = 32;
  const g = c.getContext("2d")!, r = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  r.addColorStop(0, color); r.addColorStop(.25, color); r.addColorStop(1, "transparent");
  g.fillStyle = r; g.fillRect(0, 0, 32, 32);
  return c;
}

export function ParticleScene({ data, label }: { data: SceneData; label: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const key = JSON.stringify(data);
  useEffect(() => {
    const cv = ref.current!; const g = cv.getContext("2d")!;
    const css = (n: string) => getComputedStyle(cv).getPropertyValue(n).trim();
    let pal: Pal, sp: Record<string, HTMLCanvasElement>, dark = false;
    const readPal = () => {
      pal = { accent: css("--accent"), critical: css("--critical"), ink: css("--ink-2") };
      sp = Object.fromEntries(Object.entries(pal).map(([k, v]) => [k, sprite(v)]));
      dark = getComputedStyle(document.documentElement).colorScheme.includes("dark");  // glow adds up on dark, plain dots on light
    };
    readPal();
    let W = 0, H = 0, ps: P[] = [], t = 0, raf = 0, on = false, frame = 0;
    // radar story blips, fixed so a story's place label stays put: (1) each story owns an equal slice of the circle, starting at
    // the top, and sits inside it away from the slice's edges, so the labels don't pile up; (2) its ring is how important it is,
    // by Radar score: the top third on the inner ring, the next on the middle, the rest on the outer; (3) where inside its slice and
    // ring comes from the story's id, so it lands in the same spot after every refresh
    const RINGS = [.12, .33, .66, 1];  // the centre gap, then the three rings, as a share of the outer radius
    const hash = (id: string, k: number) => { let h = 2166136261 ^ k; for (const ch of id) h = Math.imul(h ^ ch.charCodeAt(0), 16777619); return (h >>> 0) / 4294967296; };
    const blip = (i: number, n: number, R: number) => {
      const id = data.ids?.[i] ?? String(i), sc = data.scores ?? [], rank = sc.filter(v => v > (sc[i] ?? 0)).length;
      const band = Math.min(2, Math.floor(rank * 3 / n)), slice = Math.PI * 2 / n, pad = Math.min(.35, slice / 4), m = 12 / R;  // 12 px clear of a ring
      const lo = RINGS[band] + (band ? m : 0), hi = Math.max(lo, RINGS[band + 1] - m);
      return { a: -Math.PI / 2 + i * slice + pad + hash(id, 1) * (slice - 2 * pad), r: lo + hash(id, 2) * (hi - lo) };
    };
    const fit = () => { const r = cv.getBoundingClientRect(), d = Math.min(2, devicePixelRatio || 1);
      W = r.width; H = r.height; cv.width = W * d; cv.height = H * d; g.setTransform(d, 0, 0, d, 0, 0); };
    const dot = (x: number, y: number, s: number, c: string, a: number) => { g.globalAlpha = Math.max(0, Math.min(1, a)); g.drawImage(sp[c], x - s, y - s, s * 2, s * 2); };

    // ---- spawn() adds the sweep's particles, move() places one on its circle, extra() draws the rings, beam and blips
    const spawn = () => { if (ps.length < 160) ps.push({ x: W / 2 + Math.cos(rnd(0, 7)) * rnd(10, H * .44), y: 0, vx: 0, vy: 0, life: 0, max: 1e9, c: "accent", s: rnd(1.5, 3), a: rnd(0, Math.PI * 2), k: rnd(10, H * .44) }); };
    const move = (p: P) => { p.life++; p.x = W / 2 + Math.cos(p.a!) * p.k!; p.y = H / 2 + Math.sin(p.a!) * p.k!; };
    const say = (x: number, y: number, text: string | undefined, align: CanvasTextAlign = "center", alpha = .95) => { if (!text) return;  // a plain label, so the motion reads
      g.globalCompositeOperation = "source-over"; g.globalAlpha = alpha; g.fillStyle = pal.ink; g.font = `500 14px ${css("--font-ui") || "sans-serif"}`; g.textAlign = align; g.fillText(text, x, y);
      g.globalCompositeOperation = dark ? "lighter" : "source-over"; };
    const extra = () => {
      g.globalAlpha = 1;
      { const R = H * .45, a = (t / 70) % (Math.PI * 2);
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
        // one red blip per story, labelled with its place, lit as the beam passes and fading after it
        const nb = data.n ?? 3;
        Array.from({ length: nb }, (_, i) => blip(i, nb, R)).forEach((bl, i) => { const s = since(bl.a);
          const x = W / 2 + Math.cos(bl.a) * bl.r * R, y = H / 2 + Math.sin(bl.a) * bl.r * R, lit = Math.max(.06, 1 - s / 2.2);
          dot(x, y, 7, "critical", lit);
          say(x, y + 24, data.labels?.[i], "center", Math.max(.85, lit)); }); }  // where the story is, fading with its blip but always readable
    };
    const step = () => {
      t++; frame++;
      if (frame % 90 === 0) readPal();
      spawn(); ps.forEach(move); ps = ps.filter(p => p.life < p.max && p.x > -20 && p.x < W + 20 && p.y > -20 && p.y < H + 20);
      g.clearRect(0, 0, W, H);
      g.globalCompositeOperation = dark ? "lighter" : "source-over";
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
  }, [key]);
  return <canvas ref={ref} className="ovs-canvas" role="img" aria-label={label} />;
}
