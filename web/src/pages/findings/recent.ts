// Recent findings and the words for what became of them: shared by the Findings and Events pages.
import { useCallback, useEffect, useState } from "react";
import { investigationApi, type FindingRow } from "../../api/investigation";
import { setAsideReason } from "../../plain";

export const DAYS = 7;
// why the investigation set a finding aside, in a few words (plain.ts holds the words)
export const reasonText = (f: FindingRow) => setAsideReason(f.outcome?.reason);

/** Live findings of the last 7 days, newest first; reloads every 30 s. */
export function useRecentFindings() {
  const [items, setItems] = useState<FindingRow[] | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const [loadedAt, setLoadedAt] = useState<Date | null>(null);
  const load = useCallback(async () => {
    try {
      const xs = await investigationApi.findings("?world=live&limit=200");
      const since = Date.now() - DAYS * 86400_000;
      setItems(xs.filter(f => new Date(f.created_at).getTime() >= since)); setErr(null); setLoadedAt(new Date());
    } catch (e) { setErr(e); }
  }, []);
  useEffect(() => { load(); const t = setInterval(load, 30_000); return () => clearInterval(t); }, [load]);
  return { items, err, loadedAt, load };
}


/** Findings made by tests ("Try a move" on a market series): kept out of the live picture, so the page asks for them apart
 *  and shows them only when the person chooses. Same 7 days, same 30 s reload. */
export function useSandboxFindings() {
  const [items, setItems] = useState<FindingRow[]>([]);
  const load = useCallback(async () => {
    try {
      const xs = await investigationApi.findings("?world=sandbox&limit=200");
      const since = Date.now() - DAYS * 86400_000;
      setItems(xs.filter(f => new Date(f.created_at).getTime() >= since));
    } catch { /* the live list is the page; tests are extra */ }
  }, []);
  useEffect(() => { load(); const t = setInterval(load, 30_000); return () => clearInterval(t); }, [load]);
  return { items, load };
}
