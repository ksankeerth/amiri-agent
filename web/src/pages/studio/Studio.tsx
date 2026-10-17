// The Scenario Studio: start from a template or write your own, edit the headlines, and run it.
import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ApiError } from "../../api/client";
import { studioApi, type Custom, type HeadlineIn, type Mode, type PriceMove, type Scenario, type ScenarioRow, type Simulation, type Template } from "../../api/studio";
import { FillFromJson } from "../../components/FillFromJson";
import { scenariosOf } from "../../components/fillJson";
import { Icon } from "../../components/Icon";
import { HowItWorks, PageHeader, TonePill } from "../../components/blocks";
import { Banner, Empty, Modal, PageHead, PageSkeleton, useToast } from "../../components/ui";
import { dayTime, plural } from "../../format";

const TAG: Record<string, string> = { fx: "currency" };  // a template's tags in words

const MODES: [Mode, string, string][] = [
  ["replay", "Replay (instant, no agents)", "No agent is called: the answers saved from an earlier run come back, so it plays in seconds and the same every time."],
  ["live", "Run with the live agents", "The agents read the scenario as it happens. Takes a few minutes."],
  ["record", "Run live and save for replay", "As the live run, and keeps every agent answer so the run can be replayed exactly."],
];
const DAYS = 21;

export function useStart() {
  const nav = useNavigate();
  const toast = useToast();
  return async (scenario_id: string, mode: Mode) => {
    try { const s = await studioApi.start(scenario_id, mode); nav(`/studio/run/${s.sim_id}`); }
    catch (e) { toast(e instanceof ApiError ? e.full : String(e)); }
  };
}

function CurrentBanner({ sim }: { sim: Simulation | null }) {
  if (!sim) return null;
  return <Banner kind="info" icon="studio" action={<Link className="btn btn--sm" to={`/studio/run/${sim.sim_id}`}>Open it</Link>}>
    <b>{sim.title}</b> is running for {sim.institution.name}: day {sim.step} of {sim.steps}. One simulation runs at a time.
  </Banner>;
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
        <input className="input" value={title} maxLength={120} placeholder="e.g. Gulf visa freeze" onChange={e => setTitle(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter" && title.trim()) go(); }} /></label>
      {(n > 0 || (p && p.direction !== "none")) && <p className="small muted" style={{ margin: 0 }}>
        {n > 0 ? plural(n, "headline") : "No headlines"}{p && p.direction !== "none" ? `, and the rate moves ${p.size_pct}% ${p.direction} over ${p.ramp_days} days` : ""}: you can change them on the next page.</p>}
    </Modal>
  );
}

export function StudioPage() {
  const nav = useNavigate();
  const toast = useToast();
  const start = useStart();
  const [templates, setTemplates] = useState<Template[] | null>(null);
  const [items, setItems] = useState<ScenarioRow[] | null>(null);
  const [current, setCurrent] = useState<Simulation | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [own, setOwn] = useState(false);
  useEffect(() => {
    Promise.all([studioApi.templates(), studioApi.scenarios(), studioApi.current()])
      .then(([t, s, c]) => { setTemplates(t); setItems(s); setCurrent(c); })
      .catch(e => setErr(e instanceof ApiError ? e.full : String(e)));
  }, []);
  const create = async (t: Template) => {
    if (t.template_id === "blank") { setOwn(true); return; }
    try { const s = await studioApi.create(t.template_id); nav(`/studio/${s.scenario_id}`); }
    catch (e) { toast(e instanceof ApiError ? e.full : String(e)); }
  };
  const ready = (items ?? []).find(s => s.recorded);
  return (
    <div className="page">
      <PageHeader title="Scenario Studio" status="Try a what-if on your institution. Nothing touches your live data."
        help={<HowItWorks><p>A scenario plays out in a sandbox: headlines arrive and prices move, and Amiri Agent's monitors, market series and investigation respond as they would for real. You see the events it traces and the alerts each team would get.</p></HowItWorks>} />
      <div className="banners">{err && <Banner kind="crit" icon="warn">{err}</Banner>}<CurrentBanner sim={current} /></div>
      {ready && !current && <div className="card st-hero">
        <div className="col" style={{ gap: 4, flex: 1, minWidth: 260 }}>
          <span className="label">Watch it work</span>
          <h2 style={{ fontSize: 19 }}>{ready.title}, in under a minute</h2>
          <span className="small muted">A recorded run replays instantly: three weeks of headlines and prices, the events Amiri Agent traces to your products, and the alerts each team would get.</span>
        </div>
        <button className="btn btn--primary btn--lg" type="button" onClick={() => start(ready.scenario_id, "replay")}><Icon name="play" />Replay it</button>
      </div>}
      <h2 className="mt24">Start a scenario</h2>
      <div className="grid3 mt12">{(templates ?? []).map(t => (
        <div key={t.template_id} className={`card st-tpl ${t.template_id === "blank" ? "own" : ""}`}><div className="bd col" style={{ gap: 8, height: "100%" }}>
          <span className="st-ico" aria-hidden="true"><Icon name={t.template_id === "blank" ? "edit" : "series"} /></span>
          <h3>{t.title}</h3>
          <p className="small muted" style={{ margin: 0, flex: 1 }}>{t.summary}</p>
          <div className="row wrap" style={{ gap: 6 }}>{t.tags.map(x => <span key={x} className="chip">{TAG[x] ?? x}</span>)}</div>
          {t.unavailable ? <span className="small muted">Can't run here: {t.unavailable}.</span>
            : <button className={`btn btn--sm ${t.template_id === "blank" ? "" : "btn--primary"}`} type="button" style={{ alignSelf: "flex-start" }} onClick={() => create(t)}>
              <Icon name="plus" />{t.template_id === "blank" ? "Write your own" : "Use this template"}</button>}
        </div></div>))}
      </div>
      <h2 className="mt24">Your scenarios</h2>
      <div className="card mt12">{items === null ? <div className="bd small muted">…</div> : !items.length ? <Empty icon="studio" title="No scenarios yet">Start one above: from the template, or your own headlines.</Empty> : (
        <div className="tblwrap"><table className="tbl">
          <thead><tr><th>Scenario</th><th>Headlines</th><th>Instant replay</th><th>Last run</th><th><span className="sr">Actions</span></th></tr></thead>
          <tbody>{items.map(s => (
            <tr key={s.scenario_id} className="click" onClick={() => nav(`/studio/${s.scenario_id}`)}>
              <td><Link className="strong" to={`/studio/${s.scenario_id}`} onClick={e => e.stopPropagation()}>{s.title}</Link>
                <div className="sub">{s.template_id === "blank" ? "your own" : "from a template"} · made {dayTime(s.created_at)}</div></td>
              <td className="small">{s.template_id === "blank" ? "written by you" : s.custom?.headlines ? "edited" : "as written"}</td>
              <td>{s.recorded ? <span className="badge b-ok">READY</span> : <span className="muted small">not saved yet</span>}</td>
              <td className="small">{s.last_run ? dayTime(s.last_run) : "never"}</td>
              <td onClick={e => e.stopPropagation()}><span className="row" style={{ gap: 6 }}>
                {s.recorded
                  ? <button className="btn btn--sm btn--primary" type="button" disabled={!!current} onClick={() => start(s.scenario_id, "replay")}><Icon name="play" />Replay</button>
                  : <button className="btn btn--sm btn--primary" type="button" disabled={!!current} onClick={() => start(s.scenario_id, "live")}><Icon name="play" />Run</button>}
                {s.recorded && <button className="btn btn--sm" type="button" disabled={!!current} onClick={() => start(s.scenario_id, "live")}>Run live</button>}
              </span></td>
            </tr>))}</tbody>
        </table></div>)}
      </div>
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
    <div className="st-form">
      <label className="field"><span>Headline</span>
        <textarea className="input" rows={2} autoFocus maxLength={200} value={h.title} placeholder="e.g. Saudi Arabia freezes new work visas for six months"
          onChange={e => setH({ ...h, title: e.target.value })} /></label>
      <div className="row wrap" style={{ gap: 10, alignItems: "flex-end" }}>
        <label className="field" style={{ width: 190 }}><span>Published on</span>
          <select className="input" value={h.day} onChange={e => setH({ ...h, day: Number(e.target.value) })}>
            {Array.from({ length: DAYS }, (_, i) => i + 1).map(d => <option key={d} value={d}>Day {d} · {dayLabel(d)}</option>)}</select></label>
        <label className="field" style={{ width: 120 }}><span>At</span>
          <input className="input" type="time" value={h.time} onChange={e => setH({ ...h, time: e.target.value || "09:00" })} /></label>
        <span className="spacer" />
        <button className="btn btn--sm" type="button" onClick={onCancel}>Cancel</button>
        <button className="btn btn--sm btn--primary" type="button" disabled={!ok} onClick={() => onSave({ ...h, title: h.title.trim() })}>Save headline</button>
      </div>
      {!ok && h.title.length > 0 && <span className="hint">A headline needs at least 8 characters.</span>}
    </div>
  );
}

function Headlines({ s, save, startOpen }: { s: Scenario; save: (body: { custom?: Custom; switched_off?: string[] }) => Promise<void>; startOpen: boolean }) {
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
  return (
    <div className="card"><div className="hd"><h2>Headlines</h2><span className="small muted">{plural(all.length - all.filter(h => off.has(h.id)).length, "headline")} in the run</span>
      <span className="spacer" />{editing !== "new" && all.length < 30 && <button className="btn btn--sm" type="button" onClick={() => setEditing("new")}><Icon name="plus" />Add a headline</button>}</div>
      {!all.length && editing !== "new" && <div className="bd"><Empty icon="edit" title="No headlines yet" actions={<button className="btn btn--primary" type="button" onClick={() => setEditing("new")}><Icon name="plus" />Write the first headline</button>}>
        Write what happens and on which day. Amiri Agent's monitor reads each headline the day it is published.</Empty></div>}
      <div className="list">{all.map(h => editing === h.id
        ? <div key={h.id} className="li"><HeadlineForm value={{ id: h.id, title: h.title, day: h.day, time: h.time }} dayLabel={dayLabel} onSave={upsert} onCancel={() => setEditing(null)} /></div>
        : (
          <div key={h.id} className={`li st-head ${off.has(h.id) ? "off" : ""}`}>
            <input type="checkbox" checked={!off.has(h.id)} onChange={() => toggle(h.id)} aria-label={`Include: ${h.title}`} />
            <div className="col" style={{ gap: 2, flex: 1, minWidth: 0 }}>
              <span className="small muted">Day {h.day} · {dayLabel(h.day)} {h.time}{h.story === "custom" && b.template_id !== "blank" ? " · added by you" : ""}</span>
              <span className="st-title">{h.title}</span>
            </div>
            <button className="btn btn--sm btn--ghost btn--icon" type="button" aria-label={`Edit: ${h.title}`} onClick={() => setEditing(h.id)}><Icon name="edit" /></button>
            <button className="btn btn--sm btn--ghost btn--icon" type="button" aria-label={`Remove: ${h.title}`} onClick={() => remove(h.id)}><Icon name="trash" /></button>
          </div>))}
        {editing === "new" && <div className="li"><HeadlineForm value={{ id: newId(), title: "", day: Math.min(DAYS, (all[all.length - 1]?.day ?? 0) + 1), time: "09:00" }}
          dayLabel={dayLabel} onSave={upsert} onCancel={() => setEditing(null)} /></div>}
      </div>
    </div>
  );
}

function PriceMoveCard({ s, save }: { s: Scenario; save: (body: { custom?: Custom }) => Promise<void> }) {
  const cur = s.built.institution.currency === "USD" ? "US dollar" : s.built.institution.currency;
  const [m, setM] = useState<PriceMove>(s.built.prices.move ?? { direction: "none", size_pct: 0, ramp_days: 5 });
  const saved = JSON.stringify(s.built.prices.move ?? {}) === JSON.stringify(m);
  return (
    <div className="col" style={{ gap: 10 }}>
      <label className="field"><span>Exchange rate</span>
        <select className="input" value={m.direction} onChange={e => setM({ ...m, direction: e.target.value as PriceMove["direction"], size_pct: m.size_pct || 5 })}>
          <option value="none">No price move</option>
          <option value="weaker">The {cur} weakens against the US dollar</option>
          <option value="stronger">The {cur} strengthens against the US dollar</option></select></label>
      {m.direction !== "none" && <div className="row" style={{ gap: 10 }}>
        <label className="field" style={{ flex: 1 }}><span>By (%)</span>
          <input className="input" type="number" min={0.5} max={30} step={0.5} value={m.size_pct} onChange={e => setM({ ...m, size_pct: Number(e.target.value) })} /></label>
        <label className="field" style={{ flex: 1 }}><span>Over (business days)</span>
          <input className="input" type="number" min={1} max={15} value={m.ramp_days} onChange={e => setM({ ...m, ramp_days: Number(e.target.value) })} /></label>
      </div>}
      {!saved && <button className="btn btn--sm" type="button" style={{ alignSelf: "flex-start" }}
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
  const [err, setErr] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const [naming, setNaming] = useState<string | null>(null);
  const fresh = new URLSearchParams(window.location.search).has("new");
  const load = useCallback(() => Promise.all([studioApi.scenario(id), studioApi.current()])
    .then(([x, c]) => { setS(x); setCurrent(c); setErr(null); })
    .catch(e => setErr(e instanceof ApiError ? e.full : String(e))), [id]);
  useEffect(() => { load(); }, [load]);
  if (!s) return <div className="page">{err ? <Banner kind="crit" icon="warn">{err}</Banner> : <PageSkeleton bare />}</div>;
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
  return (
    <div className="page">
      <PageHead title={naming !== null
          ? <span className="row" style={{ gap: 8 }}><input className="input" aria-label="Scenario name" autoFocus style={{ fontSize: 20, height: 40, width: "min(520px, 70vw)" }} value={naming} maxLength={120}
              onChange={e => setNaming(e.target.value)} onKeyDown={e => { if (e.key === "Enter" && naming.trim()) { save({ title: naming.trim() }); setNaming(null); } if (e.key === "Escape") setNaming(null); }} />
            <button className="btn btn--sm btn--primary" type="button" disabled={!naming.trim()} onClick={() => { save({ title: naming.trim() }); setNaming(null); }}>Save</button></span>
          : <span className="row" style={{ gap: 8 }}>{s.title}<button className="btn btn--sm btn--ghost btn--icon" type="button" aria-label="Rename" onClick={() => setNaming(s.title)}><Icon name="edit" /></button></span>}
        crumbs={<><Link to="/studio">Scenario Studio</Link> / {s.title}</>}
        sub={<>For {b.institution.name} · {b.prices.symbol} · starts {dayTime(b.clock.start_at)} · {b.clock.steps} days, a day per step{own ? " · your own scenario" : ""}</>}
        actions={asking ? <span className="row" style={{ gap: 6 }}><span className="small">Delete this scenario and its runs?</span>
          <button className="btn btn--danger btn--sm" type="button" onClick={async () => { try { await studioApi.remove(id); nav("/studio"); } catch (e) { toast(e instanceof ApiError ? e.full : String(e)); } }}>Delete</button>
          <button className="btn btn--sm" type="button" onClick={() => setAsking(false)}>Keep it</button></span>
          : <button className="btn btn--ghost" type="button" onClick={() => setAsking(true)}><Icon name="trash" />Delete</button>} />
      <div className="banners">
        {err && <Banner kind="crit" icon="warn">{err}</Banner>}
        <CurrentBanner sim={current} />
        <Banner kind="info">{own ? "Your headlines are marked simulated and never reach the live pages. Amiri Agent's monitor reads each one on its day; the investigation traces what it finds to your products."
          : "The headlines are written for this scenario and marked simulated; you can edit, add or remove them. Their figures come from the price path. Sizes are illustrative."}</Banner>
      </div>
      <div className="split mt12">
        <div className="col gap16">
          <Headlines s={s} save={save} startOpen={fresh} />
          {!own && <div className="card"><div className="hd"><h2>What Amiri Agent should find</h2></div><div className="list">{b.stories.map(st => (
            <div key={st.key} className="li"><div className="row" style={{ gap: 8, flex: 1 }}>
              <TonePill tone={st.tone} /><span style={{ flex: 1 }}>{st.label}</span>
              {!st.expected && <span className="small muted">not expected: its headlines are out</span>}</div></div>))}</div></div>}
        </div>
        <div className="col gap16">
          <div className="card"><div className="hd"><h2>Run</h2></div><div className="bd col" style={{ gap: 10 }}>
            {own ? <PriceMoveCard key={s.version} s={s} save={save} /> : <>
              <label className="field"><span>How hard the shock hits</span>
                <select className="input" value={s.intensity} onChange={e => save({ intensity: e.target.value })}>
                  <option value="low">Low (×0.5)</option><option value="medium">Medium</option><option value="high">High (×1.5)</option></select></label>
              <label className="check"><input type="checkbox" checked={!off.has("prices")} onChange={() => toggle("prices")} /><span>Move {b.prices.symbol} ({b.prices.shock.size_pct.toFixed(1)}% over {b.prices.shock.ramp_business_days} business days)</span></label>
            </>}
            <div className="divider" />
            {empty && <span className="small" style={{ color: "var(--high-ink)" }}>Add a headline or a price move to run it.</span>}
            {MODES.map(([m, label, help]) => (
              <button key={m} className={`btn ${m === (replayable ? "replay" : "live") ? "btn--primary" : ""}`} type="button" title={help}
                disabled={!!current || empty || (m === "replay" && !replayable)} onClick={() => start(id, m)}>
                <Icon name="play" />{label}</button>))}
            <span className="small muted">{rec ? (rec.current ? (rec.complete ? `Recorded ${dayTime(rec.recorded_at)}.` : "A recording was started but didn't finish.")
              : "Changed since it was recorded: run it live and save it to replay again.") : "Not recorded yet: run it live and save it, then it replays instantly."}</span>
          </div></div>
          <div className="card"><div className="hd"><h2>The monitor it runs</h2></div><div className="bd col" style={{ gap: 6 }}>
            <b>{b.monitor.spec.about.name}</b><span className="small muted">{b.monitor.spec.public.in_one_sentence}</span>
            <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>{b.monitor.spec.public.tell_me_if.map(l => <li key={l}>{l}</li>)}</ul>
            <span className="small muted">It reads the scenario's headlines, not the web.</span></div></div>
          {s.simulations.length > 0 && <div className="card"><div className="hd"><h2>Runs</h2></div><div className="list">{s.simulations.map(m => (
            <div key={m.sim_id} className="li"><Link to={`/studio/run/${m.sim_id}`} className="small">{dayTime(m.created_at)} · {m.mode === "replay" ? "replay" : m.mode === "record" ? "live, saved" : "live"} · {m.status} · day {m.step} of {m.steps}</Link></div>))}</div></div>}
        </div>
      </div>
    </div>
  );
}
