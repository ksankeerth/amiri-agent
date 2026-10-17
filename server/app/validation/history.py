"""Each task's past evaluations, and what they decide now .

The server only schedules: it sends the same task again after
next_check_after. The validator remembers every evaluation (task_id, task
hash, as_of) so it can:
- re-evaluate only on new data (an unchanged data signature keeps the alert),
- raise `developing` only after two consecutive looks, and clear it only back
  inside p10 / p90 (hysteresis),
- say how the alert changed (raised, escalated, withdrawn, confirmed),
- list the verdict history, and supersede an earlier final verdict,
- schedule the next check, including one re-check at stable age after final.

A replay (an earlier as_of) sees only the evaluations before it.
"""

import json
from dataclasses import dataclass
from datetime import date, timedelta
from typing import TYPE_CHECKING, Protocol

from app.validation.contract import ValidationResult, ValidationTask, VerdictStep

if TYPE_CHECKING:
    from app.validate import Look

DAY = timedelta(days=1)
CLEAR_LOW, CLEAR_HIGH = 10.0, 90.0


@dataclass
class Evaluation:
    as_of: date
    verdict: str
    final: bool
    alert: str
    signal: str
    look_percentile: float | None
    signature: str
    unchanged_since: date | None


class TaskHistory(Protocol):
    def before(self, task_id: str, task_hash: str, as_of: date) -> list[Evaluation]: ...

    def record(
        self, task_id: str, task_hash: str, e: Evaluation, result_json: str
    ) -> None: ...


class MemoryHistory:
    def __init__(self) -> None:
        self.rows: dict[tuple[str, str, date], tuple[Evaluation, str]] = {}

    def before(self, task_id: str, task_hash: str, as_of: date) -> list[Evaluation]:
        return sorted(
            (e for (t, h, d), (e, _) in self.rows.items()
             if t == task_id and h == task_hash and d < as_of),
            key=lambda e: e.as_of,
        )  # fmt: skip

    def record(
        self, task_id: str, task_hash: str, e: Evaluation, result_json: str
    ) -> None:
        self.rows[(task_id, task_hash, e.as_of)] = (e, result_json)


# ------------------------------------------------------------- lifecycle


def _alert_change(prev: str, cur: str, prev_final: bool, cur_final: bool) -> str:
    if prev == cur:
        return "confirmed" if cur != "none" and cur_final and not prev_final else "none"
    if prev == "none":
        return "raised"
    if cur == "none":
        return "withdrawn"
    if prev == "developing" and cur == "adverse":
        return "escalated"
    return "raised"


def apply_lifecycle(
    task: ValidationTask, r: ValidationResult, look: "Look", history: TaskHistory
) -> ValidationResult:
    past = history.before(r.task_id, r.task_hash, r.evaluated_as_of)
    prev = past[-1] if past else None
    reasons = list(r.reasons)
    as_of = r.evaluated_as_of

    # Alert for this look.
    unchanged = bool(
        prev
        and look.signature
        and prev.signature == look.signature
        and prev.final == r.final
    )
    if r.verdict == "error":
        alert = (
            "none" if "metric_dropped" in reasons else (prev.alert if prev else "none")
        )
    elif unchanged and prev:
        alert = prev.alert
        reasons.append("unchanged_data")
    elif r.final:
        alert = look.signal if look.signal in ("adverse", "opportunity") else "none"
    elif look.signal == "adverse":
        previous_look_adverse = bool(
            prev and (prev.signal == "adverse" or prev.alert == "developing")
        )
        alert = "developing" if previous_look_adverse else "none"
    elif prev and prev.alert == "developing":
        lp = look.look_percentile
        inside = lp is not None and CLEAR_LOW <= lp <= CLEAR_HIGH
        alert = "none" if inside else "developing"
    else:
        alert = "none"
    change = "none" if unchanged else _alert_change(
        prev.alert if prev else "none", alert, prev.final if prev else False, r.final
    )  # fmt: skip

    attention = None
    if "dominated" in reasons:
        attention = "dominated"
    elif r.verdict == "masked":
        attention = "relief_active"
    basis = look.basis if alert != "none" else None

    # Verdict history and supersedes.
    steps: list[VerdictStep] = []
    for e in past:
        if not steps or (steps[-1].verdict, steps[-1].final) != (e.verdict, e.final):
            steps.append(VerdictStep(as_of=e.as_of, verdict=e.verdict, final=e.final))  # type: ignore[arg-type]
    if not steps or (steps[-1].verdict, steps[-1].final) != (r.verdict, r.final):
        steps.append(VerdictStep(as_of=as_of, verdict=r.verdict, final=r.final))
    finals = [e for e in past if e.final and e.verdict != "error"]
    supersedes = None
    if r.final and finals and finals[-1].verdict != r.verdict and r.verdict != "error":
        last = finals[-1]
        supersedes = VerdictStep(as_of=last.as_of, verdict=last.verdict, final=True)  # type: ignore[arg-type]
        reasons.append("revised_data")

    # Schedule.
    next_check = reason = stop = None
    if r.verdict == "error":
        if r.error_kind == "transient":
            next_check, reason = as_of + DAY, "transient_error"
        else:
            stop = as_of
    elif not r.final:
        if look.young and not look.pending:
            next_check = (look.final_watch_published or as_of) - timedelta(days=look.lag_days) + timedelta(
                days=look.stable_age_days + 1)  # fmt: skip
            reason = "stable_age_recheck"
        elif "mask_not_published" in reasons and not look.pending and look.mask_pending:
            next_check, reason = min(look.mask_pending) + DAY, "mask_publication"
        elif look.pending:
            next_check, reason = min(look.pending) + DAY, "next_period"
        else:
            next_check, reason = as_of + DAY, "next_period"
        if look.final_watch_published:
            stop = look.final_watch_published + timedelta(days=look.stable_age_days + 1)
    else:
        first_final = min([e.as_of for e in finals] + [as_of])
        recheck = first_final + timedelta(days=look.stable_age_days)
        if as_of < recheck:
            next_check, reason, stop = recheck, "stable_age_recheck", recheck
        else:
            stop = as_of
    if next_check is not None and next_check <= as_of:
        next_check = as_of + DAY

    out = r.model_copy(
        update={
            "alert": alert,
            "alert_change": change,
            "alert_basis": basis,
            "attention": attention,
            "reasons": reasons,
            "verdict_history": steps,
            "supersedes": supersedes,
            "next_check_after": next_check,
            "next_check_reason": reason,
            "stop_after": stop,
            "unchanged_since": (prev.unchanged_since or prev.as_of)
            if unchanged and prev
            else None,
        }
    )
    history.record(
        r.task_id,
        r.task_hash,
        Evaluation(
            as_of=as_of,
            verdict=r.verdict,
            final=r.final,
            alert=alert,
            signal=look.signal,
            look_percentile=look.look_percentile,
            signature=look.signature,
            unchanged_since=out.unchanged_since,
        ),
        json.dumps(out.model_dump(mode="json", by_alias=True)),
    )
    return out
