// "Draft from your profile": code fills a new monitor's sentence, lines, names, places and exposure from one item of the
// institution profile; the person checks and edits it before submitting. Nothing runs until someone approves it.
// `only` drafts one item at once, without the picker (the Institution page's "Watch this" buttons).
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ApiError } from "../../api/client";
import { monitorsApi, type Draftable } from "../../api/monitors";
import { useDemoLock } from "../../components/lock";
import { useRefusalToast } from "../../components/ui";
import { Button } from "../../components/v2/Button";
import { Dialog } from "../../components/v2/Dialog";
import { LoadError } from "../../components/v2/LoadError";

export const SECTION_WORDS: Record<string, string> = {
  "risk-exposures": "Known risks", regulators: "Regulators", rivals: "Rivals", flows: "Money and trade flows", counterparties: "Counterparties",
};

export function DraftFromProfile({ onClose, only }: { onClose: () => void; only?: { section: string; item_id: string } }) {
  const nav = useNavigate();
  const refuse = useRefusalToast();
  const locked = useDemoLock();
  const [items, setItems] = useState<Draftable[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [loadErr, setLoadErr] = useState<unknown>(null);
  const loadItems = () => monitorsApi.draftable().then(x => { setItems(x); setLoadErr(null); }).catch(setLoadErr);
  useEffect(() => { if (!only) loadItems(); }, []);   // eslint-disable-line react-hooks/exhaustive-deps
  const draft = async (d: { section: string; item_id: string }) => {
    setBusy(d.item_id);
    try { const m = await monitorsApi.draft(d.section, d.item_id); onClose(); nav(`/monitors/${m.monitor_id}`); }
    catch (e) { refuse(e, (e as ApiError | undefined)?.code === "demo_locked" ? undefined : "Couldn't draft the monitor"); setBusy(null); }
  };
  useEffect(() => { if (only) draft(only); }, []);   // eslint-disable-line react-hooks/exhaustive-deps
  if (only) return null;
  const groups = Object.keys(SECTION_WORDS).map(s => [s, (items ?? []).filter(i => i.section === s)] as const).filter(([, xs]) => xs.length);
  return (
    <Dialog size="L" title="Draft a monitor from your profile" description={<>Pick something from your institution profile. Code drafts the name, the sentence, the "tell me if" lines, the names, the places and who it could reach; you check and edit them before submitting. Nothing runs until someone approves it.</>} onClose={onClose} actions={<Button onClick={onClose}>Close</Button>}>
      {loadErr != null ? <LoadError error={loadErr} onRetry={loadItems} what="what can be drafted" />
        : items === null ? <p className="v2-meta" role="status">Loading…</p>
        : !groups.length ? <p className="v2-meta">The profile has no risks, regulators, rivals, flows or counterparties yet.</p>
        : groups.map(([s, xs]) => (
          <div key={s} className="v2-mn-draft__g">
            <h3 className="v2-cap">{SECTION_WORDS[s]}</h3>
            <ul className="v2-mn-draft__l">{xs.map(i => (
              <li key={i.item_id}>
                <Button size="sm" locked={locked} disabled={!!busy && busy !== i.item_id} busy={busy === i.item_id} busyLabel="Drafting…" onClick={() => draft(i)}>
                  {i.label}{i.monitor_id && !busy && <span className="v2-meta"> · already watched</span>}</Button>
              </li>))}</ul>
          </div>))}
    </Dialog>
  );
}
