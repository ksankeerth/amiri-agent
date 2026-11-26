// What the Metrics Spec page reads about the institution: its own products (which categories are "for your products")
// and whether its figures are connected (the banner). Reads only; nothing is written.
import { useEffect, useState } from "react";
import { useInstallation } from "../../App";
import { connectApi } from "../../api/connect";
import { inst } from "../../api/institutions";
import { coverageCounts, sourceOf } from "../admin/dataWords";
import { connectionLine, productCounts, type ConnectionLine } from "./words";

export interface Mine {
  /** products per category id */ counts: Map<string, number>;
  /** the products' names per category id */ names: Map<string, string[]>;
  kind: "bank" | "insurer" | null;
  /** the institution's Islamic flag; null when there is no institution (or its profile can't be read) */
  islamic: boolean | null;
  /** the home country code, e.g. "US" */ home: string | null;
}
const NONE: Mine = { counts: new Map(), names: new Map(), kind: null, islamic: null, home: null };

/** The institution's own products, from its profile. Undefined while loading; an empty answer when there is no
 *  institution or the profile can't be read (the page then lists every category, which is still right). */
export function useMine(): Mine | undefined {
  const installation = useInstallation();
  const id = installation?.profile ? installation.institution_id : null;
  const [mine, setMine] = useState<Mine | undefined>(id ? undefined : NONE);
  useEffect(() => {
    if (!id) { setMine(NONE); return; }
    let live = true;
    inst.profile(id).then(p => {
      if (!live) return;
      const products = p.sections.products ?? [];
      const names = new Map<string, string[]>();
      for (const x of products) names.set(x.category, [...(names.get(x.category) ?? []), x.name]);
      setMine({ counts: productCounts(products.map(x => ({ category: String(x.category) }))), names, kind: p.institution.institution_type,
        islamic: p.institution.islamic === true, home: p.institution.home_country ?? null });
    }).catch(() => { if (live) setMine(NONE); });
    return () => { live = false; };
  }, [id]);
  return mine;
}

/** The banner's words: is the institution's data connected, and are the checks on. Null when it can't be read (no banner). */
export function useConnection(): ConnectionLine | null {
  const installation = useInstallation();
  const [line, setLine] = useState<ConnectionLine | null>(null);
  const name = installation?.name ?? null;
  useEffect(() => {
    let live = true;
    (async () => {
      const c = await connectApi.get();
      let coverage: { some: number; total: number } | null = null;
      if (c.latest_check) {
        try {
          const products = (await connectApi.report(c.latest_check.check_id)).coverage?.products ?? [];
          if (products.length) { const n = coverageCounts(products); coverage = { some: n.full + n.partial, total: products.length }; }
        } catch { /* the banner is still true without the product count */ }
      }
      if (live) setLine(connectionLine({ configured: c.configured, validationOn: c.validation_enabled, approved: !!c.approved, name,
        source: sourceOf(c.imported), coverage }));
    })().catch(() => { if (live) setLine(null); });
    return () => { live = false; };
  }, [name]);
  return line;
}
