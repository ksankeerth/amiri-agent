// Run with `node --test src/pages/radar/storyWords.test.ts`.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { RadarRun, RadarStatus, RadarStory } from "../../api/radar";
import {
  cantCheck, emptyCopy, followUpOf, funnelOf, funnelRun, investigatedText, LIST_FIRST, ledeText, listFor, moreWord, neighbour, orderStories, parseTab, pickStory,
  placeList, placesOf, refusalTitle, runDoneText, shownRows, tabCounts, toWatch, whereWent, type CheckState, type Where,
} from "./storyWords.ts";

const story = (id: string, status: RadarStory["status"], more: Partial<RadarStory> = {}): RadarStory => ({
  story_id: id, fingerprint: `fp-${id}`, title: `Story ${id}`, summary: "", why: "", places: ["US-TX"], themes: [], relevance: "medium", score: 60, publishers: 3, headlines: [],
  development_of: null, status, sent_by: status === "sent" ? "agent" : null, finding_id: status === "sent" ? `f-${id}` : null, runs_seen: 1,
  first_seen_at: "2026-11-24T06:00:00Z", last_seen_at: "2026-11-24T06:00:00Z", dismissed_by: null, dismissed_at: null, finding_status: null, event_id: null, event_title: null,
  monitor_hint: null, ...more });
const none: Where = { reasons: {}, titles: {}, watching: new Set() };
const run = (more: Partial<RadarRun> = {}): RadarRun => ({
  run_id: "r1", trigger: "tick", status: "completed", stories: 10, sent: 3, bytes_processed: 0, error: null, created_at: "2026-11-24T06:00:00Z",
  finished_at: "2026-11-24T06:15:00Z", considered: 2140, shortlisted: 64, ...more });

test("the tab in the address is one of the four, else All", () => {
  assert.equal(parseTab("below"), "below");
  assert.equal(parseTab("sent"), "sent");
  assert.equal(parseTab("nope"), "all");
  assert.equal(parseTab(null), "all");
});

test("sent stories first, then held back, then dismissed; the server's order inside each", () => {
  const xs = [story("a", "below"), story("b", "sent"), story("c", "dismissed"), story("d", "sent"), story("e", "below")];
  assert.deepEqual(orderStories(xs).map(s => s.story_id), ["b", "d", "a", "e", "c"]);
});

test("a tab and a place pick the list; the counts follow the place", () => {
  const xs = [story("a", "sent", { places: ["US-TX"] }), story("b", "below", { places: ["US-CA"] }), story("c", "below", { places: ["US-TX", "US-CA"] }), story("d", "dismissed")];
  assert.deepEqual(listFor(xs, "below", "").map(s => s.story_id), ["b", "c"]);
  assert.deepEqual(listFor(xs, "all", "US-CA").map(s => s.story_id), ["b", "c"]);
  assert.deepEqual(tabCounts(xs, ""), { all: 4, sent: 1, below: 2, dismissed: 1 });
  assert.deepEqual(tabCounts(xs, "US-CA"), { all: 2, sent: 0, below: 2, dismissed: 0 });
  assert.deepEqual(placesOf(xs), ["US-TX", "US-CA"]);
});

test("the open story: the one in the address, else the first on a desktop, none on a phone", () => {
  const xs = [story("a", "sent"), story("b", "below")];
  assert.equal(pickStory(xs, "b", false)?.story_id, "b");
  assert.equal(pickStory(xs, null, false)?.story_id, "a");
  assert.equal(pickStory(xs, "gone", false)?.story_id, "a");
  assert.equal(pickStory(xs, null, true), null);
  assert.equal(pickStory(xs, "b", true)?.story_id, "b");
  assert.equal(pickStory([], null, false), null);
});

test("after one leaves the list, the next one down opens, else the one above", () => {
  const xs = [story("a", "below"), story("b", "below"), story("c", "below")];
  assert.equal(neighbour(xs, "a")?.story_id, "b");
  assert.equal(neighbour(xs, "c")?.story_id, "b");
  assert.equal(neighbour([story("a", "below")], "a"), null);
});

test("a long list shows the first rows and the open one; one row more is shown rather than hidden", () => {
  const xs = Array.from({ length: 12 }, (_, i) => story(`s${i}`, "below"));
  const a = shownRows(xs, null, false);
  assert.equal(a.shown.length, LIST_FIRST);
  assert.equal(a.hidden, 12 - LIST_FIRST);
  const b = shownRows(xs, "s10", false);  // the open story is never behind the button
  assert.deepEqual(b.shown.map(s => s.story_id), [...xs.slice(0, LIST_FIRST).map(s => s.story_id), "s10"]);
  assert.equal(b.hidden, 12 - LIST_FIRST - 1);
  assert.equal(shownRows(xs, null, true).hidden, 0);
  assert.equal(shownRows(xs.slice(0, LIST_FIRST + 1), null, false).hidden, 0);
  assert.equal(shownRows(xs.slice(0, 3), null, false).shown.length, 3);
});

test("the button names what waits", () => {
  assert.equal(moreWord("all", 1), "1 more story");
  assert.equal(moreWord("all", 5), "5 more stories");
  assert.equal(moreWord("below", 5), "5 more held back");
  assert.equal(moreWord("sent", 2), "2 more sent");
  assert.equal(moreWord("dismissed", 2), "2 more dismissed");
});

test("where a sent story went: its event, being investigated, waiting, no impact, or couldn't be investigated", () => {
  const sent = (more: Partial<RadarStory>) => story("a", "sent", more);
  assert.deepEqual(whereWent(sent({ event_id: "ev1", event_title: "Texas power" }), none), { kind: "event", text: "Texas power", eventId: "ev1" });
  assert.equal(whereWent(sent({ event_id: "ev1", event_title: "Stored" }), { ...none, titles: { ev1: "Texas power prices spike" } }).text, "Texas power prices spike");
  assert.equal(whereWent(sent({ finding_status: "grouped" }), none).kind, "investigating");
  assert.equal(whereWent(sent({ finding_status: "new" }), none).kind, "waiting");
  assert.equal(whereWent(sent({ finding_status: "new" }), { ...none, watching: new Set(["f-a"]) }).kind, "investigating");
  const aside = sent({ finding_status: "set_aside" });
  assert.equal(whereWent(aside, { ...none, reasons: { "f-a": "investigation_failed" } }).kind, "failed");
  const no = whereWent(aside, { ...none, reasons: { "f-a": "no_theme" } });
  assert.equal(no.kind, "noimpact");
  assert.match(no.detail ?? "", /no economic link to your products/);
  assert.equal(whereWent(aside, none).text, "Not in an event");
  // held back and dismissed stories went nowhere
  assert.equal(whereWent(story("b", "below"), none).kind, "none");
  assert.equal(whereWent(story("c", "dismissed"), none).kind, "none");
});

test("a follow-up names the story it continues, or says it continues an earlier one", () => {
  const first = story("a", "sent", { title: "Texas chip plants idle lines during grid emergency", fingerprint: "fp-first" });
  const next = story("b", "below", { development_of: "fp-first" });
  assert.equal(followUpOf(next, [first, next]), "Follow-up to “Texas chip plants idle lines during grid emergency”");
  assert.equal(followUpOf(next, [next]), "Follow-up to an earlier story");
  assert.equal(followUpOf(first, [first, next]), null);
});

test("short words for a row", () => {
  assert.equal(placeList(["Texas"]), "Texas");
  assert.equal(placeList(["Texas", "Austin", "California", "Arizona"]), "Texas, Austin and 2 more");
});

test("the funnel is four numbers of a finished read, and nothing for a running or failed one", () => {
  assert.deepEqual(funnelOf(run())?.map(x => x.n), [2140, 64, 10, 3]);
  assert.equal(funnelOf(run())?.[3].big, true);
  assert.equal(funnelOf(run({ status: "running" })), null);
  assert.equal(funnelOf(run({ status: "failed" })), null);
  assert.equal(funnelOf(run({ considered: null })), null);
  assert.equal(funnelOf(null), null);
  assert.equal(funnelOf(run({ status: "stopped_early" }))?.length, 4);
});

test("while a read is running, the funnel shows the one before it", () => {
  const before = run({ run_id: "r0" });
  assert.equal(funnelRun(run({ status: "running", considered: null }), [run({ run_id: "r1", status: "running", considered: null }), before])?.run_id, "r0");
  assert.equal(funnelRun(run(), [before])?.run_id, "r1");
  assert.equal(funnelRun(run({ status: "failed" }), [before])?.run_id, "r0");
  assert.equal(funnelRun(null, null), null);
});

const status = (more: Partial<RadarStatus> = {}): RadarStatus => ({
  connected: true, agent_url: "x", every_minutes: 1440, last_run: run(), running: 0, run_at: "06:00", time_zone: "Asia/Colombo", run_now: { used: 0, limit: 5, left: 5 },
  next_run_at: "2026-11-25T06:00:00Z", bytes_today: 0, bytes_cap: 100, budget_spent: false, limits: { max_stories: 10, max_queries: 3, max_bytes_per_query: 1 }, notes: [], ...more });
const at = (iso: string) => `at ${iso.slice(11, 16)}`;

test("the lede says how often, when it last read and when it reads next", () => {
  assert.equal(ledeText(status(), "once a day at 06:00", at), "Reads the world's news once a day at 06:00 · last read at 06:15 · next at 06:00");
  assert.equal(ledeText(status({ last_run: null }), "every hour", at), "Reads the world's news every hour · no read yet · next at 06:00");
  assert.match(ledeText(status({ last_run: run({ status: "running" }) }), "every hour", at), /reading now/);
  assert.match(ledeText(status({ last_run: run({ status: "failed" }) }), "every hour", at), /last read failed at 06:15/);
  assert.equal(ledeText(status({ connected: false }), "every hour", at), "Radar isn't connected, so it isn't reading the news now · last read at 06:15");
  assert.equal(ledeText(status({ connected: false, last_run: null }), "every hour", at), "Radar isn't reading the news yet.");
  assert.match(ledeText(status(), "every hour", at, () => "due now"), /next due now$/);
});

const can: CheckState = { connected: true, budgetSpent: false, running: false, left: 5, limit: 5, budgetBack: "tomorrow 05:30", runAt: "06:00" };
test("Check now says why it can't be pressed, once, in words", () => {
  assert.equal(cantCheck(can), null);
  assert.equal(cantCheck({ ...can, connected: false }), "Radar isn't connected.");
  assert.equal(cantCheck({ ...can, running: true }), "A read is in progress.");
  assert.equal(cantCheck({ ...can, budgetSpent: true }), "Today's reading budget is spent. Radar reads again from tomorrow 05:30.");
  assert.equal(cantCheck({ ...can, left: 0 }), "You've used today's 5 checks. They come back at midnight; the 06:00 read still runs.");
  assert.equal(cantCheck({ ...can, left: 0, runAt: null }), "You've used today's 5 checks. They come back at midnight; the scheduled read still runs.");
  // not connected beats the rest; a read in progress beats the budget
  assert.equal(cantCheck({ ...can, connected: false, budgetSpent: true }), "Radar isn't connected.");
  assert.equal(cantCheck({ ...can, running: true, budgetSpent: true }), "A read is in progress.");
});

test("when a read ends the toast says what it found", () => {
  assert.equal(runDoneText({ status: "completed", stories: 10, sent: 3, error: null }), "Radar found 10 stories and sent 3 to investigate.");
  assert.equal(runDoneText({ status: "completed", stories: 1, sent: 0, error: null }), "Radar found 1 story; none needed an investigation.");
  assert.equal(runDoneText({ status: "stopped_early", stories: 0, sent: 0, error: null }), "Radar read the news and found nothing for you.");
  assert.equal(runDoneText({ status: "failed", stories: null, sent: null, error: "timed out" }), "Radar's read failed. It took too long and was stopped.");
});

test("only stories this read sent, whose finding is still on its way, are asked about: the newest few", () => {
  const xs = [
    story("a", "sent", { finding_status: "new", last_seen_at: "2026-11-24T06:00:00Z" }),
    story("b", "sent", { finding_status: "linked", event_id: "e1", last_seen_at: "2026-11-24T06:00:00Z" }),
    story("c", "sent", { finding_status: "grouped", last_seen_at: "2026-11-24T07:00:00Z" }),
    story("d", "sent", { finding_status: "set_aside", last_seen_at: "2026-11-24T06:00:00Z" }),
    story("e", "below"),
    story("f", "dismissed"),
    story("g", "sent", { finding_status: "new", last_seen_at: "2026-11-23T06:00:00Z" }),  // sent by an earlier read
  ];
  assert.deepEqual(toWatch(xs, "2026-11-24T05:59:00Z"), ["f-c", "f-a"]);
  assert.deepEqual(toWatch(xs, "2026-11-24T05:59:00Z", 1), ["f-c"]);
  assert.deepEqual(toWatch(xs, "2026-11-23T00:00:00Z"), ["f-c", "f-a", "f-g"]);
  assert.deepEqual(toWatch([], "2026-11-24T05:59:00Z"), []);
});

test("the toast when the asking ends", () => {
  assert.equal(investigatedText("timeout", 0), "Still working; it will appear here.");
  assert.equal(investigatedText("cancelled", 0), "");
  assert.equal(investigatedText("done", 0), "The investigation finished. No new event.");
  assert.equal(investigatedText("done", 1), "The investigation finished: 1 story joined an event.");
  assert.equal(investigatedText("done", 3), "The investigation finished: 3 stories joined events.");
});

test("a refusal gets a plain heading by its code; an unknown code gets none", () => {
  assert.equal(refusalTitle("budget_spent"), "Radar's budget for today is spent");
  assert.equal(refusalTitle("run_now_limit"), "You've used today's checks");
  assert.equal(refusalTitle("run_running"), "A read is already in progress");
  assert.equal(refusalTitle("radar_not_connected"), "Radar isn't connected");
  assert.equal(refusalTitle("nope"), undefined);
  assert.equal(refusalTitle(undefined), undefined);
});

test("an empty list says why, and how to get something back", () => {
  const o = { any: true, connected: true, admin: false };
  assert.equal(emptyCopy("all", "", "", { ...o, any: false }).title, "Nothing from Radar yet");
  assert.equal(emptyCopy("all", "", "", { ...o, any: false, connected: false }).text, "Radar starts reading the news once your Platform Admin connects it.");
  assert.equal(emptyCopy("all", "", "", { ...o, any: false, connected: false, admin: true }).text, "Connect the Radar agent and it starts reading the news.");
  assert.equal(emptyCopy("below", "", "", o).title, "Nothing held back");
  assert.equal(emptyCopy("sent", "", "", o).title, "Nothing sent to investigate");
  assert.equal(emptyCopy("dismissed", "", "", o).title, "Nothing dismissed");
  const p = emptyCopy("below", "US-CA", "California", o);
  assert.equal(p.title, "No stories about California");
  assert.equal(p.clear, "place");
  assert.equal(emptyCopy("below", "", "", o).clear, undefined);
});
