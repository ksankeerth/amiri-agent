// One monitor: its question, when it tells you, what it found; the form (new, a draft, or the next version of a
// live one); its approval; its checks (Check now; a draft's run is a test in the sandbox) and its versions.
import { useCallback, useEffect, useId, useMemo, useState, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, ApiError } from "../../api/client";
import { investigationApi } from "../../api/investigation";
import { inst, type Profile } from "../../api/institutions";
import { EVERY, monitorsApi, type CheckRow, type ChipType, type Monitor, type MonitorFinding, type MonitorSpec, type MonitorsStatus } from "../../api/monitors";
import { FillFromJson } from "../../components/FillFromJson";
import { monitorsOf } from "../../components/fillJson";
import { Places } from "../../components/blocks";
import { Fold, GoLink, PageTitle, Section, TextButton } from "../../components/rd";
import { LockBtn, LockFields, LockNote } from "../../components/lock";
import { useNow, useToast, PageSkeleton, LoadError } from "../../components/ui";
import { ago, day, dayTime, person, plainError, ZONE_LABEL } from "../../format";
import { eventTitle, longWhen, MONITOR_STATUS, setAsideReason } from "../../plain";
import type { Installation } from "../../App";
import { ChipsInput, Field, PlacesField } from "../institution/fields";
import { FLOW_WORDS } from "../../components/setupFlow";
import { ApprovalActions, awaitingApproval, DraftFromProfile, MonitorBanners, MonitorHelp, PauseResume, useHelp, useMonitorAct, useMonitorsStatus } from "./Monitors";
import { everyWords, isOverdue, lineMatches } from "./words";

const CHIP_TYPES: ChipType[] = ["organisation", "place", "region", "person", "sector", "regulation", "topic"];
const OWNERS = ["Risk management", "Treasury", "Retail banking", "Retail credit", "Business credit", "Pawning", "Cards", "Underwriting", "Claims",
  "Commercial banking", "Energy lending"];
const SHOW_FOUND = 5;   // the newest findings shown here; the rest are in Findings

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

/** What the profile offers as exposure: id → label, grouped. */
function exposureOptions(p: Profile | null): [string, [string, string][]][] {
  if (!p) return [];
  const S = p.sections;
  const name = (c: string) => p.place_names[c] ?? c;
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

/** Which parts of the spec differ between the live version and the one waiting. */
function changed(a: MonitorSpec, b: MonitorSpec): string[] {
  const parts: [string, (s: MonitorSpec) => unknown][] = [
    ["name", s => s.about.name], ["sentence", s => s.public.in_one_sentence], ["watch", s => s.public.watch],
    ["tell me if", s => s.public.tell_me_if], ["ignore", s => s.public.ignore], ["places", s => s.public.places],
    ["languages", s => s.public.languages], ["check frequency", s => s.about.check_frequency], ["sources", s => s.public.sources],
    ["key dates", s => s.about.key_dates], ["exposure", s => s.private.exposure], ["serious", s => s.private.serious],
    ["alert level", s => s.alert_level], ["owner", s => s.about.owner],
  ];
  return parts.filter(([, f]) => JSON.stringify(f(a) ?? null) !== JSON.stringify(f(b) ?? null)).map(([n]) => n);
}

/** "Filled in for you" in words, beside a field the profile filled in. */
function Drafted({ on }: { on: boolean }) {
  return on ? <span className="mn-filled" title="Filled in from your profile. Check and edit it."> · Filled in for you</span> : null;
}

// ---------------------------------------------------------------- the form

function WatchField({ value, onChange }: { value: MonitorSpec["public"]["watch"]; onChange: (v: MonitorSpec["public"]["watch"]) => void }) {
  const [name, setName] = useState("");
  const [type, setType] = useState<ChipType>("organisation");
  const [forms, setForms] = useState("");
  const add = () => {
    if (!name.trim()) return;
    onChange([...value, { name: name.trim(), type, other_forms: forms.split(",").map(x => x.trim()).filter(Boolean), not_confused_with: [] }]);
    setName(""); setForms("");
  };
  return (
    <div className="col" style={{ gap: 8 }}>
      {value.length > 0 && <ul className="mn-watch" aria-label="Names to watch">{value.map((w, i) => (
        <li key={i}><span><b>{w.name}</b> <span className="rd-fine">{w.type}{w.other_forms?.length ? `, also ${w.other_forms.join(", ")}` : ""}</span></span>
          <TextButton onClick={() => onChange(value.filter((_, j) => j !== i))}>Remove<span className="sr"> {w.name}</span></TextButton></li>))}</ul>}
      {value.length < 12 && <div className="row wrap" style={{ gap: 8 }}>
        <input className="input" aria-label="A name to watch" style={{ flex: "1 1 220px", minWidth: 180, width: "auto" }} placeholder="A name: a country, a rival, a group of customers…" value={name} onChange={e => setName(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); add(); } }} />
        <select className="input" aria-label="What kind of name" style={{ width: 160 }} value={type} onChange={e => setType(e.target.value as ChipType)}>
          {CHIP_TYPES.map(t => <option key={t} value={t}>{t}</option>)}</select>
        <input className="input" style={{ flex: "1 1 160px", minWidth: 140, width: "auto" }} aria-label="Other forms of the name, separated by commas" placeholder="Also: short forms, other spellings" value={forms} onChange={e => setForms(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); add(); } }} />
        <button className="btn" type="button" onClick={add} disabled={!name.trim()}>Add</button>
      </div>}
    </div>
  );
}

function KeyDates({ value, onChange }: { value: NonNullable<MonitorSpec["about"]["key_dates"]>; onChange: (v: NonNullable<MonitorSpec["about"]["key_dates"]>) => void }) {
  const set = (i: number, k: string, v: unknown) => onChange(value.map((d, j) => (j === i ? { ...d, [k]: v } : d)));
  return (
    <div className="col" style={{ gap: 8 }}>
      {value.map((d, i) => (
        <div key={i} className="row wrap" style={{ gap: 8 }}>
          <input className="input" type="date" aria-label="Key date" style={{ width: 170 }} value={d.date} onChange={e => set(i, "date", e.target.value)} />
          <input className="input" aria-label="What happens" style={{ flex: "1 1 240px", width: "auto" }} placeholder="What happens: new labour rules take effect" value={d.label} onChange={e => set(i, "label", e.target.value)} />
          <select className="input" aria-label="How many days before the date to start watching" style={{ width: 200 }} value={d.lead_days} onChange={e => set(i, "lead_days", Number(e.target.value))}>
            {[1, 3, 7].map(n => <option key={n} value={n}>watch {n} day{n > 1 ? "s" : ""} before</option>)}</select>
          <TextButton onClick={() => onChange(value.filter((_, j) => j !== i))}>Remove<span className="sr"> this key date</span></TextButton>
        </div>))}
      {value.length < 10 && <span><TextButton onClick={() => onChange([...value, { date: "", label: "", lead_days: 3 }])}>+ Add a key date</TextButton></span>}
    </div>
  );
}

function errorsOf(e: unknown): { fields: Record<string, string>; general: string[] } {
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

const Chevron = () => (
  <svg className="rd-fold-chev" viewBox="0 0 20 20" aria-hidden="true"><path d="M7 4l6 6-6 6" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>);

/** A fold that opens by itself when a field inside it has an error. */
function MoreOptions({ forceOpen, children }: { forceOpen: boolean; children: ReactNode }) {
  const [shown, setShown] = useState(false);
  const body = useId();
  const open = shown || forceOpen;
  return (
    <div className="rd-fold mn-more">
      <button type="button" aria-expanded={open} aria-controls={body} onClick={() => setShown(!open)}>
        <Chevron /><span className="rd-fold-h">More options</span><span className="rd-fold-s">outlets, key dates, who it could reach, how serious, review date</span></button>
      <div id={body} className="rd-fold-b mn-more-b" hidden={!open}>{children}</div>
    </div>
  );
}

function MonitorForm({ m, profile, status, onSaved, onCancel }: { m: Monitor | null; profile: Profile | null; status: MonitorsStatus | null; onSaved: (m: Monitor) => void; onCancel?: () => void }) {
  const nav = useNavigate();
  const toast = useToast();
  const [s, setS] = useState<MonitorSpec>(() => structuredClone(m?.spec ?? blank()));
  const [tell, setTell] = useState(() => (m?.spec.public.tell_me_if ?? []).join("\n"));
  const [ignore, setIgnore] = useState(() => (m?.spec.public.ignore ?? []).join("\n"));
  const [serious, setSerious] = useState(() => (m?.spec.private.serious ?? []).join("\n"));
  const [note, setNote] = useState("");
  const [err, setErr] = useState<{ fields: Record<string, string>; general: string[] }>({ fields: {}, general: [] });
  const [busy, setBusy] = useState(false);
  const drafted = new Set(m?.drafted_fields ?? []);
  const up = (f: (x: MonitorSpec) => void) => setS(x => { const y = structuredClone(x); f(y); return y; });
  const opts = useMemo(() => exposureOptions(profile), [profile]);
  const chosen = new Set(s.private.exposure.map(e => e.id));
  const live = m && (m.status === "live" || m.status === "paused");
  const min = status?.min_frequency_minutes ?? 60;
  const E = err.fields;
  const exposeId = useId();

  // a file's spec fills the whole form (to check and edit, then save); what it leaves out stays blank
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
  const save = async (submit: boolean) => {
    const spec: MonitorSpec = structuredClone(s);
    spec.public.tell_me_if = lines(tell); spec.public.ignore = lines(ignore); spec.private.serious = lines(serious);
    spec.about.key_dates = (spec.about.key_dates ?? []).filter(d => d.date || d.label);
    setBusy(true);
    try {
      const before = m?.latest_version;
      let saved = m ? await monitorsApi.update(m.monitor_id, spec, note || undefined) : await monitorsApi.create(spec, note || undefined);
      const unchanged = !!m && saved.latest_version === before && JSON.stringify(saved.spec) === JSON.stringify(m.spec);
      const waiting = saved.versions[saved.versions.length - 1]?.status === "submitted";
      if (submit && waiting) {  // already waiting for approval: nothing to submit again
        toast(unchanged ? `No changes: version ${saved.latest_version} is already waiting for approval` : "Saved");
      } else if (submit) {
        saved = await monitorsApi.act(saved.monitor_id, "submit");
        toast(`Version ${saved.latest_version} submitted: a Risk Manager approves it on the Monitors page`);
      } else {
        toast(unchanged ? "No changes to save" : live ? `Saved as version ${saved.latest_version}, a draft; version ${saved.live_version} keeps running` : "Draft saved");
      }
      setErr({ fields: {}, general: [] }); setNote("");
      if (submit) { nav("/monitors"); return; }  // back to the list, where it waits for approval
      if (!m) nav(`/monitors/${saved.monitor_id}`, { replace: true }); else onSaved(saved);
    } catch (e) { setErr(errorsOf(e)); }
    finally { setBusy(false); }
  };
  const warn = (text: ReactNode) => <p className="mn-err" role="alert"><span className="rd-shape rd-t-bad" aria-hidden="true">▲</span> {text}</p>;

  return (
    <form className="mn-form" onSubmit={e => e.preventDefault()}>
      <LockFields className="mn-fields">
      {err.general.length > 0 && warn(err.general.join(" "))}
      {Object.keys(E).length > 0 && warn("Some fields need attention: see below.")}
      <Field label="Name" error={E["about.name"]}>
        <input className={`input ${E["about.name"] ? "err" : ""}`} value={s.about.name} placeholder="e.g. Jobs at our borrowers' main employers" onChange={e => up(x => { x.about.name = e.target.value; })} />
      </Field>
      <div className="field"><span>In one sentence, what should Amiri Agent watch for?<Drafted on={drafted.has("public.in_one_sentence")} /></span>
        <textarea className={`input ${E["public.in_one_sentence"] ? "err" : ""}`} value={s.public.in_one_sentence}
          placeholder="Events that could cut jobs or pay for the customers of one of our products." onChange={e => up(x => { x.public.in_one_sentence = e.target.value; })} />
        {E["public.in_one_sentence"] ? <span className="errtext">{E["public.in_one_sentence"]}</span> : <span className="hint">Specific beats broad: name the places, people or markets.</span>}</div>
      <div className="field"><span>Watch<Drafted on={drafted.has("public.watch")} /></span>
        <WatchField value={s.public.watch} onChange={v => up(x => { x.public.watch = v; })} />
        {E["public.watch"] ? <span className="errtext">{E["public.watch"]}</span> : <span className="hint">The names the news would use. Other forms catch abbreviations and local spellings.</span>}</div>
      <div className="field"><span>Tell me if… (one condition per line)<Drafted on={drafted.has("public.tell_me_if")} /></span>
        <textarea className={`input ${E["public.tell_me_if"] ? "err" : ""}`} rows={4} value={tell} onChange={e => setTell(e.target.value)}
          placeholder="A large employer where we lend announces job cuts or a plant closure" />
        {E["public.tell_me_if"] ? <span className="errtext">{E["public.tell_me_if"]}</span> : <span className="hint">A finding names the lines it meets.</span>}</div>
      <Field label="Ignore (optional, one per line)" error={E["public.ignore"]}>
        <textarea className="input" value={ignore} onChange={e => setIgnore(e.target.value)} placeholder="Routine labour statistics with no change" />
      </Field>
      <Field label="Where it matters" error={E["public.places"]} hint="Countries, regions or places. A finding is tagged with the ones it is about.">
        <PlacesField value={s.public.places} onChange={v => up(x => { x.public.places = v; })} names={profile?.place_names} max={20} />
      </Field>
      <div className="field"><span>Read news in</span>
        <span className="mn-plain">English</span>
        <span className="hint">The prototype reads English-language news only; more languages later.</span></div>
      <div className="grid3">
        <Field label="Check every" error={E["about.check_frequency"]}>
          <select className="input" value={s.about.check_frequency} onChange={e => up(x => { x.about.check_frequency = Number(e.target.value) as 60; })}>
            {[15, 60, 360, 1440].map(f => <option key={f} value={f} disabled={f < min}>{EVERY[f]}{f < min ? " (not in the prototype)" : ""}</option>)}</select>
        </Field>
        <Field label="Sources">
          <select className="input" value={s.public.sources?.mode ?? "any_reputable"} onChange={e => up(x => { x.public.sources = { check_first: x.public.sources?.check_first ?? [], mode: e.target.value as "any_reputable" }; })}>
            <option value="any_reputable">Any reputable</option><option value="trusted_only">Trusted only</option></select>
        </Field>
        <Field label="Owner" error={E["about.owner"]}>
          <select className="input" value={s.about.owner} onChange={e => up(x => { x.about.owner = e.target.value; })}>
            {[...new Set([s.about.owner, ...OWNERS])].map(o => <option key={o}>{o}</option>)}</select>
        </Field>
      </div>
      <MoreOptions forceOpen={["about.key_dates", "private.exposure", "public.sources"].some(k => E[k])}>
        <div className="mn-form">
          <Field label="Outlets to check first (optional)" hint="Domains, e.g. arabnews.com. With Trusted only, findings must come from these.">
            <ChipsInput value={s.public.sources?.check_first ?? []} placeholder="arabnews.com and Enter" max={10}
              onChange={v => up(x => { x.public.sources = { mode: x.public.sources?.mode ?? "any_reputable", check_first: v }; })} />
          </Field>
          <Field label="Key dates (optional)" error={E["about.key_dates"]} hint="A finding about one of these dates is dated by it, so the investigation times its effects from then.">
            <KeyDates value={s.about.key_dates ?? []} onChange={v => up(x => { x.about.key_dates = v; })} />
          </Field>
          <div className="field" role="group" aria-labelledby={exposeId}><span id={exposeId}>Which customers or products could this reach?</span>
            {opts.length === 0 ? <span className="rd-fine">No profile loaded.</span> : opts.map(([g, xs]) => (
              <div key={g} className="mn-expo"><span className="rd-fine mn-expo-l">{g}</span>
                <div className="mn-expo-o">{xs.map(([id, label]) => (
                  <label key={id} className="check"><input type="checkbox" checked={chosen.has(id)}
                    onChange={() => up(x => { x.private.exposure = chosen.has(id) ? x.private.exposure.filter(e => e.id !== id) : [...x.private.exposure, { id, how_it_reaches_us: "" }]; })} />{label}</label>))}</div></div>))}
            {E["private.exposure"] ? <span className="errtext">{E["private.exposure"]}</span> : <span className="hint">Private: the monitor agent reads it to judge relevance; it never goes into a search. The investigation still checks every product an event could reach.</span>}</div>
          <Field label="What counts as serious (optional, one per line)" hint="Private, like the exposure.">
            <textarea className="input" value={serious} onChange={e => setSerious(e.target.value)} placeholder="Any cut affecting more than 10,000 workers" />
          </Field>
          <div className="field"><span>How serious before it reports? <b>{s.alert_level}</b> of 10</span>
            <input type="range" aria-label="How serious before it reports, 0 to 10" aria-valuetext={`${s.alert_level} of 10`} min={0} max={10} value={s.alert_level} style={{ accentColor: "var(--accent)" }} onChange={e => up(x => { x.alert_level = Number(e.target.value); })} />
            <span className="hint">Sets the finding's score ({s.alert_level * 10}, +10 when two or more outlets report it).</span></div>
          <Field label="Review by (optional)" hint="The list marks the monitor when its review is due.">
            <input className="input" type="date" style={{ width: 200 }} value={s.about.review_by ?? ""} onChange={e => up(x => { x.about.review_by = e.target.value || null; })} />
          </Field>
        </div>
      </MoreOptions>
      {m && <Field label="What changed (optional)"><input className="input" value={note} onChange={e => setNote(e.target.value)} placeholder="Added Qatar" /></Field>}
      {live && <p className="rd-fine mn-fineblock">Saving makes version {m.latest_version === m.live_version ? m.latest_version + 1 : m.latest_version} a draft; version {m.live_version} keeps running until a Risk Manager approves the new one.</p>}
      <div className="fill-end"><FillFromJson what="a monitor" read={monitorsOf} onFill={c => fillFrom(c.data)}
        example={'a monitor spec as JSON ({"about": {…}, "public": {…}, "private": {…}}), or {"spec": …}'} /></div>
      </LockFields>
      <div className="mn-savebar">
        {onCancel && <TextButton onClick={onCancel}>Cancel</TextButton>}
        <LockBtn className="btn" disabled={busy} onClick={() => save(false)}>{live ? "Save as the next version" : "Save draft"}</LockBtn>
        <LockBtn className="btn btn--primary" disabled={busy} onClick={() => save(true)}>Save and submit for approval</LockBtn>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------- the monitor, read

/** The one status line: "Live · Treasury · checked every hour". Who approved and the last check are in the folds below;
 *  an overdue check is said once, in the page's warning. */
function StatusLine({ m }: { m: Monitor }) {
  const sp = m.live_spec ?? m.spec;
  const parts: ReactNode[] = [<b key="s" className="mn-state">{MONITOR_STATUS[m.status][0]}</b>, sp.about.owner];
  if (m.status !== "retired") parts.push(m.status === "live" || m.status === "paused" ? `checked ${everyWords(sp.about.check_frequency)}` : `will be checked ${everyWords(sp.about.check_frequency)}`);
  return <>{parts.map((p, i) => <span key={i}>{p}</span>)}</>;
}

/** The last check in a few words: "20 h ago: nothing new". */
function lastCheckWords(m: Monitor, now: Date): string {
  if (!m.last_check) return m.status === "draft" ? "" : "not checked yet";
  const c = m.last_check;
  return `${ago(c.at, now)}: ${c.status === "fired" ? `found ${c.findings}` : c.status === "quiet" ? "nothing new" : "couldn't check, it tries again soon"}`;
}

/** Waiting for approval, or ready to submit: what, who sent it, and the buttons. */
function Approval({ m, onChange, editing }: { m: Monitor; onChange: () => void; editing: boolean }) {
  const pending = m.pending;
  const diff = pending && m.live_spec ? changed(m.live_spec, m.spec) : [];
  const latest = m.versions[m.versions.length - 1];
  const waiting = awaitingApproval(m);
  const sent = [...m.versions].reverse().find(v => v.status === "submitted");
  const who = sent ? `${person(sent.submitted_by)}${sent.submitted_at ? `, ${dayTime(sent.submitted_at)}` : ""}` : "";
  let text: ReactNode;
  if (pending?.status === "submitted") text = <>Version {pending.version} was sent by {who}. Version {m.live_version} keeps running until it is approved.</>;
  else if (m.status === "submitted") text = <>Sent by {who}. It goes live within minutes of approval.</>;
  else if (pending) text = "You have unsaved changes in a new version. Submit them when ready; the current version keeps running.";
  else text = "A draft doesn't run on its own. Run a test to see what it would find, then submit it for approval.";
  const sentBack = latest.status === "draft" && latest.note && latest.submitted_at;
  return (
    <Section title={waiting ? "Waiting for your approval" : "Not submitted yet"}>
      <div className="mn-appr rd-prose">
        <p>{text}</p>
        {sentBack && <p><b>Changes requested:</b> {latest.note}</p>}
        {diff.length > 0 && <p>What changes: {diff.join(", ")}.</p>}
        <ApprovalActions m={m} onChange={onChange} primary={!editing} />
        <p className="rd-fine">In this prototype the person who sent it can also approve it. Who sent and who approved each version is recorded.</p>
      </div>
    </Section>
  );
}

/** "Tell me if" lines, numbered, each with how many of the latest findings met it. */
function TellMeIf({ m, findings }: { m: Monitor; findings: MonitorFinding[] }) {
  const sp = m.live_spec ?? m.spec;
  const tell = sp.public.tell_me_if;
  const real = findings.filter(f => f.world !== "sandbox");
  const pool = real.length ? real : findings;
  const hits = lineMatches(tell.length, pool);
  const label = `matched${pool === findings && !real.length ? " in tests" : ""}, latest ${pool.length} findings`;
  if (!tell.length) return null;
  return (
    <Section title="Tell me if" className="mn-tellsec" meta={pool.length ? <span className="mn-matched">{label}</span> : undefined}>
      <ol className="mn-tell">{tell.map((t, i) => (
        <li key={t} className={`mn-tl${pool.length ? " mn-has" : ""}`}>
          <span className="mn-n" aria-hidden="true">{i + 1}</span>
          <span className="mn-tt">{t}</span>
          {pool.length > 0 && <span className={`mn-c${hits[i] ? " mn-hit" : ""}`}>
            <span aria-hidden="true">{hits[i]}</span><span className="sr">matched {hits[i]} of the latest {pool.length} findings</span></span>}
        </li>))}</ol>
    </Section>
  );
}

/** The five newest findings as one-line rows; the rest are in Findings. */
function Found({ items, events }: { items: MonitorFinding[]; events: Record<string, string> }) {
  const at = (f: MonitorFinding) => f.evidence?.headlines?.[0]?.published_at ?? f.created_at;
  const newest = useMemo(() => [...items].sort((a, b) => (at(a) < at(b) ? 1 : -1)).slice(0, SHOW_FOUND), [items]);
  return (
    <Section title="What it found" meta={items.length ? <span className="rd-dots"><span>{items.length > SHOW_FOUND ? `${SHOW_FOUND} newest of ${items.length}` : items.length}</span><span>Colombo time</span></span> : undefined}
      action={items.length ? <GoLink to="/findings">All in Findings</GoLink> : undefined}>
      {!items.length ? <p className="mn-empty">Nothing yet. What it finds appears here and goes to the investigation.</p>
        : <><div className="mn-found-h rd-colh" aria-hidden="true"><span /><span /><span>In event</span></div>
          <ul className="mn-found" aria-label="Newest findings">{newest.map(f => {
          const h = f.evidence?.headlines?.[0];
          const url = h?.url ?? f.evidence?.web?.[0]?.url;
          const title = h?.title ?? f.title;
          const ev = f.outcome?.event_id;
          const note = f.status === "new" || f.status === "grouped" ? "Being investigated" : f.outcome?.reason ? `No impact found: ${setAsideReason(f.outcome.reason)}` : "";
          return (
            <li key={f.finding_id}>
              <span className="mn-ft rd-clamp1" title={title}>{url
                ? <a className="rd-name" href={url} target="_blank" rel="noreferrer">{title}<span aria-hidden="true"> ↗</span><span className="sr"> (opens the article)</span></a> : title}</span>
              <span className="mn-fm">{f.world === "sandbox" ? "Test" : h?.outlet ?? "News"} · {dayTime(at(f))}</span>
              <span className="mn-fe rd-clamp1" title={ev ? events[ev] : note}>{ev ? <Link className="rd-name" to={`/events/${ev}`}>{events[ev] ?? "open it"}</Link> : <span className="rd-fine">{note}</span>}</span>
            </li>);
        })}</ul></>}
    </Section>
  );
}

/** "20: 8 found something, 11 nothing new, 1 running" */
function checksSummary(runs: CheckRow[]): string {
  if (!runs.length) return "none yet";
  const n = (f: (r: CheckRow) => boolean) => runs.filter(f).length;
  const found = n(r => r.status !== "running" && r.status !== "failed" && !!r.findings), failed = n(r => r.status === "failed"), running = n(r => r.status === "running");
  const quiet = runs.length - found - failed - running;
  return `${runs.length}: ${[found && `${found} found something`, quiet && `${quiet} nothing new`, running && `${running} running`, failed && `${failed} couldn't check`].filter(Boolean).join(", ")}`;
}

function Checks({ m, runs, now }: { m: Monitor; runs: CheckRow[]; now: Date }) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const live = m.status === "live";
  return (
    <Fold title="Recent checks" summary={m.last_check ? `last ${lastCheckWords(m, now)}` : checksSummary(runs)} remember="monitor-checks">
      {runs.length > 0 && <p className="rd-fine mn-ck-sum">{checksSummary(runs)} · {ZONE_LABEL} time</p>}
      {!runs.length ? <p className="mn-empty">No checks yet.{live && m.next_check_at ? ` The first is due ${dayTime(m.next_check_at)}.` : ""}</p>
        : <ul className="mn-ck-list">{runs.map((r, i) => {
          const same = r.status === "failed" && i > 0 && runs[i - 1].status === "failed" && runs[i - 1].error === r.error;
          const word = r.status === "running" ? "Checking…" : r.status === "failed" ? "Couldn't check" : r.findings ? `Found ${r.findings}` : "Nothing new";
          const detail = r.error ? (same ? "Same problem as the check below." : `${plainError(r.error)} It tries again within the hour.`) : r.summary;
          const meta = r.world === "sandbox" ? "Test" : r.trigger === "now" ? "Checked on request" : "";
          const isOpen = !!open[r.run_id];
          return (
            <li key={r.run_id}>
              <div className="mn-ck-l"><b className={r.status === "failed" ? "rd-warn" : undefined}>{r.status === "failed" && <span aria-hidden="true">◆ </span>}{word}</b>
                <span className="rd-fine">{longWhen(r.created_at)}{meta ? ` · ${meta}` : ""}</span>
                <TextButton aria-expanded={isOpen} aria-controls={`ck-${r.run_id}`} onClick={() => setOpen(o => ({ ...o, [r.run_id]: !o[r.run_id] }))}>
                  {isOpen ? "Hide" : "Details"}<span className="sr"> of the check on {longWhen(r.created_at)}</span></TextButton></div>
              {detail && <p className="mn-ck-d">{detail}</p>}
              {isOpen && <dl id={`ck-${r.run_id}`} className="rd-open mn-dl">
                <div><dt>News since</dt><dd>{dayTime(r.window_since)}</dd></div>
                <div><dt>Version</dt><dd>{r.version}</dd></div>
                {r.coverage && <div><dt>Searches</dt><dd>{r.coverage.web_queries} searches, {r.coverage.pages_seen} pages, {r.coverage.pages_in_window} in the window{r.coverage.already_reported ? `, ${r.coverage.already_reported} already reported` : ""}</dd></div>}
                {r.error && <div><dt>Error</dt><dd className="rawerr">{r.error}</dd></div>}
                <div><dt>Check</dt><dd className="mono">{r.run_id}</dd></div>
              </dl>}
            </li>);
        })}</ul>}
    </Fold>
  );
}

/** Names, places, what to ignore, sources, examples. */
function MoreAbout({ m, profile }: { m: Monitor; profile: Profile | null }) {
  const sp = m.live_spec ?? m.spec;
  const p = sp.public;
  const ex = p.example_headlines;
  const rows: [string, ReactNode][] = ([
    ["Names to look for", p.watch.length ? p.watch.map(w => `${w.name} (${w.type})`).join(", ") : null],
    ["Where", p.places.length ? <Places codes={p.places} max={20} /> : null],
    ["Not interested in", p.ignore?.length ? p.ignore.join("; ") : null],
    ["Sources", p.sources?.mode === "trusted_only" ? `Only ${p.sources.check_first.join(", ")}` : `Any reputable outlet${p.sources?.check_first.length ? `, checking ${p.sources.check_first.join(", ")} first` : ""}`],
    ["Also tells", sp.about.also_notify?.length ? sp.about.also_notify.join(", ") : null],
    ["Key dates", sp.about.key_dates?.length ? sp.about.key_dates.map(d => `${d.label} (${d.date})`).join("; ") : null],
    ["Could reach", sp.private.exposure.length && profile ? `${sp.private.exposure.length} of your customer groups, products or flows` : null],
    ["How serious before it reports", `${sp.alert_level} of 10`],
    ["Headlines that match", ex?.match.length ? <ul className="mn-ex">{ex.match.map(x => <li key={x.headline}>“{x.headline}” <span className="rd-fine">line {x.line}</span></li>)}</ul> : null],
    ["Headlines that don't", ex?.not_match.length ? <ul className="mn-ex">{ex.not_match.map(x => <li key={x}>“{x}”</li>)}</ul> : null],
  ] as [string, ReactNode][]).filter(([, v]) => v !== null);
  const summary = [p.watch.length && `${p.watch.length} names`, p.places.length && `${p.places.length} places`, p.ignore?.length && `ignores ${p.ignore.length}`,
    p.sources?.mode === "trusted_only" ? "trusted sources only" : "any reputable source", ex?.match.length && `${ex.match.length + ex.not_match.length} example headlines`]
    .filter(Boolean).join(" · ");
  return (
    <Fold title="More about the question" summary={summary} remember="monitor-more">
      <dl className="mn-dl mn-dl-wide">{rows.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
    </Fold>
  );
}

function Versions({ m, onChange }: { m: Monitor; onChange: () => void }) {
  const { act } = useMonitorAct(m, onChange);
  const approved = [...m.versions].reverse().find(v => v.status === "approved");
  const review = (m.live_spec ?? m.spec).about.review_by;
  const summary = [`${m.versions.length}`, approved?.approved_by ? `approved by ${person(approved.approved_by)}` : "", review ? `review by ${day(review)}` : ""].filter(Boolean).join(" · ");
  return (
    <Fold title="Versions" summary={summary} remember="monitor-versions">
      <ol className="mn-vers">{[...m.versions].reverse().map(v => (
        <li key={v.version}><b>Version {v.version}</b>
          <span>{v.status}{v.version === m.live_version ? ", running" : ""} · by {person(v.created_by)} {dayTime(v.created_at)}{v.approved_by ? ` · approved by ${person(v.approved_by)}` : ""}{v.note ? ` · ${v.note}` : ""}</span></li>))}</ol>
      <p className="rd-fine">Monitor <span className="mono">{m.monitor_id}</span></p>
      {m.status !== "retired" && <p><TextButton edits onClick={() => act("retire")}>Retire this monitor</TextButton> <span className="rd-fine">It stops being checked and moves to Retired on the list.</span></p>}
    </Fold>
  );
}

export function MonitorPage() {
  const { id = "new" } = useParams();
  const isNew = id === "new";
  const toast = useToast();
  const now = useNow(30_000);
  const { status } = useMonitorsStatus();
  const help = useHelp();
  const [m, setM] = useState<Monitor | null>(null);
  const [runs, setRuns] = useState<CheckRow[]>([]);
  const [findings, setFindings] = useState<MonitorFinding[]>([]);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const [checking, setChecking] = useState<string | null>(null);
  const [formKey, setFormKey] = useState(0);
  const [drafting, setDrafting] = useState(false);
  const [editing, setEditing] = useState<boolean | null>(null);  // null: the default for its state (a fresh draft opens in the form)
  const [eventTitles, setEventTitles] = useState<Record<string, string>>({});
  useEffect(() => { if (findings.some(f => f.outcome?.event_id)) investigationApi.events().then(xs => setEventTitles(Object.fromEntries(xs.map(e => [e.event_id, eventTitle(e)])))).catch(() => {}); }, [findings]);

  const owner = m?.institution_id;
  useEffect(() => {  // the exposure choices come from the monitor's own institution (the installation's for a new one)
    if (!isNew && !owner) return;
    (owner ? Promise.resolve(owner) : api<Installation>("/api/v1/installation").then(i => (i.profile ? i.institution_id : null)))
      .then(id => (id ? inst.profile(id).then(setProfile) : null)).catch(() => {});
  }, [owner, isNew]);
  const load = useCallback(async () => {
    if (isNew) return;
    try {
      const [mm, r, f] = await Promise.all([monitorsApi.get(id), monitorsApi.runs(id), monitorsApi.findings(id)]);
      setM(mm); setRuns(r); setFindings(f); setErr(null);
    } catch (e) { setErr(e); }
  }, [id, isNew]);
  useEffect(() => { setM(null); load(); }, [load]);
  useEffect(() => { if (isNew) return; const t = setInterval(load, 30_000); return () => clearInterval(t); }, [load, isNew]);

  // A check started here is asked for its status until it finishes (the server asks the agent).
  useEffect(() => {
    const running = checking ?? runs.find(r => r.status === "running")?.run_id;
    if (!running) return;
    const t = setInterval(async () => {
      try {
        const r = await monitorsApi.check(running);
        if (r.status !== "running") {
          setChecking(null); await load();
          if (checking) toast(r.status === "failed" ? "The check failed: see Recent checks" : r.findings ? `Found ${r.findings}` : "Nothing new");
        }
      } catch { /* the next poll */ }
    }, 5000);
    return () => clearInterval(t);
  }, [checking, runs, load, toast]);

  const runNow = async () => {
    if (!m) return;
    try { const r = await monitorsApi.runNow(m.monitor_id); setChecking(r.status === "running" ? r.run_id : null); await load(); }
    catch (e) { toast(e instanceof ApiError ? e.full : String(e)); }
  };
  const saved = (x: Monitor) => { setM(x); setFormKey(k => k + 1); setEditing(false); load(); };
  const editMode = isNew || editing || (m?.status === "draft" && editing !== false && !m.last_check);

  if (!isNew && !m) return <div className="page rd rd-monitors">{err != null ? <><PageTitle title="Monitor" crumbs={<Link to="/monitors">Monitors</Link>} /><LoadError error={err} onRetry={load} what="this monitor" /></> : <PageSkeleton bare />}</div>;

  const sp = m ? m.live_spec ?? m.spec : null;
  const running = !!checking;
  const approving = !!m && (!!m.pending || m.status === "draft" || m.status === "submitted");
  const actions = isNew ? <>{help.toggle}<TextButton edits onClick={() => setDrafting(true)}>Draft from the profile</TextButton></> : m && <>
    {m.status !== "retired" && !editMode && <TextButton edits onClick={() => setEditing(true)}>Edit</TextButton>}
    {!editMode && <PauseResume m={m} onChange={load} />}
    {m.status !== "retired" && <TextButton disabled={running} onClick={runNow}
      title={m.status === "live" ? "Check the news now" : "Test it now; what it finds is kept apart from your real findings"}>
      {running ? "Checking…" : m.status === "live" ? "Check now" : "Run a test"}</TextButton>}
    {help.toggle}</>;
  return (
    <div className="page rd rd-monitors">
      <PageTitle title={m ? m.spec.about.name || m.name : "New monitor"}
        crumbs={<><Link to="/monitors">Monitors</Link> <span aria-hidden="true">/</span> {m ? m.name : "New monitor"}</>}
        actions={actions}
        status={m ? <span className="rd-dots"><StatusLine m={m} /></span> : undefined}
        lede={m ? undefined : "Say in plain words what to watch for. It runs once a Risk Manager approves it."}
        help={<MonitorHelp status={status} id={help.id} open={help.open} />} />
      {err != null && <LoadError error={err} onRetry={load} what="this monitor" />}
      <LockNote />
      <MonitorBanners status={status} extra={m && isOverdue(m, now) && m.last_check ? <>This one is overdue: last checked {ago(m.last_check.at, now)}.</> : undefined} />
      {editMode && m && m.drafted_fields.length > 0 && <p className="rd-fine mn-fineblock">Filled in for you from your profile. Check the marked fields before you submit.</p>}

      {m && approving && <Approval m={m} onChange={load} editing={!!editMode} />}
      {editMode
        ? <Section title={m ? "Edit" : "The question"} className="mn-edit">
            <MonitorForm key={`${m?.monitor_id ?? "new"}-${formKey}`} m={m} profile={profile} status={status} onSaved={saved} onCancel={m ? () => setEditing(false) : undefined} />
          </Section>
        : m && sp && <>
          <div className="mn-hero"><p className="mn-about">Tell me about</p><p className="mn-hq">{sp.public.in_one_sentence}</p></div>
          <TellMeIf m={m} findings={findings} />
          <Found items={findings} events={eventTitles} />
        </>}
      {m && <div className="mn-folds">
        <Checks m={m} runs={runs} now={now} />
        {!editMode && <MoreAbout m={m} profile={profile} />}
        <Versions m={m} onChange={load} />
      </div>}
      {drafting && <DraftFromProfile onClose={() => setDrafting(false)} />}
    </div>
  );
}
