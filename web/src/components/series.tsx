import { useState } from "react";
import { ApiError } from "../api/client";
import { seriesApi, type Detector, type FetchOutcome, type LookupItem, type Series, type SeriesState, type Theme } from "../api/series";
import { until, when, zx } from "../format";
import { currencyWord, SERIES_STATE } from "../plain";
import { StatusPill } from "./blocks";
import { FillFromJson } from "./FillFromJson";
import { seriesOf } from "./fillJson";
import { Icon } from "./Icon";
import { Modal, useNow, useToast } from "./ui";

export const StateBadge = ({ state }: { state: SeriesState }) => { const [t, tone] = SERIES_STATE[state]; return <StatusPill tone={tone}>{t}</StatusPill>; };

/** A series' state in one plain sentence, for its header and its card. */
export function seriesSentence(s: Series, now = new Date()): string {
  const l = s.latest;
  switch (s.state) {
    case "stale": return `Prices haven't updated since ${l ? when(l.bar_end, now) : "they were added"}; your Platform Admin has been told.`;
    case "moved": return `An unusual move: ${zx(l?.max_z)} a normal move${l?.max_z_days ? ` over ${l.max_z_days} day${l.max_z_days === 1 ? "" : "s"}` : ""}.`;
    case "warming_up": return "Still learning what a normal move is; it can flag moves once it has enough history.";
    case "pending": return "Waiting for its first prices.";
    case "paused": return "Paused: prices aren't updated until it's resumed.";
    default: return l?.max_z !== null && l?.max_z !== undefined ? `Normal: the largest recent move is ${zx(l.max_z)} a normal one.` : "Normal.";
  }
}

export function FetchBadge({ s }: { s: Series }) {
  if (s.fetch.last_status !== "error") return null;
  return <StatusPill tone="red" icon="warn" title={s.fetch.last_error?.message}>Last update failed</StatusPill>;
}

/** What a refresh did, in words. */
export function outcomeText(name: string, f: FetchOutcome): string {
  if (f.finding_id) return `${name}: unusual move flagged.`;
  if (f.status === "ok") return `${name}: ${f.bars_new} new hour${f.bars_new === 1 ? "" : "s"} of prices.`;
  return `${name}: no new prices yet (the current hour shows once it closes; markets may be closed).`;
}

export function RefreshButton({ s, onDone, small = true }: { s: Series; onDone: (s: Series) => void; small?: boolean }) {
  const toast = useToast();
  const now = useNow(1000);
  const [busy, setBusy] = useState(false);
  const [retryAt, setRetryAt] = useState<string | null>(null);
  const wait = [s.fetch.refresh_available_at, retryAt].filter((x): x is string => !!x && new Date(x) > now).sort().pop();
  const disabled = busy || s.fetch.in_progress || !s.enabled || !!wait;
  const label = busy || s.fetch.in_progress ? "Fetching…" : wait ? `Refresh in ${until(wait, now)}` : "Refresh now";
  const title = !s.enabled ? "Paused: resume the series to fetch" :
    wait ? "Each series can be refreshed once every 2 minutes (prototype limit)" : "Pull the latest hourly prices from Twelve Data now";
  const go = async () => {
    setBusy(true);
    try {
      const r = await seriesApi.refresh(s.series_id);
      toast(outcomeText(s.name, r.fetch));
      onDone(r.series);
    } catch (e) {
      if (e instanceof ApiError) {
        toast(`${s.name}: ${e.full}`);
        if (e.problem.retry_after_seconds) setRetryAt(new Date(Date.now() + e.problem.retry_after_seconds * 1000).toISOString());
        seriesApi.get(s.series_id).then(onDone).catch(() => {});
      } else toast(String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <button className={`btn ${small ? "btn--sm" : ""}`} type="button" onClick={go} disabled={disabled} title={title}>
      <Icon name="refresh" className={busy || s.fetch.in_progress ? "spin" : undefined} />{label}
    </button>
  );
}

// ---------------------------------------------------------------- theme presets
// Theme ids are the Metrics Spec's; directions are Amiri Agent's (GET /api/v1/reference/themes).
// An fx theme names the currency that moved, so its presets come from the symbol's two sides.
type Preset = { id: string; label: string; theme: Theme | null };
const FIXED: Preset[] = [
  { id: "gold", label: "Gold price", theme: { theme: "commodities", direction_up: "up", direction_down: "down", item: "gold" } },
  { id: "oil", label: "Oil price", theme: { theme: "commodities", direction_up: "up", direction_down: "down", item: "oil" } },
  { id: "rates", label: "Interest rate", theme: { theme: "rates", direction_up: "up", direction_down: "down" } },
  { id: "index", label: "Stock index", theme: { theme: "markets", direction_up: "equity_up", direction_down: "equity_down" } },
  { id: "", label: "None (no theme on findings)", theme: null },
];
// gold and oil look like currency pairs (XAU/USD, XBR/USD): they only get their own meaning, never an exchange rate
const COMMODITY: Record<string, string> = { XAU: "gold", WTI: "oil", BRENT: "oil", XBR: "oil", XTI: "oil", URALS: "oil", USOIL: "oil", UKOIL: "oil" };
export function themePresets(symbol: string): Preset[] {
  const [a, b] = symbol.toUpperCase().split("/");
  const c = COMMODITY[a ?? ""];
  if (c) return FIXED.filter(t => t.id === c || t.id === "");
  const fx: Preset[] = /^[A-Z]{3}$/.test(a ?? "") && /^[A-Z]{3}$/.test(b ?? "") ? [
    { id: `fx_${b}`, label: `Exchange rate: up = ${b} weaker`, theme: { theme: "fx", direction_up: "weaker", direction_down: "stronger", currency: b } },
    { id: `fx_${a}`, label: `Exchange rate: up = ${a} stronger`, theme: { theme: "fx", direction_up: "stronger", direction_down: "weaker", currency: a } },
  ] : [];
  return [...fx, ...FIXED];
}
const AUTO = "auto";
const same = (a: Theme, b: Theme) => a.theme === b.theme && a.direction_up === b.direction_up && (a.item ?? null) === (b.item ?? null)
  && (a.currency ?? null) === (b.currency ?? null);
const themeId = (t: Theme | null, symbol: string) => (t ? themePresets(symbol).find(x => x.theme && same(x.theme, t))?.id ?? "custom" : "");
const themeFor = (id: string, symbol: string) => themePresets(symbol).find(t => t.id === id)?.theme ?? null;
const parsePlaces = (s: string) => s.split(/[,\s]+/).map(x => x.trim().toUpperCase()).filter(Boolean);
const THEME_WORDS: Record<string, string> = { fx: "Exchange rate", commodities: "Commodity price", rates: "Interest rate" };
/** What a move in this series means, in a sentence a banker would say. */
export const themeMeaning = (t: Theme | null) => {
  if (!t) return "not set";
  const up = t.direction_up.replace(/_/g, " "), down = t.direction_down.replace(/_/g, " ");
  if (t.currency) { const w = currencyWord(t.currency).toLowerCase(); return `A rise means a ${up} ${w}, a fall a ${down} one`; }
  return `${THEME_WORDS[t.theme] ?? t.theme}${t.item ? ` (${t.item})` : ""}: a rise means ${up}, a fall means ${down}`;
};
export const themeLabel = (t: Theme | null) =>
  !t ? "no theme" : `${t.theme}${t.item ? ` (${t.item})` : ""}${t.currency ? ` ${t.currency}` : ""}: up = ${t.direction_up.replace(/_/g, " ")}, down = ${t.direction_down.replace(/_/g, " ")}`;

// ---------------------------------------------------------------- add a series
export function AddSeriesModal({ onClose, onAdded, left }: { onClose: () => void; onAdded: (s: Series) => void; left: number }) {
  const toast = useToast();
  const [q, setQ] = useState("");
  const [results, setResults] = useState<LookupItem[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [symbol, setSymbol] = useState("");
  const [name, setName] = useState("");
  const [theme, setTheme] = useState(AUTO);
  const [places, setPlaces] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const search = async () => {
    if (!q.trim()) return;
    setSearching(true); setErr(null);
    try { setResults((await seriesApi.lookup(q.trim())).items); }
    catch (e) { setErr(e instanceof ApiError ? e.full : String(e)); }
    finally { setSearching(false); }
  };
  const pick = (i: LookupItem) => {
    setSymbol(i.symbol); setName(i.symbol === i.name || !i.name ? i.symbol : `${i.symbol} (${i.name})`.slice(0, 60));
    const c = COMMODITY[i.symbol.toUpperCase().split("/")[0]];
    setTheme(c ?? AUTO);  // gold → Gold price, oil → Oil price; else the server sets it from the symbol
  };
  // a file's series fills the form (to check and edit, then add); a theme that isn't one of the choices is set from the symbol
  const fillFrom = (x: Record<string, any>) => {
    const sym = String(x.symbol ?? "").trim();
    setSymbol(sym); setName(typeof x.name === "string" ? x.name.slice(0, 60) : "");
    setPlaces(Array.isArray(x.places) ? x.places.join(", ") : typeof x.places === "string" ? x.places : "");
    const id = x.theme && typeof x.theme === "object" ? themeId(x.theme as Theme, sym) : "";
    setTheme(id && id !== "custom" && themePresets(sym).some(t => t.id === id) ? id : COMMODITY[sym.toUpperCase().split("/")[0]] ?? AUTO);
    setErr(null);
  };
  const add = async () => {
    if (!symbol.trim()) { setErr("Choose a symbol from the search, or type one (e.g. USD/LKR)."); return; }
    setBusy(true); setErr(null);
    try {
      const s = await seriesApi.create({ symbol: symbol.trim(), name: name.trim() || undefined, places: parsePlaces(places),
        ...(theme === AUTO ? {} : { theme: themeFor(theme, symbol.trim()) }) });
      toast(`${s.name} added: ${s.state_reason}`);
      onAdded(s);
    } catch (e) {
      setErr(e instanceof ApiError ? e.full : String(e));
    } finally { setBusy(false); }
  };
  return (
    <Modal title="Add a series" onClose={onClose} footer={<>
      <span className="small muted" style={{ marginRight: "auto" }}>{left} of the prototype's series slots left</span>
      <button className="btn" type="button" onClick={onClose}>Cancel</button>
      <button className="btn btn--primary" type="button" onClick={add} disabled={busy || left <= 0}>
        {busy ? <><Icon name="refresh" className="spin" />Reading history…</> : "Add and read history"}</button></>}>
      <FillFromJson what="a series" read={seriesOf} onFill={c => fillFrom(c.data)}
        example={'{"symbol": "USD/LKR", "name": "…", "places": ["LK"], "theme": {…}}, or a list of them'} />
      <p className="small muted">Amiri Agent reads about 2,000 hours of history from Twelve Data now (1 credit), then pulls new prices every hour. A move far outside normal becomes a finding. No model is involved.</p>
      <div className="row" style={{ alignItems: "flex-end" }}>
        <label className="field" style={{ flex: 1 }}><span>Find a symbol</span>
          <input className="input" value={q} onChange={e => setQ(e.target.value)} placeholder="e.g. LKR, gold, Brent"
            onKeyDown={e => e.key === "Enter" && search()} /></label>
        <button className="btn" type="button" onClick={search} disabled={searching || !q.trim()}>
          <Icon name={searching ? "refresh" : "search"} className={searching ? "spin" : undefined} />Search</button>
      </div>
      <span className="small muted" style={{ marginTop: -8 }}>Each search uses 1 Twelve Data credit; the same search is free for a day.</span>
      {results && (results.length ? (
        <div className="results">{results.map(i => (
          <button key={`${i.symbol}-${i.exchange}`} type="button" disabled={i.watched || i.on_plan === false} aria-pressed={symbol === i.symbol} onClick={() => pick(i)}
            title={i.on_plan === false ? `Needs the Twelve Data ${i.plan} plan; this key's plan doesn't include it` : undefined}>
            <b className="mono">{i.symbol}</b><span className="muted small" style={{ flex: 1 }}>{i.name} · {i.type}{i.exchange ? ` · ${i.exchange}` : ""}</span>
            {i.watched ? <span className="badge b-ok">WATCHED</span> : i.on_plan === false ? <span className="badge b-warn">NEEDS {i.plan?.toUpperCase()} PLAN</span> : null}
          </button>))}</div>
      ) : <div className="note">Nothing found for “{q}”.</div>)}
      <div className="grid2">
        <label className="field"><span>Symbol</span><input className="input mono" value={symbol} onChange={e => setSymbol(e.target.value)} placeholder="USD/LKR" /></label>
        <label className="field"><span>Name shown</span><input className="input" value={name} maxLength={60} onChange={e => setName(e.target.value)} placeholder="defaults to the symbol" /></label>
        <label className="field"><span>What a move means</span><select className="input" value={theme} onChange={e => setTheme(e.target.value)}>
          {!COMMODITY[symbol.trim().toUpperCase().split("/")[0]] && <option value={AUTO}>Set from the symbol (FX: the currency that moved; gold, oil, stock indices)</option>}
          {themePresets(symbol.trim()).map(t => <option key={t.id} value={t.id}>{t.label}</option>)}</select>
          <span className="hint">The investigation reads findings by theme, so it needs no model for them.</span></label>
        <label className="field"><span>Places (ISO codes)</span><input className="input" value={places} onChange={e => setPlaces(e.target.value)} placeholder="LK, AE" />
          <span className="hint">Where a move matters; findings carry them. Empty: an FX pair gets its currency's country.</span></label>
      </div>
      {err && <div className="rawerr">{err}</div>}
    </Modal>
  );
}

// ---------------------------------------------------------------- edit
export function EditSeriesModal({ s, onClose, onSaved }: { s: Series; onClose: () => void; onSaved: (s: Series) => void }) {
  const toast = useToast();
  const [name, setName] = useState(s.name);
  const [theme, setTheme] = useState(themeId(s.theme, s.symbol));
  const [places, setPlaces] = useState(s.places.join(", "));
  const [d, setD] = useState<Detector>(s.detector);
  const [windows, setWindows] = useState(s.detector.windows_days.join(", "));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const num = (k: keyof Detector) => (e: React.ChangeEvent<HTMLInputElement>) => setD({ ...d, [k]: Number(e.target.value) });
  const save = async () => {
    setBusy(true); setErr(null);
    try {
      const keepCustom = theme === "custom";
      const out = await seriesApi.update(s.series_id, s.version, {
        name: name.trim(), theme: keepCustom ? s.theme : themeFor(theme, s.symbol), places: parsePlaces(places),
        detector: { ...d, windows_days: windows.split(/[,\s]+/).filter(Boolean).map(Number) },
      });
      toast(`${out.name} saved.`);
      onSaved(out);
    } catch (e) {
      setErr(e instanceof ApiError ? (e.code === "conflict" ? "Someone changed this series meanwhile. Close, and edit again." : e.full) : String(e));
    } finally { setBusy(false); }
  };
  return (
    <Modal title={`Edit ${s.name}`} onClose={onClose} footer={<>
      <button className="btn" type="button" onClick={onClose}>Cancel</button>
      <button className="btn btn--primary" type="button" onClick={save} disabled={busy}>Save</button></>}>
      <div className="grid2">
        <label className="field"><span>Name shown</span><input className="input" value={name} maxLength={60} onChange={e => setName(e.target.value)} /></label>
        <label className="field"><span>Symbol</span><input className="input mono" value={s.symbol} disabled /><span className="hint">To watch another symbol, add a series.</span></label>
        <label className="field"><span>What a move means</span><select className="input" value={theme} onChange={e => setTheme(e.target.value)}>
          {themePresets(s.symbol).map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
          {themeId(s.theme, s.symbol) === "custom" && <option value="custom">{themeLabel(s.theme)}</option>}</select></label>
        <label className="field"><span>Places (ISO codes)</span><input className="input" value={places} onChange={e => setPlaces(e.target.value)} /></label>
      </div>
      <div className="label">When it fires</div>
      <div className="grid2">
        <label className="field"><span>Fires at (× typical move)</span><input className="input" type="number" step="0.5" min={1} max={10} value={d.z_threshold} onChange={num("z_threshold")} /></label>
        <label className="field"><span>Move lengths (trading days)</span><input className="input" value={windows} onChange={e => setWindows(e.target.value)} /><span className="hint">Up to 4, each 1–20.</span></label>
        <label className="field"><span>Typical move from the last … trading days</span><input className="input" type="number" min={20} max={250} value={d.sigma_days} onChange={num("sigma_days")} /></label>
        <label className="field"><span>Quiet after firing (hours)</span><input className="input" type="number" min={0} max={168} value={d.cooldown_hours} onChange={num("cooldown_hours")} /></label>
        <label className="field"><span>Stale after (market hours without a new price)</span><input className="input" type="number" min={1} max={168} value={d.stale_after_hours} onChange={num("stale_after_hours")} /></label>
      </div>
      {err && <div className="rawerr">{err}</div>}
    </Modal>
  );
}
