// The monitor page's parts: where the monitor has got to, a finding and a check as one line opened in place, what it
// watches said once, its versions as a timeline, and the sentence a monitor reads as. MonitorPage.tsx puts them in order.
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import type { Profile } from "../../api/institutions";
import type { CheckRow, Monitor, MonitorFinding, MonitorSpec, MonitorsStatus } from "../../api/monitors";
import { FactList, Places, TechnicalDetails, usePlaceNames } from "../../components/blocks";
import { Icon } from "../../components/Icon";
import { useRole } from "../../components/ui";
import { dayTime, due, person, plainError } from "../../format";
import { cap, count, undated, everyText, listText, longWhen, MONITOR_CHECK, setAsideReason } from "../../plain";
import { FLOW_WORDS } from "../../components/setupFlow";

/** "dilan@serendib.lk" → "Dilan". */
export const who = (email?: string | null) => (email ? person(email) : "someone");
export const lower = (s: string) => (/^(?:[A-Z][a-z]|A )/.test(s) ? s[0].toLowerCase() + s.slice(1) : s);
/** A drafted sentence starts with the monitor's name ("Gulf tension meets remittances: events in…"): the title says it. */
export const unnamed = (s: string, name: string) => (s.startsWith(`${name}: `) ? cap(s.slice(name.length + 2)) : s);
/** A drafted line repeats every place ("affect Saudi Arabia, …, or Strait of Hormuz"): the places are said once, the line
 *  says "these places". Three or more names in one stretch only, so a line naming one place keeps it. */
export function shorten(line: string, names: string[]): string {
  const hits = names.filter(n => n.length > 2 && line.includes(n));
  if (hits.length < 3) return line;
  const a = Math.min(...hits.map(n => line.indexOf(n))), b = Math.max(...hits.map(n => line.indexOf(n) + n.length));
  return line.slice(0, a) + "these places" + line.slice(b);
}
export const headOf = (f: MonitorFinding) => { const h = f.evidence?.headlines?.[0]; return h && { ...h, title: undated(h.title) }; };
/** Where a finding went: its event (linked), still being investigated, or set aside and why. */
export function wentTo(f: MonitorFinding, events: Record<string, string>): { text: string; to?: string } {
  const ev = f.outcome?.event_id;
  if (ev) return { text: events[ev] ?? "In an event", to: `/events/${ev}` };
  if (f.status === "new" || f.status === "grouped") return { text: "Being investigated" };
  return { text: f.outcome?.reason ? `No impact found: ${setAsideReason(f.outcome.reason)}` : "No impact found" };
}
/** What the profile offers as exposure: id → label, grouped. */
export function exposureOptions(p: Profile | null): [string, [string, string][]][] {
  if (!p) return [];
  const S = p.sections;
  const name = (c: string) => p.place_names[c] ?? c;
  return ([
    ["Customer groups", S.segments.map(x => [`segment:${x.id}`, x.label])],
    ["Products", S.products.filter(x => x.status !== "closed").map(x => [`product:${x.id}`, x.name])],
    ["Flows", S.flows.map(x => [`flow:${x.id}`, `${cap(FLOW_WORDS[x.kind] ?? x.kind)}: ${name(x.counterpart)}${x.local !== p.institution.home_country ? ` → ${name(x.local)}` : ""}`])],
    ["Known risks", S["risk-exposures"].filter(x => x.status === "active").map(x => [`risk:${x.id}`, x.title])],
    ["Rivals", S.rivals.map(x => [`rival:${x.id}`, x.name])],
    ["Regulators", S.regulators.map(x => [`regulator:${x.id}`, x.short || x.name])],
    ["Counterparties", S.counterparties.map(x => [`counterparty:${x.id}`, x.name])],
  ] as [string, [string, string][]][]).filter(([, xs]) => xs.length);
}
/** The profile items a monitor could reach, by name; the risk it was drafted from (named like the monitor) is left out. */
export function reachOf(sp: MonitorSpec, profile: Profile | null): string[] {
  const labels = new Map(exposureOptions(profile).flatMap(([, xs]) => xs));
  return sp.private.exposure.map(e => labels.get(e.id) ?? null).filter((x): x is string => !!x && x !== sp.about.name);
}

/** Where the monitor has got to. A green tick only for a step a person finished (sent, approved); amber while one waits on
 *  a person; blue while it checks. */
export function Progress({ m, runs, findings, status, now }: { m: Monitor; runs: CheckRow[]; findings: MonitorFinding[]; status: MonitorsStatus | null; now: Date }) {
  const sent = m.versions.find(v => v.submitted_at), ok = m.versions.find(v => v.version === m.live_version);
  const s: { t: ReactNode; st: "agent" | "person" | "wait" | "now" | "off" }[] = [
    m.origin === "profile" ? { t: "Drafted from the profile", st: "agent" } : { t: `Written by ${who(m.created_by)}`, st: "person" },
    sent ? { t: `Sent by ${who(sent.submitted_by)}`, st: "person" } : { t: "Not sent yet", st: "wait" },
    ok?.approved_by ? { t: `Approved by ${who(ok.approved_by)}`, st: "person" }
      : m.status === "submitted" ? { t: "Waiting for approval", st: "wait" } : { t: "Approval", st: "off" },
    m.status === "live" ? { t: <>Checks {lower(everyText(m.spec.about.check_frequency))}<span>{status && !status.connected ? "on hold" : `next ${due(m.next_check_at, now)}`}</span></>, st: "now" }
      : m.status === "paused" ? { t: "Paused", st: "wait" } : m.status === "retired" ? { t: "Retired", st: "off" } : { t: "Checks start once approved", st: "off" },
    ...(runs.length ? [{ t: <>{count(runs.length, "check")}<span>{count(findings.length, "finding")}</span></>, st: "agent" as const }] : []),
  ];
  return <ol className="mp-prog" aria-label="Where this monitor has got to">{s.map((x, i) =>
    <li key={i} className={`p-${x.st}`}><i aria-hidden="true">{x.st === "person" && <Icon name="check" />}</i><b>{x.t}</b>
      <span className="sr">{x.st === "person" ? "(done by a person)" : x.st === "wait" ? "(waiting)" : x.st === "now" ? "(running)" : ""}</span></li>)}</ol>;
}

/** A finding as one line: the headline, outlet and day, where it went; opened, why it matched and the article. */
export function FindingLine({ f, events, m }: { f: MonitorFinding; events: Record<string, string>; m: Monitor }) {
  const p = (m.live_spec ?? m.spec).public, name = usePlaceNames(p.places);
  const all = [...p.places.map(name), ...p.watch.map(w => w.name)];
  const h = headOf(f), w = wentTo(f, events), met = f.source_ref?.line_texts ?? [];
  const url = h?.url ?? f.evidence?.web?.[0]?.url;
  return <details className="mp-line"><summary><span className="mp-l1"><b>{h?.title ?? f.title}</b>
    <span className="muted"> · {[h?.outlet, longWhen(h?.published_at ?? f.created_at)].filter(Boolean).join(", ")}{f.world === "sandbox" ? " · test" : ""}</span></span>
    <span className="mp-st">{w.to ? <Link to={w.to} onClick={e => e.stopPropagation()}>{w.text}<Icon name="arrow" /></Link> : w.text}</span>
    <Icon name="chevron" className="mp-chev" /></summary>
    <div className="mp-det">{f.explanation && <p>{f.explanation}</p>}
      {met.length > 0 && <div><span className="muted">It met {met.length === 1 ? "the line" : `${met.length} lines`}:</span><ul className="mp-list">{met.map(t => <li key={t}>{shorten(t, all)}</li>)}</ul></div>}
      {url && <a className="mp-go" href={url} target="_blank" rel="noreferrer">Read the article<Icon name="external" /><span className="sr"> (opens the article)</span></a>}</div></details>;
}

/** A check as one line: when, what it found, its summary; opened, what it read. Ids and raw errors for the Platform Admin. */
export function CheckLine({ r, prev }: { r: CheckRow; prev?: CheckRow }) {
  const { role } = useRole();
  const [text, tone] = r.status === "running" ? ["Checking…", "blue" as const] : MONITOR_CHECK[r.status === "failed" ? "error" : r.findings ? "fired" : "quiet"](r.findings ?? 0);
  const same = r.status === "failed" && prev?.status === "failed" && prev.error === r.error;
  const cv = r.coverage;
  return <details className="mp-line"><summary><time className="mp-t" dateTime={r.created_at}>{longWhen(r.created_at)}</time><b className={`mp-tone t-${tone}`}>{text}</b>
    <span className="mp-l1 mp-clamp">{r.error ? (same ? "Same problem as the check before." : `${plainError(r.error)} It tries again within the hour.`) : r.summary}</span>
    <span className="mp-st">{r.world === "sandbox" ? "Test" : r.trigger === "now" ? "On request" : ""}</span><Icon name="chevron" className="mp-chev" /></summary>
    <div className="mp-det">
      <p className="muted">Read news since {dayTime(r.window_since)}{cv ? `: ${count(cv.web_queries, "search", "searches")}, ${count(cv.pages_seen, "page")}, ${cv.pages_in_window} new enough${cv.already_reported ? `, ${cv.already_reported} already reported` : ""}` : ""}. Version {r.version}.</p>
      {role === "platform_admin" && <TechnicalDetails><FactList items={[["Check", <span className="mono">{r.run_id}</span>], ["Error", r.error ? <span className="rawerr">{r.error}</span> : null],
        ["Model", r.usage ? `${r.usage.model}, ${r.usage.model_calls} calls` : null], ["Window", `${dayTime(r.window_since)} to ${dayTime(r.window_until)}`]]} /></TechnicalDetails>}</div></details>;
}

/** What it watches, said once: the sentence, the places and names, the lines; then only the facts that aren't defaults. */
export function Watches({ m, profile }: { m: Monitor; profile: Profile | null }) {
  const sp = m.live_spec ?? m.spec, p = sp.public;
  const name = usePlaceNames(p.places);
  const placeNames = new Set(p.places.map(c => name(c).toLowerCase()));
  const extra = p.watch.filter(w => !placeNames.has(w.name.toLowerCase()));
  const all = [...p.places.map(name), ...p.watch.map(w => w.name)];
  const reach = reachOf(sp, profile);
  const sentence = unnamed(p.in_one_sentence, sp.about.name);
  // places the sentence already names aren't listed again; only the ones it leaves out get a label
  const unsaid = p.places.filter(c => !sentence.toLowerCase().includes(name(c).toLowerCase()));
  return <div className="mp-watch">
    <FactList items={[
      ["Looks for", <span className="mp-sent">{sentence}</span>],
      ["Places", unsaid.length ? <span className="mp-lab place"><Icon name="pin" /><Places codes={unsaid} max={20} /></span> : null],
      ["Also names", extra.length ? listText(extra.map(w => w.name + (w.other_forms?.length ? ` (also ${w.other_forms.join(", ")})` : "")), 12) : null],
      ["Tells you if", <ul className="mp-list">{p.tell_me_if.map(t => <li key={t}>{shorten(t, all)}</li>)}</ul>],
      ["Could reach", reach.length ? <span className="mp-labs">{reach.map(r => <span key={r} className="mp-lab reach">{r}</span>)}</span> : null],
      ["Leaves out", p.ignore?.length ? p.ignore.join("; ") : null],
      ["Reads", p.sources?.mode === "trusted_only" ? `Only ${p.sources.check_first.join(", ")}` : p.sources?.check_first.length ? `Any reputable outlet, ${p.sources.check_first.join(", ")} first` : null],
      ["Key dates", sp.about.key_dates?.length ? sp.about.key_dates.map(k => `${k.label} (${k.date})`).join("; ") : null],
      ["Serious", sp.private.serious?.length ? sp.private.serious.join("; ") : null],
      ["Reports at", sp.alert_level !== 6 ? `${sp.alert_level} of 10` : null],
      ["Review by", sp.about.review_by ?? null], ["Also tells", sp.about.also_notify?.length ? sp.about.also_notify.join(", ") : null]]} />
  </div>;
}

/** The versions as a timeline, newest first: written, sent (with its note), approved. A tick where a person did it. */
export function Versions({ m }: { m: Monitor }) {
  type It = { at: string; who: "agent" | "person"; t: ReactNode; note?: string | null };
  const items = m.versions.flatMap(v => [
    v.approved_at && { at: v.approved_at, who: "person", t: <>Version {v.version} approved by <b>{who(v.approved_by)}</b>{v.version === m.live_version ? "; it runs now" : ""}</> },
    v.submitted_at && { at: v.submitted_at, who: "person", t: <>Version {v.version} {v.status === "draft" ? "sent, then sent back" : "sent for approval"} by {who(v.submitted_by)}</>, note: v.note },
    { at: v.created_at, who: v.version === 1 && m.origin === "profile" ? "agent" : "person", t: v.version === 1 && m.origin === "profile" ? "Version 1 drafted from the profile" : <>Version {v.version} written by {who(v.created_by)}</> },
  ].filter(Boolean) as It[]).sort((a, b) => (a.at < b.at ? 1 : -1));
  const latest = m.versions[m.versions.length - 1];
  return <details className="mp-fold"><summary><Icon name="book" />Versions
    <span className="muted">{m.live_version ? `version ${m.live_version} runs` : `version ${latest.version}, ${latest.status}`}{m.pending && m.live_version ? `; version ${m.pending.version} ${m.pending.status === "submitted" ? "waits for approval" : "is a draft"}` : ""}</span>
    <Icon name="chevron" className="mp-chev" /></summary>
    <ol className="mp-tl">{items.map((x, i) => <li key={i} className={x.who}><time dateTime={x.at}>{longWhen(x.at)}</time><i aria-hidden="true">{x.who === "person" && <Icon name="check" />}</i>
      <div><span>{x.t}</span>{x.note && <div className="mp-tsub">“{x.note}”</div>}</div></li>)}</ol></details>;
}

/** The monitor as one sentence: how often, which outlets, about what, who it tells and when. Blanks say what is missing. */
export function ReadsAs({ s, tell, ignore }: { s: MonitorSpec; tell?: string[]; ignore?: string[] }) {
  const p = s.public, name = usePlaceNames(p.places);
  const places = p.places.map(name), pl = new Set(places.map(x => x.toLowerCase()));
  const names = p.watch.map(w => w.name).filter(x => !pl.has(x.toLowerCase()));
  const all = [...places, ...p.watch.map(w => w.name)];  // a line that starts with a name keeps its capital
  const ls = (tell ?? p.tell_me_if).map(t => { const x = shorten(t, all); return all.some(n => x.startsWith(n)) ? x : lower(x); });
  const ign = ignore ?? p.ignore ?? [];
  return <p className="mp-reads">{everyText(s.about.check_frequency)} it reads {p.sources?.mode === "trusted_only" ? <>only <b>{listText(p.sources.check_first, 5) || "the outlets you list"}</b></> : "any reputable outlet"}{" "}
    for news about {names.length || places.length ? <>{names.length > 0 && <b>{listText(names, 6)}</b>}{names.length > 0 && places.length > 0 && " in "}{places.length > 0 && <b>{listText(places, 12)}</b>}</>
      : <em>the names and places you add</em>} and tells <b>{s.about.owner}</b> if{" "}
    {ls.length ? ls.map((t, i) => <span key={i}>{i ? (i === ls.length - 1 ? ", or if " : ", if ") : ""}<b>{t}</b></span>) : <em>something you name happens</em>}.
    {ign.length ? <> It leaves out {ign.map(lower).join("; ")}.</> : null}</p>;
}
