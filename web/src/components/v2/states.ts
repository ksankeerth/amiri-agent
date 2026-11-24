// Plain logic for the shared states (board 13 sections 2 and 3): how long ago, what a failed load says, what a
// refusal shows. Duck-typed on the API's errors (api/client.ts ApiError: code, detail, status) so it needs no import
// of the client.

/** "just now", "3 min ago", "2 h ago", "3 days ago": the stale banner's clock. */
export function agoText(loadedAt: number, now: number = Date.now()): string {
  const s = Math.max(0, Math.round((now - loadedAt) / 1000));
  if (s < 60) return "less than a minute ago";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400 * 2) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} days ago`;
}

interface ProblemLike { code?: unknown; status?: unknown; detail?: unknown; message?: unknown }
const asProblem = (e: unknown): ProblemLike | null => (typeof e === "object" && e !== null ? (e as ProblemLike) : null);

/** The server didn't answer (no connection, or a 5xx): not the user's fault. */
export function isDownError(e: unknown): boolean {
  const p = asProblem(e);
  return !!p && (p.code === "network" || (typeof p.status === "number" && p.status >= 500));
}

/** The words of a failed load: "Couldn't load the alerts" and one plain sentence. `safe` says what is not lost. */
export function loadErrorCopy(error: unknown, what = "this page", safe?: string): { title: string; message: string } {
  const title = `Couldn't load ${what}`;
  if (isDownError(error)) return { title, message: `Amiri Agent didn't answer. ${safe ?? "Nothing you saved is lost; this page just couldn't reach it."}` };
  const p = asProblem(error);
  const detail = typeof p?.detail === "string" && p.detail ? p.detail : typeof p?.message === "string" && p.message ? p.message : "";
  return { title, message: detail || "Something went wrong on our side. Try again in a moment." };
}

/** A refusal: the server's `detail` is the message, its `code` is shown small, for support. */
export function refusalOf(error: unknown): { message: string; code?: string } | null {
  const p = asProblem(error);
  if (!p) return null;
  const message = typeof p.detail === "string" && p.detail ? p.detail : typeof p.message === "string" ? p.message : "";
  if (!message) return null;
  return { message, code: typeof p.code === "string" && p.code ? p.code : undefined };
}

/** 412 on a save with If-Match: someone else saved first. */
export const isEditConflict = (e: unknown): boolean => asProblem(e)?.status === 412;
