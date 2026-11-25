// Words for the profile's codes: the Metrics Spec dimensions and their values, months, and money as the profile writes it.
// No React, so `npm test` runs it.

const DIM_WORDS: Record<string, string> = {
  segment: "Customer type", size_band: "Business size", age_band: "Age band", sector: "Economic sector (ISIC section)",
  sector_l2: "Economic sector (ISIC division)", employer_sector: "Employer's sector", region_l1: "Region",
  region_l2: "District", channel: "Channel", sales_channel: "Sales channel", corridor: "Remittance corridor", currency: "Currency",
};
export const dimWord = (d: string) => DIM_WORDS[d] ?? d;
const VALUE_WORDS: Record<string, string> = {
  remittance_linked: "receives remittances", other_individual: "other individuals", domestic_business: "domestic business",
  non_bank_financial: "non-bank financial", sme: "SME",
};
export const valueWord = (v: string) => VALUE_WORDS[v] ?? v.replace(/_/g, " ");

export const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const monthsText = (m: number[]) => (!m.length ? "any time" : m.map(x => MONTHS[x - 1]).join(", "));
export const usdText = (x: number) => (x >= 1e9 ? `USD ${(x / 1e9).toFixed(1)}bn` : x >= 1e6 ? `USD ${Math.round(x / 1e6)}m` : `USD ${Math.round(x).toLocaleString()}`);

export const AREA_WORDS: Record<string, string> = { aml: "Anti-money-laundering", data_protection: "Data protection", banking: "Banking", insurance: "Insurance", securities: "Securities", sanctions: "Sanctions", conduct: "Conduct", standards: "Global standards", other: "Other" };
