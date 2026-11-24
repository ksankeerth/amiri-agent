// A 412 on a save (board 13 section 3): someone else saved first. Says who and when when it knows, and offers the two
// ways out: Reload (their version) or Copy my changes (so the text isn't lost). The page copies the text for Copy.
import { useState, type ReactNode } from "react";
import { Button } from "./Button";

export interface EditConflictProps {
  /** "this product": "Someone changed this product while you were editing". */
  what?: string;
  /** Who saved, if the server says ("A colleague" when it doesn't). */
  who?: string;
  /** What they saved: "Capital-Call Lines". */
  name?: ReactNode;
  /** When: "2 min ago". */
  when?: string;
  onReload: () => void;
  /** Put the person's unsaved text on the clipboard. */
  onCopy: () => void | Promise<unknown>;
  className?: string;
}
export function EditConflict({ what = "this", who = "A colleague", name, when, onReload, onCopy, className }: EditConflictProps) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try { await onCopy(); setCopied(true); setTimeout(() => setCopied(false), 2500); } catch { setCopied(false); }
  };
  return (
    <div className={`v2-panel v2-conflict${className ? ` ${className}` : ""}`} role="alert">
      <b className="v2-conflict__t">Someone changed {what} while you were editing</b>
      <span className="v2-conflict__m">
        {who} saved {name != null ? <b>{name}</b> : "it"}{when ? ` ${when}` : ""}. Reload to see their version; your text stays on the clipboard.
      </span>
      <div className="v2-conflict__act">
        <Button variant="primary" onClick={onReload}>Reload</Button>
        <Button onClick={copy}>{copied ? "Copied" : "Copy my changes"}</Button>
        <span className="v2-sr" role="status">{copied ? "Your changes are on the clipboard" : ""}</span>
      </div>
    </div>
  );
}
