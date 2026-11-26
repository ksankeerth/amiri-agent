// Recent findings and the words for what became of them: shared by the Findings and Events pages.
import { useCallback, useEffect, useState } from "react";
import { usePolling } from "../../components/usePolling";
import { peek } from "../../api/client";
import { investigationApi, type FindingRow } from "../../api/investigation";

const lastWeek = (xs: FindingRow[]) => { const since = Date.now() - DAYS * 86400_000; return xs.filter(f => new Date(f.created_at).getTime() >= since); };

export const DAYS = 7;

/** Live findings of the last 7 days, newest first; reloads every 30 s. */
export function useRecentFindings() {
  const [items, setItems] = useState<FindingRow[] | null>(() => { const xs = peek(() => investigationApi.findings("?world=live&limit=200")); return xs ? lastWeek(xs) : null; });
  const [err, setErr] = useState<unknown>(null);
  const [loadedAt, setLoadedAt] = useState<Date | null>(null);
  const load = useCallback(async () => {
    try {
      const xs = await investigationApi.findings("?world=live&limit=200");
      const since = Date.now() - DAYS * 86400_000;
      setItems(xs.filter(f => new Date(f.created_at).getTime() >= since)); setErr(null); setLoadedAt(new Date());
    } catch (e) { setErr(e); }
  }, []);
  useEffect(() => { load(); }, [load]);
  usePolling(load, 30_000);
  return { items, err, loadedAt, load };
}


/** Findings made by tests ("Try a move" on a market series): kept out of the live picture, so the page asks for them apart
 *  and shows them only when the person chooses. Same 7 days, same 30 s reload. */
export function useSandboxFindings() {
  const [items, setItems] = useState<FindingRow[]>(() => lastWeek(peek(() => investigationApi.findings("?world=sandbox&limit=200")) ?? []));
  const load = useCallback(async () => {
    try {
      const xs = await investigationApi.findings("?world=sandbox&limit=200");
      const since = Date.now() - DAYS * 86400_000;
      setItems(xs.filter(f => new Date(f.created_at).getTime() >= since));
    } catch { /* the live list is the page; tests are extra */ }
  }, []);
  useEffect(() => { load(); }, [load]);
  usePolling(load, 30_000);
  return { items, load };
}
