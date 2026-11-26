// The institution the Institution page and the guided setup work on: the list, the chosen one, its profile and its
// readiness checks, loaded together. A proposal applied in the setup agent's panel changes the profile under the page,
// so the page loads it again when "amiri:profile-changed" fires.
import { useCallback, useEffect, useState } from "react";
import { ApiError, peek } from "../../api/client";
import { inst, type InstitutionSummary, type Profile, type Readiness } from "../../api/institutions";
import type { Ctx } from "./forms";

export const INSTITUTION_KEY = "amiri.institution";

export function useInstitution() {
  // seen before: the last answers show at once and are refreshed below (F4)
  const [id, setId] = useState<string | null>(() => { try { return localStorage.getItem(INSTITUTION_KEY); } catch { return null; } });
  const [list, setList] = useState<InstitutionSummary[] | null>(() => peek(() => inst.list()) ?? null);
  const [profile, setProfile] = useState<Profile | null>(() => (id ? peek(() => inst.profile(id)) ?? null : null));
  const [readiness, setReadiness] = useState<Readiness | null>(() => (id ? peek(() => inst.readiness(id)) ?? null : null));
  const [error, setError] = useState<unknown>(null);
  /** When the profile on screen was loaded (ms since the epoch): the stale banner says how old it is. */
  const [loadedAt, setLoadedAt] = useState<number | null>(null);
  const loadList = useCallback(async () => {
    try {
      const l = await inst.list();
      setList(l);
      setId(cur => (cur && l.some(x => x.institution_id === cur) ? cur : l.find(x => x.status !== "archived")?.institution_id ?? l[0]?.institution_id ?? null));
    } catch (e) { setError(e); }
  }, []);
  const reload = useCallback(async () => {
    // no institution chosen: nothing to load, so an old error (a failed list) goes too; "Try again" then
    // loads the list afresh and sets it again only if that fails once more
    if (!id) { setProfile(null); setError(null); return; }
    try {
      const [p, r] = await Promise.all([inst.profile(id), inst.readiness(id)]);
      setProfile(p); setReadiness(r); setError(null); setLoadedAt(Date.now());
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) { try { localStorage.removeItem(INSTITUTION_KEY); } catch { /* */ } loadList(); }
      else setError(e);
    }
  }, [id, loadList]);
  useEffect(() => { loadList(); }, [loadList]);
  useEffect(() => { reload(); }, [reload]);
  // a proposal confirmed in the assistant drawer changes the profile under this page
  useEffect(() => {
    const f = () => { reload(); };
    window.addEventListener("amiri:profile-changed", f);
    return () => window.removeEventListener("amiri:profile-changed", f);
  }, [reload]);
  const select = (x: string) => { setId(x); try { localStorage.setItem(INSTITUTION_KEY, x); } catch { /* */ } };
  const ctx: Ctx = { profile, type: profile?.institution.institution_type ?? "bank" };
  return { list, id, select, profile, readiness, error, loadedAt, refresh: reload, reload: async () => { await reload(); loadList(); }, ctx, reloadList: () => { loadList(); window.dispatchEvent(new Event("amiri:installation")); } };
}

export type InstitutionState = ReturnType<typeof useInstitution>;
