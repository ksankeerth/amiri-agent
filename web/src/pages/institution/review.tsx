// The guided setup's last step: the go-live checks as ruled rows (what is open first, what is done last), each saying its state in a
// shape and a word, with the one action that fixes it; and the confirmation before going live.
import type { Readiness } from "../../api/institutions";
import { useDemoLock } from "../../components/lock";
import { Button } from "../../components/v2/Button";
import { Dialog } from "../../components/v2/Dialog";
import { openWords, readinessRows } from "./words";
import { fixStep, goLiveNote } from "./wizardWords";

/** The checks. `onFix` goes to the step that holds the section; `onEdit` opens the institution's details. The shapes and classes are the
 *  Institution page's (institution.css). */
export function ReviewChecks({ readiness, onFix, onEdit }: { readiness: Readiness; onFix: (step: string) => void; onEdit: () => void }) {
  const rows = readinessRows(readiness.checks);
  return (
    <ul className="v2-in-chk" aria-label="Checks before going live">
      {rows.map(r => {
        const c = readiness.checks.find(x => x.id === r.id)!;
        const step = fixStep(c.section);
        return (
          <li key={r.id} className={r.ok ? "is-done" : undefined}>
            <span className={`v2-in-chk__shape is-${r.ok ? "done" : r.level}`} aria-hidden="true">{r.shape}</span>
            <span className="v2-in-chk__body">
              <span className="v2-in-chk__t">{r.text}</span>
              <span className="v2-in-chk__m"><b>{r.word}</b>{!r.ok && r.fix ? ` · ${r.fix}` : ""}</span>
            </span>
            {!r.ok && (r.edit
              ? <Button size="sm" variant="quiet" className="v2-in-chk__go" onClick={onEdit}>Edit details</Button>
              : step && <Button size="sm" variant="quiet" className="v2-in-chk__go" onClick={() => onFix(step)}
                label={`${r.level === "info" ? openWords(c).action : "Fix"}: ${r.text}`}>{r.level === "info" ? openWords(c).action : "Fix"} <span aria-hidden="true">→</span></Button>)}
          </li>);
      })}
      {readiness.warnings.map((w, k) => (
        <li key={`w${k}`}>
          <span className="v2-in-chk__shape is-recommended" aria-hidden="true">◆</span>
          <span className="v2-in-chk__body"><span className="v2-in-chk__t">{w.message}</span><span className="v2-in-chk__m"><b>Look at it</b></span></span>
          {fixStep(w.section ?? "") && <Button size="sm" variant="quiet" className="v2-in-chk__go" onClick={() => onFix(fixStep(w.section ?? "")!)}>Look <span aria-hidden="true">→</span></Button>}
        </li>))}
    </ul>
  );
}

/** "Go live with Austin Tech Bank?": what changes, what is still open, and the one button. */
export function GoLiveDialog({ name, readiness, busy, onClose, onConfirm }: { name: string; readiness: Readiness; busy: boolean; onClose: () => void; onConfirm: () => void }) {
  const locked = useDemoLock();
  return (
    <Dialog size="S" title={`Go live with ${name}?`} onClose={onClose} actions={<>
      <Button onClick={onClose}>Not yet</Button>
      <Button variant="primary" locked={locked} disabled={busy} busy={busy} busyLabel="Going live…" onClick={onConfirm}>Go live</Button></>}>
      <p className="v2-in-dlgtext">AMIRI Agent starts using this profile to decide what matters to you. You can keep changing it afterwards, and each change is kept in the history.</p>
      <p className="v2-in-dlgtext">{goLiveNote(readiness)}</p>
    </Dialog>
  );
}
