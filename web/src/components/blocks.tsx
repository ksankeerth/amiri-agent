// Place codes as names, for pages that list places (alerts, events, findings).
import { useEffect, useState } from "react";
import { ref } from "../api/reference";
import { placeName } from "../format";

// ---------------------------------------------------------------- places
const named = new Map<string, string>();
/** Place codes as names. Seas, straits and regions are looked up in the reference data once (countries are named by
 *  the browser), so a page shows "Strait of Hormuz", never "chk:hormuz". */
export function usePlaceNames(codes: string[]): (code: string) => string {
  const [, bump] = useState(0);
  const key = codes.join(",");
  useEffect(() => {
    const todo = codes.filter(c => !/^[A-Z]{2}$/.test(c) && !named.has(c));
    if (!todo.length) return;
    let live = true;
    Promise.all(todo.map(c => ref.place(c).then(p => { if (p.name) named.set(c, p.name); }).catch(() => {})))
      .then(() => { if (live) bump(n => n + 1); });
    return () => { live = false; };
  }, [key]);  // eslint-disable-line react-hooks/exhaustive-deps
  return (c: string) => named.get(c) ?? placeName(c);
}
