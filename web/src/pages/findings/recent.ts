// Recent findings and the words for what became of them: shared by the Findings and Events pages.
import { useCallback, useEffect, useState } from "react";
import { ApiError } from "../../api/client";
import { investigationApi, type FindingRow } from "../../api/investigation";
import { setAsideReason } from "../../plain";

export const DAYS = 7;
// why the investigation set a finding aside, in a few words (plain.ts holds the words)
export const reasonText = (f: FindingRow) => setAsideReason(f.outcome?.reason);

/** Live findings of the last 7 days, newest first; reloads every 30 s. */
export function useRecentFindings() {
  const [items, setItems] = useState<FindingRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loadedAt, setLoadedAt] = useState<Date | null>(null);
  const load = useCallback(async () => {
    try {
      const xs = await investigationApi.findings("?world=live&limit=200");
      const since = Date.now() - DAYS * 86400_000;
      setItems(xs.filter(f => new Date(f.created_at).getTime() >= since)); setErr(null); setLoadedAt(new Date());
    } catch (e) { setErr(e instanceof ApiError ? e.full : String(e)); }
  }, []);
  useEffect(() => { load(); const t = setInterval(load, 30_000); return () => clearInterval(t); }, [load]);
  return { items, err, loadedAt, load };
}

