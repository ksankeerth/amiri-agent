// A file picker that also takes a dropped file (F6). Two looks: "button" (a secondary button: "Fill from a JSON file") and "zone" (a dashed
// box with a title, a line of fine print and the button: Data connection). The real <input type="file"> is inside the button's label,
// so Tab reaches it, Enter and Space open the picker, and a screen reader says what it is; the label draws the focus ring. A dropped
// or chosen file is checked the same way (components/v2/dropRules.ts: kind, empty, size) before `onFile` gets it; `onReject` gets the
// reason. Locked (the demo lock) or disabled: no picker, no drop.
import { useId, useState, type DragEvent, type ReactNode } from "react";
import { lockAttrs } from "../demoLock";
import { btnClass } from "./Button";
import { fileProblem, firstFile, type DropRules } from "./dropRules";

export interface FileDropProps extends DropRules {
  onFile: (f: File) => void;
  /** Why a file was refused (wrong kind, empty, too big, several). */
  onReject?: (why: string) => void;
  /** Replaces the built-in check (the page has its own words). Return null for a usable file. */
  validate?: (f: File) => string | null;
  variant?: "button" | "zone";
  /** Button text (the zone's button, or the whole button). */
  pickLabel: ReactNode;
  /** The zone's title ("Drop a JSON file here"). */
  label?: ReactNode;
  /** The zone's fine print. */
  hint?: ReactNode;
  size?: "sm" | "md";
  primary?: boolean;
  locked?: boolean;
  disabled?: boolean;
  busy?: boolean;
  "aria-label"?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean;
  title?: string;
  className?: string;
  /** In the zone, beside the button (a link to an example file). */
  children?: ReactNode;
}
export function FileDrop({ onFile, onReject, validate, accept, maxBytes, noun, variant = "button", pickLabel, label, hint, size = "sm", primary, locked, disabled, busy,
  title, className, children, ...aria }: FileDropProps) {
  const titleId = useId();
  const [over, setOver] = useState(false);
  const off = !!disabled || !!busy;
  const take = (files: FileList | null | undefined) => {
    const { file, extra } = firstFile(files);
    if (!file) return;
    if (extra) { onReject?.("Only one file at a time: drop a single file."); return; }
    const why = validate ? validate(file) : fileProblem(file, { accept, maxBytes, noun });
    if (why) onReject?.(why); else onFile(file);
  };
  const drop = (e: DragEvent) => { e.preventDefault(); setOver(false); if (!locked && !off) take(e.dataTransfer.files); };
  const pick = (
    <label className={btnClass(primary ? "primary" : "secondary", size, false, "v2-drop__pick", !!locked, !!busy)}
      {...(locked ? { "data-lock": "", title: lockAttrs(true).title } : { title })}>
      <input type="file" className="v2-sr v2-drop__in" accept={accept} disabled={off} {...aria}
        aria-describedby={aria["aria-describedby"]} onClick={locked ? e => e.preventDefault() : undefined}
        onChange={e => { const f = e.target.files; take(f); e.target.value = ""; }} />
      {pickLabel}
    </label>
  );
  return (
    <div className={`v2-drop is-${variant}${over ? " is-over" : ""}${className ? ` ${className}` : ""}`}
      {...(variant === "zone" ? { role: "group", "aria-labelledby": titleId } : {})}
      onDragOver={e => { e.preventDefault(); if (!locked && !off) setOver(true); }} onDragLeave={() => setOver(false)} onDrop={drop}>
      {variant === "zone" && <span id={titleId} className="v2-drop__t">{label}</span>}
      {variant === "zone" && hint != null && <span className="v2-drop__hint">{hint}</span>}
      {variant === "zone" ? <div className="v2-drop__row">{pick}{children}</div> : <>{pick}{children}</>}
    </div>
  );
}
