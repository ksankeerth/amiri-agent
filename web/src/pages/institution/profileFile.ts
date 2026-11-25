// The profile as a file: the fields a new institution can be created from (so an export imports again), and the download.
const CREATE_KEYS = ["institution_id", "name", "legal_name", "short_name", "institution_type", "subtype", "islamic", "lei", "home_country", "base_currency", "time_zone", "clearing_currencies", "summary", "governance_body", "size_band", "fiscal_year_start_month", "website"];
export const pickCreate = (i: Record<string, any>) => Object.fromEntries(CREATE_KEYS.filter(k => i[k] !== undefined && i[k] !== null).map(k => [k, i[k]]));

export function downloadJson(name: string, data: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
  const a = document.createElement("a"); a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
