// Run with `node --test src/pages/institution/words.test.ts` (Node runs the TypeScript directly).
import assert from "node:assert/strict";
import { test } from "node:test";
import type { Check, Item } from "../../api/institutions";
import type { Change } from "../../api/assistant";
import {
  batchSummary, bookCell, bookHeading, booksTotal, bookText, byWords, cantApplyWhy, changeRows, changesText, countTone, emptyNote, expiredWhy,
  groupBatches, isStale, liveWords, openWords, proposalLook, readinessRows, removesText, statusLook, subLine, toReview, topicTab, typeWords,
  unlinkedNote, viewForTopic, viewName, viewOf, viewPath, whyParts,
} from "./words.ts";

const check = (id: string, level: Check["level"], ok: boolean, section = "products", message = id): Check => ({ id, level, ok, message, section, fix: `fix ${id}` });
const COUNTS = { footprint: 3, "watch-places": 4, segments: 6, products: 12, flows: 0, regulators: 6, rivals: 0, counterparties: 2, "risk-exposures": 0 };
const CHECKS = [check("footprint_home", "required", true, "footprint"), check("products", "required", true), check("flows", "recommended", false, "flows"),
  check("rivals", "recommended", false, "rivals"), check("risk_exposures", "recommended", false, "risk-exposures"), check("regulators", "recommended", true, "regulators")];

test("viewOf: sections, the two other views, the setup agent's older names, and nonsense", () => {
  assert.equal(viewOf(undefined), "overview");
  assert.equal(viewOf("overview"), "overview");
  assert.equal(viewOf("products"), "products");
  assert.equal(viewOf("risk-exposures"), "risk-exposures");
  assert.equal(viewOf("history"), "history");
  assert.equal(viewOf("agents"), "agents");
  assert.equal(viewOf("customers"), "products");
  assert.equal(viewOf("rules"), "regulators");
  assert.equal(viewOf("risks"), "risk-exposures");
  assert.equal(viewOf("footprint"), "footprint");
  assert.equal(viewOf("rivals"), "rivals");
  assert.equal(viewOf("setup"), null);
  assert.equal(viewOf("new"), null);
});

test("paths and names", () => {
  assert.equal(viewPath("overview"), "/institution");
  assert.equal(viewPath("products"), "/institution/products");
  assert.equal(viewName("watch-places"), "Places to watch");
  assert.equal(viewName("counterparties"), "Firms you depend on");
  assert.equal(viewName("agents"), "What the agents see");
});

test("the setup agent's topics and the page's parts meet", () => {
  assert.equal(topicTab("products"), "customers");
  assert.equal(topicTab("segments"), "customers");
  assert.equal(topicTab("flows"), "footprint");
  assert.equal(topicTab("watch-places"), "footprint");
  assert.equal(topicTab("regulators"), "rules");
  assert.equal(topicTab("counterparties"), "rivals");
  assert.equal(topicTab("risk-exposures"), "risks");
  assert.equal(topicTab("overview"), "overview");
  assert.equal(viewForTopic("customers"), "products");
  assert.equal(viewForTopic("rules"), "regulators");
  assert.equal(viewForTopic("agents"), "agents");
  assert.equal(viewForTopic("nonsense"), "overview");
});

test("countTone: an empty section the profile needs, by how much", () => {
  assert.equal(countTone("flows", 0, CHECKS), "unusual");
  assert.equal(countTone("rivals", 0, CHECKS), "unusual");
  assert.equal(countTone("flows", 3, CHECKS), undefined);
  assert.equal(countTone("counterparties", 0, CHECKS), undefined);   // nothing asks for it
  assert.equal(countTone("regulators", 0, CHECKS), undefined);       // its check is done
  assert.equal(countTone("products", 0, [check("products", "required", false)]), "bad");
});

test("emptyNote: board 08's line, and the required one", () => {
  assert.equal(emptyNote(COUNTS, CHECKS)?.text, "Flows, rivals and risks are empty. Recommended, not required: they sharpen what AMIRI Agent watches.");
  assert.equal(emptyNote(COUNTS, CHECKS)?.required, false);
  assert.equal(emptyNote(COUNTS, [])?.text, undefined);
  const req = emptyNote({ ...COUNTS, products: 0, segments: 0 }, [check("products", "required", false), check("segments", "required", false, "segments")]);
  assert.equal(req?.text, "Customer groups and products are empty. Required before this profile can go live.");
  assert.equal(req?.required, true);
  assert.equal(emptyNote({ ...COUNTS, products: 0 }, [check("products", "required", false)])?.text, "Products are empty. Required before this profile can go live.");
  assert.equal(emptyNote({ ...COUNTS, footprint: 0 }, [check("footprint_home", "required", false, "footprint")])?.text, "Footprint is empty. Required before this profile can go live.");
  const both = emptyNote({ ...COUNTS, products: 0 }, [check("products", "required", false), ...CHECKS.slice(2)])?.text ?? "";
  assert.match(both, /^Products are empty\. Required before this profile can go live\. Flows, rivals and risks are empty\. Recommended/);
  assert.equal(emptyNote({ ...COUNTS, flows: 2, rivals: 1, "risk-exposures": 1 }, CHECKS), null);
});

test("the header: type, the line under the name, the status pill", () => {
  const i = { subtype: "commercial", institution_type: "bank", islamic: false, base_currency: "USD", profile_version: 7 } as never;
  assert.equal(typeWords(i), "Commercial bank");
  assert.equal(typeWords({ subtype: null, institution_type: "insurer", islamic: true }), "Insurer (Islamic)");
  assert.equal(typeWords({ subtype: "finance_company", institution_type: "bank" }), "Finance company bank");
  assert.equal(subLine(i, "United States", "Central"), "Commercial bank · United States · USD · Central time · profile version 7");
  assert.equal(statusLook("active").word, "Active");
  assert.equal(statusLook("active").tone, "good");
  assert.equal(statusLook("setup").word, "Setting up");
  assert.equal(statusLook("archived").word, "Archived");
  assert.equal(toReview({ missing_required: 0, open_recommendations: 2 }), 2);
  assert.equal(toReview({ missing_required: 1, open_recommendations: 2 }), 3);
});

const prod = (o: Record<string, unknown> = {}): Item => ({ id: "p", version: 1, created_at: null, updated_at: null, updated_by: null, name: "P", ...o });

test("books: the total in one currency, the heading, the cell", () => {
  assert.equal(bookText(9.2e9), "9.2 bn");
  assert.equal(bookText(850e6), "850 m");
  assert.equal(bookText(1234), "1,234");
  const ps = [prod({ book_size: { amount: 9.2e9, currency: "USD" } }), prod({ book_size: { amount: 25.6e9, currency: "USD" } }), prod()];
  assert.deepEqual(booksTotal(ps), { currency: "USD", amount: 34.8e9, text: "USD 34.8 bn" });
  assert.equal(booksTotal([prod()]), null);
  assert.equal(booksTotal([prod({ book_size: { amount: 1e9, currency: "USD" } }), prod({ book_size: { amount: 1e9, currency: "LKR" } })]), null);
  assert.equal(bookHeading(ps), "Book, USD");
  assert.equal(bookHeading([prod({ book_size: { amount: 1e9, currency: "USD" } }), prod({ book_size: { amount: 1e9, currency: "LKR" } })]), "Book");
  assert.equal(bookCell(ps[0], true), "9.2 bn");
  assert.equal(bookCell(ps[0], false), "USD 9.2 bn");
  assert.equal(bookCell(ps[2], true), "—");
});

test("unlinkedNote", () => {
  const linked = prod({ data: { source_id: "s" } });
  assert.equal(unlinkedNote([linked, linked]), null);
  assert.deepEqual(unlinkedNote([prod()]), { lead: "This product is not linked to your institution's data yet", rest: ", so its checks can't use your numbers." });
  assert.equal(unlinkedNote([prod(), prod()])?.lead, "None of the 2 is linked to your institution's data yet");
  assert.equal(unlinkedNote([prod(), linked, linked])?.lead, "1 of the 3 is not linked to your institution's data yet");
  assert.equal(unlinkedNote([prod(), prod(), linked])?.rest, ", so their checks can't use your numbers.");
});

test("openWords: a check in plain words, with where its action goes", () => {
  const r = openWords(check("regulators", "recommended", false, "regulators", "5 regulators; 3 more suggested by the rule table"));
  assert.equal(r.title, "Review the 3 suggested regulators");
  assert.equal(r.to, "/institution/regulators");
  assert.equal(openWords(check("risk_exposures", "recommended", false, "risk-exposures", "3 risk exposures; the risk finder has 4 more to review")).sub, "4 more known risks to look at");
  assert.equal(openWords(check("product_data", "info", false, "products", "3 of 10 products linked to a data connection")).sub, "3 of 10 linked: checks need each product's numbers");
  const id = openWords(check("identity", "required", false, "institution", "Name, type"));
  assert.equal(id.to, undefined);
  assert.equal(id.action, "Edit details");
  assert.equal(openWords(check("segments", "required", false, "segments")).to, "/institution/segments");
});

test("readinessRows: open first, required before recommended, done last; a shape and a word each", () => {
  const rows = readinessRows([check("a", "recommended", true), check("b", "recommended", false), check("c", "required", false), check("d", "info", false), check("e", "required", true)]);
  assert.deepEqual(rows.map(r => r.id), ["c", "b", "d", "a", "e"]);
  assert.deepEqual(rows.map(r => [r.shape, r.word]), [["○", "Required"], ["◐", "Recommended"], ["◐", "Good to have"], ["✓", "Done"], ["✓", "Done"]]);
  assert.equal(rows[3].to, undefined);   // a done check has no action
  assert.equal(readinessRows([check("identity", "required", false, "institution")])[0].edit, true);
});

test("liveWords", () => {
  assert.equal(liveWords({ ready: false, missing_required: 2, open_recommendations: 1 }), "2 required items before you can go live");
  assert.equal(liveWords({ ready: false, missing_required: 1, open_recommendations: 1 }), "1 required item before you can go live");
  assert.equal(liveWords({ ready: true, missing_required: 0, open_recommendations: 2 }), "Everything required is there; 2 recommendations still open");
  assert.equal(liveWords({ ready: true, missing_required: 0, open_recommendations: 0 }), "Everything is there");
});

const ch = (o: Partial<Change>): Change => ({ section: "segments", id: null, op: "create", before: null, after: {}, ...o });

test("changeRows: what a proposal card lists", () => {
  const rows = changeRows([
    ch({ after: { label: "Solar and wind developers", kind: "business" } }),
    ch({ section: "products", after: { name: "Renewable Project Loans", product_type: "term_loan" } }),
    ch({ section: "rivals", op: "update", id: "r1", before: { name: "Coastal", overlap: "low" }, after: { name: "Coastal", overlap: "high" } }),
    ch({ section: "watch-places", op: "delete", before: { name: "Strait of Malacca" }, after: null }),
    ch({ section: "institution", op: "update", before: { governance_body: null }, after: { governance_body: "Board Risk Committee" } }),
  ]);
  assert.deepEqual(rows[0], { op: "Add", what: "Customer group", name: "Solar and wind developers", detail: "business", fields: [] });
  assert.equal(rows[1].name, "Renewable Project Loans");
  assert.equal(rows[1].detail, "term loan");
  assert.equal(rows[2].op, "Change");
  assert.deepEqual(rows[2].fields.find(f => f.label === "Overlap"), { label: "Overlap", before: "low", after: "high" });
  assert.equal(rows[3].op, "Remove");
  assert.equal(rows[3].what, "Place to watch");
  assert.equal(rows[3].name, "Strait of Malacca");
  assert.equal(rows[4].what, "Institution details");
  assert.equal(rows[4].name, "");
  assert.deepEqual(rows[4].fields, [{ label: "Who owns risk decisions", before: "—", after: "Board Risk Committee" }]);
});

test("changeRows: a place is named by the names it is given", () => {
  const [r] = changeRows([ch({ section: "footprint", after: { code: "LK" } })], { LK: "Sri Lanka" });
  assert.equal(r.name, "Sri Lanka");
  assert.equal(r.what, "Place in the footprint");
});

test("proposalLook: the six states of a card", () => {
  assert.deepEqual(proposalLook({ status: "pending", fits: true }), { kind: "waiting", cap: "Proposed change · waits for you" });
  assert.deepEqual(proposalLook({ status: "pending", fits: null }), { kind: "waiting", cap: "Proposed change · waits for you" });
  assert.deepEqual(proposalLook({ status: "pending", fits: false }), { kind: "cant", cap: "Proposed change · can't apply" });
  assert.deepEqual(proposalLook({ status: "expired", fits: null }), { kind: "expired", cap: "Proposed change · expired" });
  assert.equal(proposalLook({ status: "confirmed", fits: null }).kind, "applied");
  assert.equal(proposalLook({ status: "rejected", fits: null }).kind, "rejected");
  assert.equal(proposalLook({ status: "failed", fits: null }).kind, "failed");
});

test("expiredWhy and cantApplyWhy", () => {
  assert.equal(expiredWhy({ base_profile_version: 6 }, 7), "The profile changed since.");
  assert.equal(expiredWhy({ base_profile_version: 7 }, 7), "It waited too long to be applied.");
  assert.equal(expiredWhy({ base_profile_version: null }, 7), "It waited too long to be applied.");
  assert.equal(cantApplyWhy({ fit_errors: [{ message: "Capital-Call Lines still uses this group." }, { message: "Change it first." }] }), "Capital-Call Lines still uses this group. Change it first.");
  assert.match(cantApplyWhy({ fit_errors: [] }), /no longer fits/);
});

test("removesText: what a proposal deletes", () => {
  assert.equal(removesText([ch({ section: "watch-places", op: "delete" }), ch({ section: "watch-places", op: "delete" }), ch({ section: "risk-exposures", op: "delete" }), ch({})]), "2 places to watch and 1 risk");
  assert.equal(removesText([ch({ section: "rivals", op: "delete" })]), "1 rival");
  assert.equal(removesText([ch({})]), "");
});

test("history: one row per save, who made it", () => {
  const r = (batch_id: string, section: string) => ({ batch_id, section });
  const g = groupBatches([r("a", "rivals"), r("b", "products"), r("a", "rivals"), r("a", "products")]);
  assert.deepEqual(g.map(b => b.length), [3, 1]);
  assert.equal(batchSummary(g[0]), "2 rivals, 1 product");
  const person = (a: string) => a.split("@")[0];
  assert.equal(byWords("dilan@x.lk", "form", person), "dilan · via a form");
  assert.equal(byWords("anonymous", "system", person), "System · via the system");
  assert.equal(byWords("", "import", person), "System · via an import");
  assert.equal(byWords("a", "odd", person), "a · via odd");
});

test("whyParts: why a place is watched, in words", () => {
  const names = { LK: "Sri Lanka", KW: "Kuwait" };
  assert.deepEqual(whyParts("flow: remittances in with KW", names), ["Flow", "Remittances in with Kuwait"]);
  assert.deepEqual(whyParts("footprint (home)", names), ["Footprint", "Home"]);
  assert.deepEqual(whyParts("place to watch: Hormuz", names), ["Place to watch", "Hormuz"]);
  assert.deepEqual(whyParts("something else", names), ["", "Something else"]);
});

test("isStale: the server's two ways of saying someone else saved first", () => {
  assert.equal(isStale({ status: 412, code: "precondition_failed" }), true);
  assert.equal(isStale({ status: 409, code: "conflict" }), true);
  assert.equal(isStale({ status: 409, code: "in_use" }), false);
  assert.equal(isStale({ status: 422, code: "invalid" }), false);
  assert.equal(isStale(new Error("x")), false);
  assert.equal(isStale(null), false);
});

test("changesText: the person's unsaved edits, for the clipboard", () => {
  assert.equal(changesText("Capital-Call Lines", { owner: "Fund banking", islamic: true }).split("\n").length, 3);
  assert.match(changesText("Capital-Call Lines", { islamic: true }), /^My changes to Capital-Call Lines:\nIslamic: Yes$/);
  assert.equal(changesText("", {}), "My changes to this:\n(none)");
});

// ---------------------------------------------------------------- the map's regulator labels (mapLabels.ts)

import { around, labelWidth, LABEL_H, placeLabels, type Box, type LabelIn } from "./mapLabels.ts";

const overlap = (a: Box, b: Box) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const reg = (id: string, text: string | null, at: [number, number], rank = 0): LabelIn => ({ id, text, full: `${text ?? id} (full name)`, at, rank });

test("map labels: five regulators at one point: a few beside it, the rest one +N chip, none overlapping, none under the zoom buttons", () => {
  const zoom: Box = { x: 410, y: 0, w: 190, h: 62 };
  const items = [reg("fed", "Fed", [300, 200], 0), reg("fdic", "FDIC", [300, 200], 1), reg("dob", "Texas DOB", [300, 200], 2), reg("cfpb", "CFPB", [300, 200], 3), reg("fincen", "FinCEN", [300, 200], 4)];
  const out = placeLabels(items, { width: 600, height: 400, avoid: [zoom] });
  assert.equal(out.filter(l => !l.more).length, 3);
  const chip = out.find(l => l.more);
  assert.equal(chip?.text, "+2 more");
  assert.deepEqual(chip?.more, ["CFPB (full name)", "FinCEN (full name)"]);
  for (let i = 0; i < out.length; i++) {
    assert.ok(!overlap(out[i].box, zoom), out[i].text);
    assert.ok(!overlap(out[i].box, around([300, 200], 4)), `${out[i].text} sits on its point`);
    for (let j = i + 1; j < out.length; j++) assert.ok(!overlap(out[i].box, out[j].box), `${out[i].text} / ${out[j].text}`);
  }
  assert.deepEqual(out.filter(l => !l.more).map(l => l.text), ["Fed", "FDIC", "Texas DOB"]);  // the most important first
});

test("map labels: a name is whole or absent; a label with no short name only shows in the chip; the labels stay inside the map", () => {
  const out = placeLabels([reg("a", "Texas DOB", [596, 30]), reg("b", null, [596, 30], 1)], { width: 600, height: 300, avoid: [] });
  const a = out.find(l => l.text === "Texas DOB")!;
  assert.ok(a.box.x >= 0 && a.box.x + a.box.w <= 600 && a.box.y >= 0 && a.box.y + a.box.h <= 300);
  assert.ok(a.box.w >= labelWidth("Texas DOB") && a.box.h === LABEL_H);
  assert.equal(out.find(l => l.more)?.text, "+1 more");
  assert.ok(out.every(l => !/^Texas D$/.test(l.text)));
});

test("map labels: marks and event names are kept clear; with no room at all nothing is drawn rather than overlapped", () => {
  const out = placeLabels([reg("a", "FDIC", [50, 50])], { width: 120, height: 120, avoid: [{ x: 0, y: 0, w: 120, h: 120 }] });
  assert.deepEqual(out, []);
  const near = placeLabels([reg("a", "FDIC", [200, 200])], { width: 600, height: 400, avoid: [around([230, 200], 20)] });
  assert.ok(near.every(l => !overlap(l.box, around([230, 200], 20))));
});
