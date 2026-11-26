// Platform Admin: Data connection (board 11, states: board 16 section I, board 13 sections 2, 3 and 5). Where AMIRI Agent reads
// the institution's own figures: a sample (the bank, or the insurer for an insurer) or one JSON file in the Metrics Spec
// format (decision D1: there is no API address). Five steps: Source, Conditions, Check, Approve, Use it.
//
// The server holds one set of imported data. A sample is the example file (GET data-connection:example, with the chosen
// conditions) sent to the same import as a file of your own. The demo lock greys out what writes: importing (sample or
// file), Approve and the checks switch. Check stays open.
import { useCallback, useEffect, useRef, useState } from "react";
import { useInstallation } from "../../App";
import { connectApi, type Connection, type Report } from "../../api/connect";
import { inst } from "../../api/institutions";
import { specApi } from "../../api/spec";
import { useDemoLock } from "../../components/lock";
import { useRefusalToast, useToast } from "../../components/ui";
import { LoadError } from "../../components/v2/LoadError";
import { useCrumbs } from "../../components/v2/Shell";
import { Skeleton } from "../../components/v2/Skeleton";
import { StaleBanner } from "../../components/v2/StaleBanner";
import { person, when } from "../../format";
import { Conditions, FileImport, SourceCards, Steps, UseSample } from "./dataParts";
import { defaultOn, plantedIds, stepStrip, sourceOf, type Kind, type SourceId } from "./dataWords";
import { ResultPanel } from "./ResultPanel";
import "../../styles/v2/admin.css";

const SPEC = "1.0.0";

/** Metric keys to the Spec's names, read once (the page falls back to the key in words when the Spec isn't to hand). */
let namesOnce: Promise<Map<string, string>> | null = null;
const metricNames = () => (namesOnce ??= specApi.get().then(s => new Map(s.categories.flatMap(c => c.metrics ?? []).map(m => [m.key, m.name] as const))).catch(() => { namesOnce = null; return new Map<string, string>(); }));

export function DataConnectionsPage() {
  const toast = useToast(), refuse = useRefusalToast();
  const locked = useDemoLock();
  const installation = useInstallation();
  useCrumbs([{ label: "Platform admin" }, { label: "Data connections" }]);

  const [conn, setConn] = useState<Connection | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [history, setHistory] = useState<Awaited<ReturnType<typeof connectApi.checks>>>([]);
  const [error, setError] = useState<unknown>(null);
  const [loadedAt, setLoadedAt] = useState(0);
  const [checking, setChecking] = useState(false);
  const [names, setNames] = useState<Map<string, string>>(new Map());
  const [kind, setKind] = useState<Kind>("bank");
  const [choice, setChoice] = useState<SourceId | null>(null);
  const [on, setOn] = useState<string[]>(defaultOn("bank"));
  const shownId = useRef<string | null>(null);
  const started = useRef(false);

  const load = useCallback(async () => {
    try {
      const [c, h] = await Promise.all([connectApi.get(), connectApi.checks()]);
      setConn(c); setHistory(h);
      const id = c.latest_check?.check_id ?? null;
      if (!id) { shownId.current = null; setReport(null); }
      else if (shownId.current !== id) { const r = await connectApi.report(id); shownId.current = id; setReport(r); }
      setError(null); setLoadedAt(Date.now());
    } catch (e) { setError(e); }
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { metricNames().then(setNames); }, []);

  // the institution's own kind decides which sample the server can make (a bank's, or an insurer's)
  const instId = installation?.institution_id;
  useEffect(() => {
    if (!instId) return;
    inst.list().then(l => { const t = l.find(i => i.institution_id === instId)?.institution_type; if (t === "bank" || t === "insurer") setKind(t); }).catch(() => { /* the bank's sample is the fallback */ });
  }, [instId]);

  // the cards and switches start from what is loaded: the source it came from, and the conditions it was made with
  useEffect(() => {
    if (!conn || started.current) return;
    started.current = true;
    const src = sourceOf(conn.imported);
    if (src) setChoice(src);
    const planted = plantedIds(conn.imported?.about, kind);
    setOn(planted ?? defaultOn(kind));
  }, [conn, kind]);
  useEffect(() => { if (!conn?.imported) setOn(defaultOn(kind)); }, [kind]);  // eslint-disable-line react-hooks/exhaustive-deps

  const run = async () => {
    setChecking(true);
    try { const r = await connectApi.check(); shownId.current = r.check_id; setReport(r); toast(`Checked: ${r.headline}`); await load(); }
    catch (e) { refuse(e, "Couldn't check the data"); }
    finally { setChecking(false); }
  };
  const approve = async () => {
    try { setConn(await connectApi.approve()); toast("Approved: checks against your data can now be switched on."); }
    catch (e) { refuse(e, "Couldn't approve it"); }
  };
  const validation = async (v: boolean) => {
    try { setConn(await connectApi.validation(v)); toast(v ? "Checks are on: new tasks are checked against your data." : "Checks are off."); }
    catch (e) { refuse(e, "Couldn't change the checks"); }
  };
  const pick = async (id: string) => {
    try { const r = await connectApi.report(id); shownId.current = id; setReport(r); } catch (e) { refuse(e, "Couldn't open that check"); }
  };
  const imported = (c: Connection) => { setConn(c); shownId.current = null; load(); };

  const Head = <header className="v2-ad-head"><h1 className="v2-ad-h1">Data connection</h1>
    {conn ? <p className="v2-ad-sub">{installation?.name ? `${installation.name}'s own figures` : "The institution's own figures"}, so AMIRI Agent can check its expectations · Metrics Spec {SPEC}</p> : null}</header>;
  if (error != null && !conn) {
    return <div className="v2-ad"><header className="v2-ad-head"><h1 className="v2-ad-h1">Data connection</h1></header>
      <LoadError error={error} onRetry={load} what="the data connection" safe="Your data is safe; this page just couldn't reach it." /></div>;
  }
  if (!conn) return <div className="v2-ad"><header className="v2-ad-head"><h1 className="v2-ad-h1">Data connection</h1></header><Skeleton rows={6} label="Loading the data connection" /></div>;

  const latest = conn.latest_check;
  const src = sourceOf(conn.imported);
  const steps = stepStrip({
    source: src, fileName: conn.imported?.file_name ?? null, configured: conn.configured,
    conditionsOn: src === "bank" || src === "insurer" ? (plantedIds(conn.imported?.about, kind)?.length ?? null) : null,
    check: latest ? { status: latest.status, current: !!latest.current } : null,
    approved: conn.approved ? { by: person(conn.approved.by), when: when(conn.approved.at) } : null,
    validationOn: conn.validation_enabled, validationAllowed: conn.validation_allowed,
  });
  const current = !!latest?.current && !!report && latest.check_id === report.check_id;
  const sample = choice === "bank" || choice === "insurer" ? choice : null;
  const toggle = (id: string, v: boolean) => setOn(x => (v ? [...x, id] : x.filter(y => y !== id)));

  return (
    <div className="v2-ad">
      {Head}
      <div role="note" className="v2-ad-proto"><b>Prototype:</b> use a sample institution, or a file with made-up figures and no real data.</div>
      {error != null && <StaleBanner loadedAt={loadedAt} onRetry={load} />}
      <Steps steps={steps} />
      <div className="v2-ad-cols">
        <div className="v2-ad-side">
          <SourceCards choice={choice} kind={kind} onPick={setChoice} />
          {choice === "file" && <FileImport conn={conn} locked={locked} onImported={imported} />}
          {sample ? <Conditions kind={kind} on={on} onToggle={toggle}><UseSample kind={kind} on={on} conn={conn} locked={locked} onImported={imported} /></Conditions>
            : <section><div className="v2-ad-h2row"><h2 className="v2-ad-h2">2 · Conditions</h2><span className="v2-ad-opt">optional</span></div>
              <p className="v2-ad-fine">{choice === "file" ? "A file brings its own figures, so there is nothing to set here." : "Conditions are for the samples: pick one above to choose what its data shows."}</p></section>}
        </div>
        <ResultPanel conn={conn} report={report} history={history} current={current} names={names} checking={checking} locked={locked}
          onCheck={run} onApprove={approve} onValidation={validation} onPick={pick} />
      </div>
    </div>
  );
}
