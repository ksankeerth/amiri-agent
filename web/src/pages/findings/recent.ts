// Recent findings and the words for what became of them: shared by the Findings and Events pages.
import { useCallback, useEffect, useState } from "react";
import { ApiError } from "../../api/client";
import { investigationApi, type FindingRow } from "../../api/investigation";

export const DAYS = 7;
export const STATUS: Record<FindingRow["status"], [string, string]> = {
  new: ["b-info", "WAITING"], grouped: ["b-info", "BEING INVESTIGATED"], linked: ["b-ok", "IN AN EVENT"], set_aside: ["b-noeffect", "SET ASIDE"],
};
// why the investigation set a finding aside, in words
const REASON: Record<string, string> = {
  not_home_country: "it isn't about a place where you operate",
  no_theme: "it carries no economic theme the investigation can trace to products",
  below_min_size: "the move is too small to matter",
  after_as_of: "it came after the investigation's cut-off",
  investigation_failed: "the investigation failed",
};
export const reasonText = (f: FindingRow) => f.outcome?.reason ? (REASON[f.outcome.reason] ?? f.outcome.reason.replace(/_/g, " ")) : "";

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

