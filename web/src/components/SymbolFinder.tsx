// "Add a series" search: one list from the data provider, grouped by kind (commodities, currencies, indices, funds,
// company shares, crypto). The server adds the commodities and currency pairs whose names match, so "gold" and "rupee"
// find the gold price and the rupee pairs. Chips and a country list narrow the list with no new search; a typed word
// that names a kind ("stock gold") switches its chip on. An exact code comes first; the institution's currency leads.
import { useEffect, useMemo, useRef, useState } from "react";
import { ApiError } from "../api/client";
import { overviewApi } from "../api/overview";
import { seriesApi, type LookupItem } from "../api/series";

type Kind = "Commodity" | "Currency" | "Index" | "Fund" | "Company shares" | "Crypto" | "Other";
const KINDS: Kind[] = ["Commodity", "Currency", "Index", "Fund", "Company shares", "Crypto", "Other"];
export const kindOf = (t: string | null): Kind => !t ? "Other" : /commodit/i.test(t) ? "Commodity" : /digital/i.test(t) ? "Crypto"
  : /currency|forex/i.test(t) ? "Currency" : /index/i.test(t) ? "Index" : /etf|fund|etc|trust/i.test(t) ? "Fund"
  : /stock|share|depositary|reit/i.test(t) ? "Company shares" : "Other";
const KIND_WORDS: [RegExp, Kind][] = [[/^(stocks?|shares?|company|companies|equity)$/i, "Company shares"], [/^(etfs?|funds?)$/i, "Fund"],
  [/^(index|indices)$/i, "Index"], [/^(currency|currencies|fx|forex)$/i, "Currency"], [/^(commodity|commodities)$/i, "Commodity"],
  [/^(crypto|cryptocurrency)$/i, "Crypto"]];

const CURRENCY: Record<string, string> = { USD: "US dollars", EUR: "euros", GBP: "pounds", JPY: "yen", CHF: "Swiss francs", AUD: "Australian dollars",
  CAD: "Canadian dollars", NZD: "NZ dollars", SGD: "Singapore dollars", HKD: "Hong Kong dollars", IDR: "rupiah", TRY: "lira", XAG: "silver", LKR: "rupees" };

// a country's currency, so a country filter keeps gold priced in it (XAU/AUD) and pairs that trade it (AUD/USD)
// ponytail: the countries Twelve Data lists most; one not here keeps no commodities or pairs
const COUNTRY_CCY: Record<string, string> = { "United States": "USD", Australia: "AUD", Canada: "CAD", "United Kingdom": "GBP",
  Japan: "JPY", Switzerland: "CHF", "New Zealand": "NZD", Singapore: "SGD", "Hong Kong": "HKD", India: "INR", Indonesia: "IDR",
  Turkey: "TRY", "Sri Lanka": "LKR", China: "CNY", "South Korea": "KRW", Israel: "ILS", "South Africa": "ZAR", Brazil: "BRL",
  Mexico: "MXN", Sweden: "SEK", Norway: "NOK", Denmark: "DKK", Poland: "PLN", "United Arab Emirates": "AED", "Saudi Arabia": "SAR",
  Malaysia: "MYR", Thailand: "THB", Philippines: "PHP", Pakistan: "PKR", Germany: "EUR", France: "EUR", Italy: "EUR",
  Spain: "EUR", Netherlands: "EUR", Belgium: "EUR", Ireland: "EUR", Austria: "EUR", Finland: "EUR", Portugal: "EUR", Greece: "EUR" };
const inCountry = (i: LookupItem, c: string) => !c || (i.country ? i.country === c : i.symbol.toUpperCase().split("/").includes(COUNTRY_CCY[c] ?? "-"));

export function SymbolFinder({ picked, onPick }: { picked: string; onPick: (i: LookupItem) => void }) {
  const [q, setQ] = useState("");
  const [home, setHome] = useState<string | null>(null);
  const [found, setFound] = useState<Record<string, LookupItem[]>>({});  // answers by term, so going back to one shows it
  const [kinds, setKinds] = useState<Kind[] | null>(null);  // null: as the typed words say
  const [country, setCountry] = useState("");
  const [searching, setSearching] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { overviewApi.get().then(o => setHome(o.institution?.base_currency ?? null)).catch(() => {}); }, []);

  // a word naming a kind switches its chip on; the other words are what to search for
  const words = q.trim().split(/\s+/).filter(Boolean);
  const typedKinds = words.map(w => KIND_WORDS.find(([re]) => re.test(w))?.[1]).filter(Boolean).slice(-1) as Kind[];  // one kind at a time: the last named
  const term = words.filter(w => !KIND_WORDS.some(([re]) => re.test(w))).join(" ");
  const results = found[term.toLowerCase()] ?? null;
  useEffect(() => { setKinds(null); setCountry(""); }, [term]);  // new words, fresh filters
  useEffect(() => { setKinds(null); }, [typedKinds[0]]);  // a kind word typed or removed sets the chip again
  const active = kinds ?? typedKinds;

  const last = useRef(0);  // only the newest search may show an error or end the wait; every answer is kept by its term
  const search = async (t: string) => {
    if (!t) return;  // Enter searches a one-letter ticker (F, T); typing waits for two letters
    const id = ++last.current;
    setSearching(true); setErr(null);
    try { const r = await seriesApi.lookup(t); setFound(f => ({ ...f, [t.toLowerCase()]: r.items })); }
    catch (e) { if (id === last.current) setErr(e instanceof ApiError ? e.full : String(e)); }
    finally { if (id === last.current) setSearching(false); }
  };
  // search once typing stops (each new search is 1 credit; the same search is free for a day)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);  // the pending search; Enter runs it now instead
  useEffect(() => {
    if (term.length < 2 || results) return;
    timer.current = setTimeout(() => search(term), 600);
    return () => clearTimeout(timer.current);
  }, [term]);  // eslint-disable-line react-hooks/exhaustive-deps
  const searchNow = () => { clearTimeout(timer.current); search(term); };

  // a share's listing country, and for a commodity or pair (no country) the countries of its currencies
  const countries = useMemo(() => [...new Set((results ?? []).flatMap(i => i.country ? [i.country]
    : Object.keys(COUNTRY_CCY).filter(c => i.symbol.toUpperCase().split("/").includes(COUNTRY_CCY[c]))))].sort(), [results]);
  const mine = (i: LookupItem) => !!home && i.symbol.toUpperCase().split("/").includes(home);
  const asCode = term.includes("/") || (term === term.toUpperCase() && /[A-Z]/.test(term));  // "gold" is a word, "GOLD" a code
  const exact = asCode ? (results ?? []).filter(i => i.symbol.toUpperCase() === term.toUpperCase()) : [];
  const rest = (results ?? []).filter(i => !exact.includes(i) && (!active.length || active.includes(kindOf(i.type))) && inCountry(i, country));
  // the institution's currency first, then US dollars (how most prices are quoted), then the rest; a spot price
  // (the standard one, per ounce) before other units of the same thing, like Gold Gram
  const rank = (i: LookupItem) => (mine(i) ? 0 : i.currency === "USD" ? 2 : 4) + (/spot/i.test(i.name ?? "") ? 0 : 1);
  const groups = KINDS.map(k => [k, rest.filter(i => kindOf(i.type) === k).sort((a, b) => rank(a) - rank(b))] as const).filter(([, l]) => l.length);
  const toggle = (k: Kind) => setKinds(active.includes(k) ? [] : [k]);  // one kind at a time; tapping it again shows all

  const row = (i: LookupItem) => <button key={`${i.symbol}-${i.exchange}-${i.name}`} type="button" className="sf-row" disabled={i.watched || i.on_plan === false}
    aria-pressed={picked === i.symbol} onClick={() => onPick(i)}
    title={i.on_plan === false ? `Needs the Twelve Data ${i.plan} plan; this key's plan doesn't include it` : undefined}>
    <span className="sf-n">{i.name ?? i.symbol}{mine(i) && <span className="sf-yours">your currency</span>}
      {i.watched ? <span className="badge b-ok">WATCHED</span> : i.on_plan === false ? <span className="badge b-warn">NEEDS {i.plan?.toUpperCase()} PLAN</span> : null}</span>
    <span className="sf-k">{kindOf(i.type) === "Commodity" && i.currency ? `priced in ${CURRENCY[i.currency] ?? i.currency}` : [i.exchange, i.country].filter(Boolean).join(", ")}</span><b className="mono sf-s">{i.symbol}</b></button>;

  return <div className="sf">
    <label className="field"><span>Find a market price</span>
      <span className="sf-box"><input className="input" value={q} onChange={e => setQ(e.target.value)} placeholder="e.g. gold, oil, rupee, or a code like XAU/USD"
        onKeyDown={e => e.key === "Enter" && searchNow()} />{searching && <span className="sf-ring" aria-hidden="true" />}</span></label>
    {/* while searching: grey chips and rows where the results will be, so the dialog doesn't jump when they come */}
    {searching && !results && <div className="sf-group" role="status" aria-label="Searching Twelve Data">
      <div className="sf-chips" aria-hidden="true">{[56, 104, 74].map(w => <span key={w} className="sf-sk" style={{ width: w, height: 26 }} />)}</div>
      {["42%", "55%", "36%"].map(w => <div key={w} className="sf-row sf-skrow" aria-hidden="true"><span className="sf-sk" style={{ width: w }} /><span className="sf-sk" style={{ width: 64 }} /></div>)}
    </div>}
    {!searching && !results && term.length >= 2 && !err && <span className="small muted sf-status">Searches when you stop typing. Each new search uses 1 Twelve Data credit.</span>}

    {results && (results.length ? <div className="sf-group">
      <div className="sf-chips" role="group" aria-label="Filter the matches">
        <button type="button" className="sf-chip" aria-pressed={!active.length} onClick={() => setKinds([])}>All <span>{results.length}</span></button>
        {KINDS.map(k => { const n = results.filter(i => kindOf(i.type) === k).length; return n ? <button key={k} type="button" className="sf-chip" aria-pressed={active.includes(k)} onClick={() => toggle(k)}>{k} <span>{n}</span></button> : null; })}
        {countries.length > 1 && <select className="input sf-country" value={country} onChange={e => setCountry(e.target.value)} aria-label="Country">
          <option value="">All countries</option>{countries.map(c => <option key={c}>{c}</option>)}</select>}
      </div>
      <div className="sf-list">
        {exact.length > 0 && <><div className="sf-h">Exact match</div>{exact.map(row)}</>}
        {groups.map(([k, l]) => <div key={k} className="sf-group"><div className="sf-h">{k}</div>{l.map(row)}</div>)}
        {!exact.length && !groups.length && <div className="note">None of the matches fits these filters.</div>}
      </div>
    </div> : <div className="note">Nothing found for “{term}”.</div>)}
    {err && <div className="rawerr">{err}</div>}
  </div>;
}
