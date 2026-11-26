// Dev-only gallery of the v2 shared components at /dev/v2 (registered in App.tsx only when import.meta.env.DEV, so it is
// not in the production build). Every component in every state, with fixtures, no API calls. Grouped like board 13
// (docs/ux/v2/pages/13_*), each specimen labelled with the API field that switches it. The Shell's toggle switches the theme.
import { useState, type ReactNode } from "react";
import { Icon } from "../../components/Icon";
import { useRefusalToast, useToast } from "../../components/ui";
import { AgentState } from "../../components/v2/AgentState";
import { ArrowLink } from "../../components/v2/ArrowLink";
import { Button } from "../../components/v2/Button";
import { Checkbox, RadioGroup, Segmented, Switch } from "../../components/v2/Choice";
import { Dialog, type DialogSize } from "../../components/v2/Dialog";
import { Field, Input, Select, Textarea } from "../../components/v2/Field";
import { FileDrop } from "../../components/v2/FilePicker";
import { Count } from "../../components/v2/Count";
import { Direction, DirectionMark, DirectionPill } from "../../components/v2/Direction";
import { DotMap, type DotPlace } from "../../components/v2/DotMap";
import { EditConflict } from "../../components/v2/EditConflict";
import { Empty } from "../../components/v2/Empty";
import { LivePill, type LiveState } from "../../components/v2/LivePill";
import { LoadError } from "../../components/v2/LoadError";
import { Pill } from "../../components/v2/Pill";
import { SectionHead } from "../../components/v2/SectionHead";
import { Skeleton } from "../../components/v2/Skeleton";
import { Sparkline } from "../../components/v2/Sparkline";
import { StaleBanner } from "../../components/v2/StaleBanner";
import { StatTile, StatTiles } from "../../components/v2/StatTile";
import { Cell, Row, Table } from "../../components/v2/Table";
import { TabPanel, Tabs } from "../../components/v2/Tabs";
import { RefusalToast } from "../../components/v2/Toasts";
import { ChecksOff, Verdict } from "../../components/v2/Verdict";
import { VERDICT_ORDER } from "../../components/v2/verdictWords";
import { WorldMark } from "../../components/v2/WorldMark";
import { useCrumbs } from "../../components/v2/Shell";
import "./V2Gallery.css";

// ---- fixtures
const LIVE: LiveState[] = [
  { tone: "live", word: "Live", why: "updates ran 4 min ago" },
  { tone: "late", word: "Waiting for prices", why: "Clean energy fund: no new price since 09:00" },
  { tone: "idle", word: "Updates delayed", why: "last ran 2 h ago" },
  { tone: "idle", word: "Not watching yet", why: "set up an institution" },
  { tone: "down", word: "No answer", why: "trying again every minute" },
];
const PRICES = [
  { name: "Natural gas fund", sym: "UNG", px: "14.92", chg: "+6.4%", tone: "unusual" as const, v: [18, 17, 18, 16, 17, 15, 12, 6, 3].map(n => 24 - n) },
  { name: "Semiconductor fund", sym: "SMH", px: "231.80", chg: "−5.2%", tone: "unusual" as const, v: [6, 7, 6, 8, 7, 9, 13, 17, 20].map(n => 24 - n) },
  { name: "Regional bank fund", sym: "KRE", px: "48.15", chg: "−3.9%", tone: "unusual" as const, v: [8, 9, 8, 9, 10, 9, 12, 15, 18].map(n => 24 - n) },
  { name: "Gold fund", sym: "GLD", px: "212.40", chg: "+0.4%", tone: "neutral" as const, v: [10, 11, 10, 11, 12, 11, 12, 12, 13].map(n => 24 - n) },
];
const EVENTS: { title: string; tone: string; word?: string; n: number; where: string; when: string }[] = [
  { title: "Texas power prices spike", tone: "bad", n: 5, where: "Texas", when: "2 h ago" },
  { title: "Startup funding rounds shrink", tone: "mixed", n: 3, where: "Silicon Valley", when: "yesterday" },
  { title: "Oil prices rise", tone: "good", n: 2, where: "Permian Basin", when: "yesterday" },
  { title: "Port strike ends", tone: "neutral", n: 0, where: "Colombo", when: "3 days ago" },
];
const US_FIT: [number, number][] = [[-125, 24], [-66, 50]];
const US_PLACES: DotPlace[] = [
  { label: "Austin", lon: -97.74, lat: 30.27, tone: "bad", strong: true, halo: true },
  { label: "Texas", lon: -99.3, lat: 31.5, tone: "bad", side: "top" },
  { label: "Permian", lon: -102.1, lat: 31.9, tone: "good", side: "left" },
  { label: "Silicon Valley", lon: -122.1, lat: 37.4, tone: "mixed" },
];
const LK_PLACES: DotPlace[] = [
  { label: "Colombo", lon: 79.86, lat: 6.93, tone: "bad", strong: true, halo: true, side: "left" },
  { label: "Hambantota", lon: 81.12, lat: 6.12, tone: "good", side: "bottom" },
  { label: "Jaffna", lon: 80.0, lat: 9.67, tone: "mixed", side: "right" },
];

// ---- layout helpers
function Section({ n, title, lede, children }: { n: string; title: string; lede: string; children: ReactNode }) {
  return (
    <section className="gal-sec" aria-labelledby={`gal-${n}`}>
      <div className="v2-cap">{n}</div>
      <h2 id={`gal-${n}`} className="v2-h2 gal-h">{title}</h2>
      <p className="gal-lede">{lede}</p>
      <div className="gal-grid">{children}</div>
    </section>
  );
}
function Spec({ name, field, wide, children }: { name: string; field?: string; wide?: boolean; children: ReactNode }) {
  return (
    <div className={`gal-spec${wide ? " is-wide" : ""}`}>
      <div className="gal-spec__h"><b>{name}</b>{field && <span className="v2-mono v2-muted">{field}</span>}</div>
      {children}
    </div>
  );
}

export default function V2Gallery() {
  useCrumbs([{ label: "Dev" }, { label: "Components" }]);
  const toast = useToast(), refuse = useRefusalToast();
  const [tab, setTab] = useState("findings");
  const [alertTab, setAlertTab] = useState("new");
  const [picked, setPicked] = useState("UNG");
  const [stale, setStale] = useState(Date.now() - 3 * 60_000);
  const [retries, setRetries] = useState(0);
  const [reloaded, setReloaded] = useState(0);
  const [gone, setGone] = useState(false);
  const [txt, setTxt] = useState("Austin Tech Bank");
  const [grow, setGrow] = useState("A note that grows with its text.\nA second line.");
  const [sel, setSel] = useState("bank");
  const [chk, setChk] = useState(true);
  const [sw, setSw] = useState(true);
  const [rad, setRad] = useState<"bank" | "insurer" | "file">("bank");
  const [seg, setSeg] = useState<"low" | "medium" | "high">("medium");
  const [dropMsg, setDropMsg] = useState("Nothing chosen yet.");
  const [dlg, setDlg] = useState<null | { size: DialogSize; danger?: boolean; long?: boolean }>(null);

  return (
    <div className="gal">
      <header>
        <div className="v2-cap">Dev only · /dev/v2</div>
        <h1 className="gal-title">Shared components</h1>
        <p className="gal-lede">Every component in every state, with fixtures (no API calls). Grouped as board 13, each specimen labelled with the API field that switches it.
          The theme toggle is in the top bar. This route is not in the production build.</p>
      </header>

      <Section n="0 · Everyday" title="Buttons, pills, marks" lede="Boards 00, 01, 04, 07. Buttons have three variants and three sizes; icon-only buttons need a label.">
        <Spec name="Buttons" field="variant · size">
          <div className="gal-row"><Button variant="primary">Acknowledge</Button><Button>Resolve</Button><Button variant="quiet">Draft from your profile</Button></div>
          <div className="gal-row"><Button variant="primary" size="sm">Reload</Button><Button size="sm">Investigate now</Button><Button variant="quiet" size="sm">Open</Button></div>
          <div className="gal-row"><Button as="link" to="/home" variant="primary" size="lg">Review the alerts →</Button><Button as="link" to="/events" size="lg">4 open events</Button></div>
        </Spec>
        <Spec name="Busy (F3)" field="busy · busyLabel: the label stays, a spinner sits over it, the width never changes">
          <div className="gal-row"><Button variant="primary" busy busyLabel="Checking…">Check now</Button><Button busy busyLabel="Saving…">Save</Button><Button variant="quiet" busy>Refresh now</Button></div>
        </Spec>
        <Spec name="Disabled and locked" field="disabled · demoLock (locked)">
          <div className="gal-row">
            <Button disabled>Check now</Button>
            <Button variant="primary" locked>Save changes</Button>
            <Button locked>Reset</Button>
            <Button as="link" to="/institution/new" locked>New institution</Button>
          </div>
          <p className="v2-meta">Locked ones stay on screen, greyed and focusable (Tab to them), with the reason on hover and focus; a click does nothing.</p>
        </Spec>
        <Spec name="Icon only" field="icon + label (aria-label)">
          <div className="gal-row">
            <Button icon label="Edit the name" variant="quiet"><Icon name="edit" /></Button>
            <Button icon label="Close" variant="quiet" size="sm"><Icon name="x" /></Button>
            <Button icon label="Switch to dark theme"><Icon name="moon" /></Button>
            <Button icon label="Delete the scenario" locked><Icon name="trash" /></Button>
          </div>
        </Spec>
        <Spec name="Pills" field="tone · dashed · mark">
          <div className="gal-row">
            <Pill tone="bad">Early warning</Pill><Pill tone="unusual">Developing</Pill><Pill tone="good">In an event</Pill><Pill tone="neutral">Being investigated</Pill>
            <Pill tone="brand">Recommended</Pill><Pill tone="ink">Commercial banking</Pill><Pill tone="sim">Simulated</Pill><Pill dashed>Test</Pill><Pill tone="unusual" mark="◆">Unusual</Pill>
          </div>
        </Spec>
        <Spec name="Count chips" field="alerts.to_review · counts">
          <div className="gal-row">
            <Count n={18} /><Count n={3} tone="hot" label="alerts to review" /><Count n={3} tone="unusual" label="unusual" /><Count n={0} />
            <span className="v2-meta">Findings <Count n={18} /> · Alerts <Count n={3} tone="hot" label="to review" /></span>
          </div>
        </Spec>
        <Spec name="Direction" field="event.tone: bad · mixed · good · neutral">
          <div className="gal-col">
            {EVENTS.map(e => <div key={e.tone} className="gal-row"><Direction tone={e.tone} showWord /><Direction tone={e.tone} /><DirectionPill tone={e.tone} /><span className="v2-meta">(second: mark only, the words are read out)</span></div>)}
          </div>
        </Spec>
      </Section>

      <Section n="0b · Lists" title="Tabs, tables, rows, sections" lede="The row lists of boards 00, 04 and 07. A row is a link or a selection; the whole row is the target and a real link or button is what the keyboard reaches.">
        <Spec name="Tabs (board 00)" field="counts.findings · counts.radar" wide>
          <Tabs label="What came in" value={tab} onChange={setTab} tabs={[{ id: "findings", label: "Findings", count: 18 }, { id: "radar", label: "Radar", count: 3 }]}>
            <TabPanel id="findings">
              <Table label="Findings" cols="76px minmax(0,1fr) auto 44px" colsPhone="76px minmax(0,1fr) 44px">
                <Row to="/dev/v2#findings" label="ERCOT asks Texans to cut power use as prices hit the cap">
                  <Cell muted><Icon name="monitor" /> Monitor</Cell><Cell>ERCOT asks Texans to cut power use as prices hit the cap</Cell><Cell phoneHide><Pill tone="good">In an event</Pill></Cell><Cell align="right" muted>09:40</Cell>
                </Row>
                <Row to="/dev/v2#findings" label="Natural gas fund up 6.4% in 1 day">
                  <Cell muted><Icon name="series" /> Price</Cell><Cell>Natural gas fund up 6.4% in 1 day, 4.1× a usual day</Cell><Cell phoneHide><Pill tone="good">In an event</Pill></Cell><Cell align="right" muted>09:00</Cell>
                </Row>
              </Table>
              <div className="gal-more"><ArrowLink to="/findings">All findings</ArrowLink></div>
            </TabPanel>
            <TabPanel id="radar"><Table label="Radar" cols="76px minmax(0,1fr) 44px"><Row><Cell muted>Radar</Cell><Cell>Austin chipmaker plans 1,200 job cuts</Cell><Cell align="right" muted>08:15</Cell></Row></Table></TabPanel>
          </Tabs>
        </Spec>
        <Spec name="Tabs with a red count and filters (board 01)" field="alerts.to_review · acknowledged · resolved" wide>
          <Tabs label="Status" value={alertTab} onChange={setAlertTab}
            tabs={[{ id: "new", label: "New", count: 3, countTone: "hot", countLabel: "to review" }, { id: "ack", label: "Acknowledged", count: 5 }, { id: "res", label: "Resolved", count: 9 }]}
            trailing={<label className="gal-sel">Team <Select inline defaultValue="all"><option value="all">All teams (3)</option><option>Retail banking (2)</option></Select></label>}>
            <TabPanel id={alertTab}><p className="v2-meta gal-pad">Panel for “{alertTab}”. Tab onto the row, then ←/→ or Home/End.</p></TabPanel>
          </Tabs>
        </Spec>
        <Spec name="Table with a header (board 07)" field="series[]  ·  selected row" wide>
          <Table label="Market series" cols="minmax(0,1fr) 70px 58px 74px 112px" colsPhone="minmax(0,1fr) 70px 58px" closed
            columns={[{ label: "Series · unusual first" }, { label: "Price", align: "right" }, { label: "1 day", align: "right" }, { label: "30 days", phoneHide: true }, { label: "State", phoneHide: true }]}>
            {PRICES.map(p => (
              <Row key={p.sym} onSelect={() => setPicked(p.sym)} selected={picked === p.sym} label={`${p.name}, ${p.sym}`} className="gal-tight">
                <Cell><b className="gal-name">{p.name}</b><span className="v2-mono v2-muted">{p.sym}</span></Cell>
                <Cell align="right" num>{p.px}</Cell><Cell align="right" num><b>{p.chg}</b></Cell>
                <Cell phoneHide><Sparkline values={p.v} tone={p.tone} width={70} height={22} /></Cell>
                <Cell phoneHide>{p.tone === "unusual" ? <Pill tone="unusual" mark="◆">Unusual</Pill> : <Pill>Normal</Pill>}</Cell>
              </Row>
            ))}
          </Table>
        </Spec>
        <Spec name="Open events (board 00)" field="events[].tone · hypotheses">
          <SectionHead title="Open events" count={4} countLabel="open events" action={<ArrowLink to="/events">All events</ArrowLink>} />
          <Table label="Open events" cols="14px minmax(0,1fr) 112px 92px 72px" colsPhone="14px minmax(0,1fr) 112px" className="gal-events">
            {EVENTS.map(e => (
              <Row key={e.title} to="/dev/v2#events" label={e.title}>
                <Cell><DirectionMark tone={e.tone} /></Cell><Cell><b className="v2-title-lg">{e.title}</b></Cell>
                <Cell><DirectionPill tone={e.tone} /></Cell><Cell phoneHide><b className="v2-num">{e.n}</b> effects</Cell><Cell phoneHide align="right" muted>{e.when}</Cell>
              </Row>
            ))}
          </Table>
        </Spec>
        <Spec name="Prices (board 00)" field="markets[].state · sparkline">
          <SectionHead size="sm" level={3} title="Prices" meta={<Pill tone="unusual" mark="◆">3 unusual</Pill>} action={<span className="v2-meta">1 day</span>} />
          <Table label="Prices" cols="minmax(0,1fr) 80px 64px">
            {PRICES.slice(0, 3).map(p => (
              <Row key={p.sym} className="gal-price">
                <Cell><div className="gal-name">{p.name}</div><div className="v2-mono v2-muted">{p.sym} · {p.px}</div></Cell>
                <Cell><Sparkline values={p.v} tone={p.tone} /></Cell><Cell align="right" num><b>{p.chg}</b></Cell>
              </Row>
            ))}
            <Row className="gal-price"><Cell><div className="gal-name">Clean energy fund</div><div className="v2-mono v2-muted">ICLN · 13.40</div></Cell><Cell><Pill>Waiting for prices</Pill></Cell><Cell align="right" muted className="gal-late">no new price since 09:00</Cell></Row>
          </Table>
        </Spec>
        <Spec name="Overview tiles (board 00)" field="counts · alerts_to_review" wide>
          <StatTiles label="Today, step by step">
            <StatTile caption="1 · Watching" value={30} meta="7 monitors · 22 prices · Radar" to="/monitors" />
            <StatTile caption="2 · Found, last 24 h" value={18} meta="9 monitors · 3 prices · 6 Radar" to="/findings" />
            <StatTile caption="3 · Traced to you" value={4} meta="open events · 14 effects to watch" to="/events" />
            <StatTile caption="4 · Who must act" value={3} meta="alerts for 2 teams" tone="act" to="/alerts" />
          </StatTiles>
        </Spec>
        <Spec name="Dotted map (board 00)" field="events[].places[] · role=img, aria-label names the places" wide>
          <div className="gal-maps">
            <DotMap places={US_PLACES} fit={US_FIT} />
            <DotMap places={LK_PLACES} fit={[[79.4, 5.7], [82.0, 9.9]]} minSpan={8} intro="Where the bank's events are" />
          </div>
        </Spec>
        <Spec name="Empty" field="events.length = 0 · findings waiting = 0">
          <Empty title="Nothing open right now" action={<Button as="link" to="/studio" variant="secondary" size="sm">Try a what-if</Button>}>AMIRI Agent is watching 30 sources. Open events appear here.</Empty>
          <Empty title="No alerts for your teams" plain>AMIRI Agent is following 2 open events; none needs a team yet.</Empty>
        </Spec>
      </Section>

      <Section n="0c · Forms" title="Fields, inputs, choices" lede="One height (40 px, 44 under 720 px), one border (--v2-line-input), one focus ring, one error look. A Field ties its label, hint and error to the control with aria-describedby. Hover: move the pointer over a control, its border steps up. Focus: press Tab; the ring is the second column.">
        <Spec name="Input and Textarea: default, hover, focus, error, disabled, locked" field="Field · Input · Textarea" wide>
          <div className="gal-forms">
            <Field label="Default" hint="A hint under the field."><Input value={txt} onChange={e => setTxt(e.target.value)} placeholder="Placeholder" /></Field>
            <Field label="Empty, with a placeholder"><Input defaultValue="" placeholder="e.g. Business Current Account" /></Field>
            <Field req label="Focused (Tab here)"><Input autoFocus={false} defaultValue="Tab to me" /></Field>
            <Field req label="With an error" error="Give it a name of at least 3 characters."><Input defaultValue="ab" /></Field>
            <Field label="Disabled" hint="Cannot be changed."><Input defaultValue="Locked by the system" disabled /></Field>
            <Field label="Locked by the demo" hint="Hover or focus it to see why."><Input defaultValue="Austin Tech Bank" locked /></Field>
            <Field label="Mono, for codes"><Input mono defaultValue="US-TX-0042" /></Field>
            <Field label="Search"><Input type="search" placeholder="Find a series or symbol" /></Field>
            <Field label="Auto-grow textarea" hint="Grows to 12 lines, then scrolls." optional><Textarea autoGrow value={grow} onChange={e => setGrow(e.target.value)} /></Field>
            <Field label="Textarea with an error" error="Say what to watch for in at least 10 characters."><Textarea defaultValue="Short" rows={2} /></Field>
          </div>
        </Spec>
        <Spec name="Select: default, error, disabled, locked, inline (filters)" field="Select">
          <div className="gal-forms">
            <Field label="Default"><Select value={sel} onChange={e => setSel(e.target.value)}><option value="bank">Bank</option><option value="insurer">Insurer</option></Select></Field>
            <Field label="With an error" error="Choose one."><Select defaultValue=""><option value="">Choose…</option><option>Retail</option></Select></Field>
            <Field label="Disabled"><Select disabled defaultValue="a"><option value="a">Not available</option></Select></Field>
            <Field label="Locked by the demo"><Select locked defaultValue="a"><option value="a">Weaker</option></Select></Field>
          </div>
          <div className="gal-row"><label className="gal-sel">Sort <Select inline defaultValue="a"><option value="a">Newest first</option><option>Most serious</option></Select></label></div>
        </Spec>
        <Spec name="Checkbox, Switch" field="Checkbox · Switch">
          <div className="gal-col">
            <Checkbox checked={chk} onChange={e => setChk(e.target.checked)} label="Islamic or takaful variant" hint="Shown on the Metrics Spec." />
            <Checkbox label="Unticked" />
            <Checkbox label="Disabled" disabled />
            <Checkbox label="Locked by the demo" locked defaultChecked />
            <Switch checked={sw} onChange={e => setSw(e.target.checked)} label="A currency slide hits importers" />
            <Switch large checked={sw} onChange={e => setSw(e.target.checked)} label="Checks against your data" />
            <Switch label="Disabled" disabled />
            <Switch label="Locked by the demo" locked defaultChecked />
          </div>
        </Spec>
        <Spec name="Radio group: list and cards" field="RadioGroup">
          <RadioGroup legend="List" variant="list" value={rad} onChange={setRad}
            options={[{ value: "bank", label: "Bank", description: "Branches, loans and deposits" }, { value: "insurer", label: "Insurer", description: "Policies and claims" }, { value: "file", label: "Import a file", disabled: true, why: "Switched off here." }]} />
          <RadioGroup legend="Cards (Data connection sources)" variant="cards" value={rad} onChange={setRad}
            options={[{ value: "bank", label: "The sample bank", description: "Shaped by your profile" }, { value: "insurer", label: "The sample insurer", description: "A bundled insurer", disabled: true, why: "Only for an insurer: this institution is a bank." }, { value: "file", label: "Import a JSON file", description: "Your own figures" }]} />
          <RadioGroup legend="Locked by the demo" variant="cards" locked value="bank" onChange={() => {}} options={[{ value: "bank", label: "The sample bank", description: "Greyed, focusable" }, { value: "insurer", label: "The sample insurer" }]} />
        </Spec>
        <Spec name="Segmented" field="Segmented">
          <div className="gal-col">
            <Segmented caption label="How hard it hits" value={seg} onChange={setSeg} options={[{ value: "low", label: "Low" }, { value: "medium", label: "Medium" }, { value: "high", label: "High" }]} />
            <Segmented caption label="Locked by the demo" locked value="medium" onChange={() => {}} options={[{ value: "low", label: "Low" }, { value: "medium", label: "Medium" }, { value: "high", label: "High" }]} />
          </div>
        </Spec>
        <Spec name="File drop: button and zone" field="FileDrop (drop a file on either; a wrong kind says why)">
          <FileDrop accept="application/json,.json" noun="a JSON file" pickLabel="Fill from a JSON file" onFile={f => setDropMsg(`Chose ${f.name}`)} onReject={setDropMsg} />
          <FileDrop variant="zone" accept="application/json,.json" noun="a JSON file" maxBytes={2 * 1024 * 1024} label="Drop a JSON file here" hint="One file, up to 2 MB." pickLabel="Choose a file" size="md"
            onFile={f => setDropMsg(`Chose ${f.name}`)} onReject={setDropMsg}><a href="/dev/v2#drop">Download an example file</a></FileDrop>
          <FileDrop variant="zone" locked label="Drop a JSON file here" hint="Locked by the demo." pickLabel="Choose a file" size="md" onFile={() => {}} />
          <p className="v2-meta" role="status">{dropMsg}</p>
        </Spec>
      </Section>

      <Section n="0d · Dialogs" title="One layout, three sizes" lede="Header (title, optional line), a body that scrolls on its own, a footer with the actions right-aligned (primary last). S 400, M 560, L 760. Under 720 px it is a bottom sheet: narrow the window to see it. Esc closes; focus returns here.">
        <Spec name="Open one" field="Dialog size · tone · description · actions" wide>
          <div className="gal-row">
            <Button onClick={() => setDlg({ size: "S" })}>Size S (400)</Button>
            <Button onClick={() => setDlg({ size: "M" })}>Size M (560)</Button>
            <Button onClick={() => setDlg({ size: "L" })}>Size L (760)</Button>
            <Button onClick={() => setDlg({ size: "S", danger: true })}>Danger</Button>
            <Button onClick={() => setDlg({ size: "M", long: true })}>Long content</Button>
          </div>
        </Spec>
      </Section>
      {dlg && (
        <Dialog size={dlg.size} tone={dlg.danger ? "danger" : "default"} onClose={() => setDlg(null)}
          title={dlg.danger ? "Delete this scenario?" : dlg.long ? "A long form" : `A size ${dlg.size} dialog`}
          description={dlg.danger ? undefined : "One line saying what this is about."}
          actions={<>
            {dlg.size === "L" && !dlg.danger && <Button variant="quiet" className="v2-dlg__aside">Ask the Setup agent instead</Button>}
            <Button onClick={() => setDlg(null)}>Cancel</Button>
            <Button variant="primary" onClick={() => setDlg(null)}>{dlg.danger ? "Delete it" : "Save"}</Button></>}>
          {dlg.danger ? <p><b>Port strike</b> and its runs will be gone. This can't be undone.</p> : (
            <>
              <Field req label="Name"><Input defaultValue="Port strike" /></Field>
              <Field label="Kind"><Select defaultValue="a"><option value="a">Country</option></Select></Field>
              {dlg.long && Array.from({ length: 10 }, (_, i) => <Field key={i} label={`Field ${i + 3}`} hint="The body scrolls; the header and footer stay."><Input defaultValue={`Value ${i + 3}`} /></Field>)}
            </>)}
        </Dialog>)}

      <Section n="1 · Status" title="The Live pill, five states" lede="Sits in the sidebar on every page. The word says the state; the line says why. Comes from the Overview call the page already makes.">
        <Spec name="Live, Waiting for prices, Updates delayed, Not watching yet, No answer" field="services.tick.ok · markets[].state · first_run · request failed" wide>
          <div className="gal-row gal-live">{LIVE.map(l => <LivePill key={l.word} live={l} />)}</div>
        </Spec>
      </Section>

      <Section n="2 · Loading and failure" title="Skeleton, load error, stale banner" lede="One of each, reused by every page. The skeleton keeps the row shape so nothing jumps when data arrives.">
        <Spec name="Loading" field="any list call in flight"><Skeleton rows={4} label="Loading the alerts" /></Spec>
        <Spec name="Load error" field="request failed / 5xx">
          <LoadError what="the alerts" safe="Your alerts are safe; this page just couldn't reach them." error={{ code: "network", status: 0 }} onRetry={() => new Promise(r => setTimeout(() => { setRetries(n => n + 1); r(null); }, 700))} />
          <p className="v2-meta">Tried again {retries} time{retries === 1 ? "" : "s"}.</p>
        </Spec>
        <Spec name="Load error, a refusal" field="4xx with a detail">
          <LoadError what="the series" error={{ code: "not_found", status: 404, detail: "No market series with that id." }} onRetry={() => {}} />
        </Spec>
        <Spec name="Refresh failed, data kept" field="Overview's 60 s refresh failed" wide>
          <StaleBanner loadedAt={stale} onRetry={() => setStale(Date.now())} />
          <div className="gal-row"><Button size="sm" onClick={() => setStale(Date.now() - 3 * 60_000)}>Reset to 3 min ago</Button><Button size="sm" onClick={() => setStale(Date.now() - 2 * 3600_000)}>2 h ago</Button></div>
        </Spec>
      </Section>

      <Section n="3 · When the server says no" title="Edit conflicts and refusals" lede="Saves send If-Match; a 412 means someone else saved first. Every refusal has a code and a detail: show the detail as the message and the code small, for support.">
        <Spec name="Edit conflict" field="412 on PATCH with If-Match">
          <EditConflict what="this product" name="Capital-Call Lines" when="2 min ago" onReload={() => setReloaded(n => n + 1)} onCopy={() => navigator.clipboard?.writeText("my unsaved text")} />
          <p className="v2-meta">Reload pressed {reloaded} time{reloaded === 1 ? "" : "s"}.</p>
        </Spec>
        <Spec name="Refusal toast" field="problem: code + detail (e.g. budget_spent, simulation_running)">
          {!gone && <RefusalToast ms={0} title="Radar's budget for today is spent" message="Check now works again after midnight. Scheduled reads still run." code="budget_spent" onClose={() => setGone(true)} />}
          {gone && <Button size="sm" onClick={() => setGone(false)}>Show it again</Button>}
          <RefusalToast ms={0} message="A simulation is already running. Wait for it to finish or stop it." code="simulation_running" onClose={() => {}} />
        </Spec>
        <Spec name="Live toasts (the app's own host)" field="useToast() · useRefusalToast()">
          <div className="gal-row">
            <Button size="sm" onClick={() => toast("Saved.")}>Info toast</Button>
            <Button size="sm" onClick={() => refuse({ code: "budget_spent", status: 409, detail: "Radar's budget for today is spent. Check now works again after midnight." })}>Refusal toast</Button>
            <Button size="sm" onClick={() => refuse({ code: "simulation_running", status: 409, detail: "A simulation is already running." }, "Can't start a second run")}>With a title</Button>
          </div>
          <p className="v2-meta">They close after a few seconds, but not while the pointer or focus is on them. Esc closes the one with focus; × is reachable by Tab.</p>
        </Spec>
      </Section>

      <Section n="4 · Which world" title="Test and simulated items" lede="Findings and events carry world. Live is unmarked. Sandbox items are marked Test; Studio items Simulated, in their own colour, and both stay out of live counts and the Overview.">
        <Spec name="Markers" field="world: live · sandbox · studio" wide>
          <Table label="Worlds" cols="auto minmax(0,1fr) auto">
            <Row><Cell><WorldMark world="sandbox" /></Cell><Cell>Natural gas fund down 5% in 1 day (a test move)</Cell><Cell muted>from Try a move</Cell></Row>
            <Row><Cell><WorldMark world="studio" /></Cell><Cell>Texas chip output halts</Cell><Cell muted>Studio · day 4</Cell></Row>
            <Row><Cell><WorldMark world="live" /></Cell><Cell>Live (no mark: this row has nothing before it)</Cell><Cell muted>world = live</Cell></Row>
          </Table>
        </Spec>
      </Section>

      <Section n="5 · Your data says" title="Every verdict, and checks switched off" lede="The words are the server's verdict_text. When validation_enabled is false, the column shows Checks off with the way to turn them on, never an empty cell.">
        <Spec name="All seven verdicts" field="check.verdict">
          <div className="gal-row">{VERDICT_ORDER.map(v => <Verdict key={v} verdict={v} />)}</div>
        </Spec>
        <Spec name="A verdict in full" field="verdict_text · line · final · supersedes">
          <Verdict full verdict="confirms" text="confirms" line="+6.1% against the prior periods, seasonally adjusted" final={false} supersedes={{ verdict: "not_yet" }} />
        </Spec>
        <Spec name="Checks off" field="data-connection.validation_enabled = false">
          <Table label="An effect" cols="minmax(0,1fr) minmax(0,1fr)">
            <Row className="gal-tight"><Cell>Credit-line utilisation ↑ 3–8%</Cell><Cell><ChecksOff action={<a href="/dev/v2#checks">Turn on checks against your data</a>} /></Cell></Row>
          </Table>
        </Spec>
      </Section>

      <Section n="6 · The agents" title="Waking up and offline" lede="Cloud Run sleeps idle agents. Say so in plain words, say what still works, and disable only the buttons that need the missing agent.">
        <Spec name="Setup agent starting" field="assistant/status.starting · keep_warm_seconds"><AgentState kind="waking" /></Spec>
        <Spec name="Investigation offline" field="investigation:status.connected = false · findings_waiting">
          <AgentState kind="offline" title="The investigation is offline." meta="checked 1 min ago">6 findings wait; they're picked up as soon as it's back.</AgentState>
        </Spec>
        <Spec name="Radar offline" field="services.radar.connected = false">
          <AgentState kind="offline" tone="idle" title="Radar isn't connected." action={<Button size="sm" disabled>Check now</Button>}>Monitors and prices still run.</AgentState>
        </Spec>
      </Section>

      <Section n="7 · Dark mode" title="Tokens for both themes" lede="Every component here uses --v2- tokens only. Use the theme toggle in the top bar; the two themes share these specimens.">
        <Spec name="A sample" field="light / dark" wide>
          <div className="gal-sample">
            <div className="gal-sample__row"><DirectionMark tone="bad" size={16} /><b className="v2-title">Texas power prices spike</b><DirectionPill tone="bad" /><span className="v2-meta">5 effects</span></div>
            <div className="gal-sample__row"><DirectionMark tone="mixed" size={16} /><b className="v2-title">Startup funding rounds shrink</b><DirectionPill tone="mixed" /><span className="v2-meta">3 effects</span></div>
            <div className="gal-row"><Button variant="primary">Review the alerts →</Button><Button>4 open events</Button></div>
          </div>
        </Spec>
      </Section>

      <Section n="8 · Go to" title="A jump list, not a search" lede="The Go to box is part of the shell (T2). Press ⌘K / Ctrl K, or use the top bar button. Its footer is one line.">
        <Spec name="Open it" field="client-side over /events?status=open, /monitors, /series, profile">
          <p className="v2-meta">Press ⌘K here.</p>
        </Spec>
      </Section>
    </div>
  );
}
