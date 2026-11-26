// Forms for the institution and every section of its profile. A form edits a draft;
// saving creates the item, or sends only the fields that changed (If-Match: version).
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ApiError } from "../../api/client";
import { type InstitutionType, type Item, type Profile, type SectionName } from "../../api/institutions";
import { ref, type Category } from "../../api/reference";
import { FillFromJson } from "../../components/FillFromJson";
import { Checkbox } from "../../components/v2/Choice";
import { asControl, Input, Select, Textarea } from "../../components/v2/Field";
import { Segmented } from "../../components/v2/Choice";
import { institutionsOf } from "../../components/fillJson";
import {
  ChipsInput, CountrySelect, CurrenciesField, CurrencySelect, Field, FlowValueField, KVField, MoneyField, MonthStrip,
  PlaceField, PlacesField, RefsField, SpecField, TimeZoneInput, Toggles, useLoad, useRoutes,
} from "./fields";
import { FLOW_WORDS } from "../../components/setupFlow";
import { AREA_WORDS } from "./fieldWords";

export { AREA_WORDS };
import { cap, productTypeLabel } from "../../plain";

export type Draft = Record<string, any>;
export type Errors = Record<string, string>;
export interface Ctx { profile: Profile | null; type: InstitutionType }

/** Errors for fields the form doesn't show (the server names them, no input has a place for them): said at the bottom. */
export function useHiddenErrors(err: Errors) {
  const box = useRef<HTMLDivElement>(null);
  const [hidden, setHidden] = useState<string[]>([]);
  useEffect(() => {
    const text = box.current?.textContent ?? "";
    setHidden(Object.entries(err).filter(([, m]) => !text.includes(m)).map(([k, m]) => `${k}: ${m}`));
  }, [err]);
  return { box, hidden };
}

/** Field errors keyed by their first path segment; the rest as general errors. */
export function splitErrors(e: unknown): { fields: Errors; general: string[] } {
  if (!(e instanceof ApiError)) return { fields: {}, general: [String(e)] };
  const p = e.problem;
  const fields: Errors = {};
  const general: string[] = [];
  for (const x of (p.errors as { field?: string; message: string; code?: string }[] | undefined) ?? []) {
    const key = (x.field ?? "").split(".")[0];
    if (key && !/^\d+$/.test(key)) fields[key] = fields[key] ? `${fields[key]}; ${x.message}` : x.message;
    else general.push(x.message);
  }
  if (!p.errors?.length) general.push(e.full);
  return { fields, general };
}

export const LABELS: Record<SectionName, { one: string; many: string; nameKey: string }> = {
  footprint: { one: "place in the footprint", many: "Footprint", nameKey: "code" },
  "watch-places": { one: "place to watch", many: "Places to watch", nameKey: "name" },
  segments: { one: "customer group", many: "Customer groups", nameKey: "label" },
  products: { one: "product", many: "Products", nameKey: "name" },
  flows: { one: "flow", many: "Money and goods flows", nameKey: "id" },
  regulators: { one: "regulator", many: "Regulators and rules", nameKey: "name" },
  rivals: { one: "rival", many: "Rivals", nameKey: "name" },
  counterparties: { one: "counterparty", many: "Firms you depend on", nameKey: "name" },
  "risk-exposures": { one: "risk exposure", many: "Risk exposures", nameKey: "title" },
};

const opt = (xs: string[], words: Record<string, string> = {}) => xs.map(x => <option key={x} value={x}>{cap(words[x] ?? x.replace(/_/g, " "))}</option>);
const ROLE_WORDS: Record<string, string> = { home: "home (headquarters country)", branches: "branches", subsidiary: "subsidiary", representative_office: "representative office", agents: "agents only", digital_only: "digital only" };
const INCOME: [string, string][] = [["salary", "salary"], ["remittances", "remittances"], ["business_income", "business income"], ["farm_income", "farm income"], ["pension", "pension"], ["government_transfers", "government transfers"], ["investment_income", "investment income"], ["other", "other"]];
const RIVAL_TYPES = ["bank", "insurer", "takaful", "wallet", "fintech", "microfinance", "cooperative", "finance_company", "broker", "remittance_company", "other"];
const CP_KINDS = ["correspondent_bank", "reinsurer", "payment_scheme", "clearing_house", "technology_provider", "distribution_partner", "outsourcer", "other"];
const RISK_KINDS = ["conflict", "climate", "economic", "regulatory", "market", "health", "technology", "other"];
const AREAS = ["banking", "insurance", "securities", "aml", "data_protection", "sanctions", "conduct", "standards", "other"];
const RELATION_WORDS: Record<string, string> = { home: "home: your home country", host: "host: a country you operate in", reach: "reach: through a currency or market", standard: "standard: a global standard" };

// ---------------------------------------------------------------- per-section form bodies

export type Body = (p: { d: Draft; set: (k: string, v: any) => void; err: Errors; ctx: Ctx; editing: Item | null }) => ReactNode;

const names = (ctx: Ctx) => ctx.profile?.place_names ?? {};
/** A heading that groups the fields under it, across both columns. */
const Group = ({ children, first }: { children: ReactNode; first?: boolean }) => <h3 className={`pf-group${first ? " first" : ""}`}>{children}</h3>;
const items = (ctx: Ctx, s: SectionName) => ctx.profile?.sections[s] ?? [];

function ProductCategory({ d, set, err, ctx }: Parameters<Body>[0]) {
  const tax = useLoad(() => ref.taxonomy());
  const cats: Category[] = (tax ?? []).filter(c => c.institution === ctx.type);
  const cat = cats.find(c => c.id === d.category);
  const pt = cat?.product_types.find(t => t.id === d.product_type);
  return (
    <>
      <Field req label="Category (Metrics Spec)" error={err.category}>
        <Select value={d.category ?? ""} onChange={e => { set("category", e.target.value); set("product_type", ""); }}>
          <option value="">Choose…</option>{cats.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </Select>
      </Field>
      <Field req label="Product type" error={err.product_type} hint={pt ? `Typically: ${pt.typical_products}${pt.islamic_variant ? ` · Islamic: ${pt.islamic_variant}` : ""}` : undefined}>
        <Select value={d.product_type ?? ""} onChange={e => set("product_type", e.target.value)} disabled={!cat}>
          <option value="">Choose…</option>{(cat?.product_types ?? []).map(t => <option key={t.id} value={t.id}>{productTypeLabel(t.id)}</option>)}
        </Select>
      </Field>
    </>
  );
}

const RouteSelect = asControl(function RouteSelect({ value, onChange }: { value: string | null; onChange: (v: string | null) => void }) {
  const routes = useRoutes();
  return (
    <Select value={value ?? ""} onChange={e => onChange(e.target.value || null)}>
      <option value="">— not by sea, or not known —</option>{routes.map(r => <option key={r.route_id} value={r.route_id}>{r.name}</option>)}
    </Select>
  );
});

function RoutesToggles({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const routes = useRoutes();
  return <Toggles options={routes.map(r => [r.route_id, r.name] as [string, string])} value={value} onChange={onChange} />;
}

function RivalCategories({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const tax = useLoad(() => ref.taxonomy());
  return <Toggles options={(tax ?? []).map(c => [c.id, c.name] as [string, string])} value={value} onChange={onChange} />;
}

export const BODIES: Record<SectionName, Body> = {
  footprint: ({ d, set, err, ctx, editing }) => (<>
    <Field req label="Place (country or region)" error={err.code} full hint={editing ? "To move it, delete this entry and add the new place." : "Countries, states, provinces, districts (ISO 3166)."}>
      {editing ? <span className="chip sel">{names(ctx)[d.code] ?? d.code} <span className="mono">{d.code}</span></span>
        : <PlaceField value={d.code ?? null} onChange={v => set("code", v)} scope="iso" names={names(ctx)} />}
    </Field>
    <Field label="Role" error={err.role}><Select value={d.role} onChange={e => set("role", e.target.value)}>{opt(Object.keys(ROLE_WORDS), ROLE_WORDS)}</Select></Field>
    <Field label="Covers" error={err.scope}><Select value={d.scope} onChange={e => set("scope", e.target.value)}><option value="all">all of it</option><option value="part">part of it</option></Select></Field>
    <Field label="Branches" error={err.branch_count}><Input type="number" min={0} value={d.branch_count ?? ""} onChange={e => set("branch_count", e.target.value === "" ? null : Number(e.target.value))} /></Field>
    <Field label="Note" error={err.note} full><Textarea value={d.note ?? ""} onChange={e => set("note", e.target.value || null)} /></Field>
  </>),
  "watch-places": ({ d, set, err, ctx }) => (<>
    <Field req label="Name" error={err.name}><Input value={d.name ?? ""} onChange={e => set("name", e.target.value)} /></Field>
    <Field label="Kind" error={err.kind}><Select value={d.kind} onChange={e => set("kind", e.target.value)}>{opt(["country", "region", "city", "port", "chokepoint", "area"])}</Select></Field>
    <Field label="Place" error={err.code} full hint="Pick it to put it on the map (countries, cities, ports, straits).">
      <PlaceField value={d.code ?? null} names={names(ctx)} onChange={v => set("code", v)} />
    </Field>
    <Field label="Why it matters" error={err.reason} full><Textarea value={d.reason ?? ""} onChange={e => set("reason", e.target.value || null)} /></Field>
  </>),
  segments: ({ d, set, err, ctx }) => (<>
    <Group first>The group</Group>
    <Field req label="Name of the group" error={err.label} hint="A category, never names of customers."><Input value={d.label ?? ""} onChange={e => set("label", e.target.value)} /></Field>
    <Field label="Kind" error={err.kind}><Select value={d.kind} onChange={e => set("kind", e.target.value)}>{opt(["individual", "business", "public_sector", "financial", "mixed"])}</Select></Field>
    <Group>Where they are and what they live on</Group>
    <Field label="Where they are concentrated" error={err.places} full><PlacesField value={d.places ?? []} names={names(ctx)} onChange={v => set("places", v)} /></Field>
    <Field label="Main income" error={err.income_sources} full><Toggles options={INCOME} value={d.income_sources ?? []} onChange={v => set("income_sources", v)} /></Field>
    <Group>In your numbers</Group>
    <Field label="How your data identifies them (Metrics Spec)" error={err.spec_mapping} full hint="Lets checks look at just this group in your numbers.">
      <SpecField value={d.spec_mapping ?? []} onChange={v => set("spec_mapping", v)} /></Field>
    <Field label="Share of customers (%)" error={err.share_of_customers_pct}><Input type="number" min={0} max={100} value={d.share_of_customers_pct ?? ""} onChange={e => set("share_of_customers_pct", e.target.value === "" ? null : Number(e.target.value))} /></Field>
    <Field label="Note" error={err.note} full><Textarea value={d.note ?? ""} onChange={e => set("note", e.target.value || null)} /></Field>
  </>),
  products: (p) => {
    const { d, set, err, ctx } = p;
    return (<>
      <Group first>The product</Group>
      <Field req label="Name" error={err.name} full><Input value={d.name ?? ""} onChange={e => set("name", e.target.value)} placeholder="e.g. Business Current Account" /></Field>
      <ProductCategory {...p} />
      <Field label="Owner (business unit)" error={err.owner}><Input value={d.owner ?? ""} onChange={e => set("owner", e.target.value || null)} placeholder="e.g. Retail banking" /></Field>
      <Field label="Status" error={err.status}><Select value={d.status} onChange={e => set("status", e.target.value)}>{opt(["active", "launching", "closing", "closed"])}</Select></Field>
      <Group>Who uses it and how big it is</Group>
      <Field label="Who uses it" error={err.segments} full><RefsField items={items(ctx, "segments")} labelKey="label" value={d.segments ?? []} onChange={v => set("segments", v)} empty="Add customer groups first." /></Field>
      <Field label="Currencies" error={err.currencies} full><CurrenciesField value={d.currencies ?? []} onChange={v => set("currencies", v)} /></Field>
      <Field label="Book size" error={err.book_size} full><MoneyField value={d.book_size ?? null} onChange={v => set("book_size", v)} /></Field>
      <Field label="Islamic product" error={err.islamic}><Checkbox checked={!!d.islamic} onChange={e => set("islamic", e.target.checked)} label="Islamic or takaful variant" /></Field>
      <Field label="Launched" error={err.launched_on}><Input type="date" value={d.launched_on ?? ""} onChange={e => set("launched_on", e.target.value || null)} /></Field>
      <Group>Its numbers</Group>
      <Field label="In your institution's data" error={err.data} full hint="Its numbers come from the JSON file imported on Data connections: name the source and its product id in that file's catalog.">
        <div className="row" style={{ gap: 6 }}>
          <Input aria-label="Source id" value={d.data?.source_id ?? ""} placeholder="source id, e.g. institution-data" onChange={e => set("data", { ...(d.data ?? {}), source_id: e.target.value || null })} />
          <Input aria-label="Product id in the catalog" value={d.data?.catalog_product_id ?? ""} placeholder="its product id in the catalog" onChange={e => set("data", { ...(d.data ?? {}), catalog_product_id: e.target.value || null })} />
        </div>
      </Field>
      <Field label={ctx.type === "insurer" ? "Details (e.g. sum_insured_band, retention_pct)" : "Details (e.g. tenor_months, secured)"} error={err.attributes} full>
        <KVField value={d.attributes ?? {}} onChange={v => set("attributes", v)} /></Field>
      <Field label="Note" error={err.note} full><Textarea value={d.note ?? ""} onChange={e => set("note", e.target.value || null)} /></Field>
    </>);
  },
  flows: ({ d, set, err, ctx, editing }) => (<>
    <Group first>The flow</Group>
    <Field req label="Kind" error={err.kind}><Select value={d.kind} onChange={e => set("kind", e.target.value)}>{opt(Object.keys(FLOW_WORDS), FLOW_WORDS)}</Select></Field>
    <Field label="Goods (trade only)" error={err.goods}><Input value={d.goods ?? ""} onChange={e => set("goods", e.target.value || null)} placeholder="e.g. Garments" /></Field>
    <Field req label="Your end (in the footprint)" error={err.local}><PlaceField value={d.local ?? null} scope="iso" names={names(ctx)} onChange={v => set("local", v)} /></Field>
    <Field req label="The other end (country)" error={err.counterpart}><CountrySelect value={d.counterpart ?? null} onChange={v => set("counterpart", v)} /></Field>
    <Group>Size and route</Group>
    <Field label="Figure" error={err.value} full hint={editing?.source?.kind === "dataset" ? `From ${editing.source.dataset} (${editing.source.dataset_year}). Changing it keeps the dataset's figure as the original.` : undefined}>
      <FlowValueField value={d.value ?? null} onChange={v => set("value", v)} /></Field>
    <Field label="Sea route (goods)" error={err.route_id} full><RouteSelect value={d.route_id ?? null} onChange={v => set("route_id", v)} /></Field>
    <Group>Who it concerns</Group>
    <Field label="Customer groups it concerns" error={err.segments} full><RefsField items={items(ctx, "segments")} labelKey="label" value={d.segments ?? []} onChange={v => set("segments", v)} /></Field>
    <Field label="Status" error={err.status}><Select value={d.status} onChange={e => set("status", e.target.value)}><option value="confirmed">confirmed</option><option value="suggested">suggested (not checked yet)</option></Select></Field>
    <Field label="Note" error={err.note} full><Textarea value={d.note ?? ""} onChange={e => set("note", e.target.value || null)} /></Field>
  </>),
  regulators: ({ d, set, err }) => (<>
    <Field req label="Name" error={err.name}><Input value={d.name ?? ""} onChange={e => set("name", e.target.value)} /></Field>
    <Field label="Short name" error={err.short}><Input value={d.short ?? ""} onChange={e => set("short", e.target.value || null)} placeholder="e.g. FATF" /></Field>
    <Field label="Country" error={err.country}><CountrySelect value={d.country ?? null} allowEmpty onChange={v => set("country", v)} /></Field>
    <Field req label="Area" error={err.area}><Select value={d.area} onChange={e => set("area", e.target.value)}>{opt(AREAS, AREA_WORDS)}</Select></Field>
    <Field req label="How it reaches you" error={err.relation} full><Select value={d.relation} onChange={e => set("relation", e.target.value)}>{opt(Object.keys(RELATION_WORDS), RELATION_WORDS)}</Select></Field>
    <Field label="What it controls" error={err.controls} full><ChipsInput value={d.controls ?? []} onChange={v => set("controls", v)} placeholder="e.g. Foreign-exchange rules, then Enter" /></Field>
    <Field label="Note" error={err.note} full><Textarea value={d.note ?? ""} onChange={e => set("note", e.target.value || null)} /></Field>
  </>),
  rivals: ({ d, set, err, ctx }) => (<>
    <Group first>The rival</Group>
    <Field req label="Name" error={err.name}><Input value={d.name ?? ""} onChange={e => set("name", e.target.value)} /></Field>
    <Field label="Type" error={err.type}><Select value={d.type} onChange={e => set("type", e.target.value)}>{opt(RIVAL_TYPES)}</Select></Field>
    <Field label="Overlap with you" error={err.overlap}><Select value={d.overlap} onChange={e => set("overlap", e.target.value)}>{opt(["high", "medium", "low"])}</Select></Field>
    <Field label="Website" error={err.website}><Input value={d.website ?? ""} onChange={e => set("website", e.target.value || null)} placeholder="https://" /></Field>
    <Group>Where they compete</Group>
    <Field label="Where they compete" error={err.places} full><PlacesField value={d.places ?? []} names={names(ctx)} onChange={v => set("places", v)} /></Field>
    <Field label="Product lines where they compete" error={err.categories} full><RivalCategories value={d.categories ?? []} onChange={v => set("categories", v)} /></Field>
    <Group>In the news</Group>
    <Field label="Other names in the news" error={err.aliases} full><ChipsInput value={d.aliases ?? []} onChange={v => set("aliases", v)} /></Field>
    <Field label="Note" error={err.note} full><Textarea value={d.note ?? ""} onChange={e => set("note", e.target.value || null)} /></Field>
  </>),
  counterparties: ({ d, set, err, ctx }) => (<>
    <Field req label="Name" error={err.name}><Input value={d.name ?? ""} onChange={e => set("name", e.target.value)} /></Field>
    <Field req label="Kind" error={err.kind}><Select value={d.kind} onChange={e => set("kind", e.target.value)}>{opt(ctx.type === "insurer" ? ["reinsurer", "distribution_partner", ...CP_KINDS.filter(k => k !== "reinsurer" && k !== "distribution_partner")] : CP_KINDS)}</Select></Field>
    <Field label="Where" error={err.places} full><PlacesField value={d.places ?? []} names={names(ctx)} onChange={v => set("places", v)} /></Field>
    <Field label="Importance" error={err.importance}><Select value={d.importance} onChange={e => set("importance", e.target.value)}>{opt(["critical", "important", "other"])}</Select></Field>
    <Field label="Other names" error={err.aliases}><ChipsInput value={d.aliases ?? []} onChange={v => set("aliases", v)} /></Field>
    <Field label="Note" error={err.note} full><Textarea value={d.note ?? ""} onChange={e => set("note", e.target.value || null)} /></Field>
  </>),
  "risk-exposures": ({ d, set, err, ctx }) => (<>
    <Group first>The risk</Group>
    <Field req label="Title" error={err.title} full><Input value={d.title ?? ""} onChange={e => set("title", e.target.value)} placeholder="e.g. Floods meet our branches" /></Field>
    <Field req label="Kind" error={err.kind}><Select value={d.kind} onChange={e => set("kind", e.target.value)}>{opt(RISK_KINDS)}</Select></Field>
    <Field label="Status" error={err.status}><Select value={d.status} onChange={e => set("status", e.target.value)}><option value="active">active</option><option value="dismissed">dismissed (not relevant)</option></Select></Field>
    <Field label="Where" error={err.places} full><PlacesField value={d.places ?? []} names={names(ctx)} onChange={v => set("places", v)} /></Field>
    <Field label="When in the year" error={err.months} full><MonthStrip value={d.months ?? []} onChange={v => set("months", v)} /></Field>
    <Group>What it touches</Group>
    <Field label="Customer groups" error={err.touches} full><RefsField items={items(ctx, "segments")} labelKey="label" value={d.touches?.segments ?? []} onChange={v => set("touches", { ...d.touches, segments: v })} /></Field>
    <Field label="Products" full><RefsField items={items(ctx, "products")} labelKey="name" value={d.touches?.products ?? []} onChange={v => set("touches", { ...d.touches, products: v })} /></Field>
    <Field label="Flows" full><RefsField items={(items(ctx, "flows")).map(f => ({ ...f, _label: `${FLOW_WORDS[f.kind]} ${f.local} ↔ ${f.counterpart}${f.goods ? ` (${f.goods})` : ""}` }))} labelKey="_label" value={d.touches?.flows ?? []} onChange={v => set("touches", { ...d.touches, flows: v })} /></Field>
    <Field label="Sea routes" full><RoutesToggles value={d.touches?.routes ?? []} onChange={v => set("touches", { ...d.touches, routes: v })} /></Field>
    <Field label="Places to watch" full><RefsField items={items(ctx, "watch-places")} labelKey="name" value={d.touches?.watch_places ?? []} onChange={v => set("touches", { ...d.touches, watch_places: v })} /></Field>
    <Field label="Note" error={err.note} full><Textarea value={d.note ?? ""} onChange={e => set("note", e.target.value || null)} /></Field>
  </>),
};

export const DEFAULTS: Record<SectionName, (ctx: Ctx) => Draft> = {
  footprint: () => ({ code: null, role: "branches", scope: "all", branch_count: null, note: null }),
  "watch-places": () => ({ name: "", code: null, kind: "country", reason: null }),
  segments: () => ({ label: "", kind: "individual", places: [], income_sources: [], spec_mapping: [], note: null }),
  products: () => ({ name: "", category: "", product_type: "", segments: [], status: "active", currencies: [], islamic: false, attributes: {} }),
  flows: () => ({ kind: "remittances_in", local: null, counterpart: null, value: null, segments: [], status: "confirmed", source: { kind: "user" } }),
  regulators: () => ({ name: "", area: "banking", relation: "home", basis: "user", controls: [] }),
  rivals: () => ({ name: "", type: "bank", places: [], categories: [], overlap: "medium", aliases: [] }),
  counterparties: (ctx) => ({ name: "", kind: ctx.type === "insurer" ? "reinsurer" : "correspondent_bank", places: [], importance: "important", aliases: [] }),
  "risk-exposures": () => ({ title: "", kind: "climate", places: [], months: [], status: "active", source: "user", touches: { segments: [], products: [], flows: [], routes: [], watch_places: [] } }),
};

export const META = new Set(["id", "version", "created_at", "updated_at", "updated_by", "used_by", "warnings"]);
export const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

// ---------------------------------------------------------------- the institution itself

const SUBTYPES: Record<InstitutionType, string[]> = {
  bank: ["commercial", "savings", "cooperative", "development", "islamic", "microfinance", "finance_company", "digital", "rural"],
  insurer: ["life", "general", "composite", "health", "takaful", "reinsurer", "micro"],
};
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** `grouped`: the fields under three plain headings (the first-run form); otherwise one flat grid, as in the edit dialog. */
export function InstitutionFields({ d, set, err, creating, fill, grouped }: { d: Draft; set: (k: string, v: any) => void; err: Errors; creating: boolean; fill?: (data: Draft) => void; grouped?: boolean }) {
  const t = (d.institution_type ?? "bank") as InstitutionType;
  const islamic = <Field label="Islamic" error={err.islamic}><Checkbox checked={!!d.islamic} onChange={e => set("islamic", e.target.checked)} label="Islamic bank or window, or takaful" /></Field>;
  return (
    <div className="grid2">
      {grouped && <Group first>Who you are</Group>}
      <Field req label="Name" error={err.name}><Input value={d.name ?? ""} onChange={e => set("name", e.target.value)} placeholder="The institution's name" /></Field>
      <Field label="Legal name" error={err.legal_name}><Input value={d.legal_name ?? ""} onChange={e => set("legal_name", e.target.value || null)} /></Field>
      <Field req label="Type" error={err.institution_type} hint={!creating ? "Can't change while products of this type exist." : undefined}>
        <Segmented label="Type" value={t} options={[{ value: "bank", label: "Bank" }, { value: "insurer", label: "Insurer" }]}
          onChange={x => { set("institution_type", x); set("subtype", null); }} />
      </Field>
      <Field label="Kind of bank or insurer" error={err.subtype}>
        <Select value={d.subtype ?? ""} onChange={e => set("subtype", e.target.value || null)}><option value="">—</option>{opt(SUBTYPES[t])}</Select>
      </Field>
      {grouped && islamic}
      {grouped && <Group>Where you are, and in what money</Group>}
      <Field req label="Home country" error={err.home_country} hint={!creating ? "To move home, add the new country to the footprint as home first." : undefined}>
        <CountrySelect home value={d.home_country ?? null} onChange={v => set("home_country", v)} /></Field>
      <Field req label="Base currency" error={err.base_currency}><CurrencySelect home value={d.base_currency ?? null} onChange={v => set("base_currency", v)} /></Field>
      <Field req label="Time zone" error={err.time_zone}><TimeZoneInput value={d.time_zone ?? ""} onChange={v => set("time_zone", v)} /></Field>
      {!grouped && islamic}
      <Field label="Currencies you settle in abroad" error={err.clearing_currencies} full hint="Decides which sanctions regimes reach you (USD → OFAC).">
        <CurrenciesField value={d.clearing_currencies ?? []} onChange={v => set("clearing_currencies", v)} /></Field>
      {grouped ? (
        <details className="pf-more" open={["governance_body", "size_band", "fiscal_year_start_month", "lei", "short_name", "website", "summary"].some(k => err[k]) || undefined}>
          <summary>More about you <span>(optional)</span></summary>
          <div className="grid2">
            <Field label="Who owns risk decisions" error={err.governance_body}><Input value={d.governance_body ?? ""} onChange={e => set("governance_body", e.target.value || null)} placeholder="e.g. Board Risk Committee" /></Field>
            <Field label="Size" error={err.size_band}><Select value={d.size_band ?? ""} onChange={e => set("size_band", e.target.value || null)}><option value="">—</option>{opt(["small", "mid", "large", "systemic"], { mid: "mid-size", systemic: "systemically important" })}</Select></Field>
            <Field label="Financial year starts in" error={err.fiscal_year_start_month}><Select value={d.fiscal_year_start_month ?? 1} onChange={e => set("fiscal_year_start_month", Number(e.target.value))}>{MONTH_NAMES.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}</Select></Field>
            <Field label="LEI" error={err.lei}><Input mono value={d.lei ?? ""} onChange={e => set("lei", e.target.value.toUpperCase() || null)} placeholder="20 characters" /></Field>
            <Field label="Short name" error={err.short_name}><Input value={d.short_name ?? ""} onChange={e => set("short_name", e.target.value || null)} /></Field>
            <Field label="Website" error={err.website}><Input value={d.website ?? ""} onChange={e => set("website", e.target.value || null)} placeholder="https://" /></Field>
            <Field label="In a few lines: what you do" error={err.summary} full><Textarea value={d.summary ?? ""} onChange={e => set("summary", e.target.value || null)} /></Field>
          </div>
        </details>
      ) : <>
      <Field label="Who owns risk decisions" error={err.governance_body}><Input value={d.governance_body ?? ""} onChange={e => set("governance_body", e.target.value || null)} placeholder="e.g. Board Risk Committee" /></Field>
      <Field label="Size" error={err.size_band}><Select value={d.size_band ?? ""} onChange={e => set("size_band", e.target.value || null)}><option value="">—</option>{opt(["small", "mid", "large", "systemic"], { mid: "mid-size", systemic: "systemically important" })}</Select></Field>
      <Field label="Financial year starts in" error={err.fiscal_year_start_month}><Select value={d.fiscal_year_start_month ?? 1} onChange={e => set("fiscal_year_start_month", Number(e.target.value))}>{MONTH_NAMES.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}</Select></Field>
      <Field label="LEI" error={err.lei}><Input mono value={d.lei ?? ""} onChange={e => set("lei", e.target.value.toUpperCase() || null)} placeholder="20 characters" /></Field>
      <Field label="Short name" error={err.short_name}><Input value={d.short_name ?? ""} onChange={e => set("short_name", e.target.value || null)} /></Field>
      <Field label="Website" error={err.website}><Input value={d.website ?? ""} onChange={e => set("website", e.target.value || null)} placeholder="https://" /></Field>
      <Field label="In a few lines: what you do" error={err.summary} full><Textarea value={d.summary ?? ""} onChange={e => set("summary", e.target.value || null)} /></Field>
      </>}
      {fill && <FillFromJson what="the institution" read={institutionsOf} onFill={c => fill(c.data)}
        example={'{"institution": {"name": "…", "institution_type": "bank", "home_country": "LK", …}}, or those fields on their own'} />}
    </div>
  );
}
