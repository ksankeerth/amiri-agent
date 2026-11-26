// The ids that tie a form field together (plain logic, so `npm test` covers it). One base id (React's useId) gives the
// control, its label, its hint and its error; the control's aria-describedby names the hint and the error that are on screen.

export interface FieldIds { control: string; label: string; hint: string; error: string }

export function fieldIds(base: string): FieldIds {
  return { control: base, label: `${base}-l`, hint: `${base}-h`, error: `${base}-e` };
}

/** Joins ids into one aria-describedby value: empty parts are dropped, repeats are kept once; nothing left is undefined (no empty attribute). */
export function joinIds(...parts: (string | false | null | undefined)[]): string | undefined {
  const out: string[] = [];
  for (const p of parts) for (const id of (p || "").split(/\s+/)) if (id && !out.includes(id)) out.push(id);
  return out.length ? out.join(" ") : undefined;
}

/** What a control is described by: the hint (when there is one) and the error (when there is one), in that order. */
export function describedBy(ids: FieldIds, on: { hint?: boolean; error?: boolean }): string | undefined {
  return joinIds(on.hint && ids.hint, on.error && ids.error);
}

/** The attributes a control takes from its field. A control alone in its field is labelled by the label (`for`) and described by the hint and
 *  error; a control in a group of controls is labelled by the group's name and has no id of its own. What the control sets itself wins; its own
 *  aria-describedby is kept and the field's ids are added. */
export interface FieldState { id?: string; labelId: string; describedBy?: string; invalid: boolean; required: boolean; single: boolean }
export interface OwnAria { id?: string; "aria-label"?: string; "aria-labelledby"?: string; "aria-describedby"?: string; "aria-invalid"?: boolean | "true" | "false" | "grammar" | "spelling" }
export function controlAttrs(own: OwnAria, f: FieldState | null): { id?: string; "aria-labelledby"?: string; "aria-describedby"?: string; "aria-invalid"?: boolean | "true" | "false" | "grammar" | "spelling"; "aria-required"?: true } {
  if (!f) return { id: own.id, "aria-describedby": own["aria-describedby"], "aria-invalid": own["aria-invalid"] };
  const named = !!own["aria-label"] || !!own["aria-labelledby"];
  return {
    id: own.id ?? (f.single ? f.id : undefined),
    "aria-labelledby": own["aria-labelledby"] ?? (!f.single && !named ? f.labelId : undefined),
    "aria-describedby": joinIds(own["aria-describedby"], f.single && f.describedBy),
    "aria-invalid": own["aria-invalid"] ?? (f.single && f.invalid ? true : undefined),
    "aria-required": f.single && f.required ? true : undefined,
  };
}
