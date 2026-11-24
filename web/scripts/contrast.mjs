// WCAG contrast check for the v2 tokens (src/styles/v2/tokens.css). Plain Node, no dependencies.
// Prints the ratio of every text colour on each background it is meant for, and the non-text pairs.
// Exit code 1 if any text pair is under 4.5:1, any non-text pair under 3:1, or the two dark blocks differ.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, "../src/styles/v2/tokens.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

function block(open) {
  const start = css.indexOf(open);
  if (start < 0) throw new Error(`tokens.css: no block starting ${open}`);
  const body = css.slice(css.indexOf("{", start) + 1);
  let depth = 1, i = 0;
  for (; i < body.length && depth; i++) depth += body[i] === "{" ? 1 : body[i] === "}" ? -1 : 0;
  return body.slice(0, i - 1);
}
function vars(text) {
  const out = {};
  for (const m of text.matchAll(/(--v2-[\w-]+)\s*:\s*([^;]+);/g)) out[m[1].slice(5)] = m[2].trim();
  return out;
}

const light = vars(block(":root {"));
const darkToggle = vars(block(':root[data-theme="dark"]'));
const darkOs = vars(block('@media (prefers-color-scheme: dark)').replace(/^\s*:root:not\(\[data-theme="light"\]\)\s*\{/, ""));
const themes = { light, dark: { ...light, ...darkToggle } };

let failures = 0;
const fail = (msg) => { failures++; console.log(`  FAIL ${msg}`); };

// the OS-setting block and the toggle block must say the same thing
for (const k of new Set([...Object.keys(darkToggle), ...Object.keys(darkOs)])) {
  if (darkToggle[k] !== darkOs[k]) fail(`dark blocks differ on --v2-${k}: toggle=${darkToggle[k]} os=${darkOs[k]}`);
}
for (const k of Object.keys(darkToggle)) if (!(k in light)) fail(`--v2-${k} is dark-only`);
for (const k of Object.keys(light)) {
  if (/^(fs-|fw-|ls-|lh-|r-|sp-|dur|ease|font$|mono$|page-pad$|hit)/.test(k)) continue;
  if (!(k in darkToggle)) fail(`--v2-${k} has no dark value`);
}

function parse(v) {
  let m = /^#([0-9a-f]{6})$/i.exec(v);
  if (m) return [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16));
  m = /^#([0-9a-f]{3})$/i.exec(v);
  if (m) return [...m[1]].map((c) => parseInt(c + c, 16));
  throw new Error(`not an opaque hex colour: ${v}`);
}
const lin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
function ratio(a, b) {
  const [hi, lo] = [lum(parse(a)), lum(parse(b))].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

// [text token, [backgrounds it is meant for]]
const surfaces = ["page", "surface"];
const tints = ["bad-tint", "unusual-tint", "good-tint", "brand-tint", "neutral-tint", "sim-tint", "warn-bg", "hover", "selected", "count-bg"];
const text = [
  ["text", [...surfaces, ...tints]],
  ["text-2", [...surfaces, ...tints]],          // A1: the secondary text for tints
  ["muted", surfaces],                           // page and surface only; on a tint or hover fill use text-2 (A1)
  ["bad", [...surfaces, "bad-tint"]],
  ["unusual", [...surfaces, "unusual-tint"]],
  ["good", [...surfaces, "good-tint"]],
  ["brand", [...surfaces, "brand-tint", "hover", "selected"]],
  ["brand-hover", surfaces],
  ["neutral-ink", ["neutral-tint", ...surfaces]],   // the dashed Test / Checks off pill sits on the page or a row
  ["sim-ink", ["sim-tint"]],
  ["on-bad", ["bad"]],                           // count badge: text on a solid red
  ["ink-btn-text", ["ink-btn"]],
  ["warn-ink", ["unusual-tint", "warn-bg"]],
  ["warn-ink-2", ["warn-bg"]],
  ["toast-text", ["toast-bg"]],
  ["toast-text-2", ["toast-bg"]],
  ["toast-muted", ["toast-bg"]],
  ["event-text", ["event-bg"]],                  // the dark "The event" panel on the Event page
  ["event-text-2", ["event-bg"]],
  ["event-muted", ["event-bg"]],
];
// non-text pairs: [token, background]; 3:1
const nonText = [
  ["line-input", "surface"], ["line-input", "page"],
  ["focus", "page"], ["focus", "surface"],
  ["bad", "page"], ["bad", "surface"],           // the shape marks
  ["unusual", "page"], ["unusual", "surface"],
  ["good", "page"], ["good", "surface"],
];

for (const [name, t] of Object.entries(themes)) {
  console.log(`\n== ${name}: text (AA 4.5:1) ==`);
  for (const [fg, bgs] of text) {
    for (const bg of bgs) {
      const r = ratio(t[fg], t[bg]);
      const ok = r >= 4.5;
      console.log(`  ${ok ? "ok  " : "FAIL"} ${r.toFixed(2).padStart(5)}  --${fg} ${t[fg]} on --${bg} ${t[bg]}`);
      if (!ok) failures++;
    }
  }
  console.log(`\n== ${name}: non-text (3:1) ==`);
  for (const [fg, bg] of nonText) {
    const r = ratio(t[fg], t[bg]);
    const ok = r >= 3;
    console.log(`  ${ok ? "ok  " : "FAIL"} ${r.toFixed(2).padStart(5)}  --${fg} ${t[fg]} on --${bg} ${t[bg]}`);
    if (!ok) failures++;
  }
}

console.log(failures ? `\n${failures} problem(s).` : "\nAll pairs pass.");
process.exit(failures ? 1 : 0);
