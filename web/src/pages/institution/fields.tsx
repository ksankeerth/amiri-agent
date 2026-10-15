// Form controls for the institution profile. Every control is controlled: value + onChange.
import { cloneElement, createContext, isValidElement, useContext, useEffect, useId, useMemo, useRef, useState, type ReactElement, type ReactNode } from "react";
import type { Item, PlaceInfo } from "../../api/institutions";
import { ref, type Dimension } from "../../api/reference";
import { Icon } from "../../components/Icon";

export function useLoad<T>(f: () => Promise<T>, deps: unknown[] = []): T | null {
  const [v, setV] = useState<T | null>(null);
  useEffect(() => {
    let live = true;
    f().then(x => live && setV(x)).catch(() => {});
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return v;
}

/** A labelled control. A single input, select or textarea is tied to its label and to the hint or error, so a screen reader
 *  announces "Name, edit text, <hint>"; anything composite (chips, several controls) is a named group. */
/** The label of the Field a composite control sits in, for the control inside (a select in a wrapper component). */
const FieldLabel = createContext<string | undefined>(undefined);
export const useFieldLabel = () => useContext(FieldLabel);

/** A required field's mark: a star to see, "required" to hear. The forms say once that * means required. */
export const Req = () => <><span className="req" aria-hidden="true"> *</span><span className="sr"> (required)</span></>;

export function Field({ label, hint, error, children, full, req }: { label: string; hint?: ReactNode; error?: string; children: ReactNode; full?: boolean; req?: boolean }) {
  const id = useId();
  const note = error || hint ? `${id}-note` : undefined;
  const single = isValidElement(children) && typeof children.type === "string" && ["input", "select", "textarea"].includes(children.type);
  const body = single
    ? cloneElement(children as ReactElement<Record<string, unknown>>, { id, "aria-describedby": note, "aria-invalid": error ? true : undefined })
    : children;
  return (
    <div className="field" role={single ? undefined : "group"} aria-labelledby={single ? undefined : `${id}-label`} style={full ? { gridColumn: "1 / -1" } : undefined}>
      {single ? <label htmlFor={id}>{label}{req && <Req />}</label> : <span id={`${id}-label`}>{label}{req && <Req />}</span>}
      <FieldLabel.Provider value={single ? undefined : `${id}-label`}>{body}</FieldLabel.Provider>
      {error ? <span className="errtext" id={note} role="alert">{error}</span> : hint ? <span className="hint" id={note}>{hint}</span> : null}
    </div>
  );
}

// ---------------------------------------------------------------- places

export type PlaceScope = "any" | "iso" | "country";

/** The name of a place code, looked up once. */
export function PlaceName({ code, names }: { code: string; names?: Record<string, string | null> }) {
  const known = names?.[code];
  const info = useLoad(() => (known ? Promise.resolve(null) : ref.place(code)), [code, known]);
  return <>{known ?? info?.name ?? code}</>;
}

const NONE: string[] = [];

export function PlacePicker({ onPick, scope = "any", placeholder = "Search a country, region, city, port or strait…", exclude = NONE }: {
  onPick: (p: PlaceInfo) => void; scope?: PlaceScope; placeholder?: string; exclude?: string[];
}) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<PlaceInfo[]>([]);
  const [open, setOpen] = useState(false);
  const seq = useRef(0);
  // by value: a caller's new array on every render must not re-run this (with setHits([]) that looped forever,
  // and the endless re-rendering starved every navigation on the page)
  const excluded = exclude.join(",");
  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) { setHits(h => (h.length ? [] : h)); return; }
    const n = ++seq.current;
    const t = setTimeout(() => {
      ref.searchPlaces(term, scope === "country" ? "country" : undefined).then(items => {
        if (n !== seq.current) return;
        const skip = new Set(excluded.split(","));
        setHits(items.filter(p => !skip.has(p.code) && (scope !== "iso" || !p.code.includes(":"))));
        setOpen(true);
      }).catch(() => {});
    }, 200);
    return () => clearTimeout(t);
  }, [q, scope, excluded]);
  return (
    <div style={{ position: "relative" }}>
      <input className="input" value={q} placeholder={placeholder} onChange={e => setQ(e.target.value)}
        onFocus={() => hits.length && setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)} />
      {open && hits.length > 0 && (
        <div className="results" style={{ position: "absolute", zIndex: 20, left: 0, right: 0, top: 38, background: "var(--surface)", boxShadow: "var(--e-pop)" }}>
          {hits.map(p => (
            <button key={p.code} type="button" onMouseDown={e => { e.preventDefault(); onPick(p); setQ(""); setHits([]); setOpen(false); }}>
              <b>{p.name}</b><span className="small muted" style={{ flex: 1 }}>{p.kind}{p.parent ? ` · in ${p.parent}` : ""}</span>
              <span className="mono small muted">{p.code}</span>
            </button>))}
        </div>
      )}
    </div>
  );
}

export function PlacesField({ value, onChange, scope = "any", names, max = 60 }: {
  value: string[]; onChange: (v: string[]) => void; scope?: PlaceScope; names?: Record<string, string | null>; max?: number;
}) {
  return (
    <div className="col" style={{ gap: 6 }}>
      {value.length > 0 && (
        <div className="row wrap" style={{ gap: 6 }}>{value.map(c => (
          <span key={c} className="chip"><PlaceName code={c} names={names} /> <span className="mono muted" style={{ fontSize: 10 }}>{c}</span>
            <button type="button" aria-label={`Remove ${c}`} onClick={() => onChange(value.filter(x => x !== c))}>×</button></span>))}
        </div>
      )}
      {value.length < max && <PlacePicker scope={scope} exclude={value} onPick={p => onChange([...value, p.code])} />}
    </div>
  );
}

export function PlaceField({ value, onChange, scope = "any", names }: { value: string | null; onChange: (v: string | null) => void; scope?: PlaceScope; names?: Record<string, string | null> }) {
  if (value) return (
    <div className="row" style={{ gap: 8 }}>
      <span className="chip sel"><PlaceName code={value} names={names} /> <span className="mono" style={{ fontSize: 10 }}>{value}</span></span>
      <button className="btn btn--sm btn--ghost" type="button" onClick={() => onChange(null)}>Change</button>
    </div>
  );
  return <PlacePicker scope={scope} onPick={p => onChange(p.code)} placeholder={scope === "country" ? "Search a country…" : undefined} />;
}

export function CountrySelect({ value, onChange, allowEmpty = false, home = false }: { value: string | null; onChange: (v: string | null) => void; allowEmpty?: boolean; home?: boolean }) {
  const fieldLabel = useFieldLabel();
  const all = useLoad(() => (home ? Promise.resolve(null) : ref.countries()));
  const homes = useLoad(() => (home ? ref.homeCountries() : Promise.resolve(null)));
  const countries: { code: string; name: string | null }[] | null = home ? homes?.items ?? null : all;
  return (
    <>
      <select className="input" aria-labelledby={fieldLabel} value={value ?? ""} onChange={e => onChange(e.target.value || null)}>
        {(allowEmpty || !value) && <option value="">{allowEmpty ? "— none (global) —" : "Choose a country…"}</option>}
        {(countries ?? (value ? [{ code: value, name: value }] : [])).map(c => <option key={c.code} value={c.code}>{c.name} ({c.code})</option>)}
      </select>
      {homes?.region && <span className="hint">The prototype covers {homes.region.label} only.</span>}
    </>
  );
}

// ---------------------------------------------------------------- currencies, time zones

export function CurrencySelect({ value, onChange, allowEmpty = false, home = false }: { value: string | null; onChange: (v: string | null) => void; allowEmpty?: boolean; home?: boolean }) {
  const fieldLabel = useFieldLabel();
  const all = useLoad(() => (home ? Promise.resolve(null) : ref.currencies()));
  const homes = useLoad(() => (home ? ref.homeCurrencies() : Promise.resolve(null)));
  const cur = home ? homes?.items ?? null : all;
  return (
    <>
      <select className="input" aria-labelledby={fieldLabel} value={value ?? ""} onChange={e => onChange(e.target.value || null)}>
        {(allowEmpty || !value) && <option value="">{allowEmpty ? "—" : "Choose…"}</option>}
        {(cur ?? (value ? [{ code: value, name: "" }] : [])).map(c => <option key={c.code} value={c.code}>{c.code} · {c.name}</option>)}
      </select>
      {homes?.region && <span className="hint">Currencies of {homes.region.label} only.</span>}
    </>
  );
}

export function CurrenciesField({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const cur = useLoad(() => ref.currencies());
  return (
    <div className="row wrap" style={{ gap: 6 }}>
      {value.map(c => <span key={c} className="chip">{c}<button type="button" onClick={() => onChange(value.filter(x => x !== c))}>×</button></span>)}
      <select className="input" aria-label="Add a currency" style={{ width: 160 }} value="" onChange={e => e.target.value && onChange([...value, e.target.value])}>
        <option value="">+ currency</option>
        {(cur ?? []).filter(c => !value.includes(c.code)).map(c => <option key={c.code} value={c.code}>{c.code} · {c.name}</option>)}
      </select>
    </div>
  );
}

export function TimeZoneInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const tz = useLoad(() => ref.timeZones());
  return (
    <>
      <input className="input" list="amiri-tz" value={value} placeholder="e.g. Asia/Colombo" onChange={e => onChange(e.target.value)} />
      <datalist id="amiri-tz">{(tz ?? []).map(z => <option key={z} value={z} />)}</datalist>
    </>
  );
}

// ---------------------------------------------------------------- lists of values

export function ChipsInput({ value, onChange, placeholder = "Type and press Enter", max = 12 }: { value: string[]; onChange: (v: string[]) => void; placeholder?: string; max?: number }) {
  const [t, setT] = useState("");
  const add = () => { const v = t.trim(); if (v && !value.includes(v) && value.length < max) onChange([...value, v]); setT(""); };
  return (
    <div className="col" style={{ gap: 6 }}>
      {value.length > 0 && <div className="row wrap" style={{ gap: 6 }}>{value.map(v => (
        <span key={v} className="chip">{v}<button type="button" onClick={() => onChange(value.filter(x => x !== v))}>×</button></span>))}</div>}
      <input className="input" value={t} placeholder={placeholder} onChange={e => setT(e.target.value)}
        onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); add(); } }} onBlur={add} />
    </div>
  );
}

export function Toggles<T extends string | number>({ options, value, onChange }: { options: [T, string][]; value: T[]; onChange: (v: T[]) => void }) {
  return (
    <div className="row wrap" style={{ gap: 6 }}>
      {options.map(([v, label]) => {
        const on = value.includes(v);
        return <button key={String(v)} type="button" className={`chip click ${on ? "sel" : ""}`} aria-pressed={on}
          onClick={() => onChange(on ? value.filter(x => x !== v) : [...value, v])}>{on && <Icon name="check" />}{label}</button>;
      })}
    </div>
  );
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const monthsText = (m: number[]) => (!m.length ? "any time" : m.map(x => MONTHS[x - 1]).join(", "));
export function MonthStrip({ value, onChange }: { value: number[]; onChange: (v: number[]) => void }) {
  return (
    <div className="col" style={{ gap: 6 }}>
      <Toggles options={MONTHS.map((m, i) => [i + 1, m] as [number, string])} value={value} onChange={v => onChange([...v].sort((a, b) => a - b))} />
      <span className="hint">{value.length ? monthsText(value) : "None ticked: any time of year."}</span>
    </div>
  );
}

/** Links to other items of the profile (e.g. a product's customer groups). */
export function RefsField({ items, labelKey, value, onChange, empty }: { items: Item[]; labelKey: string; value: string[]; onChange: (v: string[]) => void; empty?: string }) {
  if (!items.length) return <span className="small muted">{empty ?? "Nothing to link yet."}</span>;
  return <Toggles options={items.map(i => [i.id, String(i[labelKey] ?? i.id)] as [string, string])} value={value} onChange={onChange} />;
}

// ---------------------------------------------------------------- Metrics Spec values

const DIM_WORDS: Record<string, string> = {
  segment: "Customer type", size_band: "Business size", age_band: "Age band", sector: "Economic sector (ISIC section)",
  sector_l2: "Economic sector (ISIC division)", employer_sector: "Employer's sector", region_l1: "Region",
  region_l2: "District", channel: "Channel", sales_channel: "Sales channel", corridor: "Remittance corridor", currency: "Currency",
};
export const dimWord = (d: string) => DIM_WORDS[d] ?? d;
const VALUE_WORDS: Record<string, string> = {
  remittance_linked: "receives remittances", other_individual: "other individuals", domestic_business: "domestic business",
  non_bank_financial: "non-bank financial", sme: "SME",
};
export const valueWord = (v: string) => VALUE_WORDS[v] ?? v.replace(/_/g, " ");

export function SpecField({ value, onChange }: { value: { dimension: string; value: string }[]; onChange: (v: { dimension: string; value: string }[]) => void }) {
  const dims = useLoad(() => ref.dimensions());
  const set = (i: number, patch: Partial<{ dimension: string; value: string }>) => onChange(value.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const dimOf = (k: string): Dimension | undefined => dims?.find(d => d.dimension === k);
  return (
    <div className="col" style={{ gap: 6 }}>
      {value.map((m, i) => {
        const d = dimOf(m.dimension);
        return (
          <div key={i} className="row" style={{ gap: 6 }}>
            <select className="input" style={{ width: 230 }} value={m.dimension} onChange={e => set(i, { dimension: e.target.value, value: "" })}>
              {(dims ?? []).map(x => <option key={x.dimension} value={x.dimension}>{dimWord(x.dimension)}</option>)}
            </select>
            {d?.values ? (
              <select className="input" value={m.value} onChange={e => set(i, { value: e.target.value })}>
                <option value="">Choose…</option>{d.values.map(v => <option key={v} value={v}>{valueWord(v)}</option>)}
              </select>
            ) : <input className="input" value={m.value} placeholder={d?.format ?? "value"} onChange={e => set(i, { value: e.target.value })} />}
            <button className="btn btn--ghost btn--icon" type="button" aria-label="Remove" onClick={() => onChange(value.filter((_, j) => j !== i))}><Icon name="x" /></button>
          </div>
        );
      })}
      {value.length < 6 && <button className="btn btn--sm" type="button" style={{ alignSelf: "flex-start" }}
        onClick={() => onChange([...value, { dimension: "segment", value: "" }])}><Icon name="plus" />Add a data value</button>}
    </div>
  );
}

// ---------------------------------------------------------------- money

export function MoneyField({ value, onChange }: { value: { amount: number; currency: string; as_of?: string | null } | null; onChange: (v: { amount: number; currency: string; as_of?: string | null } | null) => void }) {
  const v = value ?? { amount: 0, currency: "", as_of: null };
  return (
    <div className="row" style={{ gap: 6 }}>
      <input className="input" type="number" min={0} step="any" style={{ width: 170 }} value={value ? v.amount : ""} placeholder="amount"
        onChange={e => e.target.value === "" ? onChange(null) : onChange({ ...v, amount: Number(e.target.value) })} />
      <div style={{ width: 150 }}><CurrencySelect value={v.currency || null} onChange={c => onChange(c ? { ...v, currency: c } : null)} /></div>
      <input className="input" type="date" style={{ width: 160 }} value={v.as_of ?? ""} onChange={e => value && onChange({ ...v, as_of: e.target.value || null })} title="As of" />
    </div>
  );
}

export const usdText = (x: number) => (x >= 1e9 ? `USD ${(x / 1e9).toFixed(1)}bn` : x >= 1e6 ? `USD ${Math.round(x / 1e6)}m` : `USD ${Math.round(x).toLocaleString()}`);

/** A flow's figure, entered in millions a year. */
export function FlowValueField({ value, onChange }: { value: { amount: number; currency: string; year: number } | null; onChange: (v: { amount: number; currency: string; year: number } | null) => void }) {
  const year = value?.year ?? new Date().getFullYear() - 1;
  return (
    <div className="row" style={{ gap: 6, alignItems: "center" }}>
      <input className="input" type="number" min={0} step="any" style={{ width: 150 }} value={value ? +(value.amount / 1e6).toFixed(3) : ""} placeholder="USD million"
        onChange={e => e.target.value === "" ? onChange(null) : onChange({ amount: Math.round(Number(e.target.value) * 1e6), currency: "USD", year })} />
      <span className="small muted">USD million a year, in</span>
      <input className="input" type="number" min={1990} max={2100} style={{ width: 100 }} value={year}
        onChange={e => value && onChange({ ...value, year: Number(e.target.value) })} />
      {value && <span className="small muted">= {usdText(value.amount)}</span>}
    </div>
  );
}

/** Small key-value list (a product's type-specific details). */
export function KVField({ value, onChange }: { value: Record<string, string | number | boolean>; onChange: (v: Record<string, string | number | boolean>) => void }) {
  const entries = Object.entries(value);
  const [k, setK] = useState("");
  const [v, setV] = useState("");
  const add = () => { if (!k.trim()) return; const n = Number(v); onChange({ ...value, [k.trim()]: v !== "" && !isNaN(n) ? n : v }); setK(""); setV(""); };
  return (
    <div className="col" style={{ gap: 6 }}>
      {entries.map(([a, b]) => (
        <div key={a} className="row small" style={{ gap: 8 }}><span className="mono">{a}</span><span className="muted">=</span><span>{String(b)}</span>
          <button className="btn btn--ghost btn--icon" type="button" onClick={() => { const n = { ...value }; delete n[a]; onChange(n); }}><Icon name="x" /></button></div>))}
      <div className="row" style={{ gap: 6 }}>
        <input className="input" style={{ width: 170 }} value={k} placeholder="detail, e.g. tenor_months" onChange={e => setK(e.target.value)} />
        <input className="input" value={v} placeholder="value" onChange={e => setV(e.target.value)} onKeyDown={e => e.key === "Enter" && (e.preventDefault(), add())} />
        <button className="btn btn--sm" type="button" onClick={add}>Add</button>
      </div>
    </div>
  );
}

export function useRoutes() {
  const routes = useLoad(() => ref.routes());
  return useMemo(() => routes ?? [], [routes]);
}
