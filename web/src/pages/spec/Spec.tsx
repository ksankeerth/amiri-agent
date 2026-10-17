// The Metrics Spec, for both roles: the guide, every category's metrics with their definitions and how they are
// judged, the dimensions, and the conformance checks. Each metric has its own anchor (#metric-<key>), so the
// connector's report and the event page link straight to its definition. /spec/print is the same body laid out for
// the PDF (`uv run amiri spec-pdf`).
import { useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import { ApiError } from "../../api/client";
import { specApi, type Spec, type SpecCategory, type SpecDimension, type SpecMetric } from "../../api/spec";
import { Icon } from "../../components/Icon";
import { Markdown, ScrollTable } from "../../components/markdown";
import { Banner, PageHead, PageSkeleton } from "../../components/ui";

const words = (s: string) => s.replace(/_/g, " ");
const TIER: Record<string, string> = { required: "b-ok", recommended: "b-info", optional: "b-sub" };
const GUIDE_BEFORE = ["1", "2", "3"], GUIDE_AFTER = ["8", "10", "11", "12", "13"];
// the guide's sections, in its order: the structured ones are drawn from the YAML
const CONTENTS: [string, string][] = [
  ["s1", "1. Purpose, audience and versioning"], ["s2", "2. General data rules"], ["s3", "3. Capability levels"],
  ["s4", "4. Product taxonomy"], ["s5", "5. Metrics per category"], ["s6", "6. Validation parameters"],
  ["s7", "7. Standard dimensions"], ["s8", "8. Breaks and events"], ["s9", "9. Conformance checks and errors"],
  ["s10", "10. Open points and assumptions"], ["s11", "11. Event themes each category helps check"],
  ["s12", "12. Counts"], ["s13", "13. Common misreadings"], ["changes", "Change log"],
];

/** Metric ids: the first category to define a key owns #metric-<key>; later ones add the category. */
function anchors(cats: SpecCategory[]): Map<string, string> {
  const seen = new Set<string>(), out = new Map<string, string>();
  for (const c of cats) for (const m of c.metrics ?? []) {
    out.set(`${c.id}/${m.key}`, seen.has(m.key) ? `metric-${m.key}-${c.id}` : `metric-${m.key}`);
    seen.add(m.key);
  }
  return out;
}

const matches = (m: SpecMetric, q: string) => !q || [m.key, m.name, m.question].some(x => x.toLowerCase().includes(q));

function Fold({ print, summary, children }: { print: boolean; summary: string; children: React.ReactNode }) {
  return print ? <div className="sp-fold"><div className="label">{summary}</div>{children}</div>
    : <details className="sp-fold"><summary>{summary}</summary>{children}</details>;
}

function MetricCard({ m, id, print }: { m: SpecMetric; id: string; print: boolean }) {
  const d = m.definition, v = m.validation;
  return (
    <article className="sp-metric" id={id} aria-labelledby={`${id}-h`}>
      <div className="row wrap" style={{ gap: 8 }}>
        <h4 id={`${id}-h`}>{m.name}</h4><code>{m.key}</code>
        <span className={`badge ${TIER[m.tier] ?? "b-sub"}`}>{m.tier.toUpperCase()}</span>
        {m.starter && <span className="badge b-info">STARTER</span>}
        {m.deprecated_in && <span className="badge b-warn">DEPRECATED IN {m.deprecated_in}{m.replaced_by ? ` → ${m.replaced_by}` : ""}</span>}
        {m.since !== "1.0.0" && <span className="chip">new in {m.since}</span>}
      </div>
      <p className="sp-q">{m.question}</p>
      <dl className="sp-facts">
        <div><dt>Kind</dt><dd>{m.kind}</dd></div><div><dt>Unit</dt><dd>{words(m.unit)}</dd></div>
        <div><dt>Grain</dt><dd>{m.grain}</dd></div><div><dt>Currency</dt><dd>{m.currency_rule}</dd></div>
        <div><dt>Published within</dt><dd>{m.max_lag_days} day{m.max_lag_days === 1 ? "" : "s"}{m.max_lag_rule ? ` (${m.max_lag_rule})` : ""}</dd></div>
        <div><dt>History</dt><dd>{m.history_months} months</dd></div>
        {m.adverse?.length ? <div><dt>Adverse</dt><dd>{m.adverse.join(", ")}</dd></div> : null}
        <div><dt>For</dt><dd>{Array.isArray(m.applies_to) ? m.applies_to.map(words).join(", ") : "every product type"}</dd></div>
      </dl>
      {m.breakdowns.length > 0 && <div className="small"><b>Breakdowns:</b> {m.breakdowns.map((b, i) => <span key={b}>{i ? ", " : ""}<a href={`#dim-${b}`}>{words(b)}</a></span>)}</div>}
      <Fold print={print} summary="Definition">
        <div className="small col" style={{ gap: 4 }}>
          {d.numerator && <div><b>Numerator:</b> {d.numerator}</div>}
          {d.denominator && <div><b>Denominator:</b> {d.denominator}</div>}
          {d.exposure && <div><b>Exposure:</b> {d.exposure}</div>}
          <div><b>In:</b> {d.includes.join("; ")}</div>
          <div><b>Out:</b> {d.excludes.join("; ")}</div>
          <div><b>Booking date:</b> {d.booking_date}</div>
          {d.flow_basis && <div><b>Flow basis:</b> {d.flow_basis}</div>}
          {m.volume && <div><b>Volume:</b> {m.volume}</div>}
          {d.notes && <div><b>Notes:</b> {d.notes}</div>}
        </div>
      </Fold>
      {v && <Fold print={print} summary="How it is judged">
        <div className="small col" style={{ gap: 4 }}>
          <div><b>Method:</b> <code>{v.method}</code>{v.judge_grain ? `, judged ${v.judge_grain}` : ""}
            {v.stable_age_days != null ? ` · stable after ${v.stable_age_days} days` : ""}
            {v.min_volume != null ? ` · at least ${v.min_volume} volume` : ""}
            {v.min_denominator != null ? ` · denominator at least ${v.min_denominator}` : ""}
            {v.min_base != null ? ` · year-ago base at least ${v.min_base}` : ""}
            {v.counts ? " · Wilson interval on counts" : ""}{v.concentration_sensitive ? " · needs change concentration (L5)" : ""}</div>
          {v.thresholds && <div><b>Thresholds:</b> {Object.entries(v.thresholds).map(([size, t]) =>
            `${size} ${Object.entries(t).map(([s, x]) => `${words(s)} ${x}`).join(", ")}`).join(" · ")}</div>}
        </div>
      </Fold>}
    </article>
  );
}

function dimValues(d: SpecDimension): string {
  if (typeof d.values === "string") return d.values;
  if (Array.isArray(d.values)) return d.values.join(", ");
  return Object.entries(d.values).map(([k, vs]) => `${words(k)}: ${vs.join(", ")}`).join(" · ");
}

function SpecBody({ s, print, q }: { s: Spec; print: boolean; q: string }) {
  const ids = useMemo(() => anchors(s.categories), [s]);
  const g = (n: string) => s.guide[n];
  const guideSection = (n: string) => g(n) && (
    <section key={n} id={`s${n}`} className="sp-sec"><h2>{n}. {g(n).title}</h2><Markdown text={g(n).md} /></section>);
  const cats = s.categories.map(c => ({ c, ms: (c.metrics ?? []).filter(m => matches(m, q)) })).filter(x => !q || x.ms.length);
  return (
    <>
      {!q && <>
        <section className="sp-sec" id="intro"><Markdown text={g("intro")?.md ?? ""} /></section>
        {GUIDE_BEFORE.map(guideSection)}
        <section id="s4" className="sp-sec"><h2>4. Product taxonomy</h2>
          <ScrollTable label="Product taxonomy"><table><thead><tr><th scope="col">Category</th><th scope="col">For</th><th scope="col">Product types</th></tr></thead>
            <tbody>{s.categories.map(c => <tr key={c.id}><td><a href={`#cat-${c.id}`}>{c.name}</a> <code>{c.id}</code></td><td>{c.institution}</td>
              <td>{c.product_types.map(p => words(p.id)).join(", ")}</td></tr>)}</tbody></table></ScrollTable>
        </section>
      </>}
      <section id="s5" className="sp-sec"><h2>5. Metrics per category</h2>
        {q && !cats.length && <p className="muted">No metric matches “{q}”.</p>}
        {cats.map(({ c, ms }) => (
          <div key={c.id} id={`cat-${c.id}`} className="sp-cat">
            <h3>{c.name} <span className="small muted">{c.institution} · <code>{c.id}</code></span></h3>
            {!q && c.supervisory_note && <p className="small muted">{c.supervisory_note}</p>}
            <div className="col" style={{ gap: 12 }}>{ms.map(m => <MetricCard key={m.key} m={m} id={ids.get(`${c.id}/${m.key}`)!} print={print} />)}</div>
            {!q && c.derived_metrics?.length ? <div className="small mt8"><b>Derived:</b> {c.derived_metrics.map(x => `${x.key} = ${x.formula}${x.note ? ` (${x.note})` : ""}`).join("; ")}</div> : null}
          </div>))}
      </section>
      {!q && <>
        {guideSection("6")}
        <section id="s7" className="sp-sec"><h2>7. Standard dimensions</h2>
          <ScrollTable label="Standard dimensions"><table><thead><tr><th scope="col">Dimension</th><th scope="col">Values</th><th scope="col">About it</th></tr></thead>
            <tbody>{Object.entries(s.dimensions).map(([k, d]) => <tr key={k} id={`dim-${k}`}><td><code>{k}</code>{d.frozen ? <div className="small muted">frozen at the segment date</div> : null}</td>
              <td className="small">{dimValues(d)}</td><td className="small">{d.description}{d.source ? <div className="muted">Source: {d.source}</div> : null}</td></tr>)}</tbody></table></ScrollTable>
        </section>
        {guideSection("8")}
        <section id="s9" className="sp-sec"><h2>9. Conformance checks and errors</h2>
          <p>You can run these checks yourself before onboarding; the connector runs the same ones and reports each as pass, fail or not applicable, with the fix.</p>
          <ScrollTable label="Conformance checks"><table><thead><tr><th scope="col">Id</th><th scope="col">Level</th><th scope="col">Check</th><th scope="col">Passes when</th><th scope="col">Fix</th></tr></thead>
            <tbody>{s.conformance_checks.map(c => <tr key={c.id} id={`check-${c.id}`}><td><b>{c.id}</b></td><td>{c.level}</td>
              <td className="small"><b>{c.name}.</b> {c.check}</td><td className="small">{c.passes}</td><td className="small">{c.fix}</td></tr>)}</tbody></table></ScrollTable>
          <h3 className="mt16">Error codes</h3>
          <p className="small">Errors are RFC 9457 problem details with a <code>code</code>; each code always comes with the same HTTP status.</p>
          <ScrollTable label="Error codes"><table><thead><tr><th scope="col">HTTP status</th><th scope="col">Codes</th></tr></thead>
            <tbody>{Object.entries(Object.entries(s.vocabularies.error_codes ?? {}).reduce<Record<string, string[]>>((acc, [code, st]) =>
              ({ ...acc, [String(st)]: [...(acc[String(st)] ?? []), code] }), {})).map(([st, codes]) =>
              <tr key={st}><td>{st}</td><td className="small">{codes.map((c, i) => <span key={c}>{i ? ", " : ""}<code>{c}</code></span>)}</td></tr>)}</tbody></table></ScrollTable>
        </section>
        {GUIDE_AFTER.filter(n => n !== "8").map(guideSection)}
        <section id="changes" className="sp-sec"><h2>Change log</h2>
          <ScrollTable label="Change log"><table><thead><tr><th scope="col">Version</th><th scope="col">Date</th><th scope="col">Change</th><th scope="col">What changed</th></tr></thead>
            <tbody>{s.changelog.map(c => <tr key={c.version}><td><b>{c.version}</b></td><td>{c.date}</td><td>{c.kind}</td><td className="small">{c.text}</td></tr>)}</tbody></table></ScrollTable>
          {!s.aliases.length && !s.deprecations.length && <p className="small muted">No aliases or deprecations in this version.</p>}
        </section>
      </>}
    </>
  );
}

function useSpec(): [Spec | null, string | null] {
  const [s, setS] = useState<Spec | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { specApi.get().then(setS).catch(e => setErr(e instanceof ApiError ? e.full : String(e))); }, []);
  return [s, err];
}

const kb = (n: number | null) => (n == null ? "" : n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.round(n / 1e3)} KB`);

export function SpecPage() {
  const [s, err] = useSpec();
  const [query, setQuery] = useState("");
  const { hash } = useLocation();
  const q = query.trim().toLowerCase();
  useEffect(() => {  // a link to a metric, a dimension or a check: open it there
    if (!s || !hash) return;
    const el = document.getElementById(decodeURIComponent(hash.slice(1)));
    el?.scrollIntoView({ block: "start" });
  }, [s, hash]);
  const found = useMemo(() => !s || !q ? [] : s.categories.flatMap(c => (c.metrics ?? []).filter(m => matches(m, q)).map(m => ({ c, m }))), [s, q]);
  if (err) return <div className="page"><Banner kind="crit" icon="warn">{err}</Banner></div>;
  if (!s) return <div className="page"><PageSkeleton bare /></div>;
  const nMetrics = s.categories.reduce((n, c) => n + (c.metrics?.length ?? 0), 0);
  return (
    <div className="page">
      <PageHead title={<span className="row" style={{ gap: 10 }}>{s.title}<span className="chip">Spec {s.spec_version}</span></span>}
        sub={<>The numbers an institution exposes, per product category, and how Amiri Agent judges them. Version {s.spec_version} · {s.status} · {s.published} · validation parameters {s.validation_params_version} · {s.categories.length} categories, {nMetrics} metrics.</>} />
      <div className="card sp-files">
        <div className="hd"><h2>Downloads</h2><span className="small muted">each named with its version</span></div>
        <div className="bd row wrap" style={{ gap: 8 }}>{s.files.map(f => f.available
          ? <a key={f.name} className="btn btn--sm" href={f.href} download={f.name}><Icon name="data" />{f.label} <span className="muted small">{f.name} · {kb(f.bytes)}</span></a>
          : <span key={f.name} className="btn btn--sm" aria-disabled="true" title="Not made yet">{f.label} (not made yet)</span>)}</div>
      </div>
      <div className="sp-layout mt16">
        <nav className="sp-toc card" aria-label="Spec contents">
          <label className="label" htmlFor="sp-search">Find a metric</label>
          <input id="sp-search" className="input" type="search" placeholder="key or name, e.g. lc_openings" value={query} onChange={e => setQuery(e.target.value)} />
          {q ? <div className="small mt8" role="status">{found.length} metric{found.length === 1 ? "" : "s"}</div>
            : <ol className="sp-toc-list">{CONTENTS.map(([id, label]) => <li key={id}><a href={`#${id}`}>{label}</a></li>)}</ol>}
        </nav>
        <div className="sp-body card"><div className="bd"><SpecBody s={s} print={false} q={q} /></div></div>
      </div>
    </div>
  );
}

/** The same spec laid out for print: everything open, a title page and contents; `data-spec-ready` once drawn. */
export function SpecPrintPage() {
  const [s, err] = useSpec();
  useEffect(() => { if (s) document.title = `${s.title} ${s.spec_version}`; }, [s]);
  if (err) return <main className="sp-print"><p>{err}</p></main>;
  if (!s) return <main className="sp-print"><p>Loading the spec…</p></main>;
  return (
    <main className="sp-print" data-spec-ready="">
      <header className="sp-title">
        <h1>{s.title} {s.spec_version}</h1>
        <p>Aggregated metrics for banks and insurers</p>
        <p className="small">Status: {s.status} · published {s.published} · validation parameters {s.validation_params_version}</p>
        <ol className="sp-toc-list">{CONTENTS.map(([id, label]) => <li key={id}>{label}</li>)}</ol>
      </header>
      <SpecBody s={s} print q="" />
    </main>
  );
}
