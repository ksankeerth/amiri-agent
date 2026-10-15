// Reference data (GET /api/v1/reference/*), fetched once per page load.
import { api } from "./client";
import type { PlaceInfo } from "./institutions";

export interface Category { id: string; institution: "bank" | "insurer"; name: string; product_types: { id: string; typical_products: string | null; islamic_variant: string | null }[] }
export interface Dimension { dimension: string; values: string[] | null; format: string | null; description: string }
export interface Route { route_id: string; name: string; kind: string; points: [number, number][]; places: PlaceInfo[] }
export interface Hazard { hazard_id: string; kind: string; name: string; note?: string; months: number[]; places: string[]; centre?: [number, number]; radius_km?: number }

const cache = new Map<string, Promise<any>>();
function once<T>(key: string, f: () => Promise<T>): Promise<T> {
  if (!cache.has(key)) cache.set(key, f().catch(e => { cache.delete(key); throw e; }));
  return cache.get(key)!;
}
const R = "/api/v1/reference";

export interface Region { id: string; label: string }

export const ref = {
  taxonomy: () => once("tax", () => api<{ items: Category[] }>(`${R}/product-taxonomy`).then(r => r.items)),
  dimensions: () => once("dims", () => api<{ items: Dimension[] }>(`${R}/segment-dimensions`).then(r => r.items)),
  currencies: () => once("cur", () => api<{ items: { code: string; name: string }[] }>(`${R}/currencies`).then(r => r.items)),
  timeZones: () => once("tz", () => api<{ items: string[] }>(`${R}/time-zones`).then(r => r.items)),
  countries: () => once("countries", () => api<{ items: PlaceInfo[] }>(`${R}/places?kind=country&limit=400`).then(r => r.items)),
  // what a home country and base currency may be (the prototype's region, SUPPORTED_REGION on the server)
  homeCountries: () => once("homeCountries", () => api<{ items: { code: string; name: string }[]; region: Region | null }>(`${R}/countries?scope=home`)),
  homeCurrencies: () => once("homeCurrencies", () => api<{ items: { code: string; name: string }[]; region: Region | null }>(`${R}/currencies?scope=home`)),
  regulator: (id: string) => api<Record<string, any>>(`${R}/regulators/${encodeURIComponent(id)}`),
  routes: () => once("routes", () => api<{ items: Route[] }>(`${R}/routes`).then(r => r.items)),
  hazards: () => once("hazards", () => api<{ items: Hazard[] }>(`${R}/hazards`).then(r => r.items)),
  types: () => once("types", () => api<{ items: { institution_type: string; subtypes: string[] }[] }>(`${R}/institution-types`).then(r => r.items)),
  searchPlaces: (q: string, kind?: string) => api<{ items: PlaceInfo[] }>(`${R}/places?q=${encodeURIComponent(q)}${kind ? `&kind=${kind}` : ""}&limit=20`).then(r => r.items),
  place: (code: string) => once("place:" + code, () => api<PlaceInfo>(`${R}/places/${encodeURIComponent(code)}`)),
};
