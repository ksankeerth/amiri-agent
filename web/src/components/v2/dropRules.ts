// What a file drop accepts (plain logic, so `npm test` covers it). `accept` is the same list as an <input type="file"> takes:
// extensions (".json"), exact types ("application/json") and families ("image/*"). A dropped file is checked here, because
// a drop skips the browser's own `accept` filter; a chosen file is checked the same way, so both say the same words.

export interface FileLike { name: string; size: number; type?: string }
export interface DropRules { accept?: string; maxBytes?: number; /** What the file is, in the message: "a JSON file". */ noun?: string }

export function acceptList(accept: string | undefined): string[] {
  return (accept ?? "").split(",").map(x => x.trim().toLowerCase()).filter(Boolean);
}

export function matchesAccept(f: FileLike, accept: string | undefined): boolean {
  const list = acceptList(accept);
  if (!list.length) return true;
  const name = f.name.toLowerCase(), type = (f.type ?? "").toLowerCase();
  return list.some(a => a.startsWith(".") ? name.endsWith(a) : a.endsWith("/*") ? type.startsWith(a.slice(0, -1)) : type === a);
}

export function sizeWords(bytes: number): string {
  if (bytes < 1024) return `${bytes} bytes`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${+(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** Why a file can't be used, in words for the person, or null when it can. */
export function fileProblem(f: FileLike, rules: DropRules = {}): string | null {
  if (!matchesAccept(f, rules.accept)) return `${f.name} isn't ${rules.noun ?? "a file of the right kind"}.${rules.accept ? ` Choose a file ending ${acceptList(rules.accept).filter(a => a.startsWith(".")).join(" or ") || "in the right type"}.` : ""}`;
  if (f.size === 0) return `${f.name} is empty.`;
  if (rules.maxBytes != null && f.size > rules.maxBytes) return `${f.name} is ${sizeWords(f.size)}; the most this takes is ${sizeWords(rules.maxBytes)}.`;
  return null;
}

/** The first file of a drop or a choice, and how many more there were (only one is used). */
export function firstFile<T>(files: ArrayLike<T> | null | undefined): { file: T | null; extra: number } {
  const n = files?.length ?? 0;
  return { file: n ? (files as ArrayLike<T>)[0] : null, extra: Math.max(0, n - 1) };
}
