// The article behind an alert's strongest finding. The alert carries only the finding's title; the findings list
// (an existing GET) has its headlines. Asked for when Details opens, once per source for a minute.
import { useEffect, useState } from "react";
import { investigationApi, type FindingRow } from "../../api/investigation";

type WithHeads = FindingRow & { evidence?: { headlines?: { url?: string | null }[] } | null };
const cache = new Map<string, { at: number; p: Promise<WithHeads[]> }>();
const bySource = (source: string) => {
  const hit = cache.get(source);
  if (hit && Date.now() - hit.at < 60_000) return hit.p;
  const p = investigationApi.findings(`?source=${encodeURIComponent(source)}&limit=200`).then(xs => xs as WithHeads[]).catch(() => [] as WithHeads[]);
  cache.set(source, { at: Date.now(), p });
  return p;
};

/** The first article link of the finding with this title, or null when there is none (or while it's being looked up). */
export function useArticleUrl(title: string | null, sources: string[] | null, enabled: boolean, known?: string | null): string | null {
  const [url, setUrl] = useState<string | null>(null);
  const key = (sources ?? []).join(",");
  useEffect(() => {
    if (!enabled || !title || known) return;
    let live = true;
    (async () => {
      for (const s of key ? key.split(",") : []) {
        const f = (await bySource(s)).find(x => x.title === title);
        const u = f?.evidence?.headlines?.find(h => h.url)?.url;
        if (u) { if (live) setUrl(u); return; }
      }
    })();
    return () => { live = false; };
  }, [enabled, title, key, known]);
  return known ?? url;
}
