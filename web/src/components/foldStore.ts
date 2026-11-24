// Remembers whether a viewer opened or closed a fold, in their own browser. Storage can be blocked (private mode,
// cleared site data) and then every read is null and every write is ignored: the page still works, folds start as
// their default. The storage is a parameter so the tests can pass one that throws.

export type StorageLike = Pick<Storage, "getItem" | "setItem">;

const KEY = "amiri.folds";

function browserStorage(): StorageLike | null {
  try { return typeof localStorage === "undefined" ? null : localStorage; } catch { return null; }
}

function readAll(s: StorageLike | null): Record<string, boolean> {
  if (!s) return {};
  try {
    const raw = s.getItem(KEY);
    const v = raw ? JSON.parse(raw) : {};
    return v && typeof v === "object" && !Array.isArray(v) ? v : {};
  } catch { return {}; }
}

/** The viewer's choice for this fold, or null when they never chose (or storage is blocked). */
export function readFold(id: string, s: StorageLike | null = browserStorage()): boolean | null {
  const v = readAll(s)[id];
  return typeof v === "boolean" ? v : null;
}

/** Saves the viewer's choice; does nothing when storage is blocked. */
export function writeFold(id: string, open: boolean, s: StorageLike | null = browserStorage()): void {
  if (!s) return;
  try { s.setItem(KEY, JSON.stringify({ ...readAll(s), [id]: open })); } catch { /* blocked or full: the choice isn't kept */ }
}
