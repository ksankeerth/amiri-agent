// The Scenario Studio: start from a template or write your own, edit the headlines, and run it.
import { useCallback, useEffect, useId, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ApiError } from "../../api/client";
import { studioApi, type Custom, type HeadlineIn, type Mode, type PriceMove, type Scenario, type ScenarioRow, type Simulation, type Template } from "../../api/studio";
import { FillFromJson } from "../../components/FillFromJson";
import { scenariosOf } from "../../components/fillJson";
import { Icon } from "../../components/Icon";
import { Fold, GoLink, PageTitle, Section, TextButton, ToneMark, TONE_WORD } from "../../components/rd";
import { LoadError, Modal, PageSkeleton, useToast } from "../../components/ui";
import { day, dayTime, plural } from "../../format";
import "../../styles/rd-studio.css";

const TAG: Record<string, string> = { fx: "currency" };  // a template's tags in words

/** The three ways to run one: [mode, label, what it does]. Replay is filled once there is a recording to replay. */
const MODES: Record<Mode, [string, string]> = {
  replay: ["Replay (instant, no AI calls)", "No agent is called: the answers saved from an earlier run come back, so it plays in seconds and the same every time."],
  live: ["Run with the live agents", "The agents read the scenario as it happens. Takes a few minutes."],
  record: ["Run live and save it for replay", "As the live run, and keeps every agent answer so the run can be replayed exactly."],
};
const DAYS = 21;

export function useStart() {
  const nav = useNavigate();
  const toast = useToast();
  return async (scenario_id: string, mode: Mode) => {
    try { const s = await studioApi.start(scenario_id, mode); nav(`/studio/run/${s.sim_id}`); }
    catch (e) { toast(e instanceof ApiError ? e.full : String(e)); }
  };
}

/** A run that's going: one line, and the way into it. One simulation runs at a time. */
function CurrentLine({ sim, scenarioOnly }: { sim: Simulation | null; scenarioOnly?: string }) {
  if (!sim) return null;
  return <p className="rds-line"><span className="rds-grow"><b>{sim.title}</b> is running{scenarioOnly ? "" : ` for ${sim.institution.name}`}: day {sim.step} of {sim.steps}. One simulation runs at a time.</span>
    <GoLink to={`/studio/run/${sim.sim_id}`}>Open it</GoLink></p>;
}

/** Coming back to a scenario: its latest run, one click away (the full list stays in Runs, lower down). */
function LastRunLine({ m }: { m: Scenario["simulations"][number] }) {
  const how = m.mode === "replay" ? "replay" : m.mode === "record" ? "live, saved" : "live";
  const where = m.status === "completed" || m.status === "finished" ? "finished" : m.status === "stopped" ? `stopped on day ${m.step} of ${m.steps}` : `${m.status.replace(/_/g, " ")}, day ${m.step} of ${m.steps}`;
  return <p className="rds-line"><span className="rds-grow">Your last run ({how} · {dayTime(m.created_at)}) {where}. Its findings, events and alerts are still there.</span>
    <GoLink to={`/studio/run/${m.sim_id}`}>Open the run</GoLink></p>;
}

/** A name for a scenario you write yourself. */
function NewOwnModal({ onClose }: { onClose: () => void }) {
  const nav = useNavigate();
  const toast = useToast();
  const [title, setTitle] = useState("");
  const [custom, setCustom] = useState<Custom>({ headlines: [], prices: { direction: "none", size_pct: 0, ramp_days: 5 } });
  const [busy, setBusy] = useState(false);
  // a file's scenario fills the form: its name, its headlines and its price move (checked by the server when it is created)
  const fillFrom = (x: Record<string, any>) => {
    const c = (x.custom && typeof x.custom === "object" ? x.custom : x) as Record<string, any>;
    const heads: HeadlineIn[] = (Array.isArray(c.headlines) ? c.headlines : []).filter((h: any) => h && typeof h.title === "string")
      .map((h: any, i: number) => ({ id: typeof h.id === "string" && h.id ? h.id : `h${i + 1}`, title: h.title, day: Number(h.day) || 1, time: typeof h.time === "string" ? h.time : "09:00" }));
    const p = c.prices && typeof c.prices === "object" ? c.prices : {};
    setTitle(typeof x.title === "string" ? x.title.slice(0, 120) : title);
    setCustom({ headlines: heads, prices: { direction: ["weaker", "stronger"].includes(p.direction) ? p.direction : "none",
      size_pct: Number(p.size_pct) || 0, ramp_days: Number(p.ramp_days) || 5 } });
  };
  const go = async () => {
    setBusy(true);
    try {
      const s = await studioApi.create("blank", { title: title.trim(), custom });
      nav(`/studio/${s.scenario_id}?new=1`);
    } catch (e) { toast(e instanceof ApiError ? e.full : String(e)); setBusy(false); }
  };
  const n = custom.headlines?.length ?? 0, p = custom.prices;
  return (
    <Modal title="Write your own scenario" onClose={onClose} footer={<>
      <button className="btn" type="button" onClick={onClose}>Cancel</button>
      <button className="btn btn--primary" type="button" disabled={busy || !title.trim()} onClick={go}>Create</button></>}>
      <p style={{ margin: 0 }}>Name it, then write the headlines that arrive day by day and, if you like, how the exchange rate moves. Amiri Agent's monitor reads your headlines and the investigation traces them to your products.</p>
      <FillFromJson what="a scenario" read={scenariosOf} onFill={c => fillFrom(c.data)}
        example={'{"title": "…", "headlines": [{"title": "…", "day": 1, "time": "09:00"}], "prices": {"direction": "weaker", "size_pct": 5, "ramp_days": 4}}'} />
      <label className="field"><span>Name</span>
        <input className="input" value={title} maxLength={120} placeholder="e.g. Port strike" onChange={e => setTitle(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter" && title.trim()) go(); }} /></label>
      {(n > 0 || (p && p.direction !== "none")) && <p className="small muted" style={{ margin: 0 }}>
        {n > 0 ? plural(n, "headline") : "No headlines"}{p && p.direction !== "none" ? `, and the rate moves ${p.size_pct}% ${p.direction} over ${p.ramp_days} days` : ""}: you can change them on the next page.</p>}
    </Modal>
  );
}

// ---------------------------------------------------------------- the list

export function StudioPage() {
  const nav = useNavigate();
  const toast = useToast();
  const start = useStart();
  const [templates, setTemplates] = useState<Template[] | null>(null);
  const [items, setItems] = useState<ScenarioRow[] | null>(null);
  const [current, setCurrent] = useState<Simulation | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const [own, setOwn] = useState(false);
  const [help, setHelp] = useState(false);
  const helpId = useId();
  const load = () => Promise.all([studioApi.templates(), studioApi.scenarios(), studioApi.current()])
    .then(([t, s, c]) => { setTemplates(t); setItems(s); setCurrent(c); setErr(null); })
    .catch(setErr);
  useEffect(() => { load(); }, []);
  const create = async (t: Template) => {
    if (t.template_id === "blank") { setOwn(true); return; }
    try { const s = await studioApi.create(t.template_id); nav(`/studio/${s.scenario_id}`); }
    catch (e) { toast(e instanceof ApiError ? e.full : String(e)); }
  };
  const ready = (items ?? []).find(s => s.recorded);
  // one filled button per view: "Replay it" when there is a recording, otherwise the first template
  const lead = ready && !current ? null : (templates ?? []).find(t => t.template_id !== "blank" && !t.unavailable)?.template_id;
  return (
    <div className="page rd rd-studio">
      <PageTitle title="Scenario Studio"
        lede={<>Try a what-if on your institution. Nothing touches your live data.
          <TextButton aria-expanded={help} aria-controls={helpId} onClick={() => setHelp(h => !h)}>How this works</TextButton></>}
        help={<p id={helpId} className="rd-prose rds-help" hidden={!help}>A scenario plays out in a sandbox: headlines arrive and prices move, and Amiri Agent's monitors, market series and investigation respond as they would for real. You see the events it traces and the alerts each team would get.</p>} />
      {err != null && templates === null ? <LoadError error={err} onRetry={load} what="the Scenario Studio" /> : <>
      <CurrentLine sim={current} />
      {ready && !current && <Section title="Watch it work">
        <div className="rds-tpl rd-row" style={{ borderBottom: 0 }}>
          <div className="rds-main"><div className="rd-row-t">{ready.title}, in under a minute</div>
            <div className="rd-row-d rd-prose">A recorded run replays instantly: three weeks of headlines and prices, the events Amiri Agent traces to your products, and the alerts each team would get.</div></div>
          <div className="rds-act"><button className="btn btn--primary btn--lg" type="button" onClick={() => start(ready.scenario_id, "replay")}><Icon name="play" />Replay it</button></div>
        </div></Section>}
      <Section title="Start a scenario">
        {(templates ?? []).map(t => (
          <div key={t.template_id} className="rds-tpl rd-row">
            <div className="rds-main"><div className="rd-row-t">{t.title}</div>
              <div className="rd-row-d rd-prose">{t.summary}</div>
              {t.tags.length > 0 && <div className="rd-row-m">{t.tags.map(x => TAG[x] ?? x).join(" · ")}</div>}</div>
            <div className="rds-act">{t.unavailable ? <span className="rd-fine">Can't run here: {t.unavailable}.</span>
              : <button className={`btn ${t.template_id === lead ? "btn--primary" : ""}`} type="button" onClick={() => create(t)}>
                {t.template_id === "blank" ? "Write your own" : "Use this template"}</button>}</div>
          </div>))}
      </Section>
      <Section title="Your scenarios" count={items?.length ? items.length : undefined}>
        {items === null ? <p className="rd-row-d rds-empty">…</p> : !items.length
          ? <p className="rd-row-d rds-empty rd-prose">No scenarios yet. Start one above: from the template, or your own headlines.</p> : (
          <table className="rd-table rds-table">
            <thead><tr><th>Scenario</th><th>Headlines</th><th>Replay</th><th>Last run</th><th><span className="sr">Actions</span></th></tr></thead>
            <tbody>{items.map(s => {
              const running = current?.scenario_id === s.scenario_id;
              return (
                <tr key={s.scenario_id} className="rds-click" onClick={() => nav(`/studio/${s.scenario_id}`)}>
                  <td className="rd-strong"><Link className="rd-name" to={`/studio/${s.scenario_id}`} onClick={e => e.stopPropagation()}>{s.title}</Link>
                    <div className="rds-sub">{s.template_id === "blank" ? "your own" : "from a template"} · made {dayTime(s.created_at)}</div></td>
                  <td>{s.template_id === "blank" ? "written by you" : s.custom?.headlines ? "edited" : "as written"}</td>
                  <td>{s.recorded ? "Ready to replay" : <span className="rd-fine">not recorded yet</span>}</td>
                  <td>{running ? "running now" : s.last_run ? dayTime(s.last_run) : "never"}</td>
                  <td onClick={e => e.stopPropagation()}><span className="rds-acts">
                    {running && current ? <GoLink to={`/studio/run/${current.sim_id}`}>Open</GoLink> : <>
                      <button className="btn" type="button" disabled={!!current} onClick={() => start(s.scenario_id, s.recorded ? "replay" : "live")}>
                        <Icon name="play" />{s.recorded ? "Replay" : "Run"}</button>
                      {s.recorded && <TextButton disabled={!!current} onClick={() => start(s.scenario_id, "live")}>Run live</TextButton>}</>}
                  </span></td>
                </tr>);
            })}</tbody>
          </table>)}
      </Section></>}
      {own && <NewOwnModal onClose={() => setOwn(false)} />}
    </div>
  );
}

// ---------------------------------------------------------------- one scenario

const newId = () => `c-${Math.random().toString(36).slice(2, 8)}`;

/** One headline, written or edited in place. */
function HeadlineForm({ value, dayLabel, onSave, onCancel }: {
  value: HeadlineIn; dayLabel: (d: number) => string; onSave: (h: HeadlineIn) => void; onCancel: () => void;
}) {
  const [h, setH] = useState(value);
  const ok = h.title.trim().length >= 8;
  return (
    <div className="rds-form">
      <label className="field"><span>Headline</span>
        <textarea className="input" rows={2} autoFocus maxLength={200} value={h.title} placeholder="e.g. Dockworkers at the main port strike for a week"
          onChange={e => setH({ ...h, title: e.target.value })} /></label>
      <div className="rds-frow">
        <label className="field" style={{ width: 200 }}><span>Published on</span>
          <select className="input" value={h.day} onChange={e => setH({ ...h, day: Number(e.target.value) })}>
            {Array.from({ length: DAYS }, (_, i) => i + 1).map(d => <option key={d} value={d}>Day {d} · {dayLabel(d)}</option>)}</select></label>
        <label className="field" style={{ width: 130 }}><span>At</span>
          <input className="input" type="time" value={h.time} onChange={e => setH({ ...h, time: e.target.value || "09:00" })} /></label>
        <span className="rds-grow" />
        <TextButton onClick={onCancel}>Cancel</TextButton>
        <button className="btn" type="button" disabled={!ok} onClick={() => onSave({ ...h, title: h.title.trim() })}>Save headline</button>
      </div>
      {!ok && h.title.length > 0 && <p className="rd-fine" style={{ margin: "8px 0 0" }}>A headline needs at least 8 characters.</p>}
    </div>
  );
}

function Headlines({ s, save, startOpen, own }: { s: Scenario; save: (body: { custom?: Custom; switched_off?: string[] }) => Promise<void>; startOpen: boolean; own: boolean }) {
  const b = s.built;
  const all = b.all_headlines;
  const off = new Set(s.switched_off);
  const [editing, setEditing] = useState<string | null>(startOpen && !all.length ? "new" : null);
  const fmt = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: b.institution.time_zone });
  const dayLabel = (d: number) => fmt.format(new Date(new Date(b.clock.start_at).getTime() + (d - 1) * 86400_000 + 12 * 3600_000));
  const list = (): HeadlineIn[] => all.map(h => ({ id: h.id, title: h.title, day: h.day, time: h.time }));
  const put = async (next: HeadlineIn[]) => { await save({ custom: { headlines: next } }); setEditing(null); };
  const upsert = (h: HeadlineIn) => put(editing === "new" ? [...list(), h] : list().map(x => (x.id === h.id ? h : x)));
  const remove = (id: string) => put(list().filter(x => x.id !== id));
  const toggle = (id: string) => save({ switched_off: off.has(id) ? s.switched_off.filter(x => x !== id) : [...s.switched_off, id] });
  const inRun = all.length - all.filter(h => off.has(h.id)).length;
  return (
    <Section title="Headlines" meta={plural(inRun, "headline") + " in the run"}
      action={editing !== "new" && all.length < 30 ? <TextButton onClick={() => setEditing("new")}>+ Add</TextButton> : undefined}>
      <p className="rd-fine rds-fine">{own ? "Your headlines are marked simulated and never reach the live pages. Amiri Agent's monitor reads each one on its day; the investigation traces what it finds to your products."
        : "Written for this scenario and marked simulated: you can edit, add or remove them. Their figures come from the price path. Sizes are illustrative."}</p>
      {!all.length && editing !== "new" && <p className="rd-row-d rd-prose" style={{ margin: "12px 0" }}>No headlines yet. Write what happens and on which day: Amiri Agent's monitor reads each headline the day it is published.{" "}
        <TextButton onClick={() => setEditing("new")}>Write the first headline</TextButton></p>}
      {all.map(h => editing === h.id
        ? <HeadlineForm key={h.id} value={{ id: h.id, title: h.title, day: h.day, time: h.time }} dayLabel={dayLabel} onSave={upsert} onCancel={() => setEditing(null)} />
        : (
          <div key={h.id} className={`rds-head ${off.has(h.id) ? "rds-off" : ""}`}>
            <label className="rds-pick">{/* the whole headline is the checkbox's target, not 22 px of it */}
              <input type="checkbox" checked={!off.has(h.id)} onChange={() => toggle(h.id)} aria-label={`Include: ${h.title}`} />
              <span style={{ flex: 1, minWidth: 0 }}>
                <span className="rd-fine">Day {h.day} · {dayLabel(h.day)} {h.time}{off.has(h.id) ? " · switched off" : ""}{h.story === "custom" && b.template_id !== "blank" ? " · added by you" : ""}</span>
                <span className="rds-ht">{h.title}</span>
              </span>
            </label>
            <span className="rds-acts">
              <TextButton onClick={() => setEditing(h.id)} title={`Edit: ${h.title}`}>Edit</TextButton>
              <TextButton onClick={() => remove(h.id)} title={`Remove: ${h.title}`}>Remove</TextButton></span>
          </div>))}
      {editing === "new" && <HeadlineForm value={{ id: newId(), title: "", day: Math.min(DAYS, (all[all.length - 1]?.day ?? 0) + 1), time: "09:00" }}
        dayLabel={dayLabel} onSave={upsert} onCancel={() => setEditing(null)} />}
    </Section>
  );
}

function PriceMoveForm({ s, save }: { s: Scenario; save: (body: { custom?: Custom }) => Promise<void> }) {
  const cur = s.built.institution.currency === "USD" ? "US dollar" : s.built.institution.currency;
  const [m, setM] = useState<PriceMove>(s.built.prices.move ?? { direction: "none", size_pct: 0, ramp_days: 5 });
  const saved = JSON.stringify(s.built.prices.move ?? {}) === JSON.stringify(m);
  return (
    <div style={{ display: "grid", gap: 12 }}>
      <label className="field"><span>Exchange rate</span>
        <select className="input" value={m.direction} onChange={e => setM({ ...m, direction: e.target.value as PriceMove["direction"], size_pct: m.size_pct || 5 })}>
          <option value="none">No price move</option>
          <option value="weaker">The {cur} weakens against the US dollar</option>
          <option value="stronger">The {cur} strengthens against the US dollar</option></select></label>
      {m.direction !== "none" && <div style={{ display: "flex", gap: 12 }}>
        <label className="field" style={{ flex: 1 }}><span>By (%)</span>
          <input className="input" type="number" min={0.5} max={30} step={0.5} value={m.size_pct} onChange={e => setM({ ...m, size_pct: Number(e.target.value) })} /></label>
        <label className="field" style={{ flex: 1 }}><span>Over (business days)</span>
          <input className="input" type="number" min={1} max={15} value={m.ramp_days} onChange={e => setM({ ...m, ramp_days: Number(e.target.value) })} /></label>
      </div>}
      {!saved && <button className="btn" type="button" style={{ justifySelf: "start" }}
        disabled={m.direction !== "none" && !(m.size_pct >= 0.5 && m.size_pct <= 30 && m.ramp_days >= 1 && m.ramp_days <= 15)}
        onClick={() => save({ custom: { prices: m } })}>Save the price move</button>}
    </div>
  );
}

export function ScenarioPage() {
  const { id = "" } = useParams();
  const nav = useNavigate();
  const toast = useToast();
  const start = useStart();
  const [s, setS] = useState<Scenario | null>(null);
  const [current, setCurrent] = useState<Simulation | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const [asking, setAsking] = useState(false);
  const [naming, setNaming] = useState<string | null>(null);
  const fresh = new URLSearchParams(window.location.search).has("new");
  const load = useCallback(() => Promise.all([studioApi.scenario(id), studioApi.current()])
    .then(([x, c]) => { setS(x); setCurrent(c); setErr(null); })
    .catch(setErr), [id]);
  useEffect(() => { load(); }, [load]);
  if (!s) return <div className="page rd rd-studio">{err != null ? <><PageTitle title="Scenario" crumbs={<Link to="/studio">Scenario Studio</Link>} /><LoadError error={err} onRetry={load} what="this scenario" /></> : <PageSkeleton bare />}</div>;
  const b = s.built;
  const own = b.template_id === "blank";
  const save = async (body: { intensity?: string; switched_off?: string[]; title?: string; custom?: Custom }) => {
    try { setS(await studioApi.update(id, body)); } catch (e) { toast(e instanceof ApiError ? e.full : String(e)); }
  };
  const off = new Set(s.switched_off);
  const toggle = (key: string) => save({ switched_off: off.has(key) ? s.switched_off.filter(x => x !== key) : [...s.switched_off, key] });
  const rec = s.recording;
  const empty = !b.headlines.length && (b.prices.off ?? true);
  const replayable = !!(rec?.complete && rec.current);
  const rename = () => { if (naming?.trim()) { save({ title: naming.trim() }); setNaming(null); } };
  // replay leads once there is a recording (the safe demo path); otherwise the live run does
  const order: Mode[] = replayable ? ["replay", "live", "record"] : ["live", "record", "replay"];
  const lead: Mode = replayable ? "replay" : "live";
  return (
    <div className="page rd rd-studio">
      <PageTitle title={naming !== null
          ? <input className="input rds-name-in" aria-label="Scenario name" autoFocus value={naming} maxLength={120}
              onChange={e => setNaming(e.target.value)} onKeyDown={e => { if (e.key === "Enter") rename(); if (e.key === "Escape") setNaming(null); }} />
          : s.title}
        crumbs={<><Link to="/studio">Scenario Studio</Link> / {s.title}</>}
        status={<>For {b.institution.name} · {b.prices.symbol} · starts {day(b.clock.start_at)} · {b.clock.steps} days, one a step{own ? " · your own scenario" : ""}</>}
        actions={<>
          {naming !== null ? <><button className="btn" type="button" disabled={!naming.trim()} onClick={rename}>Save</button><TextButton onClick={() => setNaming(null)}>Cancel</TextButton></>
            : <TextButton onClick={() => setNaming(s.title)}>Rename</TextButton>}
          {asking ? <span className="rds-quiet" style={{ margin: 0 }}><span>Delete this scenario and its runs?</span>
            <TextButton onClick={async () => { try { await studioApi.remove(id); nav("/studio"); } catch (e) { toast(e instanceof ApiError ? e.full : String(e)); } }}><span className="rds-danger">Delete</span></TextButton>
            <TextButton onClick={() => setAsking(false)}>Keep it</TextButton></span>
            : <TextButton onClick={() => setAsking(true)}>Delete</TextButton>}</>} />
      {err != null && <LoadError error={err} onRetry={load} what="this scenario" />}
      <CurrentLine sim={current} scenarioOnly={id} />
      {!current && s.simulations[0] && <LastRunLine m={s.simulations[0]} />}
      <div className="rds-cols">
        <div><Headlines s={s} save={save} startOpen={fresh} own={own} /></div>
        <div>
          <Section title="Run it">
            <div className="rds-runit">
              {own ? <PriceMoveForm key={s.version} s={s} save={save} /> : <>
                <label className="field"><span>How hard the shock hits</span>
                  <select className="input" value={s.intensity} onChange={e => save({ intensity: e.target.value })}>
                    <option value="low">Low (×0.5)</option><option value="medium">Medium</option><option value="high">High (×1.5)</option></select></label>
                <label className="rds-check"><input type="checkbox" checked={!off.has("prices")} onChange={() => toggle("prices")} /><span>Move {b.prices.symbol} ({b.prices.shock.size_pct.toFixed(1)}% over {b.prices.shock.ramp_business_days} business days)</span></label>
              </>}
            </div>
            {empty && <p className="rd-warn" style={{ margin: "12px 0 0" }}><span className="rd-shape rd-t-mixed" aria-hidden="true">◆</span> Add a headline or a price move to run it.</p>}
            <div className="rds-modes">
              {order.map(m => {
                const [label, help] = MODES[m];
                const missing = m === "replay" && !replayable;
                return <button key={m} className={`btn ${m === lead ? "btn--primary" : ""}`} type="button" title={missing ? undefined : help}
                  disabled={!!current || empty || missing} onClick={() => start(id, m)}>
                  {missing ? "Replay: not recorded yet" : <><Icon name="play" />{label}</>}</button>;
              })}
            </div>
            <p className="rd-fine" style={{ margin: "10px 0 0" }}>{rec ? (rec.current ? (rec.complete ? `Recorded ${dayTime(rec.recorded_at)}.` : "A recording was started but didn't finish.")
              : "Changed since it was recorded: run it live and save it to replay again.") : "Not recorded yet: run it live and save it, then it replays instantly."}
              {current ? " Another run is going, so nothing can start until it ends." : ""}</p>
          </Section>
          {!own && <Section title="Should find" meta={plural(b.stories.length, "story", "stories")}>
            {b.stories.map(st => (
              <div key={st.key} className="rds-find"><span><ToneMark tone={st.tone} label={TONE_WORD[st.tone]} />{st.label}</span>
                {!st.expected && <span className="rd-fine">not expected: its headlines are out</span>}</div>))}
          </Section>}
        </div>
      </div>
      <div className="rds-folds">
        <Fold title="The monitor it runs" summary={b.monitor.spec.about.name} remember="studio-monitor">
          <p className="rds-fold-p">{b.monitor.spec.public.in_one_sentence}</p>
          <ul>{b.monitor.spec.public.tell_me_if.map(l => <li key={l}>{l}</li>)}</ul>
          <p className="rd-fine" style={{ margin: "8px 0 0" }}>It reads the scenario's headlines, not the web.</p>
        </Fold>
        {s.simulations.length > 0 && <Fold title="Runs" summary={plural(s.simulations.length, "run")} remember="studio-runs">
          <ul className="rds-runs">{s.simulations.map(m => (
            <li key={m.sim_id}><Link className="rd-name" to={`/studio/run/${m.sim_id}`}>{dayTime(m.created_at)} · {m.mode === "replay" ? "replay" : m.mode === "record" ? "live, saved" : "live"} · {m.status} · day {m.step} of {m.steps}</Link></li>))}</ul>
        </Fold>}
      </div>
    </div>
  );
}
