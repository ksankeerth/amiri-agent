// The Metrics Spec, for its pages and downloads (server: app/spec/api.py).
import { api } from "./client";

export interface SpecMetric {
  key: string; name: string; question: string; kind: string; unit: string; currency_rule: string; grain: string;
  day_basis: string | null; max_lag_days: number; max_lag_rule?: string | null; history_months: number; breakdowns: string[];
  volume: string | null; adverse: string[] | null; tier: "required" | "recommended" | "optional"; starter: boolean;
  themes: string[]; applies_to: string[] | "all"; scope: string; since: string; commonly_reported: boolean;
  deprecated_in?: string | null; replaced_by?: string | null;
  definition: { includes: string[]; excludes: string[]; booking_date: string; flow_basis?: string; notes?: string;
    numerator?: string; denominator?: string; exposure?: string };
  validation: { method: string; judge_grain: string | null; stable_age_days: number | null; min_volume: number | null;
    min_denominator: number | null; min_base: number | null; counts: boolean; mask_family: boolean;
    masked_by: unknown; adverse_allowed: string[] | null; concentration_sensitive: boolean;
    thresholds: Record<string, Record<string, number>> | null } | null;
}
export interface SpecCategory {
  id: string; institution: "bank" | "insurer"; name: string; supervisory_note?: string | null;
  product_types: { id: string; typical_products?: string | null; islamic_variant?: string | null }[];
  derived_metrics?: { key: string; formula: string; note?: string }[] | null; metrics?: SpecMetric[];
}
export interface SpecDimension { values: string[] | string | Record<string, string[]>; source?: string; frozen?: boolean; description?: string }
export interface SpecCheck { id: string; level: string; name: string; check: string; passes: string; fix: string }
export interface SpecFile { name: string; label: string; available: boolean; bytes: number | null; href: string }
export interface Spec {
  spec_version: string; validation_params_version: string; title: string; status: string; published: string;
  guide: Record<string, { title: string; md: string }>;
  capability_levels: { level: string; name: string; requires: string; unlocks: string; lost_without: string }[];
  vocabularies: Record<string, Record<string, string | number>>;
  dimensions: Record<string, SpecDimension>; categories: SpecCategory[]; conformance_checks: SpecCheck[];
  aliases: unknown[]; deprecations: unknown[]; changelog: { version: string; date: string; kind: string; text: string }[];
  files: SpecFile[];
}

export const specApi = { get: () => api<Spec>("/api/v1/spec") };
