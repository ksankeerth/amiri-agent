import { test } from "node:test";
import assert from "node:assert/strict";
import { prefetchPlan } from "./prefetchPlan.ts";

const rm = { admin: false, institutionId: "austin-tech-bank" };

test("Overview asks for the overview (all of it for an admin) and the alert counts", () => {
  assert.deepEqual(prefetchPlan("/home", rm), ["/api/v1/overview", "/api/v1/alerts:summary"]);
  assert.equal(prefetchPlan("/home", { ...rm, admin: true })[0], "/api/v1/overview?audience=all");
});

test("Alerts: the tab, team and level in the address are in the list's address, in the order the page writes them", () => {
  assert.deepEqual(prefetchPlan("/alerts", rm), ["/api/v1/alerts:summary", "/api/v1/alerts?status=new&limit=200", "/api/v1/events?limit=200"]);
  assert.equal(prefetchPlan("/alerts?tab=resolved&team=Risk%20ops&level=adverse&alert=al-1", rm)[1], "/api/v1/alerts?status=resolved&owner=Risk+ops&level=adverse&limit=200");
  assert.equal(prefetchPlan("/alerts?tab=bogus&level=nope", rm)[1], "/api/v1/alerts?status=new&limit=200");
});

test("an event, a monitor, a series: the page's own detail", () => {
  assert.deepEqual(prefetchPlan("/events/ev-1", rm), ["/api/v1/events/ev-1", "/api/v1/alerts?event_id=ev-1"]);
  assert.ok(prefetchPlan("/monitors/mon-a%20b", rm).includes("/api/v1/monitors/mon-a%20b/findings"));
  assert.ok(prefetchPlan("/series/qqq", rm).includes("/api/v1/series/qqq/findings?limit=20"));
  assert.ok(prefetchPlan("/series", rm).every(u => !u.includes("/bars")));    // the chart's window moves with the clock: not worth asking ahead
});

test("every list page has a plan; the profile is asked for only when there is an institution", () => {
  for (const p of ["/events", "/findings", "/radar", "/monitors", "/series", "/studio", "/institution", "/institution/customers", "/spec", "/admin/data"]) {
    assert.ok(prefetchPlan(p, rm).length > 0, p);
  }
  assert.ok(prefetchPlan("/radar", rm).includes("/api/v1/institutions/austin-tech-bank/profile"));
  assert.ok(prefetchPlan("/radar", { admin: false, institutionId: null }).every(u => !u.includes("/institutions/")));
});

test("only reads, and nothing for pages that aren't known or must not be warmed", () => {
  assert.deepEqual(prefetchPlan("/nowhere", rm), []);
  assert.deepEqual(prefetchPlan("/institution/new", rm), []);
  assert.deepEqual(prefetchPlan("/institution/setup/2", rm), []);
  assert.deepEqual(prefetchPlan("/studio/run/sim-1", rm), []);
  assert.deepEqual(prefetchPlan("/admin/settings", rm), []);
  assert.deepEqual(prefetchPlan("not a path ::", rm).filter(u => !u.startsWith("/api/v1/")), []);
  for (const p of ["/home", "/alerts", "/events", "/findings", "/radar", "/monitors/m", "/series/s", "/studio/s", "/institution", "/spec", "/admin/data"]) {
    for (const u of prefetchPlan(p, rm)) assert.ok(u.startsWith("/api/v1/"), u);
  }
});
