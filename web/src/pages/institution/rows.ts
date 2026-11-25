// What each section's table says (board 08 draws Products; the other sections follow the same grid): the columns, and each
// row as plain text. The first column is the item's name, in ink; the rest are details. On a phone only the name shows, with
// the details under it as one line ("Type: Term loan · Owner: Commercial banking"). No React, so `npm test` runs it.
import type { Item, SectionName } from "../../api/institutions";
import { FLOW_WORDS } from "../../components/setupFlow.ts";
import { placeName } from "../../format.ts";
import { cap, productTypeLabel } from "../../plain.ts";
import { AREA_WORDS, dimWord, monthsText, usdText, valueWord } from "./fieldWords.ts";
import { bookCell, bookHeading } from "./words.ts";

export interface ColDef { label: string; width: string; align?: "right"; /** Hidden on a phone: the sub line says it. */ phoneHide?: boolean }
export interface RowText { name: string; cells: string[]; /** The details as one line, for a phone. */ sub: string }
export interface RowCtx { names: Record<string, string | null>; segments: Item[] }

/** "finance_company" → "Finance company". */
export const cw = (s: string) => cap(s.replace(/_/g, " "));
export const withShort = (name: string, short?: string | null) => (short && !name.includes(`(${short})`) ? `${name} (${short})` : name);

const EDIT_COL = "32px";
const RELATION: Record<string, string> = { home: "Home", host: "Host country", reach: "Reaches you from abroad", standard: "Global standard" };

/** The columns of a section's table; `width` is a grid track. The Book column is named after the products' currency. */
export function columnsOf(section: SectionName, items: Item[]): ColDef[] {
  const U = "minmax(0, 1fr)";
  switch (section) {
    case "footprint": return [{ label: "Place", width: "minmax(0, 1.5fr)" }, { label: "Role", width: "150px", phoneHide: true }, { label: "Covers", width: "110px", phoneHide: true }, { label: "Branches", width: "90px", align: "right", phoneHide: true }];
    case "watch-places": return [{ label: "Place", width: "minmax(0, 1.2fr)" }, { label: "Kind", width: "120px", phoneHide: true }, { label: "Why it matters", width: "minmax(0, 1.8fr)", phoneHide: true }];
    case "segments": return [{ label: "Group", width: "minmax(0, 1.3fr)" }, { label: "Kind", width: "120px", phoneHide: true }, { label: "Where", width: U, phoneHide: true }, { label: "In your data", width: "minmax(0, 1.4fr)", phoneHide: true }];
    case "products": return [{ label: "Product", width: "minmax(0, 1.5fr)" }, { label: "Type", width: "120px", phoneHide: true }, { label: "Owner", width: U, phoneHide: true }, { label: "Customers", width: "minmax(0, 1.2fr)", phoneHide: true }, { label: bookHeading(items), width: "88px", align: "right", phoneHide: true }];
    case "flows": return [{ label: "Flow", width: "minmax(0, 1.3fr)" }, { label: "Between", width: "minmax(0, 1.3fr)", phoneHide: true }, { label: "A year", width: "110px", align: "right", phoneHide: true }, { label: "Customer groups", width: U, phoneHide: true }];
    case "regulators": return [{ label: "Regulator", width: "minmax(0, 1.6fr)" }, { label: "Area", width: "150px", phoneHide: true }, { label: "Where", width: U, phoneHide: true }, { label: "How it reaches you", width: "170px", phoneHide: true }];
    case "rivals": return [{ label: "Rival", width: "minmax(0, 1.4fr)" }, { label: "Type", width: "140px", phoneHide: true }, { label: "Where", width: U, phoneHide: true }, { label: "Overlap with you", width: "130px", phoneHide: true }];
    case "counterparties": return [{ label: "Firm", width: "minmax(0, 1.4fr)" }, { label: "Kind", width: "160px", phoneHide: true }, { label: "Where", width: U, phoneHide: true }, { label: "Importance", width: "130px", phoneHide: true }];
    case "risk-exposures": return [{ label: "Risk", width: "minmax(0, 1.8fr)" }, { label: "Kind", width: "110px", phoneHide: true }, { label: "When", width: U, phoneHide: true }, { label: "Touches", width: "minmax(0, 1.2fr)", phoneHide: true }];
  }
}

/** The grid for a section's rows: its columns, then the edit button's track. */
export const gridOf = (cols: ColDef[]): string => [...cols.map(c => c.width), EDIT_COL].join(" ");

export function rowText(section: SectionName, it: Item, items: Item[], c: RowCtx): RowText {
  const place = (code: string) => c.names[code] ?? placeName(code);
  const seg = (id: string) => c.segments.find(s => s.id === id)?.label ?? id;
  const list = (xs: string[]) => (xs.length ? xs.join(", ") : "—");
  const cols = columnsOf(section, items);
  let name: string, cells: string[];
  switch (section) {
    case "footprint":
      name = place(it.code);
      cells = [it.role === "home" ? "Home country" : cw(it.role), it.scope === "part" ? "Part of it" : "All of it", it.branch_count != null ? String(it.branch_count) : "—"];
      break;
    case "watch-places": name = it.name; cells = [cw(it.kind), it.reason || "—"]; break;
    case "segments":
      name = it.label;
      cells = [cw(it.kind), list(it.places.map(place)), it.spec_mapping.length
        ? it.spec_mapping.map((m: { dimension: string; value: string }) => `${dimWord(m.dimension).toLowerCase().replace("isic", "ISIC")} “${valueWord(m.value)}”`).join(", ") : "—"];
      break;
    case "products": {
      const single = new Set(items.map(p => p.book_size?.currency).filter(Boolean)).size <= 1;
      name = it.name;
      cells = [productTypeLabel(it.product_type), it.owner || "—", it.segments.length ? it.segments.map(seg).join(", ") : "—", bookCell(it, single)];
      break;
    }
    case "flows":
      name = `${cap(FLOW_WORDS[it.kind] ?? it.kind)}${it.goods ? ` (${it.goods})` : ""}`;
      cells = [`${place(it.local)} ↔ ${place(it.counterpart)}`, it.value ? usdText(it.value.amount) : "No figure", list(it.segments.map(seg))];
      break;
    case "regulators":
      name = withShort(it.name, it.short);
      cells = [AREA_WORDS[it.area] ?? cw(it.area), it.country ? place(it.country) : "Global", RELATION[it.relation] ?? cw(it.relation)];
      break;
    case "rivals": name = it.name; cells = [cw(it.type), list(it.places.map(place)), `${cap(it.overlap)} overlap`]; break;
    case "counterparties": name = it.name; cells = [cw(it.kind), list(it.places.map(place)), it.importance === "critical" ? "Critical to you" : cap(it.importance)]; break;
    case "risk-exposures": {
      const t = it.touches ?? {};
      const parts = [t.segments?.length && `${t.segments.length} customer ${t.segments.length === 1 ? "group" : "groups"}`, t.products?.length && `${t.products.length} ${t.products.length === 1 ? "product" : "products"}`,
        t.flows?.length && `${t.flows.length} ${t.flows.length === 1 ? "flow" : "flows"}`, t.routes?.length && `${t.routes.length} sea ${t.routes.length === 1 ? "route" : "routes"}`].filter(Boolean) as string[];
      name = it.title; cells = [cw(it.kind), monthsText(it.months), parts.length ? parts.join(", ") : "—"];
      break;
    }
  }
  const sub = cells.map((x, i) => (x === "—" ? null : `${cols[i + 1].label}: ${x}`)).filter(Boolean).join(" · ");
  return { name, cells, sub };
}
