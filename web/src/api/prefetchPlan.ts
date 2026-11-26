// What a page asks for when it opens, by address (F4): used to warm the cache when a link is hovered or focused, or a Go to result
// is highlighted. Plain strings, no calls, so `npm test` covers it. The addresses must be exactly the ones the pages ask for (the cache
// is keyed by them): the numbers below are the pages' own (`LIST_LIMIT`, `EVENTS_LIMIT`...), and the browser check in docs/ux/v2/out/F4
// confirms a prefetched page's first asks are all answered from it. Reads only; never a write.

export interface PlanCtx {
  /** The Platform Admin's Overview asks for everything (`?audience=all`). */
  admin: boolean;
  /** For the pages that read the institution's profile (monitors, Radar, Institution, Spec). */
  institutionId: string | null;
}

const V1 = "/api/v1";
const enc = encodeURIComponent;
const EVENTS_LIMIT = 200;   // pages/events/Events.tsx, Alerts.tsx (event names), Findings.tsx, Radar.tsx
const ALERTS_LIMIT = 200;   // pages/alerts/words.ts LIST_LIMIT
const FINDINGS = `${V1}/findings?world=live&limit=200`;

/** The GET addresses the page at `to` (a path with an optional query) asks for first. Empty for a page that isn't known. */
export function prefetchPlan(to: string, ctx: PlanCtx): string[] {
  let u: URL;
  try { u = new URL(to, "http://x"); } catch { return []; }
  const path = u.pathname.replace(/\/+$/, "") || "/";
  const q = u.searchParams;
  const inst = ctx.institutionId ? enc(ctx.institutionId) : null;
  let m: RegExpMatchArray | null;

  if (path === "/home") return [`${V1}/overview${ctx.admin ? "?audience=all" : ""}`, `${V1}/alerts:summary`];
  if (path === "/alerts") {
    const tab = q.get("tab") === "acknowledged" || q.get("tab") === "resolved" ? q.get("tab")! : "new";
    const p = new URLSearchParams([["status", tab], ...(q.get("team") ? [["owner", q.get("team")!]] : []),
      ...(["warning", "developing", "adverse"].includes(q.get("level") ?? "") ? [["level", q.get("level")!]] : []), ["limit", String(ALERTS_LIMIT)]]);
    return [`${V1}/alerts:summary`, `${V1}/alerts?${p}`, `${V1}/events?limit=${EVENTS_LIMIT}`];
  }
  if (path === "/events") return [`${V1}/investigation:status`, `${V1}/events?limit=${EVENTS_LIMIT}`, FINDINGS, `${V1}/alerts?status=new`, `${V1}/alerts:summary`];
  if ((m = path.match(/^\/events\/([^/]+)$/))) return [`${V1}/events/${enc(decodeURIComponent(m[1]))}`, `${V1}/alerts?event_id=${enc(decodeURIComponent(m[1]))}`];
  if (path === "/findings") return [FINDINGS, `${V1}/findings?world=sandbox&limit=200`, `${V1}/investigation:status`, `${V1}/events?limit=${EVENTS_LIMIT}`, `${V1}/monitors`, `${V1}/series`];
  if (path === "/radar") return [`${V1}/radar:status`, `${V1}/radar/stories`, `${V1}/radar/runs`, `${V1}/events?limit=${EVENTS_LIMIT}`,
    ...(inst ? [`${V1}/institutions/${inst}/profile`, `${V1}/institutions/${inst}/context`] : [])];
  if ((m = path.match(/^\/monitors(?:\/([^/]+))?$/))) {
    const id = m[1] ? enc(decodeURIComponent(m[1])) : null;
    return [`${V1}/monitors`, `${V1}/monitors:status`, ...(inst ? [`${V1}/institutions/${inst}/profile`] : []),
      ...(id ? [`${V1}/monitors/${id}`, `${V1}/monitors/${id}/runs`, `${V1}/monitors/${id}/findings`] : [])];
  }
  if ((m = path.match(/^\/series(?:\/([^/]+))?$/))) {
    const id = m[1] ? enc(decodeURIComponent(m[1])) : null;
    return [`${V1}/series`, `${V1}/series:status`, `${V1}/events?limit=${EVENTS_LIMIT}`, ...(id ? [`${V1}/series/${id}/findings?limit=20`] : [])];
  }
  if ((m = path.match(/^\/studio(?:\/([^/]+))?$/)) && m[1] !== "run") {
    return [`${V1}/studio/templates`, `${V1}/studio/scenarios`, `${V1}/studio/simulations/current`, ...(m[1] ? [`${V1}/studio/scenarios/${enc(decodeURIComponent(m[1]))}`] : [])];
  }
  if (path === "/institution" || /^\/institution\/(?!new$|setup)[^/]+$/.test(path)) {
    return [`${V1}/institutions`, ...(inst ? [`${V1}/institutions/${inst}/profile`, `${V1}/institutions/${inst}/readiness`] : []), `${V1}/reference/routes`, `${V1}/reference/hazards`];
  }
  if (path === "/spec") return [`${V1}/spec`, ...(inst ? [`${V1}/institutions/${inst}/profile`] : []), `${V1}/data-connection`];
  if (path === "/admin/data") return [`${V1}/data-connection`, `${V1}/data-connection/checks`, `${V1}/spec`, `${V1}/institutions`];
  return [];
}
