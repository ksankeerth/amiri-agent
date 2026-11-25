// The Metrics Spec itself: what /spec and the print view (SpecPrint.tsx) both read.
import { useEffect, useState } from "react";
import { specApi, type Spec } from "../../api/spec";

export function useSpec(): [Spec | null, unknown, () => Promise<void>] {
  const [s, setS] = useState<Spec | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const load = () => specApi.get().then(x => { setS(x); setErr(null); }).catch(setErr);
  useEffect(() => { load(); }, []);
  return [s, err, load];
}
