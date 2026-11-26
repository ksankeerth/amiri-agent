// The boxes over the series page: add a series (search the provider, pick, name it, read its history), edit one, and stop
// watching one. Same calls as before; the words and rules are in components/series.tsx (theme choices) and words.ts.
// A refusal inside a box is shown inside it (the toasts sit under the dimmed page), with the server's own words.
import { useId, useRef, useState } from "react";
import { ApiError } from "../../api/client";
import { seriesApi, type Detector, type LookupItem, type Series, type Theme } from "../../api/series";
import { parseJson, seriesOf } from "../../components/fillJson";
import { AUTO, COMMODITY, parsePlaces, themeFor, themeId, themeLabel, themePresets } from "../../components/series";
import { useDemoLock } from "../../components/lock";
import { useToast } from "../../components/ui";
import { Button } from "../../components/v2/Button";
import { Dialog } from "../../components/v2/Dialog";
import { Field, Input, Select } from "../../components/v2/Field";
import { FileDrop } from "../../components/v2/FilePicker";
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
      <FileDrop accept="application/json,.json" noun="a JSON file" pickLabel="Fill from a JSON file" aria-describedby={`${id}-m`} onFile={load} onReject={setMsg} />
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
  const [symErr, setSymErr] = useState<string | null>(null);
  const symIn = useRef<HTMLInputElement>(null);

  const search = async () => {
    if (!q.trim()) return;
    setSearching(true); setErr(null);
    try { setResults((await seriesApi.lookup(q.trim())).items); }
    catch (e) { setErr(sayError(e)); }
    finally { setSearching(false); }
  };
  const pick = (i: LookupItem) => {
    setSymErr(null); setSymbol(i.symbol); setName(i.symbol === i.name || !i.name ? i.symbol : `${i.symbol} (${i.name})`.slice(0, 60));
    setTheme(COMMODITY[i.symbol.toUpperCase().split("/")[0]] ?? AUTO);   // gold, oil: their own meaning; else the server sets it from the symbol
  };
  // a file's series fills the form (to check and edit, then add); a theme that isn't one of the choices is set from the symbol
  const fillFrom = (x: Record<string, any>) => {
    const sym = String(x.symbol ?? "").trim();
    setSymErr(null); setSymbol(sym); setName(typeof x.name === "string" ? x.name.slice(0, 60) : "");
    setPlaces(Array.isArray(x.places) ? x.places.join(", ") : typeof x.places === "string" ? x.places : "");
    const id = x.theme && typeof x.theme === "object" ? themeId(x.theme as Theme, sym) : "";
    setTheme(id && id !== "custom" && themePresets(sym).some(t => t.id === id) ? id : COMMODITY[sym.toUpperCase().split("/")[0]] ?? AUTO);
    setErr(null);
  };
  const add = async () => {
    if (locked) return;
    if (!symbol.trim()) { setSymErr("Choose a symbol from the search, or type one (for example EUR/USD)."); symIn.current?.focus(); return; }
    setBusy(true); setErr(null);
    try {
      const s = await seriesApi.create({ symbol: symbol.trim(), name: name.trim() || undefined, places: parsePlaces(places),
        ...(theme === AUTO ? {} : { theme: themeFor(theme, symbol.trim()) }) });
      toast(`${s.name} added: ${s.state_reason}`);
      onAdded(s);
    } catch (e) { setErr(sayError(e)); }
    finally { setBusy(false); }
  };
  const noSlots = left <= 0;
  return (
    <Dialog title="Add a series" size="L" onClose={onClose} initialFocus="input[type=search]" actions={<>
      <span className="v2-dlg__aside">{plural(Math.max(left, 0), "series slot")} left</span>
      <Button onClick={onClose}>Cancel</Button>
      <Button variant="primary" locked={locked} disabled={busy || noSlots} busy={busy} busyLabel="Reading history…" onClick={add}>Add and read history</Button></>}>
      <p className="v2-sr-dlg__p">AMIRI Agent reads about 2,000 hours of history from Twelve Data now (1 credit), then pulls new prices every hour. A move far outside normal becomes a finding. No model is involved.</p>
      {noSlots && <p className="v2-sr-alert is-warn" role="status">All the series slots are used. Stop watching one to add another.</p>}
      <JsonFill onFill={fillFrom} />
      <div className="v2-sr-lookup">
        <Field label="Find a symbol" className="v2-sr-lookup__f">
          <Input type="search" value={q} onChange={e => setQ(e.target.value)} placeholder="EUR, gold, Brent"
            onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); search(); } }} /></Field>
        <Button onClick={search} disabled={searching || !q.trim()} busy={searching} busyLabel="Searching…">Search</Button>
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
        <Field req label="Symbol" error={symErr ?? undefined}><Input ref={symIn} mono value={symbol} onChange={e => { setSymbol(e.target.value); setSymErr(null); }} placeholder="EUR/USD" /></Field>
        <Field label="Name shown"><Input value={name} maxLength={60} onChange={e => setName(e.target.value)} placeholder="Defaults to the symbol" /></Field>
        <Field label="What a move means" hint="The investigation reads findings by theme, so it needs no model for them.">
          <Select value={theme} onChange={e => setTheme(e.target.value)}>
            {!COMMODITY[symbol.trim().toUpperCase().split("/")[0]] && <option value={AUTO}>Set from the symbol</option>}
            {themePresets(symbol.trim()).map(t => <option key={t.id} value={t.id}>{t.label}</option>)}</Select></Field>
        <Field label="Places (ISO codes)" hint="Where a move matters; findings carry them. Empty: an FX pair gets its currency's country.">
          <Input value={places} onChange={e => setPlaces(e.target.value)} placeholder="LK, AE" /></Field>
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
  return (
    <Dialog title={`Edit ${s.name}`} size="L" onClose={onClose} initialFocus="input" actions={<>
      <Button onClick={onClose}>Cancel</Button>
      <Button variant="primary" locked={locked} disabled={busy} busy={busy} busyLabel="Saving…" onClick={save}>Save</Button></>}>
      <div className="v2-sr-grid">
        <Field label="Name shown"><Input value={name} maxLength={60} onChange={e => setName(e.target.value)} /></Field>
        <Field label="Symbol" hint="To watch another symbol, add a series."><Input mono value={s.symbol} disabled /></Field>
        <Field label="What a move means">
          <Select value={theme} onChange={e => setTheme(e.target.value)}>
            {themePresets(s.symbol).map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
            {themeId(s.theme, s.symbol) === "custom" && <option value="custom">{themeLabel(s.theme)}</option>}</Select></Field>
        <Field label="Places (ISO codes)"><Input value={places} onChange={e => setPlaces(e.target.value)} /></Field>
      </div>
      <h3 className="v2-cap">When it flags a move</h3>
      <div className="v2-sr-grid">
        <Field label="Flags at (× a usual move)"><Input type="number" step="0.5" min={1} max={10} value={d.z_threshold} onChange={num("z_threshold")} /></Field>
        <Field label="Move lengths (trading days)" hint="Up to 4, each 1 to 20."><Input value={windows} onChange={e => setWindows(e.target.value)} /></Field>
        <Field label="A usual move from the last … trading days"><Input type="number" min={20} max={250} value={d.sigma_days} onChange={num("sigma_days")} /></Field>
        <Field label="Quiet after flagging (hours)"><Input type="number" min={0} max={168} value={d.cooldown_hours} onChange={num("cooldown_hours")} /></Field>
        <Field label="Waiting for prices after (market hours without a price)"><Input type="number" min={1} max={168} value={d.stale_after_hours} onChange={num("stale_after_hours")} /></Field>
      </div>
      {err && <p className="v2-sr-alert" role="alert">{err}</p>}
    </Dialog>
  );
}

// ---------------------------------------------------------------- stop watching
export function StopWatchingDialog({ s, onClose, onConfirm, busy }: { s: Series; onClose: () => void; onConfirm: () => void; busy: boolean }) {
  const locked = useDemoLock();
  return (
    <Dialog tone="danger" title={`Stop watching ${s.name}?`} onClose={onClose} actions={<>
      <Button onClick={onClose}>Cancel</Button>
      <Button variant="primary" locked={locked} disabled={busy} busy={busy} busyLabel="Stopping…" onClick={onConfirm}>Stop watching</Button></>}>
      <p>Its stored prices and fetch log are removed and it frees a series slot. Moves it already flagged stay as findings.</p>
    </Dialog>
  );
}
