// The Overview's parts (board 00): the hero with the map, the numbered tiles, the open events, findings and Radar,
// what needs you, and the prices. Page logic stays in ../Overview.tsx; the words and rules are in ./words.ts.
import { useEffect, useId, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { Link } from "react-router-dom";
import type { Profile } from "../../api/institutions";
import type { Attention, Overview, OverviewEvent } from "../../api/overview";
import { Icon } from "../../components/Icon";
import { ArrowLink } from "../../components/v2/ArrowLink";
import { Button } from "../../components/v2/Button";
import { DirectionMark, DirectionPill } from "../../components/v2/Direction";
import { DotMap, type DotPlace } from "../../components/v2/DotMap";
import { Empty } from "../../components/v2/Empty";
import { Pill } from "../../components/v2/Pill";
import { SectionHead } from "../../components/v2/SectionHead";
import { SkBar, Skeleton } from "../../components/v2/Skeleton";
import { Sparkline } from "../../components/v2/Sparkline";
import { StatTile, StatTiles } from "../../components/v2/StatTile";
import { Cell, Row, Table } from "../../components/v2/Table";
import { TabPanel, Tabs } from "../../components/v2/Tabs";
import { WorldMark } from "../../components/v2/WorldMark";
import { pct, placeName, plural, price, when } from "../../format";
import { eventTitle, metricWords } from "../../plain";
import { friendlySeriesText, seriesName } from "../series/words";
import {
  actMeta, ageText, arrowOf, effectsText, findingPill, foundMeta, greetingText, headlineKind, headlineText, footprintView, lateSince, mapMarks, markLabel, moreLine,
  needAction, needLevelWord, othersText, placesText, plainNote, priceRows, sourceWord, storyPill, tracedMeta, watchingMeta, type HeadlineKind,
} from "./words";

const RANK: Record<string, number> = { bad: 0, mixed: 1, good: 2, neutral: 3 };  // what hurts first
/** Open events, worst first (the server's order, newest first, within a tone). */
export const rankEvents = (events: OverviewEvent[]): OverviewEvent[] =>
  events.map((e, i) => [e, i] as const).sort(([a, i], [b, j]) => (RANK[a.tone] ?? 3) - (RANK[b.tone] ?? 3) || i - j).map(([e]) => e);

type Places = Overview["map"]["places"];
const nameOf = (places: Places, code: string) => places[code]?.name ?? placeName(code);

// ---------------------------------------------------------------- the map's width
/** The width of an element, in whole tens of pixels, so the dotted map is drawn at the size it is shown (its names stay 12 px). */
function useWidth<T extends HTMLElement>(on = true): [RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [w, setW] = useState(511);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fit = () => setW(Math.max(280, Math.min(511, Math.floor(el.clientWidth / 10) * 10)));
    fit();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(fit) : null;
    ro?.observe(el);
    return () => ro?.disconnect();
  }, [on]);  // the element may mount later than the component (the map waits for the profile)
  return [ref, w];
}

// ---------------------------------------------------------------- the hero
export interface HeroProps {
  o: Overview;
  events: OverviewEvent[];
  now: Date;
  name: string;
  timeZone: string;
  /** The institution's profile, for the footprint on the map: undefined while it loads (no map yet), null when it can't be read (events only). */
  profile?: Profile | null;
}
export function Hero({ o, events, now, name, timeZone, profile }: HeroProps) {
  const alerts = o.counts.alerts_to_review;
  const kind = headlineKind({ alerts, events: events.length, tickOk: o.services.tick.ok });
  const text = headlineText(kind, alerts);
  const worst = events.find(e => e.tone === "bad");
  const sources = o.counts.monitors_live + o.counts.series_watched + (o.services.radar.connected ? 1 : 0);

  // the map: the home footprint (from the profile) shaded and framed, the events marked on their most specific place
  const map = useMemo(() => {
    const all = { ...profile?.places, ...o.map.places };
    const home = o.institution?.home_country ?? "";
    const fp = footprintView(home, (profile?.sections.footprint ?? []).map(i => ({ code: String(i.code), role: i.role, branch_count: i.branch_count })), all);
    const marks = mapMarks(events.map(e => ({ title: eventTitle(e), tone: e.tone, places: e.places })), { places: all, home, anchor: fp.anchor?.code ?? null });
    const places: DotPlace[] = marks.flatMap(m => {
      const info = all[m.code];
      if (!info || info.lat == null || info.lon == null) return [];
      return [{ label: markLabel(m, info.name ?? placeName(m.code)), lon: info.lon, lat: info.lat, tone: m.tone, strong: m.first, halo: m.first }];
    });
    return { places, shade: { countries: fp.countries, halos: fp.halos, names: fp.names } };
  }, [o, events, profile]);
  const places = map.places;
  const showMap = places.length > 0 && profile !== undefined;
  const [mapRef, mapW] = useWidth<HTMLDivElement>(showMap);

  return (
    <section className="v2-ov-hero" aria-label="Where things stand">
      <div className="v2-ov-hero__text">
        <p className="v2-cap">{greetingText(now, timeZone, name)}</p>
        <h1 className="v2-hero v2-ov-h1">
          {text.hot && <span className="v2-ov-h1__hot">{text.hot}</span>}
          {text.hot ? " " : ""}{text.rest}
        </h1>
        <HeroLine kind={kind} worst={worst} sources={sources} events={events.length} tickAt={o.services.tick.last_at} now={now} />
        <div className="v2-ov-cta">
          {kind === "alerts" && <Button as="link" to="/alerts" variant="primary" size="lg">Review the alerts →</Button>}
          {kind === "alerts" && events.length > 0 && <Button as="link" to="/events" size="lg">{plural(events.length, "open event")}</Button>}
          {kind === "quiet" && <Button as="link" to="/events" variant="primary" size="lg">See the open events →</Button>}
          {(kind === "clear" || kind === "stopped") && <Button as="link" to="/studio" variant="primary" size="lg">See how it responds: try a what-if →</Button>}
        </div>
      </div>
      {showMap && (
        <div className="v2-ov-hero__map" ref={mapRef}>
          <DotMap places={places} shade={map.shade} width={mapW} height={Math.round(mapW * 224 / 511)} intro="Where today's events are" />
        </div>
      )}
    </section>
  );
}

function HeroLine({ kind, worst, sources, events, tickAt, now }: { kind: HeadlineKind; worst: OverviewEvent | undefined; sources: number; events: number; tickAt: string | null; now: Date }) {
  if (kind === "alerts") {
    return worst
      ? <p className="v2-lead v2-ov-line">Most serious: <Link to={`/events/${worst.event_id}`}><b>{eventTitle(worst)}</b></Link>
        {worst.effects ? <>, with {plural(worst.effects, "possible effect")} on your products.</> : <>, bad for you.</>}</p>
      : <p className="v2-lead v2-ov-line">Early warnings for products your teams own.</p>;
  }
  if (kind === "quiet") return <p className="v2-lead v2-ov-line">AMIRI Agent is following {plural(events, "open event")}; none needs a team yet.</p>;
  if (kind === "clear") return <p className="v2-lead v2-ov-line">No alerts and no open events. AMIRI Agent is watching {plural(sources, "source")}.</p>;
  return (
    <p className="v2-lead v2-ov-line v2-ov-line--warn"><span aria-hidden="true">⚠ </span>Updates aren't running, so no news or prices arrive.
      {tickAt ? <> Last ran {ageText(tickAt, now)}.</> : <> They haven't run yet.</>}</p>
  );
}

// ---------------------------------------------------------------- the four tiles
export function Tiles({ o, events, teams }: { o: Overview; events: OverviewEvent[]; teams: number | null }) {
  const c = o.counts, s = o.services;
  const f24 = c.findings_24h.timeseries + c.findings_24h.monitor + c.findings_24h.radar;
  const sources = c.monitors_live + c.series_watched + (s.radar.connected ? 1 : 0);
  return (
    <StatTiles label="Today, step by step">
      <StatTile caption="1 · Watching" value={sources} meta={watchingMeta(c.monitors_live, c.series_watched, s.radar.connected)} to="/monitors" />
      <StatTile caption="2 · Found, last 24 h" value={f24} meta={foundMeta(c.findings_24h)} to="/findings" />
      <StatTile caption="3 · Traced to you" value={events.length} meta={tracedMeta(events.length, c.effects_to_watch)} to="/events" />
      <StatTile caption="4 · Who must act" value={c.alerts_to_review} meta={actMeta(c.alerts_to_review, teams)} to="/alerts" tone={c.alerts_to_review > 0 ? "act" : undefined} />
    </StatTiles>
  );
}

// ---------------------------------------------------------------- a scenario is running
export function ScenarioRow({ studio }: { studio: NonNullable<Overview["studio"]> }) {
  return (
    <Link to={`/studio/run/${studio.sim_id}`} className="v2-rowlink v2-ov-sim">
      <WorldMark world="studio" />
      <span className="v2-ov-sim__t">{studio.title} · day {studio.step} of {studio.steps} · nothing here reaches live counts</span>
      <b className="v2-ov-sim__go">Watch it →</b>
    </Link>
  );
}

// ---------------------------------------------------------------- open events
export function OpenEvents({ events, places, now }: { events: OverviewEvent[]; places: Places; now: Date }) {
  const base = useId();
  const [openId, setOpenId] = useState<string | null | undefined>(undefined);  // undefined: the first one, until the person chooses
  const open = openId === undefined ? events[0]?.event_id ?? null : openId;
  return (
    <section aria-labelledby={`${base}-h`} className="v2-ov-events">
      <SectionHead id={`${base}-h`} title="Open events" count={events.length || undefined} countLabel="open events" action={<ArrowLink to="/events">All events</ArrowLink>} />
      {!events.length
        ? <Empty title="No open events">When AMIRI Agent traces news or a price move to your products, it appears here.</Empty>
        : <ul className="v2-ov-evlist">{events.slice(0, 6).map(e => {
          const isOpen = open === e.event_id;
          const panel = `${base}-p-${e.event_id}`;
          const names = e.places.map(p => nameOf(places, p));
          return (
            <li key={e.event_id} className="v2-ov-ev">
              <button type="button" className="v2-ov-ev__head" aria-expanded={isOpen} aria-controls={panel} onClick={() => setOpenId(isOpen ? null : e.event_id)}>
                <DirectionMark tone={e.tone} />
                <span className="v2-title-lg v2-ov-ev__title">{eventTitle(e)}</span>
                <DirectionPill tone={e.tone} />
                <span className="v2-ov-ev__n">{e.effects > 0 ? <><b className="v2-num">{e.effects}</b> {e.effects === 1 ? "effect" : "effects"}</> : <span className="v2-muted">{effectsText(0)}</span>}</span>
                <span className="v2-ov-ev__where v2-hs">{placesText(names)}</span>
                <span className="v2-ov-ev__age v2-hs">{ageText(e.last_finding_at, now)}</span>
                <span className="v2-ov-ev__chev" aria-hidden="true"><Icon name="chevron" /></span>
              </button>
              <div id={panel} className="v2-ov-ev__body" hidden={!isOpen}>
                {e.top_effects.length > 0 ? <>
                  <h3 className="v2-cap v2-ov-ev__cap">What it could move</h3>
                  <ul className="v2-ov-fx">{e.top_effects.map((x, i) => {
                    const a = arrowOf(x.direction);
                    return (
                      <li key={i} className="v2-ov-fx__row">
                        <span>{x.product}</span>
                        <span className="v2-text-2">{x.metric ? metricWords(x.metric) : x.label}</span>
                        <span className="v2-ov-fx__arrow">{a ? <><b aria-hidden="true">{a.glyph}</b><span className="v2-sr">{a.word}</span></> : null}</span>
                      </li>);
                  })}</ul>
                </> : <p className="v2-meta v2-ov-ev__none">No effects on your products traced yet.</p>}
                <div className="v2-ov-ev__foot">
                  <span className="v2-meta">{moreLine(e.effects, e.top_effects.length, e.developments)}</span>
                  <span className="v2-ov-ev__sm v2-meta">{names.length ? `${placesText(names, 3)} · ${ageText(e.last_finding_at, now)}` : ageText(e.last_finding_at, now)}</span>
                  <ArrowLink to={`/events/${e.event_id}`}>Open the event</ArrowLink>
                </div>
              </div>
            </li>);
        })}</ul>}
    </section>
  );
}

// ---------------------------------------------------------------- findings and Radar
const SOURCE_ICON: Record<string, string> = { monitor: "monitor", timeseries: "series", radar: "radar" };
export function Latest({ o, now }: { o: Overview; now: Date }) {
  const [tab, setTab] = useState("findings");
  const f24 = o.counts.findings_24h.timeseries + o.counts.findings_24h.monitor + o.counts.findings_24h.radar;
  const stories = o.radar.stories;
  return (
    <section aria-labelledby="ov-latest" className="v2-ov-latest">
      <h2 id="ov-latest" className="v2-sr">Latest findings and Radar stories</h2>
      <Tabs label="Latest" value={tab} onChange={setTab}
        tabs={[{ id: "findings", label: "Findings", count: f24 || undefined, countLabel: "in the last 24 hours" }, { id: "radar", label: "Radar", count: stories.length || undefined, countLabel: "latest stories" }]}>
        <TabPanel id="findings">
          {!o.findings.length
            ? <Empty plain title="No findings yet">They appear here when a monitor, a market price or Radar notices something.</Empty>
            : <Table label="Latest findings" cols="76px minmax(0,1fr) 150px 96px" colsPhone="64px minmax(0,1fr) 84px" className="v2-ov-rows">
              {o.findings.slice(0, 4).map(f => {
                const p = findingPill(f);
                return (
                  <Row key={f.finding_id} to={f.event_id ? `/events/${f.event_id}` : `/findings#f-${f.finding_id}`} label={f.title}>
                    <Cell muted className="v2-ov-src"><Icon name={SOURCE_ICON[f.source] ?? "monitor"} />{sourceWord(f.source)}</Cell>
                    <Cell>{f.title}{p.why && <span className="v2-meta v2-ov-why">{p.word} · {p.why}</span>}</Cell>
                    <Cell phoneHide><Pill tone={p.tone}>{p.word}</Pill></Cell>
                    <Cell align="right" muted className="v2-ov-when">{when(f.created_at, now)}</Cell>
                  </Row>);
              })}
            </Table>}
          <div className="v2-ov-more"><ArrowLink to="/findings">All findings</ArrowLink></div>
        </TabPanel>
        <TabPanel id="radar">
          {!stories.length
            ? <Empty plain title={o.services.radar.connected ? "No stories yet" : "Radar isn't connected yet"}>
              {o.services.radar.connected ? "Radar reads the news on a schedule; its stories appear here." : "Ask the Platform Admin to connect it."}</Empty>
            : <Table label="Latest Radar stories" cols="76px minmax(0,1fr) 150px 96px" colsPhone="64px minmax(0,1fr) 84px" className="v2-ov-rows">
              {stories.map(r => {
                const p = storyPill(r);
                return (
                  <Row key={r.story_id} to={r.event_id ? `/events/${r.event_id}` : "/radar"} label={r.title}>
                    <Cell muted className="v2-ov-src"><Icon name="radar" />Radar</Cell>
                    <Cell>{r.title}</Cell>
                    <Cell phoneHide><Pill tone={p.tone}>{p.word}</Pill></Cell>
                    <Cell align="right" muted className="v2-ov-when">{when(r.last_seen_at, now)}</Cell>
                  </Row>);
              })}
            </Table>}
          <div className="v2-ov-more"><ArrowLink to="/radar">Open Radar</ArrowLink></div>
        </TabPanel>
      </Tabs>
    </section>
  );
}

// ---------------------------------------------------------------- needs you
const SHOWN = 3;
/** What needs a person, as rows: the alerts are the headline, so they are not a row again; late prices become one row. */
export function needRows(attention: Attention[]): Attention[] {
  const late = attention.filter(a => a.kind === "series");
  return [
    ...attention.filter(a => a.kind !== "alerts" && a.kind !== "series"),
    ...(late.length ? [{
      kind: "series", audience: "user", level: "info", link: "/series", at: null,
      title: late.length === 1 ? plainNote(late[0].title) : `${plural(late.length, "market price")} waiting for a new price`,
      detail: late.length === 1 ? null : late.map(a => a.title.split(":")[0]).join(", "),
    } as Attention] : []),
  ];
}
export function NeedsYou({ rows, more, adminNotes, hasAlerts }: { rows: Attention[]; more: number; adminNotes: number; hasAlerts: boolean }) {
  const [all, setAll] = useState(false);
  const list = all ? rows : rows.slice(0, SHOWN);
  const hidden = rows.length - SHOWN;
  const id = useId();
  return (
    <section aria-labelledby={`${id}-h`} className="v2-ov-needs">
      <SectionHead id={`${id}-h`} size="sm" title="Needs you" count={rows.length + more || undefined} countLabel="things that need you" />
      {!rows.length
        ? <Empty plain title={hasAlerts ? "Nothing else needs you" : "Nothing needs you right now"}>Approvals, failed checks, prices waiting for an update and gaps in your profile appear here.</Empty>
        : <ul className="v2-ov-needlist">{list.map((a, n) => {
          const inner = <>
            <span className={`v2-ov-need__dot is-${a.level}`} aria-hidden="true" />
            <span className="v2-ov-need__t">
              <span className="v2-ov-need__title"><span className="v2-sr">{needLevelWord(a.level)}</span>{plainNote(a.title)}</span>
              {a.detail && <span className="v2-ov-need__detail" title={friendlySeriesText(a.detail)}>{friendlySeriesText(a.detail)}</span>}
            </span>
            {a.link && <span className="v2-ov-need__go">{needAction(a.kind)}</span>}
          </>;
          return <li key={n}>{a.link ? <Link to={a.link} className="v2-rowlink v2-ov-need">{inner}</Link> : <div className="v2-ov-need">{inner}</div>}</li>;
        })}</ul>}
      {(hidden > 0 || more > 0) && (
        <p className="v2-ov-needmore v2-meta">
          {hidden > 0 && <button type="button" className="v2-ov-linkbtn" aria-expanded={all} onClick={() => setAll(v => !v)}>{all ? "Show fewer" : `+${plural(hidden, "more thing")}`}</button>}
          {more > 0 && <span>{hidden > 0 ? " · " : ""}and {more} more not listed here</span>}
        </p>
      )}
      {adminNotes > 0 && <p className="v2-meta v2-ov-needmore">{plural(adminNotes, "note")} about AMIRI Agent's own services {adminNotes === 1 ? "is" : "are"} with your Platform Admin.</p>}
    </section>
  );
}

// ---------------------------------------------------------------- prices
export function Prices({ markets }: { markets: Overview["markets"] }) {
  const r = priceRows(markets);
  const id = useId();
  if (!markets.length) return null;
  return (
    <section aria-labelledby={`${id}-h`} className="v2-ov-prices">
      <SectionHead id={`${id}-h`} size="sm" title="Prices"
        meta={<>{r.unusual > 0 && <Pill tone="unusual" mark="◆">{r.unusual} unusual</Pill>}{r.late > 0 && <Pill>{r.late} waiting for prices</Pill>}</>}
        action={<span className="v2-meta">change over 1 day</span>} />
      <Table label="Prices that need a look" cols="minmax(0,1fr) 80px 64px" colsPhone="minmax(0,1fr) 64px" className="v2-ov-prices__t">
        {r.shown.map(m => {
          const late = m.state === "stale";
          const since = late ? lateSince(m.state_reason) : null;
          return (
            <Row key={m.series_id} to={`/series/${m.series_id}`} label={`${seriesName(m.name)}: ${late ? "waiting for a new price" : "price and change"}`} className={`v2-ov-price${late ? " is-late" : ""}`}
              cols={late ? "minmax(0,1fr) auto" : undefined} colsPhone={late ? "minmax(0,1fr) auto" : undefined}>
              <Cell>
                <span className="v2-ov-price__name">{seriesName(m.name)}</span>
                <span className="v2-mono v2-muted v2-ov-price__px">{price(m.close)}</span>
                {late && <span className="v2-meta v2-ov-price__late">{since ? `No new price since ${since}` : "No new price lately"}</span>}
              </Cell>
              {late ? <Cell><Pill>Waiting for prices</Pill></Cell> : <>
                <Cell phoneHide><Sparkline values={m.spark} tone={m.state === "moved" ? "unusual" : "neutral"} /></Cell>
                <Cell align="right" num className="v2-ov-price__chg"><b>{pct(m.change_1d_pct, 1)}</b></Cell>
              </>}
            </Row>);
        })}
      </Table>
      <p className="v2-ov-pricesfoot"><ArrowLink to="/series">{r.others > 0 ? `${othersText(r.others, r.othersNormal)} · all ${markets.length} series` : `All ${markets.length} series`}</ArrowLink></p>
    </section>
  );
}

// ---------------------------------------------------------------- loading
export function OverviewSkeleton(): ReactNode {
  return (
    <div className="v2-ov v2-ov--loading">
      <h1 className="v2-sr">Overview</h1>
      <div className="v2-ov-hero" aria-hidden="true">
        <div className="v2-ov-hero__text">
          <SkBar w={240} h={13} />
          <SkBar w="min(420px, 100%)" h={56} />
          <SkBar w="min(340px, 100%)" h={56} />
          <SkBar w="min(460px, 100%)" h={17} />
        </div>
      </div>
      <Skeleton rows={6} label="Loading the Overview" />
    </div>
  );
}
