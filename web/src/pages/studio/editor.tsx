// One scenario's editor (board 09): its name, how hard it hits and what it should find, the headlines, the monitor it
// runs, and the run buttons. Saving, deleting and starting are the page's (Studio.tsx); this draws and collects.
import { useId, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import type { Custom, HeadlineIn, Mode, PriceMove, Scenario, Simulation } from "../../api/studio";
import { useDemoLock } from "../../components/lock";
import { Button } from "../../components/v2/Button";
import { Checkbox, Segmented, Switch } from "../../components/v2/Choice";
import { DirectionMark } from "../../components/v2/Direction";
import { Field, Input, Select, Textarea } from "../../components/v2/Field";
import { DIRECTIONS, directionOf } from "../../components/v2/directionWords";
import { MoreMenu } from "../../components/v2/MoreMenu";
import { Pill } from "../../components/v2/Pill";
import { SectionHead } from "../../components/v2/SectionHead";
import { dayTime } from "../../format";
import {
  byTime, DAYS, headlineError, headlineOk, intensityWord, liveMode, MAX_HEADLINES, onCount, priceMoveError, priceMoveOk, replayable, runHint, runLine,
  sameMove, subtitle,
} from "./editorWords";

export type SaveBody = { intensity?: string; switched_off?: string[]; title?: string; custom?: Custom };
export type Save = (body: SaveBody) => Promise<boolean>;

const newId = () => `c-${Math.random().toString(36).slice(2, 8)}`;

/** One headline, written or changed in place. Not a <form>: Enter never saves by accident. */
function HeadlineForm({ value, dayLabel, locked, onSave, onCancel }: {
  value: HeadlineIn; dayLabel: (d: number) => string; locked: boolean; onSave: (h: HeadlineIn) => void; onCancel: () => void;
}) {
  const [h, setH] = useState(value);
  const err = headlineError(h.title);
  return (
    <div className="v2-st-hform" role="group" aria-label={value.title ? "Change this headline" : "Write a headline"}>
      <Field req label="Headline" error={err ?? undefined}>
        <Textarea rows={2} autoFocus maxLength={200} value={h.title} placeholder="e.g. Dockworkers at the main port strike for a week"
          onChange={e => setH({ ...h, title: e.target.value })} />
      </Field>
      <div className="v2-st-hform__row">
        <Field label="Published on" className="v2-st-field--day">
          <Select value={h.day} onChange={e => setH({ ...h, day: Number(e.target.value) })}>
            {Array.from({ length: DAYS }, (_, i) => i + 1).map(d => <option key={d} value={d}>Day {d} · {dayLabel(d)}</option>)}
          </Select>
        </Field>
        <Field label="At" className="v2-st-field--time">
          <Input type="time" value={h.time} onChange={e => setH({ ...h, time: e.target.value || "09:00" })} />
        </Field>
        <span className="v2-st-grow" />
        <Button variant="quiet" onClick={onCancel}>Cancel</Button>
        <Button locked={locked} disabled={!headlineOk(h.title)} onClick={() => onSave({ ...h, title: h.title.trim() })}>Save headline</Button>
      </div>
    </div>
  );
}

/** The headlines that arrive day by day, each with an on/off switch; edit, remove and add are one step away. */
function Headlines({ s, save, startOpen, own, locked }: { s: Scenario; save: Save; startOpen: boolean; own: boolean; locked: boolean }) {
  const b = s.built;
  const all = byTime(b.all_headlines);
  const off = new Set(s.switched_off);
  const [editing, setEditing] = useState<string | null>(startOpen && !all.length && !locked ? "new" : null);
  const fmt = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: b.institution.time_zone });
  const dayLabel = (d: number) => fmt.format(new Date(new Date(b.clock.start_at).getTime() + (d - 1) * 86400_000 + 12 * 3600_000));
  const list = (): HeadlineIn[] => all.map(h => ({ id: h.id, title: h.title, day: h.day, time: h.time }));
  const put = async (next: HeadlineIn[]) => { if (await save({ custom: { headlines: next } })) setEditing(null); };
  const upsert = (h: HeadlineIn) => put(editing === "new" ? [...list(), h] : list().map(x => (x.id === h.id ? h : x)));
  const remove = (id: string) => put(list().filter(x => x.id !== id));
  const toggle = (id: string) => save({ switched_off: off.has(id) ? s.switched_off.filter(x => x !== id) : [...s.switched_off, id] });
  const nOff = all.filter(h => off.has(h.id)).length;
  const headId = useId();
  return (
    <section aria-labelledby={headId} className="v2-st-heads">
      <SectionHead id={headId} level={3} size="sm" title="Headlines"
        meta={<><span className="v2-chip">{onCount(all.length, nOff)}</span><span className="v2-meta">· simulated, marked as such</span></>}
        action={editing !== "new" && all.length < MAX_HEADLINES
          ? <Button variant="quiet" size="sm" locked={locked} onClick={() => setEditing("new")}>+ Add a headline</Button> : undefined} />
      <p className="v2-meta v2-st-heads__note">{own ? "They never reach the live pages. AMIRI Agent's monitor reads each one on its day." : "Switch one off to leave it out of the run. Their figures come from the price path; sizes are illustrative."}</p>
      <ul className="v2-st-hlist">
        {all.length === 0 && editing !== "new" && (
          <li className="v2-st-hnone">No headlines yet. Write what happens and on which day: AMIRI Agent's monitor reads each headline the day it is published.{" "}
            <Button variant="quiet" size="sm" locked={locked} onClick={() => setEditing("new")}>Write the first headline</Button></li>)}
        {all.map((h, i) => editing === h.id
          ? <li key={h.id}><HeadlineForm value={{ id: h.id, title: h.title, day: h.day, time: h.time }} dayLabel={dayLabel} locked={locked} onSave={upsert} onCancel={() => setEditing(null)} /></li>
          : (
            <li key={h.id} className={`v2-st-hl${off.has(h.id) ? " is-off" : ""}`}>
              <span className="v2-st-hl__n v2-num" aria-hidden="true">{i + 1}</span>
              <span className="v2-st-hl__when v2-num">Day {h.day}<br className="v2-st-br" /><span className="v2-st-dot" aria-hidden="true"> · </span>{h.time}</span>
              <span className="v2-st-hl__t">{h.title}
                {h.outlet && <span className="v2-st-hl__src"> · {h.outlet}</span>}
                {(off.has(h.id) || (h.story === "custom" && b.template_id !== "blank")) && <span className="v2-st-hl__tag">
                  {[off.has(h.id) ? "switched off" : "", h.story === "custom" && b.template_id !== "blank" ? "added by you" : ""].filter(Boolean).join(", ")}</span>}
              </span>
              <Switch checked={!off.has(h.id)} locked={locked} aria-label={`Include headline ${i + 1}: ${h.title}`} onChange={() => toggle(h.id)} />
              <MoreMenu label={`More for headline ${i + 1}: ${h.title}`} items={[
                { label: "Edit", locked, onSelect: () => setEditing(h.id) },
                { label: "Remove", locked, danger: true, onSelect: () => remove(h.id) },
              ]} />
            </li>))}
        {editing === "new" && (
          <li><HeadlineForm value={{ id: newId(), title: "", day: Math.min(DAYS, (all[all.length - 1]?.day ?? 0) + 1), time: "09:00" }}
            dayLabel={dayLabel} locked={locked} onSave={upsert} onCancel={() => setEditing(null)} /></li>)}
      </ul>
    </section>
  );
}

/** A scenario you wrote has no template to scale: its price move is written here. */
function PriceMoveForm({ s, save, locked }: { s: Scenario; save: Save; locked: boolean }) {
  const cur = s.built.institution.currency === "USD" ? "US dollar" : s.built.institution.currency;
  const [m, setM] = useState<PriceMove>(s.built.prices.move ?? { direction: "none", size_pct: 0, ramp_days: 5 });
  const errId = useId();
  const err = priceMoveError(m);
  const saved = sameMove(s.built.prices.move, m);
  return (
    <div className="v2-st-move" role="group" aria-label="The price move">
      <Field label="Exchange rate">
        <Select value={m.direction} locked={locked}
          onChange={e => { if (!locked) setM({ ...m, direction: e.target.value as PriceMove["direction"], size_pct: m.size_pct || 5 }); }}>
          <option value="none">No price move</option>
          <option value="weaker">The {cur} weakens against the US dollar</option>
          <option value="stronger">The {cur} strengthens against the US dollar</option>
        </Select>
      </Field>
      {m.direction !== "none" && (
        <div className="v2-st-move__row">
          <Field label="By (%)">
            <Input type="number" min={0.5} max={30} step={0.5} value={m.size_pct} locked={locked} invalid={!!err} aria-describedby={err ? errId : undefined}
              onChange={e => setM({ ...m, size_pct: Number(e.target.value) })} />
          </Field>
          <Field label="Over (business days)">
            <Input type="number" min={1} max={15} value={m.ramp_days} locked={locked} invalid={!!err} aria-describedby={err ? errId : undefined}
              onChange={e => setM({ ...m, ramp_days: Number(e.target.value) })} />
          </Field>
        </div>)}
      {err && <p id={errId} className="v2-field__err" role="alert"><span aria-hidden="true">▲ </span>{err}</p>}
      {!saved && <Button locked={locked} disabled={!priceMoveOk(m)} onClick={() => save({ custom: { prices: m } })}>Save the price move</Button>}
    </div>
  );
}

export interface EditorProps {
  s: Scenario;
  current: Simulation | null;
  fresh: boolean;
  save: Save;
  onAskDelete: () => void;
  onRun: (mode: Mode) => void;
  starting: boolean;
  /** Shown above the editor: the edit conflict. */
  notice?: ReactNode;
}
export function Editor({ s, current, fresh, save, onAskDelete, onRun, starting, notice }: EditorProps) {
  const locked = useDemoLock();
  const b = s.built;
  const own = b.template_id === "blank";
  const off = new Set(s.switched_off);
  const rec = s.recording;
  const canReplay = replayable(rec);
  const empty = !b.headlines.length && (b.prices.off ?? true);
  const running = !!current;
  const [naming, setNaming] = useState<string | null>(null);
  const [record, setRecord] = useState(false);
  const nameId = useId(), hintId = useId();
  const nameIn = useRef<HTMLInputElement>(null);
  const rename = async () => { if (naming?.trim() && await save({ title: naming.trim() })) setNaming(null); };
  const startFmt = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: b.institution.time_zone });
  const when = (iso: string) => dayTime(iso).replace(/ \d\d:\d\d$/, "");
  const sub = subtitle(startFmt.format(new Date(b.clock.start_at)), b.clock.steps, own, rec, rec ? when(rec.recorded_at) : "");
  const last = s.simulations[0];
  const shared = running || empty ? runHint({ running, empty, rec, mode: "live" }) : null;
  const replayHint = shared ? null : runHint({ running, empty, rec, mode: "replay" });
  const liveHint = shared ? null : runHint({ running, empty, rec, mode: "live" });
  const stories = b.stories;
  return (
    <article className="v2-panel v2-st-panel" aria-labelledby={nameId}>
      {notice}
      <div className={`v2-st-panel__head${naming !== null ? " is-naming" : ""}`}>
        {naming !== null ? (
          <>
            <div className="v2-st-field v2-st-grow">
              <Input id={nameId} ref={nameIn} aria-label="Scenario name" className="v2-st-name" autoFocus value={naming} maxLength={120} autoComplete="off"
                onChange={e => setNaming(e.target.value)} onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); rename(); } if (e.key === "Escape") setNaming(null); }} />
            </div>
            <Button locked={locked} disabled={!naming.trim()} onClick={rename}>Save</Button>
            <Button variant="quiet" onClick={() => setNaming(null)}>Cancel</Button>
          </>
        ) : (
          <>
            <h2 id={nameId} className="v2-st-title">{s.title}</h2>
            <MoreMenu label="More: rename or delete" items={[
              { label: "Rename", locked, onSelect: () => setNaming(s.title) },
              { label: "Delete", locked, danger: true, onSelect: onAskDelete },
            ]} />
          </>)}
      </div>
      <p className="v2-st-sub">{sub}</p>

      <div className="v2-st-set">
        {own ? <PriceMoveForm key={s.version} s={s} save={save} locked={locked} /> : (
          <>
            <Segmented caption label="How hard it hits" value={s.intensity} locked={locked} onChange={v => save({ intensity: v })}
              options={(["low", "medium", "high"] as const).map(v => ({ value: v, label: intensityWord(v) }))} />
            <Checkbox checked={!off.has("prices")} locked={locked}
              onChange={() => save({ switched_off: off.has("prices") ? s.switched_off.filter(x => x !== "prices") : [...s.switched_off, "prices"] })}
              label={`Move ${b.prices.name || b.prices.symbol} by ${Number(b.prices.shock.size_pct.toFixed(1))}% over ${b.prices.shock.ramp_business_days} business days`} />
          </>)}
        {!own && stories.length > 0 && (
          <div className="v2-st-find">
            <div className="v2-cap">What AMIRI Agent should find</div>
            <ul className="v2-st-pills">
              {stories.map(st => (
                <li key={st.key}>
                  <Pill tone={st.expected ? DIRECTIONS[directionOf(st.tone)].pill : "neutral"} dashed={!st.expected}
                    mark={<DirectionMark tone={st.tone} size={11} />}>
                    {st.label}
                    <span className="v2-sr"> ({DIRECTIONS[directionOf(st.tone)].word}{st.expected ? "" : "; not expected: its headlines are out"})</span>
                    {!st.expected && <span aria-hidden="true"> · out</span>}
                  </Pill>
                </li>))}
            </ul>
          </div>)}
      </div>

      <Headlines s={s} save={save} startOpen={fresh} own={own} locked={locked} />

      <details className="v2-st-fold">
        <summary>The monitor it runs · {b.monitor.spec.about.name}</summary>
        <p>{b.monitor.spec.public.in_one_sentence}</p>
        <ul className="v2-st-bullets">{b.monitor.spec.public.tell_me_if.map(l => <li key={l}>{l}</li>)}</ul>
        <p className="v2-meta">It reads the scenario's headlines, not the web.</p>
      </details>

      {s.simulations.length > 0 && (
        <details className="v2-st-fold">
          <summary>Earlier runs · {s.simulations.length}</summary>
          <ul className="v2-st-runs">
            {s.simulations.map(m => (
              <li key={m.sim_id}><Link to={`/studio/run/${m.sim_id}`}>{runLine(m, dayTime(m.created_at))}</Link></li>))}
          </ul>
        </details>)}

      <div className="v2-st-run">
        {!running && last && (
          <p className="v2-st-last v2-meta">Last run: {runLine(last, dayTime(last.created_at))}. Its findings, events and alerts are still there.{" "}
            <Link to={`/studio/run/${last.sim_id}`}>Open the run</Link></p>)}
        <div className="v2-st-run__bar">
          <Button size="lg" disabled={running || empty || !canReplay || starting} aria-describedby={hintId} onClick={() => onRun("replay")}>Replay instantly</Button>
          <span id={hintId} className="v2-st-run__hint">{replayHint ?? liveHint}</span>
          <div className="v2-st-run__live">
            <Checkbox checked={record} onChange={e => setRecord(e.target.checked)} label="Record this run" />
            <Button size="lg" variant="primary" disabled={running || empty || starting} busy={starting} busyLabel="Starting…" onClick={() => onRun(liveMode(record))}>
              Run with the live agents<span aria-hidden="true"> →</span></Button>
          </div>
        </div>
        {shared && <p className="v2-st-run__shared v2-meta" role="status">{shared}</p>}
      </div>
    </article>
  );
}
