// One monitor: the form (new, a draft, or the next version of a live one), its approval,
// its checks (Run now; a draft's run is a test in the sandbox) and what it found.
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, ApiError } from "../../api/client";
import { inst, type Profile } from "../../api/institutions";
import { EVERY, monitorsApi, type CheckRow, type ChipType, type Monitor, type MonitorFinding, type MonitorSpec, type MonitorsStatus } from "../../api/monitors";
import { Icon } from "../../components/Icon";
import { Banner, PageHead, useNow, useToast, PageSkeleton } from "../../components/ui";
import { ago, dayTime, plainError, when } from "../../format";
import type { Installation } from "../../App";
import { ChipsInput, Field, PlacesField } from "../institution/fields";
import { FLOW_WORDS } from "../institution/forms";
import { DraftFromProfile, MonitorActions, MonitorBanners, ORIGIN, StatusBadge, useMonitorsStatus } from "./Monitors";

const CHIP_TYPES: ChipType[] = ["organisation", "place", "region", "person", "sector", "regulation", "topic"];
const OWNERS = ["Risk management", "Treasury", "Retail banking", "Retail credit", "Business credit", "Pawning", "Cards", "Underwriting", "Claims"];

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

function Drafted({ on }: { on: boolean }) {
  return on ? <span className="badge b-info" style={{ marginLeft: 6 }} title="Drafted by code from the profile item. Check and edit it.">DRAFTED</span> : null;
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
  return (
    <div className="col" style={{ gap: 6 }}>
      {value.length > 0 && <div className="row wrap" style={{ gap: 6 }}>{value.map((w, i) => (
        <span key={i} className="chip" title={w.other_forms?.length ? `Also: ${w.other_forms.join(", ")}` : undefined}>
          {w.name} <span className="muted">{w.type}</span>{w.other_forms?.length ? <span className="muted">+{w.other_forms.length}</span> : null}
          <button type="button" aria-label={`Remove ${w.name}`} onClick={() => onChange(value.filter((_, j) => j !== i))}>×</button></span>))}</div>}
      {value.length < 12 && <div className="row wrap" style={{ gap: 6 }}>
        <input className="input" aria-label="A name to watch" style={{ flex: "1 1 220px", minWidth: 180, width: "auto" }} placeholder="A name: Saudi Arabia, Coastal Remit, migrant workers…" value={name} onChange={e => setName(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); add(); } }} />
        <select className="input" aria-label="What kind of name" style={{ width: 140 }} value={type} onChange={e => setType(e.target.value as ChipType)}>
          {CHIP_TYPES.map(t => <option key={t} value={t}>{t}</option>)}</select>
        <input className="input" style={{ flex: "1 1 160px", minWidth: 140, width: "auto" }} aria-label="Other forms of the name, separated by commas" placeholder="Also: KSA, UAE" value={forms} onChange={e => setForms(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); add(); } }} />
        <button className="btn btn--sm" type="button" onClick={add} disabled={!name.trim()}><Icon name="plus" />Add</button>
      </div>}
    </div>
  );
}

function KeyDates({ value, onChange }: { value: NonNullable<MonitorSpec["about"]["key_dates"]>; onChange: (v: NonNullable<MonitorSpec["about"]["key_dates"]>) => void }) {
  const set = (i: number, k: string, v: unknown) => onChange(value.map((d, j) => (j === i ? { ...d, [k]: v } : d)));
  return (
    <div className="col" style={{ gap: 6 }}>
      {value.map((d, i) => (
        <div key={i} className="row" style={{ gap: 6 }}>
          <input className="input" type="date" aria-label="Key date" style={{ width: 160 }} value={d.date} onChange={e => set(i, "date", e.target.value)} />
          <input className="input" placeholder="What happens: new labour rules take effect" value={d.label} onChange={e => set(i, "label", e.target.value)} />
          <select className="input" aria-label="How many days before the date to start watching" style={{ width: 150 }} value={d.lead_days} onChange={e => set(i, "lead_days", Number(e.target.value))}>
            {[1, 3, 7].map(n => <option key={n} value={n}>watch {n} day{n > 1 ? "s" : ""} before</option>)}</select>
          <button className="btn btn--sm btn--ghost" type="button" aria-label="Remove" onClick={() => onChange(value.filter((_, j) => j !== i))}><Icon name="trash" /></button>
        </div>))}
      {value.length < 10 && <button className="btn btn--sm" type="button" style={{ alignSelf: "flex-start" }}
        onClick={() => onChange([...value, { date: "", label: "", lead_days: 3 }])}><Icon name="plus" />Add a key date</button>}
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

function MonitorForm({ m, profile, status, onSaved }: { m: Monitor | null; profile: Profile | null; status: MonitorsStatus | null; onSaved: (m: Monitor) => void }) {
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

  return (
    <form className="card" onSubmit={e => e.preventDefault()}>
      <div className="bd col" style={{ gap: 14 }}>
        {err.general.length > 0 && <Banner kind="crit" icon="warn">{err.general.join(" ")}</Banner>}
        {Object.keys(E).length > 0 && <Banner kind="crit" icon="warn">Some fields need attention: see below.</Banner>}
        <Field label="Name" error={E["about.name"]}>
          <input className={`input ${E["about.name"] ? "err" : ""}`} value={s.about.name} placeholder="e.g. Gulf jobs and security" onChange={e => up(x => { x.about.name = e.target.value; })} />
        </Field>
        <div className="field"><span>In one sentence, what should Amiri Agent watch for?<Drafted on={drafted.has("public.in_one_sentence")} /></span>
          <textarea className={`input ${E["public.in_one_sentence"] ? "err" : ""}`} value={s.public.in_one_sentence}
            placeholder="Events in the Gulf that could cut jobs or pay for our migrant-worker customers." onChange={e => up(x => { x.public.in_one_sentence = e.target.value; })} />
          {E["public.in_one_sentence"] ? <span className="errtext">{E["public.in_one_sentence"]}</span> : <span className="hint">Specific beats broad: name the places, people or markets.</span>}</div>
        <div className="field"><span>Watch<Drafted on={drafted.has("public.watch")} /></span>
          <WatchField value={s.public.watch} onChange={v => up(x => { x.public.watch = v; })} />
          {E["public.watch"] ? <span className="errtext">{E["public.watch"]}</span> : <span className="hint">The names the news would use. Other forms catch abbreviations (KSA, UAE) and local spellings.</span>}</div>
        <div className="field"><span>Tell me if… (one condition per line)<Drafted on={drafted.has("public.tell_me_if")} /></span>
          <textarea className={`input ${E["public.tell_me_if"] ? "err" : ""}`} rows={4} value={tell} onChange={e => setTell(e.target.value)}
            placeholder="A Gulf state announces job cuts, visa limits or wage controls for foreign workers" />
          {E["public.tell_me_if"] ? <span className="errtext">{E["public.tell_me_if"]}</span> : <span className="hint">A finding names the lines it meets.</span>}</div>
        <Field label="Ignore (optional, one per line)" error={E["public.ignore"]}>
          <textarea className="input" value={ignore} onChange={e => setIgnore(e.target.value)} placeholder="Routine labour statistics with no change" />
        </Field>
        <Field label="Where it matters" error={E["public.places"]} hint="Countries, regions or places. A finding is tagged with the ones it is about.">
          <PlacesField value={s.public.places} onChange={v => up(x => { x.public.places = v; })} names={profile?.place_names} max={20} />
        </Field>
        <Field label="Read news in" hint="The prototype reads English-language news only; more languages later.">
          <div className="row wrap" style={{ gap: 6 }}><span className="chip sel">English</span></div>
        </Field>
        <div className="grid3">
          <Field label="Check every" error={E["about.check_frequency"]}>
            <select className="input" aria-label="How often to check" value={s.about.check_frequency} onChange={e => up(x => { x.about.check_frequency = Number(e.target.value) as 60; })}>
              {[15, 60, 360, 1440].map(f => <option key={f} value={f} disabled={f < min}>{EVERY[f]}{f < min ? " (not in the prototype)" : ""}</option>)}</select>
          </Field>
          <Field label="Sources">
            <select className="input" aria-label="Which outlets count" value={s.public.sources?.mode ?? "any_reputable"} onChange={e => up(x => { x.public.sources = { check_first: x.public.sources?.check_first ?? [], mode: e.target.value as "any_reputable" }; })}>
              <option value="any_reputable">Any reputable</option><option value="trusted_only">Trusted only</option></select>
          </Field>
          <Field label="Owner" error={E["about.owner"]}>
            <select className="input" aria-label="Owner" value={s.about.owner} onChange={e => up(x => { x.about.owner = e.target.value; })}>
              {[...new Set([s.about.owner, ...OWNERS])].map(o => <option key={o}>{o}</option>)}</select>
          </Field>
        </div>
        <details className="adv" open={["about.key_dates", "private.exposure", "public.sources"].some(k => E[k]) || undefined}>
          <summary>More options <span className="small muted">outlets, key dates, who it could reach, how serious, review date</span></summary>
        <Field label="Outlets to check first (optional)" hint="Domains, e.g. arabnews.com. With Trusted only, findings must come from these.">
          <ChipsInput value={s.public.sources?.check_first ?? []} placeholder="arabnews.com and Enter" max={10}
            onChange={v => up(x => { x.public.sources = { mode: x.public.sources?.mode ?? "any_reputable", check_first: v }; })} />
        </Field>
        <Field label="Key dates (optional)" error={E["about.key_dates"]} hint="A finding about one of these dates is dated by it, so the investigation times its effects from then.">
          <KeyDates value={s.about.key_dates ?? []} onChange={v => up(x => { x.about.key_dates = v; })} />
        </Field>
        <div className="field"><span>Which customers or products could this reach?</span>
          {opts.length === 0 ? <span className="small muted">No profile loaded.</span> : opts.map(([g, xs]) => (
            <div key={g} className="row wrap" style={{ gap: 6, alignItems: "center" }}><span className="small muted" style={{ width: 120 }}>{g}</span>
              {xs.map(([id, label]) => {
                const on = chosen.has(id);
                return <button key={id} type="button" className={`chip click ${on ? "sel" : ""}`} aria-pressed={on}
                  onClick={() => up(x => { x.private.exposure = on ? x.private.exposure.filter(e => e.id !== id) : [...x.private.exposure, { id, how_it_reaches_us: "" }]; })}>{label}</button>;
              })}</div>))}
          {E["private.exposure"] ? <span className="errtext">{E["private.exposure"]}</span> : <span className="hint">Private: the monitor agent reads it to judge relevance; it never goes into a search. The investigation still checks every product an event could reach.</span>}</div>
        <Field label="What counts as serious (optional, one per line)" hint="Private, like the exposure.">
          <textarea className="input" value={serious} onChange={e => setSerious(e.target.value)} placeholder="Any cut affecting more than 10,000 workers" />
        </Field>
        <div className="field"><span>How serious before it reports? <b>{s.alert_level}</b> of 10</span>
          <input type="range" aria-label="How serious before it reports, 0 to 10" aria-valuetext={`${s.alert_level} of 10`} min={0} max={10} value={s.alert_level} style={{ accentColor: "var(--accent)" }} onChange={e => up(x => { x.alert_level = Number(e.target.value); })} />
          <span className="hint">Sets the finding's score ({s.alert_level * 10}, +10 when two or more outlets report it).</span></div>
        <Field label="Review by (optional)" hint="The list marks the monitor when its review is due.">
          <input className="input" type="date" aria-label="Review by" style={{ width: 180 }} value={s.about.review_by ?? ""} onChange={e => up(x => { x.about.review_by = e.target.value || null; })} />
        </Field>
        </details>
        {m && <Field label="What changed (optional)"><input className="input" value={note} onChange={e => setNote(e.target.value)} placeholder="Added Qatar" /></Field>}
        {live && <Banner kind="info">Saving makes version {m.latest_version === m.live_version ? m.latest_version + 1 : m.latest_version} a draft; version {m.live_version} keeps running until a Risk Manager approves the new one.</Banner>}
        <div className="row wrap savebar">
          <button className="btn" type="button" disabled={busy} onClick={() => save(false)}>{live ? "Save as the next version" : "Save draft"}</button>
          <button className="btn btn--primary" type="button" disabled={busy} onClick={() => save(true)}>Save and submit for approval</button>
        </div>
      </div>
    </form>
  );
}

function Approval({ m, onChange }: { m: Monitor; onChange: () => void }) {
  const pending = m.pending;
  const diff = pending && m.live_spec ? changed(m.live_spec, m.spec) : [];
  const latest = m.versions[m.versions.length - 1];
  let text: ReactNode;
  if (m.status === "retired") text = "Retired: not checked.";
  else if (pending?.status === "submitted") text = <>Version {pending.version} was submitted by {latest.submitted_by} {latest.submitted_at ? dayTime(latest.submitted_at) : ""}. Version {m.live_version} keeps running until it is approved.</>;
  else if (m.status === "submitted") text = <>Submitted by {latest.submitted_by} {latest.submitted_at ? dayTime(latest.submitted_at) : ""}. Any Risk Manager can approve it; it goes live on the next tick.</>;
  else if (pending) text = <>Version {pending.version} is a draft. Submit it when ready; version {m.live_version} keeps running.</>;
  else if (m.status === "live") text = <>Version {m.live_version} is live{latest.approved_by ? `, approved by ${latest.approved_by}` : ""}.</>;
  else if (m.status === "paused") text = "Paused: not checked until resumed.";
  else text = "Drafts don't run on the schedule. Run a test to see what it would find (the findings go to the sandbox), then submit it.";
  const sentBack = latest.status === "draft" && latest.note && latest.submitted_at;
  // approval only matters while a version waits for it (or before the first one runs); a live monitor shows its status
  const approving = !!pending || m.status === "draft" || m.status === "submitted";
  return (
    <div className="card"><div className="hd"><h2>{approving ? "Approval" : "Status"}</h2></div><div className="bd col" style={{ gap: 8 }}>
      <p className="small" style={{ margin: 0 }}>{text}</p>
      {sentBack && <div className="note"><b>Changes requested:</b> {latest.note}</div>}
      {diff.length > 0 && <div className="note">Changes from version {m.live_version}: {diff.join(", ")}.</div>}
      <MonitorActions m={m} onChange={onChange} />
      {approving && <p className="small muted" style={{ margin: 0 }}>Prototype simplification: the person who submitted a version can also approve it. In production a second Risk Manager approves. Who submitted and who approved each version is recorded.</p>}
    </div></div>
  );
}

function Checks({ m, runs, onRun, running }: { m: Monitor; runs: CheckRow[]; onRun: () => void; running: boolean }) {
  const now = useNow(30_000);
  const live = m.status === "live";
  return (
    <div className="card"><div className="hd"><h2>Checks</h2><span className="spacer" />
      {m.status !== "retired" && <button className="btn btn--sm" type="button" disabled={running} onClick={onRun}
        title={live ? "Check the live version now" : "Test the latest version now; its findings go to the sandbox"}>
        <Icon name="play" />{running ? "Checking…" : live ? "Run now" : "Run a test"}</button>}</div>
      {!runs.length ? <div className="bd small muted">No checks yet.{live && m.next_check_at ? ` The first is due ${when(m.next_check_at, now)}.` : ""}</div> : (
        <div className="list">{runs.map((r, i) => {
          const same = r.status === "failed" && i > 0 && runs[i - 1].status === "failed" && runs[i - 1].error === r.error;  // the same problem again
          return (
          <div key={r.run_id} className="li"><div className="col" style={{ gap: 3, minWidth: 0 }}>
            <span className="small"><b>{dayTime(r.created_at)}</b> · {r.status === "running" ? <span className="badge b-info">RUNNING</span>
              : r.status === "failed" ? <span className="badge b-error">ERROR</span>
              : r.findings ? <span className="badge b-ok">FIRED · {r.findings}</span> : <span className="badge b-noeffect">QUIET</span>}
              {r.world === "sandbox" && <span className="badge b-info" style={{ marginLeft: 6 }}>TEST</span>}
              <span className="muted"> · v{r.version}{r.trigger === "now" ? " · run now" : ""}</span></span>
            <span className="small muted">News since {dayTime(r.window_since)}{r.coverage ? ` · ${r.coverage.web_queries} searches, ${r.coverage.pages_seen} pages, ${r.coverage.pages_in_window} in the window${r.coverage.already_reported ? `, ${r.coverage.already_reported} already reported` : ""}` : ""}</span>
            {r.summary && <span className="small">{r.summary}</span>}
            {r.error && (same ? <span className="small muted">Same problem as the check above.</span>
              : <><span className="small">{plainError(r.error)} It tries again within the hour; nothing is lost.</span>
                <details className="small"><summary>Technical details</summary><div className="rawerr">{r.error}</div></details></>)}
          </div></div>); })}</div>
      )}
    </div>
  );
}

function Findings({ items }: { items: MonitorFinding[] }) {
  if (!items.length) return null;
  return (
    <div className="card"><div className="hd"><h2>What it found</h2></div>
      <div className="list">{items.map(f => (
        <div key={f.finding_id} className="li"><div className="col" style={{ gap: 4, minWidth: 0 }}>
          <div className="row wrap" style={{ gap: 6 }}>
            <span className="strong">{f.title}</span>
            {f.world === "sandbox" && <span className="badge b-info">TEST</span>}
          </div>
          <span className="small muted">{dayTime(f.created_at)} · score {f.score}{f.places.length ? ` · ${f.places.join(", ")}` : ""}</span>
          {f.source_ref.line_texts.length > 0 && <span className="small">Met: {f.source_ref.line_texts.map(t => `“${t}”`).join("; ")}</span>}
          <span className="small">{f.explanation}</span>
          <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
            {f.evidence.headlines.map(h => <li key={h.url ?? h.title}>{h.url ? <a href={h.url} target="_blank" rel="noreferrer">{h.title}</a> : h.title}
              <span className="muted"> · {h.outlet ?? ""} {dayTime(h.published_at)}</span></li>)}
            {f.evidence.web.map(w => <li key={w.url}><a href={w.url} target="_blank" rel="noreferrer">{w.title ?? w.url}</a> <span className="muted">(undated)</span></li>)}
          </ul>
          <span className="small">{f.outcome?.event_id ? <>→ in the event <Link to={`/events/${f.outcome.event_id}`}>{f.outcome.event_id}</Link></>
            : f.status === "new" ? <span className="muted">Waiting for the investigation.</span>
            : f.outcome?.reason ? <span className="muted">Set aside: {f.outcome.note ?? f.outcome.reason}</span> : <span className="muted">{f.status}</span>}</span>
        </div></div>))}</div>
    </div>
  );
}

export function MonitorPage() {
  const { id = "new" } = useParams();
  const isNew = id === "new";
  const toast = useToast();
  const now = useNow(30_000);
  const { status } = useMonitorsStatus();
  const [m, setM] = useState<Monitor | null>(null);
  const [runs, setRuns] = useState<CheckRow[]>([]);
  const [findings, setFindings] = useState<MonitorFinding[]>([]);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [checking, setChecking] = useState<string | null>(null);
  const [formKey, setFormKey] = useState(0);
  const [drafting, setDrafting] = useState(false);

  const owner = m?.institution_id;
  useEffect(() => {  // the exposure chips come from the monitor's own institution (the installation's for a new one)
    if (!isNew && !owner) return;
    (owner ? Promise.resolve(owner) : api<Installation>("/api/v1/installation").then(i => (i.profile ? i.institution_id : null)))
      .then(id => (id ? inst.profile(id).then(setProfile) : null)).catch(() => {});
  }, [owner, isNew]);
  const load = useCallback(async () => {
    if (isNew) return;
    try {
      const [mm, r, f] = await Promise.all([monitorsApi.get(id), monitorsApi.runs(id), monitorsApi.findings(id)]);
      setM(mm); setRuns(r); setFindings(f); setErr(null);
    } catch (e) { setErr(e instanceof ApiError ? e.full : String(e)); }
  }, [id, isNew]);
  useEffect(() => { setM(null); load(); }, [load]);

  // A check started here is asked for its status until it finishes (the server asks the agent).
  useEffect(() => {
    const running = checking ?? runs.find(r => r.status === "running")?.run_id;
    if (!running) return;
    const t = setInterval(async () => {
      try {
        const r = await monitorsApi.check(running);
        if (r.status !== "running") {
          setChecking(null); await load();
          if (checking) toast(r.status === "failed" ? "The check failed: see Checks" : r.findings ? `Found ${r.findings}` : "Nothing new");
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
  const saved = (x: Monitor) => { setM(x); setFormKey(k => k + 1); load(); };

  if (!isNew && !m) return <div className="page">{err ? <Banner kind="crit" icon="warn">{err}</Banner> : <PageSkeleton bare />}</div>;
  const sub = m ? <><StatusBadge status={m.status} /> · version {m.live_version ?? m.latest_version}{m.pending ? ` (version ${m.pending.version} ${m.pending.status === "submitted" ? "waiting for approval" : "being edited"})` : ""} · every {EVERY[m.spec.about.check_frequency]} · owner {m.spec.about.owner}
    {m.last_check ? ` · last check ${ago(m.last_check.at, now)}` : ""}{ORIGIN[m.origin] ? ` · ${ORIGIN[m.origin]}` : ""}</>
    : "Describe what to watch for in plain words. It runs after a Risk Manager approves it.";
  return (
    <div className="page">
      <PageHead title={m ? m.spec.about.name || m.monitor_id : "New monitor"} sub={sub}
        crumbs={<><Link to="/monitors">Monitors</Link> / {m ? m.name : "New monitor"}</>}
        actions={isNew ? <button className="btn" type="button" onClick={() => setDrafting(true)}><Icon name="bank" />Draft from the profile</button> : undefined} />
      <div className="banners">{err && <Banner kind="crit" icon="warn">{err}</Banner>}<MonitorBanners status={status} /></div>
      {m && m.drafted_fields.length > 0 && <Banner kind="info">Drafted by code from your profile ({m.origin_ref?.section} · {m.origin_ref?.item_id}). Fields marked DRAFTED are a start: check them before you submit.</Banner>}
      <div className="split mt12">
        <MonitorForm key={`${m?.monitor_id ?? "new"}-${formKey}`} m={m} profile={profile} status={status} onSaved={saved} />
        {m && <div className="col gap16">
          <Approval m={m} onChange={load} />
          <Checks m={m} runs={runs} onRun={runNow} running={!!checking} />
          <Findings items={findings} />
          <div className="card"><div className="hd"><h2>Versions</h2></div><div className="list">{[...m.versions].reverse().map(v => (
            <div key={v.version} className="li"><div className="col" style={{ gap: 2 }}>
              <span className="small"><b>Version {v.version}</b> · {v.status}{v.version === m.live_version ? " · running" : ""}</span>
              <span className="small muted">by {v.created_by} {dayTime(v.created_at)}{v.approved_by ? ` · approved by ${v.approved_by}` : ""}</span>
              {v.note && <span className="small">{v.note}</span>}
            </div></div>))}</div></div>
        </div>}
      </div>
      {drafting && <DraftFromProfile onClose={() => setDrafting(false)} />}
    </div>
  );
}
