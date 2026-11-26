// The monitor form (a new monitor, a draft, or the next version of a live one). Every field has a visible label; an error is
// tied to its field with aria-describedby, and the first field with a problem takes focus after a failed save. Saving, the
// edit conflict and the calls are the pane's (MonitorPage.tsx); this draws and collects. Under the demo lock the fields are
// read-only and the save buttons are locked, with the reason.
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import type { ChipType, KeyDate, Monitor, MonitorSpec, MonitorsStatus } from "../../api/monitors";
import { EVERY } from "../../api/monitors";
import type { PlaceInfo, Profile } from "../../api/institutions";
import { ref } from "../../api/reference";
import { monitorsOf, parseJson } from "../../components/fillJson";
import { FLOW_WORDS } from "../../components/setupFlow";
import { useDemoLock } from "../../components/lock";
import { Button } from "../../components/v2/Button";
import { Checkbox } from "../../components/v2/Choice";
import { Field, FieldReset, Input, Select, Textarea } from "../../components/v2/Field";
import { FileDrop } from "../../components/v2/FilePicker";
import { placeName } from "../../format";
import { checkSpec, linesOf, type FormErrors } from "./words";

export const CHIP_TYPES: ChipType[] = ["organisation", "place", "region", "person", "sector", "regulation", "topic"];
export const OWNERS = ["Risk management", "Treasury", "Retail banking", "Retail credit", "Business credit", "Pawning", "Cards", "Underwriting", "Claims",
  "Commercial banking", "Energy lending"];

export function blank(): MonitorSpec {
  return {
    about: { name: "", owner: "Risk management", check_frequency: 60, kind: "events", key_dates: [], also_notify: [], review_by: null },
    public: { watch: [], in_one_sentence: "", tell_me_if: [], ignore: [], places: [], languages: ["en"],
      example_headlines: { match: [], not_match: [] }, sources: { mode: "any_reputable", check_first: [] } },
    private: { exposure: [], serious: [], notes: "" },
    alert_level: 6,
  };
}

/** What the profile offers as exposure: id → label, grouped. */
export function exposureOptions(p: Profile | null): [string, [string, string][]][] {
  if (!p) return [];
  const S = p.sections;
  const name = (c: string) => p.place_names[c] ?? p.places?.[c]?.name ?? placeName(c);
  return ([
    ["Customer groups", S.segments.map(x => [`segment:${x.id}`, x.label])],
    ["Products", S.products.filter(x => x.status !== "closed").map(x => [`product:${x.id}`, x.name])],
    ["Flows", S.flows.map(x => [`flow:${x.id}`, `${FLOW_WORDS[x.kind] ?? x.kind}: ${name(x.counterpart)}${x.local !== p.institution.home_country ? ` → ${name(x.local)}` : ""}`])],
    ["Known risks", S["risk-exposures"].filter(x => x.status === "active").map(x => [`risk:${x.id}`, x.title])],
    ["Rivals", S.rivals.map(x => [`rival:${x.id}`, x.name])],
    ["Regulators", S.regulators.map(x => [`regulator:${x.id}`, x.short || x.name])],
    ["Counterparties", S.counterparties.map(x => [`counterparty:${x.id}`, x.name])],
  ] as [string, [string, string][]][]).filter(([, xs]) => xs.length);
}

/** The server's field errors (a 422 with `errors`) as {"about.name": "…"}, and what has no field. */
export function errorsOf(e: unknown): FormErrors | null {
  const p = (typeof e === "object" && e !== null ? (e as { problem?: { errors?: { field: string; message: string }[] } }).problem : null) ?? null;
  if (!p?.errors?.length) return null;
  const fields: Record<string, string> = {}, general: string[] = [];
  for (const x of p.errors) {
    const k = x.field.replace(/^spec\./, "");
    const msg = x.message.replace(/^Value error, /, "");
    if (/^(about|public|private)\.[a-z_]+/.test(k)) { const key = k.split(".").slice(0, 2).join("."); fields[key] = fields[key] ? `${fields[key]}; ${msg}` : msg; }
    else general.push(msg);
  }
  return { fields, general };
}

// ---------------------------------------------------------------- fields
/** A group of controls under one name (chips, key dates, checkboxes): a named group with the error and hint tied to it. */
function Group({ label, hint, error, optional, req, children }: { label: string; hint?: ReactNode; error?: string; optional?: boolean; req?: boolean; children: ReactNode }) {
  return <Field group label={label} hint={hint} error={error} optional={optional} req={req}><FieldReset>{children}</FieldReset></Field>;
}

function WatchField({ value, onChange, invalid, describedBy }: { value: MonitorSpec["public"]["watch"]; onChange: (v: MonitorSpec["public"]["watch"]) => void; invalid: boolean; describedBy?: string }) {
  const [name, setName] = useState("");
  const [type, setType] = useState<ChipType>("organisation");
  const [forms, setForms] = useState("");
  const add = () => {
    if (!name.trim()) return;
    onChange([...value, { name: name.trim(), type, other_forms: forms.split(",").map(x => x.trim()).filter(Boolean), not_confused_with: [] }]);
    setName(""); setForms("");
  };
  const enter = (e: React.KeyboardEvent) => { if (e.key === "Enter") { e.preventDefault(); add(); } };
  return (
    <div className="v2-mn-watch">
      {value.length > 0 && (
        <ul className="v2-mn-chips" aria-label="Names to watch">
          {value.map((w, i) => (
            <li key={`${w.name}-${i}`} className="v2-mn-chip">
              <span><b>{w.name}</b> <span className="v2-mn-chip__t">· {w.type}{w.other_forms?.length ? `, also ${w.other_forms.join(", ")}` : ""}</span></span>
              <button type="button" className="v2-mn-x" aria-label={`Remove ${w.name}`} onClick={() => onChange(value.filter((_, j) => j !== i))}>×</button>
            </li>))}
        </ul>)}
      {value.length < 12 && (
        <div className="v2-mn-watch__add" role="group" aria-label="Add a name to watch" aria-describedby={describedBy} data-invalid={invalid || undefined}>
          <Field label="A name"><Input placeholder="A country, a rival, a group of customers…" value={name} onChange={e => setName(e.target.value)} onKeyDown={enter} /></Field>
          <Field label="What kind"><Select value={type} onChange={e => setType(e.target.value as ChipType)}>{CHIP_TYPES.map(t => <option key={t} value={t}>{t}</option>)}</Select></Field>
          <Field label="Also known as"><Input placeholder="Short forms, other spellings, with commas" value={forms} onChange={e => setForms(e.target.value)} onKeyDown={enter} /></Field>
          <Button onClick={add} disabled={!name.trim()}>Add</Button>
        </div>)}
    </div>
  );
}

/** A list of short words (outlets): type one and press Enter. */
function TagsField({ value, onChange, max, placeholder, noun }: { value: string[]; onChange: (v: string[]) => void; max: number; placeholder: string; noun: string }) {
  const [q, setQ] = useState("");
  const add = () => { const v = q.trim(); if (v && !value.includes(v) && value.length < max) onChange([...value, v]); setQ(""); };
  return (
    <div className="v2-mn-taginput">
      {value.length > 0 && <ul className="v2-mn-chips" aria-label={noun}>{value.map(t => (
        <li key={t} className="v2-mn-chip"><span>{t}</span><button type="button" className="v2-mn-x" aria-label={`Remove ${t}`} onClick={() => onChange(value.filter(x => x !== t))}>×</button></li>))}</ul>}
      {value.length < max && <Input placeholder={placeholder} value={q} onChange={e => setQ(e.target.value)}
        onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); add(); } }} onBlur={add} />}
    </div>
  );
}

/** Places: search the gazetteer, pick one, it becomes a chip. */
function PlacesField({ value, onChange, profile, max = 20 }: { value: string[]; onChange: (v: string[]) => void; profile: Profile | null; max?: number }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<PlaceInfo[]>([]);
  const [picked, setPicked] = useState<Record<string, string>>({});
  const seq = useRef(0);
  const list = useId();
  const nameOf = (c: string) => picked[c] ?? profile?.place_names[c] ?? profile?.places?.[c]?.name ?? placeName(c);
  const taken = value.join(",");
  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) { setHits(h => (h.length ? [] : h)); return; }
    const n = ++seq.current;
    const t = setTimeout(() => {
      ref.searchPlaces(term).then(items => { if (n === seq.current) setHits(items.filter(p => !taken.split(",").includes(p.code))); }).catch(() => {});
    }, 200);
    return () => clearTimeout(t);
  }, [q, taken]);
  return (
    <div className="v2-mn-places">
      {value.length > 0 && <ul className="v2-mn-chips" aria-label="Places">{value.map(c => (
        <li key={c} className="v2-mn-chip"><span>{nameOf(c)}</span><button type="button" className="v2-mn-x" aria-label={`Remove ${nameOf(c)}`} onClick={() => onChange(value.filter(x => x !== c))}>×</button></li>))}</ul>}
      {value.length < max && <>
        <Input placeholder="Search a country, region, city, port or strait…" value={q} autoComplete="off" aria-controls={hits.length ? list : undefined} onChange={e => setQ(e.target.value)} />
        {hits.length > 0 && (
          <ul id={list} className="v2-mn-hits" aria-label="Places that match">{hits.map(p => (
            <li key={p.code}>
              <button type="button" onClick={() => { setPicked(x => ({ ...x, [p.code]: p.name ?? p.code })); onChange([...value, p.code]); setQ(""); setHits([]); }}>
                <b>{p.name ?? p.code}</b><span className="v2-mn-hits__m">{p.kind}{p.parent ? ` · in ${p.parent}` : ""}</span>
              </button>
            </li>))}</ul>)}
      </>}
    </div>
  );
}

function KeyDates({ value, onChange }: { value: KeyDate[]; onChange: (v: KeyDate[]) => void }) {
  const set = (i: number, k: string, v: unknown) => onChange(value.map((d, j) => (j === i ? { ...d, [k]: v } : d)));
  return (
    <div className="v2-mn-dates">
      {value.map((d, i) => (
        <div key={i} className="v2-mn-date" role="group" aria-label={`Key date ${i + 1}`}>
          <Field label="Date"><Input type="date" value={d.date} onChange={e => set(i, "date", e.target.value)} /></Field>
          <Field label="What happens" className="v2-mn-field--grow"><Input placeholder="New labour rules take effect" value={d.label} onChange={e => set(i, "label", e.target.value)} /></Field>
          <Field label="Start watching">
            <Select value={d.lead_days} onChange={e => set(i, "lead_days", Number(e.target.value))}>
              {[1, 3, 7].map(n => <option key={n} value={n}>{n} day{n > 1 ? "s" : ""} before</option>)}</Select></Field>
          <Button variant="quiet" onClick={() => onChange(value.filter((_, j) => j !== i))}>Remove<span className="v2-sr"> key date {i + 1}</span></Button>
        </div>))}
      {value.length < 10 && <div><Button variant="quiet" onClick={() => onChange([...value, { date: "", label: "", lead_days: 3 }])}>+ Add a key date</Button></div>}
    </div>
  );
}

/** "Fill from a JSON file": loads a file into the form's own fields to check and edit. Nothing is saved by this. */
function JsonFill({ onFill }: { onFill: (spec: Record<string, any>) => void }) {
  const id = useId();
  const [msg, setMsg] = useState<string | null>(null);
  const [file, setFile] = useState<string | null>(null);
  const load = async (f: File) => {
    const p = parseJson(await f.text());
    if (!p.ok) { setFile(null); setMsg(p.error); return; }
    const found = monitorsOf(p.doc);
    if (!found.length) { setFile(null); setMsg(`Nothing in ${f.name} to fill a monitor with. Expected a monitor spec as JSON ({"about": …, "public": …, "private": …}), or {"spec": …}.`); return; }
    onFill(found[0].data); setFile(f.name); setMsg(null);
  };
  return (
    <div className="v2-mn-json">
      <FileDrop accept="application/json,.json" noun="a JSON file" pickLabel="Fill from a JSON file" aria-describedby={`${id}-m`} onFile={load} onReject={setMsg} />
      <span id={`${id}-m`} role="status" className={msg ? "v2-mn-err" : "v2-meta"}>{msg ?? (file ? `Filled from ${file}: check it, then save.` : "")}</span>
    </div>
  );
}

// ---------------------------------------------------------------- the form
export interface FormProps {
  /** null: a new monitor. */
  m: Monitor | null;
  profile: Profile | null;
  status: MonitorsStatus | null;
  /** Save (and submit): the pane makes the calls. `false` leaves the form open with the person's text kept. Field errors come back as `FormErrors`. */
  onSave: (spec: MonitorSpec, note: string, submit: boolean, opened: { latest_version: number; updated_at: string } | null) => Promise<FormErrors | null>;
  onCancel?: () => void;
  /** Said under the buttons while a save is on. */
  busy: boolean;
}
export function MonitorForm({ m, profile, status, onSave, onCancel, busy }: FormProps) {
  const locked = useDemoLock();
  const [s, setS] = useState<MonitorSpec>(() => structuredClone(m?.spec ?? blank()));
  const [tell, setTell] = useState(() => (m?.spec.public.tell_me_if ?? []).join("\n"));
  const [ignore, setIgnore] = useState(() => (m?.spec.public.ignore ?? []).join("\n"));
  const [serious, setSerious] = useState(() => (m?.spec.private.serious ?? []).join("\n"));
  const [note, setNote] = useState("");
  const [err, setErr] = useState<FormErrors>({ fields: {}, general: [] });
  const [moreOpen, setMoreOpen] = useState(false);
  const opened = useRef(m ? { latest_version: m.latest_version, updated_at: m.updated_at } : null);   // what the form was opened on (the edit conflict check)
  const root = useRef<HTMLFormElement>(null);
  const drafted = new Set(m?.drafted_fields ?? []);
  const up = (f: (x: MonitorSpec) => void) => setS(x => { const y = structuredClone(x); f(y); return y; });
  const opts = useMemo(() => exposureOptions(profile), [profile]);
  const chosen = new Set(s.private.exposure.map(e => e.id));
  const live = !!m && (m.status === "live" || m.status === "paused");
  const min = status?.min_frequency_minutes ?? 60;
  const E = err.fields;
  const ids = { place: useId(), outlets: useId(), alert: useId(), review: useId(), serious: useId(), expo: useId() };

  // after a failed save the first field with a problem takes focus (and its "More options" opens first when it is in there)
  const [focusErr, setFocusErr] = useState(0);
  useEffect(() => {
    if (!focusErr) return;
    root.current?.querySelector<HTMLElement>('[aria-invalid="true"], [data-invalid="true"] input')?.focus();
  }, [focusErr]);

  const fillFrom = (spec: Record<string, any>) => {
    const b = blank();
    const x: MonitorSpec = {
      ...b, ...spec,
      about: { ...b.about, ...(spec.about ?? {}) },
      public: { ...b.public, ...(spec.public ?? {}), example_headlines: { ...b.public.example_headlines, ...(spec.public?.example_headlines ?? {}) },
        sources: { ...b.public.sources, ...(spec.public?.sources ?? {}) } },
      private: { ...b.private, ...(spec.private ?? {}) },
    };
    setS(x); setTell((x.public.tell_me_if ?? []).join("\n")); setIgnore((x.public.ignore ?? []).join("\n"));
    setSerious((x.private.serious ?? []).join("\n")); setErr({ fields: {}, general: [] });
  };

  const specNow = (): MonitorSpec => {
    const spec: MonitorSpec = structuredClone(s);
    spec.public.tell_me_if = linesOf(tell); spec.public.ignore = linesOf(ignore); spec.private.serious = linesOf(serious);
    spec.about.key_dates = (spec.about.key_dates ?? []).filter(d => d.date || d.label);
    return spec;
  };
  const save = async (submit: boolean) => {
    const spec = specNow();
    const mine = checkSpec(spec);
    if (Object.keys(mine.fields).length) { setErr(mine); setFocusErr(n => n + 1); return; }
    const back = await onSave(spec, note, submit, opened.current);
    if (back) {
      setErr(back);
      if (["about.key_dates", "private.exposure", "public.sources", "private.serious"].some(k => back.fields[k])) setMoreOpen(true);
      setFocusErr(n => n + 1);
    } else setErr({ fields: {}, general: [] });
  };
  const nextVersion = m && m.latest_version === m.live_version ? m.latest_version + 1 : m?.latest_version;
  const nProblems = Object.keys(E).length;

  return (
    <form ref={root} className="v2-mn-form" onSubmit={e => e.preventDefault()} noValidate>
      {(nProblems > 0 || err.general.length > 0) && (
        <p className="v2-mn-alert" role="alert"><span aria-hidden="true">▲ </span>{err.general.length ? err.general.join(" ") : `${nProblems === 1 ? "One field needs" : `${nProblems} fields need`} attention: see below.`}</p>)}
      <fieldset className="v2-mn-fields" disabled={locked}>
        <Field req label="Name" error={E["about.name"]} hint={drafted.has("about.name") ? "Filled in from your profile. Check and edit it." : undefined}>
          <Input value={s.about.name} maxLength={80} placeholder="e.g. Jobs at our borrowers' main employers" onChange={e => up(x => { x.about.name = e.target.value; })} />
        </Field>
        <Field req label="In one sentence, what should AMIRI Agent watch for?" error={E["public.in_one_sentence"]}
          hint={drafted.has("public.in_one_sentence") ? "Filled in from your profile. Check and edit it. Specific beats broad: name the places, people or markets." : "Specific beats broad: name the places, people or markets."}>
          <Textarea rows={3} maxLength={300} value={s.public.in_one_sentence} placeholder="Events that could cut jobs or pay for the customers of one of our products."
            onChange={e => up(x => { x.public.in_one_sentence = e.target.value; })} />
        </Field>
        <Group req label="Watch" error={E["public.watch"]} hint={`The names the news would use. Other forms catch abbreviations and local spellings.${drafted.has("public.watch") ? " Filled in from your profile: check them." : ""}`}>
          <WatchField value={s.public.watch} onChange={v => up(x => { x.public.watch = v; })} invalid={!!E["public.watch"]} />
        </Group>
        <Field req label="Tell me if… (one condition per line)" error={E["public.tell_me_if"]}
          hint={`A finding names the lines it meets.${drafted.has("public.tell_me_if") ? " Filled in from your profile: check them." : ""}`}>
          <Textarea rows={4} value={tell} placeholder="A large employer where we lend announces job cuts or a plant closure" onChange={e => setTell(e.target.value)} />
        </Field>
        <Field label="Ignore" optional error={E["public.ignore"]} hint="One per line.">
          <Textarea rows={2} value={ignore} placeholder="Routine labour statistics with no change" onChange={e => setIgnore(e.target.value)} />
        </Field>
        <Field group label="Where it matters" optional error={E["public.places"]} hint="Countries, regions or places. A finding is tagged with the ones it is about.">
          <PlacesField value={s.public.places} profile={profile} onChange={v => up(x => { x.public.places = v; })} />
        </Field>
        <p className="v2-mn-fixed"><b>Reads news in</b> English <span className="v2-meta">· the prototype reads English-language news only; more languages later.</span></p>
        <div className="v2-mn-row3">
          <Field label="Check every" error={E["about.check_frequency"]}>
            <Select value={s.about.check_frequency} onChange={e => up(x => { x.about.check_frequency = Number(e.target.value) as 60; })}>
              {[15, 60, 360, 1440].map(f => <option key={f} value={f} disabled={f < min}>{EVERY[f]}{f < min ? " (not in the prototype)" : ""}</option>)}</Select>
          </Field>
          <Field label="Sources">
            <Select value={s.public.sources?.mode ?? "any_reputable"}
              onChange={e => up(x => { x.public.sources = { check_first: x.public.sources?.check_first ?? [], mode: e.target.value as "any_reputable" }; })}>
              <option value="any_reputable">Any reputable outlet</option><option value="trusted_only">Trusted outlets only</option></Select>
          </Field>
          <Field label="Owner" error={E["about.owner"]}>
            <Select value={s.about.owner} onChange={e => up(x => { x.about.owner = e.target.value; })}>{[...new Set([s.about.owner, ...OWNERS])].map(o => <option key={o}>{o}</option>)}</Select>
          </Field>
        </div>

        <div className="v2-mn-opts">
          <button type="button" className="v2-mn-opts__b" aria-expanded={moreOpen} aria-controls={`${ids.expo}-body`} onClick={() => setMoreOpen(o => !o)}>
            <span aria-hidden="true">{moreOpen ? "▾" : "▸"}</span> More options <span className="v2-meta">· outlets, key dates, who it could reach, how serious, review date</span>
          </button>
          <div id={`${ids.expo}-body`} className="v2-mn-opts__body" hidden={!moreOpen}>
            <Field group label="Outlets to check first" optional hint="Domains, e.g. arabnews.com. With Trusted outlets only, findings must come from these.">
              <TagsField noun="Outlets" value={s.public.sources?.check_first ?? []} max={10} placeholder="arabnews.com, then Enter"
                onChange={v => up(x => { x.public.sources = { mode: x.public.sources?.mode ?? "any_reputable", check_first: v }; })} />
            </Field>
            <Group label="Key dates" optional error={E["about.key_dates"]} hint="A finding about one of these dates is dated by it, so the investigation times its effects from then.">
              <KeyDates value={s.about.key_dates ?? []} onChange={v => up(x => { x.about.key_dates = v; })} />
            </Group>
            <Group label="Which customers or products could this reach?" optional error={E["private.exposure"]}
              hint="Private: the monitor agent reads it to judge relevance; it never goes into a search. The investigation still checks every product an event could reach.">
              {opts.length === 0 ? <p className="v2-meta">No profile loaded.</p> : opts.map(([g, xs]) => (
                <div key={g} className="v2-mn-expo"><span className="v2-cap">{g}</span>
                  <div className="v2-mn-expo__o">{xs.map(([id, label]) => (
                    <Checkbox key={id} label={label} checked={chosen.has(id)}
                      onChange={() => up(x => { x.private.exposure = chosen.has(id) ? x.private.exposure.filter(e => e.id !== id) : [...x.private.exposure, { id, how_it_reaches_us: "" }]; })} />))}</div></div>))}
            </Group>
            <Field optional label="What counts as serious" hint="One per line. Private, like the exposure." error={E["private.serious"]}>
              <Textarea rows={2} value={serious} placeholder="Any cut affecting more than 10,000 workers" onChange={e => setSerious(e.target.value)} />
            </Field>
            <Field label={`How serious before it reports: ${s.alert_level} of 10`} hint={`Sets the finding's score (${s.alert_level * 10}, +10 when two or more outlets report it).`}>
              <Input type="range" min={0} max={10} value={s.alert_level} aria-valuetext={`${s.alert_level} of 10`}
                onChange={e => up(x => { x.alert_level = Number(e.target.value); })} />
            </Field>
            <Field label="Review by" optional hint="The list marks the monitor when its review is due." className="v2-mn-field--date">
              <Input type="date" value={s.about.review_by ?? ""} onChange={e => up(x => { x.about.review_by = e.target.value || null; })} />
            </Field>
          </div>
        </div>
        {m && <Field label="What changed" optional>
          <Input value={note} maxLength={500} placeholder="Added Qatar" onChange={e => setNote(e.target.value)} />
        </Field>}
        {live && <p className="v2-mn-fine">Saving makes version {nextVersion} a draft; version {m!.live_version} keeps running until a Risk Manager approves the new one.</p>}
        <JsonFill onFill={fillFrom} />
      </fieldset>
      <div className="v2-mn-savebar">
        {onCancel && <Button variant="quiet" onClick={onCancel}>Cancel</Button>}
        <Button locked={locked} disabled={busy} onClick={() => save(false)}>{live ? "Save as the next version" : "Save draft"}</Button>
        <Button variant="primary" locked={locked} disabled={busy} busy={busy} busyLabel="Saving…" onClick={() => save(true)}>Save and submit for approval</Button>
      </div>
    </form>
  );
}
