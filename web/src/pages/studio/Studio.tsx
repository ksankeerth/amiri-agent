// The Scenario Studio (board 09; states: board 15 B): your scenarios and the templates on the left, the open scenario's
// editor on the right. `/studio` shows the list; `/studio/:id` opens one beside it (on a phone, the editor is the page
// and a link goes back to the list). The pane is never empty: with the address naming none, the latest-run scenario opens (the
// address stays /studio; a phone shows the list), and with nothing saved the first available template is previewed. Only editing and deleting are locked by the demo lock: creating, starting and
// stopping a run stay open (server/app/studio/api.py guards PATCH and DELETE of a scenario, nothing else).
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { peek } from "../../api/client";
import { studioApi, type Custom, type Mode, type Scenario, type ScenarioRow, type Simulation, type Template } from "../../api/studio";
import { useInstallation } from "../../App";
import { useRefusalToast, useToast } from "../../components/ui";
import { EditConflict } from "../../components/v2/EditConflict";
import { ListPane, PaneBack, PaneView } from "../../components/v2/ListPane";
import { LoadError } from "../../components/v2/LoadError";
import { useCrumbs, usePhone } from "../../components/v2/Shell";
import { Skeleton } from "../../components/v2/Skeleton";
import { isEditConflict } from "../../components/v2/states";
import { changesText, firstAvailable, lastRan, pickDefaultScenario } from "./editorWords";
import { Editor, type SaveBody } from "./editor";
import { DeleteDialog, GoingBanner, NewOwnDialog, ScenarioList, StartDialog, StudioHead, TemplateList, TemplatePreview } from "./parts";
import "../../styles/v2/studio.css";

const BASE = [{ label: "Try it" }, { label: "Scenario Studio" }];

export function StudioPage() {
  const { id } = useParams();
  const nav = useNavigate();
  const [sp] = useSearchParams();
  const toast = useToast(), refuse = useRefusalToast();
  const inst = useInstallation();
  const phone = usePhone();

  // seen before: the last answers show at once and are refreshed below (F4)
  const [templates, setTemplates] = useState<Template[] | null>(() => peek(() => studioApi.templates()) ?? null);
  const [items, setItems] = useState<ScenarioRow[] | null>(() => peek(() => studioApi.scenarios()) ?? null);
  const [current, setCurrent] = useState<Simulation | null>(() => peek(() => studioApi.current()) ?? null);
  const [err, setErr] = useState<unknown>(null);
  const [s, setS] = useState<Scenario | null>(null);
  const [sErr, setSErr] = useState<unknown>(null);
  const [conflict, setConflict] = useState<SaveBody | null>(null);
  const [own, setOwn] = useState(false);
  const [creating, setCreating] = useState(false);
  const [confirm, setConfirm] = useState<{ scenario_id: string; mode: Mode } | null>(null);
  const [starting, setStarting] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [asking, setAsking] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const fresh = useRef(sp.has("new"));

  useCrumbs(s && id ? [...BASE.slice(0, 1), { label: "Scenario Studio", to: "/studio" }, { label: s.title }] : BASE);

  // the lists and the running simulation (one at a time); the scenario itself loads below
  const load = useCallback(() => Promise.all([studioApi.templates(), studioApi.scenarios(), studioApi.current()])
    .then(([t, x, c]) => { setTemplates(t); setItems(x); setCurrent(c); setErr(null); })
    .catch(e => setErr(e)), []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {  // a run started or ended elsewhere: the page notices when it is looked at again
    const f = () => { if (document.visibilityState === "visible") studioApi.current().then(setCurrent).catch(() => {}); };
    document.addEventListener("visibilitychange", f);
    return () => document.removeEventListener("visibilitychange", f);
  }, []);
  // the address names none: the scenario that ran last (else the newest) opens, and stays open when the list is reordered
  const [pinned, setPinned] = useState<string | null>(null);
  const best = useMemo(() => (items ? pickDefaultScenario(items) : null), [items]);
  const fallbackId = id || phone ? null : pinned && items?.some(x => x.scenario_id === pinned) ? pinned : best;
  useEffect(() => { if (id) { if (pinned) setPinned(null); } else if (fallbackId && fallbackId !== pinned) setPinned(fallbackId); }, [fallbackId, pinned, id]);
  const openId = id ?? fallbackId ?? undefined;
  const loadOne = useCallback(() => {
    if (!openId) return Promise.resolve();
    return studioApi.scenario(openId).then(x => { setS(x); setSErr(null); }).catch(e => setSErr(e));
  }, [openId]);
  useLayoutEffect(() => { setS(openId ? peek(() => studioApi.scenario(openId)) ?? null : null); setSErr(null); setConflict(null); }, [openId]);  // before paint: a scenario seen before shows at once
  useEffect(() => { if (openId) loadOne(); }, [openId, loadOne]);
  const refreshList = () => studioApi.scenarios().then(setItems).catch(() => {});

  const create = async (template_id: string, extra?: { title?: string; custom?: Custom }) => {
    setCreating(true);
    try {
      const n = await studioApi.create(template_id, extra);
      await refreshList();
      nav(`/studio/${n.scenario_id}${extra ? "?new=1" : ""}`);
      setOwn(false);
    } catch (e) { refuse(e); }
    finally { setCreating(false); }
  };
  const use = (t: Template) => { if (t.template_id === "blank") setOwn(true); else create(t.template_id); };

  const save = async (body: SaveBody): Promise<boolean> => {
    if (!openId) return false;
    try { setS(await studioApi.update(openId, body)); setConflict(null); refreshList(); return true; }
    catch (e) { if (isEditConflict(e)) setConflict(body); else refuse(e); return false; }
  };
  const remove = async () => {
    if (!openId) return;
    setDeleting(true);
    try { await studioApi.remove(openId); setAsking(false); await refreshList(); nav("/studio"); toast("Scenario deleted"); }
    catch (e) { refuse(e); setAsking(false); }
    finally { setDeleting(false); }
  };

  // a start clears the Studio's last run: say so first when there is one (board 15 B)
  const clears = lastRan(items ?? []);
  const ask = (scenario_id: string, mode: Mode) => { if (clears) setConfirm({ scenario_id, mode }); else go(scenario_id, mode); };
  const go = async (scenario_id: string, mode: Mode) => {
    setConfirm(null); setStarting(true);
    try { const sim = await studioApi.start(scenario_id, mode); nav(`/studio/run/${sim.sim_id}`); }
    catch (e) { refuse(e); studioApi.current().then(setCurrent).catch(() => {}); }
    finally { setStarting(false); }
  };
  const stop = async () => {
    if (!current) return;
    setStopping(true);
    try { await studioApi.stop(current.sim_id); toast(`Stopped: ${current.title}`); setCurrent(null); load(); if (openId) loadOne(); }
    catch (e) { refuse(e); }
    finally { setStopping(false); }
  };

  const loading = items === null && templates === null && err == null;
  const phoneEditor = !!id;   // a phone shows the editor alone while one is open
  const running = current?.scenario_id;
  const list = (
    <div className="v2-st-lists">
      <ScenarioList items={items ?? []} openId={openId} runningId={running} />
      <TemplateList templates={templates ?? []} scenarios={items ?? []} onUse={use} busy={creating} />
    </div>
  );
  const preview = !items?.length && templates ? firstAvailable(templates) : null;
  const pane = !openId ? (preview && <TemplatePreview t={preview} onUse={use} busy={creating} />)
    : s ? (
      <Editor key={s.scenario_id} s={s} current={current} fresh={fresh.current} save={save} onAskDelete={() => setAsking(true)} starting={starting}
        onRun={mode => ask(s.scenario_id, mode)}
        notice={conflict && <EditConflict what="this scenario" className="v2-st-conflict" onReload={() => { setConflict(null); loadOne(); }}
          onCopy={() => navigator.clipboard.writeText(changesText(conflict))} />} />)
    : sErr != null ? <LoadError error={sErr} onRetry={loadOne} what="this scenario" />
    : <Skeleton rows={6} label="Loading the scenario" />;

  return (
    <div className={`v2-st${phoneEditor ? " has-editor" : ""}`}>
      <StudioHead name={inst?.short_name ?? inst?.name ?? null} />
      {current && <GoingBanner sim={current} onStop={stop} stopping={stopping} />}
      {err != null && templates === null
        ? <LoadError error={err} onRetry={load} what="the Scenario Studio" safe="Your scenarios are safe; this page just couldn't reach them." />
        : loading ? <Skeleton rows={5} label="Loading the Scenario Studio" />
        : (
          phone
            ? (id ? <PaneView back={<PaneBack to="/studio">All scenarios</PaneBack>}>{pane}</PaneView> : list)
            : <ListPane list={list} pane={pane} itemKey={openId} />)}
      {own && <NewOwnDialog busy={creating} onCancel={() => setOwn(false)} onCreate={(title, custom) => create("blank", { title, custom })} />}
      {asking && s && <DeleteDialog title={s.title} busy={deleting} onCancel={() => setAsking(false)} onGo={remove} />}
      {confirm && clears && <StartDialog clears={clears} onCancel={() => setConfirm(null)} onGo={() => go(confirm.scenario_id, confirm.mode)} />}
    </div>
  );
}
