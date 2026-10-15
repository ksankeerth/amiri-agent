// Sign-in (server: app/auth.py).
import { api } from "./client";

export interface AuthConfig { mode: "off" | "prototype"; recaptcha_site_key: string | null; access_code: boolean; google: boolean; asleep?: boolean }
export interface Me { mode: string; signed_in: boolean; kind: string | null; expires_at?: number | null }

export const authApi = {
  config: () => api<AuthConfig>("/api/v1/auth/config"),
  me: () => api<Me>("/api/v1/auth/me"),
  prototype: (token: string, code?: string) => api<Me>("/api/v1/auth/prototype", { method: "POST", json: { token, code: code || null } }),
  logout: () => api<{ signed_in: false }>("/api/v1/auth/logout", { method: "POST" }),
};
