// The monitor form. A new monitor asks four questions in the open; a draft or an edit opens as one line per question
// (its answer and Change), so you check rather than re-read. Beside it, the sentence the monitor will read as, and saving.
import { useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { ApiError } from "../../api/client";
import type { Profile } from "../../api/institutions";
import { EVERY, monitorsApi, type ChipType, type CheckRow, type Monitor, type MonitorSpec, type MonitorsStatus } from "../../api/monitors";
import { FillFromJson } from "../../components/FillFromJson";
import { monitorsOf } from "../../components/fillJson";
import { Icon } from "../../components/Icon";
import { useToast } from "../../components/ui";
import { cap, count, everyText, listText } from "../../plain";
import { ChipsInput, Field, PlacesField } from "../institution/fields";
import { CheckLine, exposureOptions, ReadsAs, unnamed } from "./monitorParts";

const CHIP_TYPES: ChipType[] = ["organisation", "place", "region", "person", "sector", "regulation", "topic"];
const OWNERS = ["Risk management", "Treasury", "Retail banking", "Retail credit", "Business credit", "Pawning", "Cards", "Underwriting", "Claims",
  "Commercial banking", "Energy lending"];

function blank(): MonitorSpec {
  return {
    about: { name: "", owner: "Risk management", check_frequency: 60, kind: "events", key_dates: [], also_notify: [], review_by: null },
    public: { watch: [], in_one_sentence: "", tell_me_if: [], ignore: [], places: [], languages: ["en"],
      example_headlines: { match: [], not_match: [] }, sources: { mode: "any_reputable", check_first: [] } },
    private: { exposure: [], serious: [], notes: "" },
    alert_level: 6,
  };
}
const lines = (s: string) => s.split("\n").map(x => x.trim()).filter(Boolean);

/** Which parts of the spec differ between the live version and this one. */
export function changed(a: MonitorSpec, b: MonitorSpec): string[] {
  const parts: [string, (s: MonitorSpec) => unknown][] = [
    ["name", s => s.about.name], ["sentence", s => s.public.in_one_sentence], ["names", s => s.public.watch],
    ["tell-me-if lines", s => s.public.tell_me_if], ["what it leaves out", s => s.public.ignore], ["places", s => s.public.places],
    ["languages", s => s.public.languages], ["how often", s => s.about.check_frequency], ["outlets", s => s.public.sources],
    ["key dates", s => s.about.key_dates], ["who it could reach", s => s.private.exposure], ["what counts as serious", s => s.private.serious],
    ["alert level", s => s.alert_level], ["owner", s => s.about.owner], ["review date", s => s.about.review_by],
  ];
  return parts.filter(([, f]) => JSON.stringify(f(a) ?? null) !== JSON.stringify(f(b) ?? null)).map(([n]) => n);
}

type Errs = { fields: Record<string, string>; general: string[] };
const NOERR: Errs = { fields: {}, general: [] };
function errorsOf(e: unknown): Errs {
  if (!(e instanceof ApiError)) return { fields: {}, general: [String(e)] };
  const fields: Record<string, string> = {};
  const general: string[] = [];
  for (const x of (e.problem.errors ?? []) as { field: string; message: string }[]) {
    const k = x.field.replace(/^spec\./, "");
    const msg = x.message.replace(/^Value error, /, "");
    if (/^(about|public|private)\.[a-z_]+/.test(k)) { const key = k.split(".").slice(0, 2).join("."); fields[key] = fields[key] ? `${fields[key]}; ${msg}` : msg; }
    else general.push(msg);
  }
  if (!e.problem.errors?.length) general.push(e.full);
  return { fields, general };
}
// the server's length rules (pydantic: "String should have at least 3 characters") in words, next to their field
const PLAIN_ERR: Record<string, string> = { "about.name": "Give it a name: 3 letters or more.", "public.in_one_sentence": "Say in a sentence what it watches for: 10 letters or more.",
  "public.watch": "Add at least one name the news would use.", "public.tell_me_if": "Add at least one line: when should it tell you?" };
const plainErr = (k: string, raw?: string) => (!raw ? undefined : /at least \d+ (character|item)/.test(raw) && PLAIN_ERR[k] ? PLAIN_ERR[k] : raw);

/** "The sentence, the names and the tell-me-if lines were filled in from your profile": said once, at the top. */
export function draftedLine(m: Monitor | null): string | null {
  const d = new Set(m?.drafted_fields ?? []);
  const parts = [["public.in_one_sentence", "the sentence"], ["public.watch", "the names"], ["public.tell_me_if", "the tell-me-if lines"]].filter(([k]) => d.has(k)).map(([, w]) => w);
  return parts.length ? `${cap(listText(parts))} ${parts.length === 1 ? "was" : "were"} filled in from your profile. Check ${parts.length === 1 ? "it" : "them"} before you send it.` : null;
}

function WatchField({ value, onChange }: { value: MonitorSpec["public"]["watch"]; onChange: (v: MonitorSpec["public"]["watch"]) => void }) {
  const [name, setName] = useState("");
  const [type, setType] = useState<ChipType>("organisation");
  const [forms, setForms] = useState("");
  const add = () => {
    if (!name.trim()) return;
    onChange([...value, { name: name.trim(), type, other_forms: forms.split(",").map(x => x.trim()).filter(Boolean), not_confused_with: [] }]);
    setName(""); setForms("");
  };
  const enter = (e: React.KeyboardEvent) => { if (e.key === "Enter") { e.preventDefault(); add(); } };
  return <div className="mp-col">
    {value.length > 0 && <div className="mp-chips">{value.map((w, i) => (
      <span key={i} className="chip" title={`${w.type}${w.other_forms?.length ? `; also ${w.other_forms.join(", ")}` : ""}`}>
        {w.name}{w.other_forms?.length ? <span className="muted"> +{w.other_forms.length}</span> : null}
        <button type="button" aria-label={`Remove ${w.name}`} onClick={() => onChange(value.filter((_, j) => j !== i))}>×</button></span>))}</div>}
    {value.length < 12 && <div className="mp-addrow">
      <input className="input" aria-label="A name to watch" placeholder="A name: a country, a rival, a group of customers…" value={name} onChange={e => setName(e.target.value)} onKeyDown={enter} />
      <select className="input" aria-label="What kind of name" value={type} onChange={e => setType(e.target.value as ChipType)}>
        {CHIP_TYPES.map(t => <option key={t} value={t}>{t}</option>)}</select>
      <input className="input" aria-label="Other forms of the name, separated by commas" placeholder="Also: short forms, other spellings" value={forms} onChange={e => setForms(e.target.value)} onKeyDown={enter} />
      <button className="btn btn--sm" type="button" onClick={add} disabled={!name.trim()}><Icon name="plus" />Add</button>
    </div>}
  </div>;
}

function KeyDates({ value, onChange }: { value: NonNullable<MonitorSpec["about"]["key_dates"]>; onChange: (v: NonNullable<MonitorSpec["about"]["key_dates"]>) => void }) {
  const set = (i: number, k: string, v: unknown) => onChange(value.map((d, j) => (j === i ? { ...d, [k]: v } : d)));
  return <div className="mp-col">
    {value.map((d, i) => <div key={i} className="mp-addrow">
      <input className="input" type="date" aria-label="Key date" value={d.date} onChange={e => set(i, "date", e.target.value)} />
      <input className="input" aria-label="What happens on the date" placeholder="What happens: new labour rules take effect" value={d.label} onChange={e => set(i, "label", e.target.value)} />
      <select className="input" aria-label="How many days before the date to start watching" value={d.lead_days} onChange={e => set(i, "lead_days", Number(e.target.value))}>
        {[1, 3, 7].map(n => <option key={n} value={n}>watch {n} day{n > 1 ? "s" : ""} before</option>)}</select>
      <button className="btn btn--sm btn--ghost" type="button" aria-label="Remove the date" onClick={() => onChange(value.filter((_, j) => j !== i))}><Icon name="trash" /></button>
    </div>)}
    {value.length < 10 && <button className="mp-add" type="button" onClick={() => onChange([...value, { date: "", label: "", lead_days: 3 }])}><Icon name="plus" />Add a key date</button>}
  </div>;
}

type FormProps = { m: Monitor | null; profile: Profile | null; status: MonitorsStatus | null; onSaved: (m: Monitor) => void; onCancel?: () => void;
  runs: CheckRow[]; onRun: () => void; running: boolean; onRetire: () => void };

export function MonitorForm(p: FormProps) {
  const { m, profile } = p;
  const nav = useNavigate();
  const toast = useToast();
  const [s, setS] = useState<MonitorSpec>(() => structuredClone(m?.spec ?? blank()));
  const [tell, setTell] = useState(() => (m?.spec.public.tell_me_if ?? []).join("\n"));
  const [ignore, setIgnore] = useState(() => (m?.spec.public.ignore ?? []).join("\n"));
  const [serious, setSerious] = useState(() => (m?.spec.private.serious ?? []).join("\n"));
  const [note, setNote] = useState("");
  const [err, setErr] = useState<Errs>(NOERR);
  const [busy, setBusy] = useState(false);
  const [ign, setIgn] = useState(!!ignore);
  const [allExpo, setAllExpo] = useState(false);
  const up = (f: (x: MonitorSpec) => void) => setS(x => { const y = structuredClone(x); f(y); return y; });
  const opts = useMemo(() => exposureOptions(profile), [profile]);
  const chosen = new Set(s.private.exposure.map(e => e.id));
  const drafted = new Set(m?.drafted_fields ?? []);
  const live = !!m && (m.status === "live" || m.status === "paused");
  const sentBefore = !!m?.versions.some(v => v.submitted_at);
  const min = p.status?.min_frequency_minutes ?? 60;
  const E = err.fields, pe = (k: string) => plainErr(k, E[k]);
  const rows = !!m;  // a draft or an edit: one line per question; a new monitor: the questions open

  const specNow = (): MonitorSpec => {
    const y = structuredClone(s);
    y.public.tell_me_if = lines(tell); y.public.ignore = lines(ignore); y.private.serious = lines(serious);
    y.about.key_dates = (y.about.key_dates ?? []).filter(d => d.date || d.label);
    return y;
  };
  // a file's spec fills the whole form (to check and edit, then save); what it leaves out stays blank
  const fillFrom = (spec: Record<string, any>) => {
    const b = blank();
    const x: MonitorSpec = { ...b, ...spec, about: { ...b.about, ...(spec.about ?? {}) }, private: { ...b.private, ...(spec.private ?? {}) },
      public: { ...b.public, ...(spec.public ?? {}), example_headlines: { ...b.public.example_headlines, ...(spec.public?.example_headlines ?? {}) },
        sources: { ...b.public.sources, ...(spec.public?.sources ?? {}) } } };
    setS(x); setTell((x.public.tell_me_if ?? []).join("\n")); setIgnore((x.public.ignore ?? []).join("\n"));
    setSerious((x.private.serious ?? []).join("\n")); setIgn(!!x.public.ignore?.length); setErr(NOERR);
  };
  const save = async (submit: boolean) => {
    const spec = specNow();
    setBusy(true);
    try {
      const before = m?.latest_version;
      let saved = m ? await monitorsApi.update(m.monitor_id, spec, note || undefined) : await monitorsApi.create(spec, note || undefined);
      const unchanged = !!m && saved.latest_version === before && JSON.stringify(saved.spec) === JSON.stringify(m.spec);
      const waiting = saved.versions[saved.versions.length - 1]?.status === "submitted";
      if (submit && waiting) toast(unchanged ? `No changes: version ${saved.latest_version} is already waiting for approval` : "Saved");
      else if (submit) { saved = await monitorsApi.act(saved.monitor_id, "submit"); toast(`Version ${saved.latest_version} sent: a Risk Manager approves it on the Monitors page`); }
      else toast(unchanged ? "No changes to save" : live ? `Saved as version ${saved.latest_version}, a draft; version ${saved.live_version} keeps running` : "Draft saved");
      setErr(NOERR); setNote("");
      if (submit) { nav("/monitors"); return; }  // back to the list, where it waits for approval
      if (!m) nav(`/monitors/${saved.monitor_id}`, { replace: true }); else p.onSaved(saved);
    } catch (e) { const x = errorsOf(e); setErr(x); if (x.fields["private.exposure"]) setAllExpo(true); }
    finally { setBusy(false); }
  };

  const Err = ({ k }: { k: string }) => (E[k] ? <span className="errtext mp-err" role="alert"><Icon name="warn" />{pe(k)}</span> : null);
  const Mark = ({ k }: { k: string }) => (drafted.has(k) ? <span className="mp-dm">from your profile</span> : null);
  const tellLines = lines(tell), ignLines = lines(ignore);

  // the parts, each answering one question; the new form shows them open, a draft or an edit as rows
  const what = <>
    <input className={`input mp-name ${E["about.name"] ? "err" : ""}`} aria-label="Name" aria-invalid={!!E["about.name"] || undefined} value={s.about.name}
      placeholder="Name it: jobs at our borrowers' main employers" onChange={e => up(x => { x.about.name = e.target.value; })} /><Err k="about.name" />
    <textarea className={`input ${E["public.in_one_sentence"] ? "err" : ""}`} aria-label="In one sentence, what it watches for" aria-invalid={!!E["public.in_one_sentence"] || undefined} rows={2}
      value={s.public.in_one_sentence} placeholder="In a sentence: events that could cut jobs or pay for the customers of one of our products."
      onChange={e => up(x => { x.public.in_one_sentence = e.target.value; })} />
    {E["public.in_one_sentence"] ? <Err k="public.in_one_sentence" /> : <span className="mp-hint">Specific beats broad: name the places, people or markets.</span>}
  </>;
  const when = <>
    <textarea className={`input ${E["public.tell_me_if"] ? "err" : ""}`} aria-label="Tell me if, one line each" aria-invalid={!!E["public.tell_me_if"] || undefined}
      rows={Math.max(3, tellLines.length * 2 + 1)} value={tell} onChange={e => setTell(e.target.value)}
      placeholder="A large employer where we lend announces job cuts or a plant closure" /><Err k="public.tell_me_if" />
    {ign || E["public.ignore"] ? <Field label="Leave out (one per line)" error={pe("public.ignore")}><textarea className="input" value={ignore} onChange={e => setIgnore(e.target.value)} placeholder="Routine labour statistics with no change" /></Field>
      : <button type="button" className="mp-add" onClick={() => setIgn(true)}><Icon name="plus" />Something it should leave out</button>}
  </>;
  const names = <>
    <WatchField value={s.public.watch} onChange={v => up(x => { x.public.watch = v; })} /><Err k="public.watch" />
    <PlacesField value={s.public.places} onChange={v => up(x => { x.public.places = v; })} names={profile?.place_names} max={20} /><Err k="public.places" />
  </>;
  const onExpo = opts.flatMap(([, xs]) => xs).filter(([id]) => chosen.has(id));
  const toggle = (id: string) => up(x => { x.private.exposure = chosen.has(id) ? x.private.exposure.filter(e => e.id !== id) : [...x.private.exposure, { id, how_it_reaches_us: "" }]; });
  const reach = <>
    <p className="mp-hint">Private: the monitor reads it to judge relevance; it never goes into a search. The investigation still checks every product an event could reach.</p>
    {!opts.length ? <span className="muted">No profile loaded.</span> : allExpo
      ? <div className="mp-expo">{opts.map(([g, xs]) => <div key={g}><span className="mp-glabel">{g}</span><span className="mp-chips">{xs.map(([id, label]) =>
          <button key={id} type="button" className={`chip click ${chosen.has(id) ? "sel" : ""}`} aria-pressed={chosen.has(id)} onClick={() => toggle(id)}>{label}</button>)}</span></div>)}</div>
      : <div className="mp-chips">{onExpo.map(([id, label]) => <button key={id} type="button" className="chip click sel" aria-pressed="true" title="Click to remove" onClick={() => toggle(id)}>{label}</button>)}
          <button type="button" className="mp-add" onClick={() => setAllExpo(true)}><Icon name="plus" />{onExpo.length ? "Change" : "Choose"}, from {opts.reduce((a, [, xs]) => a + xs.length, 0)} in your profile</button></div>}
    <Err k="private.exposure" />
  </>;
  const freq = <select className="input" aria-label="How often to check" value={s.about.check_frequency} onChange={e => up(x => { x.about.check_frequency = Number(e.target.value) as 60; })}>
    {[15, 60, 360, 1440].map(f => <option key={f} value={f} disabled={f < min}>{EVERY[f]}{f < min ? " (not in the prototype)" : ""}</option>)}</select>;
  const src = <select className="input" aria-label="Which outlets count" value={s.public.sources?.mode ?? "any_reputable"} onChange={e => up(x => { x.public.sources = { check_first: x.public.sources?.check_first ?? [], mode: e.target.value as "any_reputable" }; })}>
    <option value="any_reputable">any reputable</option><option value="trusted_only">only trusted</option></select>;
  const owner = <select className="input" aria-label="Owner" value={s.about.owner} onChange={e => up(x => { x.about.owner = e.target.value; })}>
    {[...new Set([s.about.owner, ...OWNERS])].map(o => <option key={o}>{o}</option>)}</select>;
  const often = <><p className="mp-inline">Check {freq} in {src} outlets, owned by {owner}.</p><Err k="about.check_frequency" /><Err k="about.owner" />
    <p className="mp-hint">Reads English-language news only, in the prototype.</p></>;
  const more = <div className="mp-adv">
    <Field label="Outlets to read first" error={pe("public.sources")} hint="Domains, e.g. arabnews.com. With “only trusted”, findings must come from these.">
      <ChipsInput value={s.public.sources?.check_first ?? []} placeholder="arabnews.com and Enter" max={10} onChange={v => up(x => { x.public.sources = { mode: x.public.sources?.mode ?? "any_reputable", check_first: v }; })} /></Field>
    <Field label="Key dates" error={pe("about.key_dates")} hint="A finding about one of these dates is dated by it, so the investigation times its effects from then.">
      <KeyDates value={s.about.key_dates ?? []} onChange={v => up(x => { x.about.key_dates = v; })} /></Field>
    <Field label="What counts as serious (one per line)" error={pe("private.serious")} hint="Private, like who it could reach."><textarea className="input" value={serious} onChange={e => setSerious(e.target.value)} placeholder="Any cut affecting more than 10,000 workers" /></Field>
    <div className="field"><span>How serious before it reports: <b>{s.alert_level}</b> of 10</span>
      <input type="range" aria-label="How serious before it reports, 0 to 10" aria-valuetext={`${s.alert_level} of 10`} min={0} max={10} value={s.alert_level} style={{ accentColor: "var(--accent)" }} onChange={e => up(x => { x.alert_level = Number(e.target.value); })} />
      <span className="hint">Sets the finding's score ({s.alert_level * 10}, +10 when two or more outlets report it).</span></div>
    <Field label="Review by" error={pe("about.review_by")} hint="The Monitors list marks it when the review is due."><input className="input mp-date" type="date" value={s.about.review_by ?? ""} onChange={e => up(x => { x.about.review_by = e.target.value || null; })} /></Field>
  </div>;
  const moreErr = ["public.sources", "about.key_dates", "private.serious", "about.review_by"].some(k => E[k]);
  const moreText = [s.public.sources?.check_first.length && `${s.public.sources.check_first.length} outlets first`, s.about.key_dates?.length && count(s.about.key_dates.length, "key date"),
    `reports at ${s.alert_level} of 10`, s.private.serious?.length && "what counts as serious", s.about.review_by && `review by ${s.about.review_by}`].filter(Boolean).join(" · ");

  const now = specNow();
  const diff = m?.live_spec && live ? changed(m.live_spec, now) : [];
  return <div className="mp-fgrid">
    <form className={rows ? "mp-rows" : "mp-qs"} onSubmit={e => e.preventDefault()} noValidate>
      {err.general.length > 0 && <p className="errtext mp-err" role="alert"><Icon name="warn" />{err.general.join(" ")}</p>}
      {rows ? <>
        <Row title="What it watches for" mark={<Mark k="public.in_one_sentence" />} err={pe("about.name") ?? pe("public.in_one_sentence")}
          answer={s.about.name && <><b>{s.about.name}</b>: {unnamed(s.public.in_one_sentence, s.about.name)}</>}>{what}</Row>
        <Row title="When to tell you" mark={<Mark k="public.tell_me_if" />} err={pe("public.tell_me_if") ?? pe("public.ignore")}
          answer={tellLines.length ? `${count(tellLines.length, "line")}${ignLines.length ? `; leaves out ${ignLines.length}` : ""}: ${tellLines[0]}${tellLines.length > 1 ? "…" : ""}` : null}>{when}</Row>
        <Row title="Names and places" mark={<Mark k="public.watch" />} err={pe("public.watch") ?? pe("public.places")}
          answer={s.public.watch.length || s.public.places.length ? listText(s.public.watch.map(w => w.name), 5) + (s.public.places.length ? `; ${count(s.public.places.length, "place")}` : "") : null}>{names}</Row>
        <Row title="Who it could reach" err={pe("private.exposure")} answer={onExpo.length ? listText(onExpo.map(([, l]) => l), 4) : null}>{reach}</Row>
        <Row title="How often, and who owns it" err={pe("about.check_frequency") ?? pe("about.owner")}
          answer={`${everyText(s.about.check_frequency)}, ${s.public.sources?.mode === "trusted_only" ? "only trusted" : "any reputable"} outlets, ${s.about.owner}`}>{often}</Row>
        <Row title="More" err={moreErr ? "Something here needs a look" : undefined} answer={<span className="muted">{moreText}</span>}>{more}</Row>
      </> : <>
        <Q n={1} title="What should it watch for?">{what}</Q>
        <Q n={2} title="When should it tell you?" hint="One line each. A finding names the lines it meets.">{when}</Q>
        <Q n={3} title="Which names and places?" hint="The names the news would use; other forms catch abbreviations and local spellings.">{names}</Q>
        <Q n={4} title="Who at the bank could it reach?">{reach}</Q>
        <div className="mp-q">{often}</div>
        <details className="mp-fold" open={moreErr || undefined}><summary><Icon name="settings" />More <span className="muted">outlets to read first, key dates, how serious, review date</span><Icon name="chevron" className="mp-chev" /></summary>{more}</details>
      </>}
    </form>
    <aside className="mp-aside" aria-label="What it will do, and saving">
      <h2>It will read as</h2><ReadsAs s={now} />
      {live && m && <p className="mp-chg">{diff.length ? <>Changes from version {m.live_version}: <b>{listText(diff, 6)}</b>. Version {m.live_version} keeps running until a Risk Manager approves the new one.</> : `No changes from version ${m.live_version} yet.`}</p>}
      {sentBefore && <input className="input" aria-label="What changed, for the approver (optional)" value={note} onChange={e => setNote(e.target.value)} placeholder="What changed, for the approver (optional)" />}
      <div className="mp-save">
        <button className="btn btn--primary" type="button" disabled={busy} onClick={() => save(true)}>Save and send for approval</button>
        <button className="btn" type="button" disabled={busy} onClick={() => save(false)}>{live ? "Save as the next version" : "Save draft"}</button>
        {p.onCancel && <button className="btn btn--ghost" type="button" onClick={p.onCancel}>Cancel</button>}</div>
      <p className="mp-hint">Nothing runs until a Risk Manager approves it.</p>
      {m && m.status === "draft" && <div className="mp-test">
        <p className="mp-quiet"><button type="button" disabled={p.running} onClick={p.onRun}><Icon name="play" />{p.running ? "Testing…" : "Run a test"}</button>
          <button type="button" onClick={p.onRetire}>Retire it</button></p>
        <p className="mp-hint">A test shows what it would find; it stays apart from your real findings.</p>
        {p.runs[0] && <CheckLine r={p.runs[0]} />}</div>}
      <FillFromJson what="a monitor" read={monitorsOf} onFill={c => fillFrom(c.data)} example={'a monitor spec as JSON ({"about": {…}, "public": {…}, "private": {…}}), or {"spec": …}'} />
    </aside>
  </div>;
}

function Q({ n, title, hint, children }: { n: number; title: string; hint?: string; children: ReactNode }) {
  return <section className="mp-q"><h2><span className="mp-qn">{n}</span>{title}</h2>{hint && <p className="mp-hint">{hint}</p>}<div className="mp-qb">{children}</div></section>;
}
/** One question as one line: its answer, or the problem with it; Change opens the fields in place. A problem opens it. */
function Row({ title, mark, answer, err, children }: { title: string; mark?: ReactNode; answer: ReactNode; err?: string; children: ReactNode }) {
  return <details className={`mp-row ${err ? "bad" : ""}`} open={!!err || undefined}><summary><span className="mp-rt">{title}{mark}</span>
    <span className="mp-ra">{err ? <span className="errtext"><Icon name="warn" />{err}</span> : answer || <em className="muted">Not set yet</em>}</span>
    <span className="mp-rc">Change<Icon name="chevron" className="mp-chev" /></span></summary><div className="mp-rb">{children}</div></details>;
}
