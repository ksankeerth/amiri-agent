// A list or page that failed to load (board 13 section 2): what failed, in plain words, and one way out.
// Pass the error and what was being loaded ("the alerts"); or write the words yourself with `title` and `children`.
import { useState, type ReactNode } from "react";
import { Button } from "./Button";
import { isDownError, loadErrorCopy } from "./states";

export interface LoadErrorProps {
  /** The failed call's error (an ApiError): picks the words. */
  error?: unknown;
  /** "the alerts" -> "Couldn't load the alerts". */
  what?: string;
  /** What is not lost, when the server didn't answer: "Your alerts are safe; this page just couldn't reach them." */
  safe?: string;
  title?: string;
  children?: ReactNode;
  onRetry: () => unknown;
  className?: string;
}
export function LoadError({ error, what, safe, title, children, onRetry, className }: LoadErrorProps) {
  const [busy, setBusy] = useState(false);
  const copy = loadErrorCopy(error, what, safe);
  const retry = async () => {
    setBusy(true);
    if (isDownError(error)) window.dispatchEvent(new Event("amiri:installation"));  // the app bar's institution comes back too
    try { await onRetry(); } finally { setBusy(false); }
  };
  return (
    <div className={`v2-panel v2-loaderr${className ? ` ${className}` : ""}`} role="alert">
      <b className="v2-title">{title ?? copy.title}</b>
      <span className="v2-loaderr__msg">{children ?? copy.message}</span>
      <Button variant="primary" onClick={retry} disabled={busy} busy={busy} busyLabel="Trying again…">Try again</Button>
    </div>
  );
}
