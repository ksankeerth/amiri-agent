// Calls amiri-server. Errors come back as RFC 9457 problem details; every failure
// becomes an ApiError carrying the problem's code, detail and Retry-After.

export interface Problem {
  type?: string;
  title?: string;
  status: number;
  code: string;
  detail: string;
  retry_after_seconds?: number;
  provider_message?: string;
  errors?: { field: string; message: string }[];
  [k: string]: unknown;
}

export class ApiError extends Error {
  constructor(public problem: Problem) {
    super(problem.detail);
  }
  get code() { return this.problem.code; }
  get status() { return this.problem.status; }
  /** The detail, plus the provider's own message or the field errors when there are any. */
  get full(): string {
    const p = this.problem;
    const extra = p.provider_message ? ` Twelve Data said: “${p.provider_message}”` :
      p.errors?.length ? " " + p.errors.map(e => `${e.field}: ${e.message}`).join("; ") : "";
    return p.detail + extra;
  }
}

// The signed-in person. IAP provides it in production; until then, one demo user.
export const ME = "dilan@serendib.lk";

export async function api<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (!headers.has("X-Amiri-Actor")) headers.set("X-Amiri-Actor", ME);
  let body = init.body;
  if (init.json !== undefined) {
    headers.set("content-type", "application/json");
    body = JSON.stringify(init.json);
  }
  let r: Response;
  try {
    r = await fetch(path, { ...init, headers, body });
  } catch (e) {
    throw new ApiError({ status: 0, code: "network", detail: "The Amiri Agent server didn't answer. Is it running?" });
  }
  if (r.status === 204) return undefined as T;
  const text = await r.text();
  const data = text ? JSON.parse(text) : undefined;
  if (!r.ok) {
    const p: Problem = data && data.code ? data : { status: r.status, code: "http_" + r.status, detail: text || r.statusText };
    if (p.retry_after_seconds === undefined && r.headers.get("Retry-After")) p.retry_after_seconds = Number(r.headers.get("Retry-After"));
    // the session ran out (or was never there): back to the sign-in page, once
    if (r.status === 401 && p.code === "signed_out" && !path.startsWith("/api/v1/auth/")) window.dispatchEvent(new Event("amiri:signed-out"));
    throw new ApiError(p);
  }
  return data as T;
}
