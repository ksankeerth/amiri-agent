// The boxes over the series page: add a series (search the provider, pick, name it, read its history), edit one, and stop
// watching one. Same calls as before; the words and rules are in components/series.tsx (theme choices) and words.ts.
// A refusal inside a box is shown inside it (the toasts sit under the dimmed page), with the server's own words.
import { useId, useState } from "react";
import { ApiError } from "../../api/client";
import { seriesApi, type Detector, type LookupItem, type Series, type Theme } from "../../api/series";
import { parseJson, seriesOf } from "../../components/fillJson";
import { AUTO, COMMODITY, parsePlaces, themeFor, themeId, themeLabel, themePresets } from "../../components/series";
import { useDemoLock } from "../../components/lock";
import { useToast } from "../../components/ui";
import { Button } from "../../components/v2/Button";
import { Dialog } from "../../components/v2/Dialog";
import { Pill } from "../../components/v2/Pill";
import { isEditConflict } from "../../components/v2/states";
import { plural } from "../../format";

const sayError = (e: unknown) => (e instanceof ApiError ? e.full : String(e));

/** "Fill from a JSON file": loads a series into the form to check and edit. Nothing is saved by this. */
function JsonFill({ onFill }: { onFill: (x: Record<string, any>) => void }) {
  const id = useId();
  const [msg, setMsg] = useState<string | null>(null);
  const [file, setFile] = useState<string | null>(null);
  const load = async (f: File) => {
    const p = parseJson(await f.text());
    if (!p.ok) { setFile(null); setMsg(p.error); return; }
    const found = seriesOf(p.doc);
    if (!found.length) { setFile(null); setMsg(`Nothing in ${f.name} to fill a series with. Expected {"symbol": "EUR/USD", "name": "…", "places": ["DE"]}, or a list of them.`); return; }
    onFill(found[0].data); setFile(f.name); setMsg(null);
  };
  return (
    <div className="v2-sr-json">
      <label className="v2-btn v2-btn--secondary v2-btn--sm" htmlFor={id}>Fill from a JSON file</label>
      <input id={id} type="file" accept="application/json,.json" className="v2-sr" aria-describedby={`${id}-m`}
        onChange={e => { const f = e.target.files?.[0]; e.target.value = ""; if (f) load(f); }} />
      <span id={`${id}-m`} role="status" className={msg ? "v2-sr-err" : "v2-meta"}>{msg ?? (file ? `Filled from ${file}: check it, then add.` : "")}</span>
    </div>
  );
}

// ---------------------------------------------------------------- add
export function AddSeriesDialog({ left, onClose, onAdded }: { left: number; onClose: () => void; onAdded: (s: Series) => void }) {
  const toast = useToast();
  const locked = useDemoLock();
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
    catch (e) { setErr(sayError(e)); }
    finally { setSearching(false); }
  };
  const pick = (i: LookupItem) => {
    setSymbol(i.symbol); setName(i.symbol === i.name || !i.name ? i.symbol : `${i.symbol} (${i.name})`.slice(0, 60));
    setTheme(COMMODITY[i.symbol.toUpperCase().split("/")[0]] ?? AUTO);   // gold, oil: their own meaning; else the server sets it from the symbol
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
    if (locked) return;
    if (!symbol.trim()) { setErr("Choose a symbol from the search, or type one (for example EUR/USD)."); return; }
    setBusy(true); setErr(null);
    try {
      const s = await seriesApi.create({ symbol: symbol.trim(), name: name.trim() || undefined, places: parsePlaces(places),
        ...(theme === AUTO ? {} : { theme: themeFor(theme, symbol.trim()) }) });
      toast(`${s.name} added: ${s.state_reason}`);
      onAdded(s);
    } catch (e) { setErr(sayError(e)); }
    finally { setBusy(false); }
  };
  const idq = useId(), ids = useId(), idn = useId(), idt = useId(), idp = useId();
  const noSlots = left <= 0;
  return (
    <Dialog title="Add a series" wide onClose={onClose} initialFocus="input[type=search]" footer={<>
      <span className="v2-meta v2-sr-slots">{plural(Math.max(left, 0), "series slot")} left</span>
      <Button variant="quiet" onClick={onClose}>Cancel</Button>
      <Button variant="primary" locked={locked} disabled={busy || noSlots} onClick={add}>{busy ? "Reading history…" : "Add and read history"}</Button></>}>
      <p className="v2-sr-dlg__p">Amiri Agent reads about 2,000 hours of history from Twelve Data now (1 credit), then pulls new prices every hour. A move far outside normal becomes a finding. No model is involved.</p>
      {noSlots && <p className="v2-sr-alert is-warn" role="status">All the series slots are used. Stop watching one to add another.</p>}
      <JsonFill onFill={fillFrom} />
      <div className="v2-sr-lookup">
        <div className="v2-sr-field"><label htmlFor={idq}>Find a symbol</label>
          <input id={idq} type="search" className="v2-sr-input" value={q} onChange={e => setQ(e.target.value)} placeholder="EUR, gold, Brent"
            onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); search(); } }} /></div>
        <Button onClick={search} disabled={searching || !q.trim()}>{searching ? "Searching…" : "Search"}</Button>
      </div>
      <p className="v2-meta">Each search uses 1 Twelve Data credit; the same search is free for a day.</p>
      {results && (results.length ? (
        <ul className="v2-sr-hits" aria-label="Search results">{results.map(i => (
          <li key={`${i.symbol}-${i.exchange}`}>
            <button type="button" disabled={i.watched || i.on_plan === false} aria-pressed={symbol === i.symbol} onClick={() => pick(i)}>
              <b className="v2-mono">{i.symbol}</b>
              <span className="v2-sr-hits__m">{i.name}{i.type ? ` · ${i.type}` : ""}{i.exchange ? ` · ${i.exchange}` : ""}</span>
              {i.watched ? <Pill tone="good">Watched</Pill> : i.on_plan === false ? <Pill>{i.plan ? `Needs the ${i.plan} plan` : "Not on your data plan"}</Pill> : null}
            </button></li>))}</ul>
      ) : <p className="v2-meta" role="status">Nothing found for “{q}”.</p>)}
      <div className="v2-sr-grid">
        <div className="v2-sr-field"><label htmlFor={ids}>Symbol</label><input id={ids} className="v2-sr-input v2-sr-input--mono" value={symbol} onChange={e => setSymbol(e.target.value)} placeholder="EUR/USD" /></div>
        <div className="v2-sr-field"><label htmlFor={idn}>Name shown</label><input id={idn} className="v2-sr-input" value={name} maxLength={60} onChange={e => setName(e.target.value)} placeholder="Defaults to the symbol" /></div>
        <div className="v2-sr-field"><label htmlFor={idt}>What a move means</label>
          <select id={idt} className="v2-sr-input" value={theme} onChange={e => setTheme(e.target.value)}>
            {!COMMODITY[symbol.trim().toUpperCase().split("/")[0]] && <option value={AUTO}>Set from the symbol</option>}
            {themePresets(symbol.trim()).map(t => <option key={t.id} value={t.id}>{t.label}</option>)}</select>
          <span className="v2-sr-hint">The investigation reads findings by theme, so it needs no model for them.</span></div>
        <div className="v2-sr-field"><label htmlFor={idp}>Places (ISO codes)</label><input id={idp} className="v2-sr-input" value={places} onChange={e => setPlaces(e.target.value)} placeholder="LK, AE" />
          <span className="v2-sr-hint">Where a move matters; findings carry them. Empty: an FX pair gets its currency's country.</span></div>
      </div>
      {err && <p className="v2-sr-alert" role="alert">{err}</p>}
    </Dialog>
  );
}

// ---------------------------------------------------------------- edit
export function EditSeriesDialog({ s, onClose, onSaved }: { s: Series; onClose: () => void; onSaved: (s: Series) => void }) {
  const toast = useToast();
  const locked = useDemoLock();
  const [name, setName] = useState(s.name);
  const [theme, setTheme] = useState(themeId(s.theme, s.symbol));
  const [places, setPlaces] = useState(s.places.join(", "));
  const [d, setD] = useState<Detector>(s.detector);
  const [windows, setWindows] = useState(s.detector.windows_days.join(", "));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const num = (k: keyof Detector) => (e: React.ChangeEvent<HTMLInputElement>) => setD({ ...d, [k]: Number(e.target.value) });
  const save = async () => {
    if (locked) return;
    setBusy(true); setErr(null);
    try {
      const out = await seriesApi.update(s.series_id, s.version, {
        name: name.trim(), theme: theme === "custom" ? s.theme : themeFor(theme, s.symbol), places: parsePlaces(places),
        detector: { ...d, windows_days: windows.split(/[,\s]+/).filter(Boolean).map(Number) },
      });
      toast(`${out.name} saved.`);
      onSaved(out);
    } catch (e) {
      setErr(e instanceof ApiError && (e.code === "conflict" || isEditConflict(e)) ? "Someone changed this series meanwhile. Close this box and edit again." : sayError(e));
    } finally { setBusy(false); }
  };
  const id = useId();
  const f = (k: string) => `${id}-${k}`;
  return (
    <Dialog title={`Edit ${s.name}`} wide onClose={onClose} initialFocus="input" footer={<>
      <Button variant="quiet" onClick={onClose}>Cancel</Button>
      <Button variant="primary" locked={locked} disabled={busy} onClick={save}>{busy ? "Saving…" : "Save"}</Button></>}>
      <div className="v2-sr-grid">
        <div className="v2-sr-field"><label htmlFor={f("n")}>Name shown</label><input id={f("n")} className="v2-sr-input" value={name} maxLength={60} onChange={e => setName(e.target.value)} /></div>
        <div className="v2-sr-field"><label htmlFor={f("s")}>Symbol</label><input id={f("s")} className="v2-sr-input v2-sr-input--mono" value={s.symbol} disabled />
          <span className="v2-sr-hint">To watch another symbol, add a series.</span></div>
        <div className="v2-sr-field"><label htmlFor={f("t")}>What a move means</label>
          <select id={f("t")} className="v2-sr-input" value={theme} onChange={e => setTheme(e.target.value)}>
            {themePresets(s.symbol).map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
            {themeId(s.theme, s.symbol) === "custom" && <option value="custom">{themeLabel(s.theme)}</option>}</select></div>
        <div className="v2-sr-field"><label htmlFor={f("p")}>Places (ISO codes)</label><input id={f("p")} className="v2-sr-input" value={places} onChange={e => setPlaces(e.target.value)} /></div>
      </div>
      <h3 className="v2-cap">When it flags a move</h3>
      <div className="v2-sr-grid">
        <div className="v2-sr-field"><label htmlFor={f("z")}>Flags at (× a usual move)</label><input id={f("z")} className="v2-sr-input" type="number" step="0.5" min={1} max={10} value={d.z_threshold} onChange={num("z_threshold")} /></div>
        <div className="v2-sr-field"><label htmlFor={f("w")}>Move lengths (trading days)</label><input id={f("w")} className="v2-sr-input" value={windows} onChange={e => setWindows(e.target.value)} /><span className="v2-sr-hint">Up to 4, each 1 to 20.</span></div>
        <div className="v2-sr-field"><label htmlFor={f("g")}>A usual move from the last … trading days</label><input id={f("g")} className="v2-sr-input" type="number" min={20} max={250} value={d.sigma_days} onChange={num("sigma_days")} /></div>
        <div className="v2-sr-field"><label htmlFor={f("c")}>Quiet after flagging (hours)</label><input id={f("c")} className="v2-sr-input" type="number" min={0} max={168} value={d.cooldown_hours} onChange={num("cooldown_hours")} /></div>
        <div className="v2-sr-field"><label htmlFor={f("l")}>Late after (market hours without a price)</label><input id={f("l")} className="v2-sr-input" type="number" min={1} max={168} value={d.stale_after_hours} onChange={num("stale_after_hours")} /></div>
      </div>
      {err && <p className="v2-sr-alert" role="alert">{err}</p>}
    </Dialog>
  );
}

// ---------------------------------------------------------------- stop watching
export function StopWatchingDialog({ s, onClose, onConfirm, busy }: { s: Series; onClose: () => void; onConfirm: () => void; busy: boolean }) {
  const locked = useDemoLock();
  return (
    <Dialog title={`Stop watching ${s.name}?`} onClose={onClose} footer={<>
      <Button variant="quiet" onClick={onClose}>Cancel</Button>
      <Button variant="primary" locked={locked} disabled={busy} onClick={onConfirm}>{busy ? "Stopping…" : "Stop watching"}</Button></>}>
      <p>Its stored prices and fetch log are removed and it frees a series slot. Moves it already flagged stay as findings.</p>
    </Dialog>
  );
}
