// Checks against the institution's own data, said once: one pill per result, and a summary line for a group.
import type { ReactNode } from "react";
import type { EventDetail } from "../api/investigation";
import { count, earliest, onDay, relDay, VERDICT_LABEL, verdictTone, type VerdictKey } from "../plain";
import { StatusPill } from "./blocks";

export interface CheckLike { verdict: VerdictKey; alert?: string | null; adverse?: boolean | null }

const ICON: Record<VerdictKey, string> = {
  confirms: "check", contradicts: "refresh", no_effect: "check", insufficient_data: "info", masked: "info", not_yet: "hourglass", error: "warn",
};

export function CheckPill({ c, n }: { c: CheckLike; n?: number }) {
  return <StatusPill tone={verdictTone(c.verdict, c.alert, c.adverse)} icon={ICON[c.verdict]}>{n ? `${n} ` : ""}{VERDICT_LABEL[c.verdict]}</StatusPill>;
}

/** "All 6: too early to check · first check 18 Oct (tomorrow)", or a pill per result when they differ. */
export function CheckSummary({ checks, total, next, off }: { checks: CheckLike[]; total: number; next?: string | null; off?: boolean }) {
  const nextText: ReactNode = next ? <span>{checks.some(c => c.verdict !== "not_yet") ? "Next check" : "First check"} <b>{onDay(next)}</b> ({relDay(next)})</span> : null;
  if (off) return <div className="ck-sum"><StatusPill tone="grey">Not checked</StatusPill><span>Checks against your data are switched off</span></div>;
  if (!checks.length) return <div className="ck-sum"><StatusPill tone="grey" icon="hourglass">Not checked yet</StatusPill>{nextText}</div>;
  const groups = new Map<VerdictKey, CheckLike[]>();
  for (const c of checks) groups.set(c.verdict, [...(groups.get(c.verdict) ?? []), c]);
  if (groups.size === 1 && checks.length === total) {
    const c = checks[0];
    return <div className="ck-sum">{total > 1 && <span>{total === 2 ? "Both" : `All ${total}`}:</span>}<CheckPill c={c} />{nextText}</div>;
  }
  const unchecked = total - checks.length;
  return (
    <div className="ck-sum">
      {[...groups.entries()].map(([v, xs]) => <CheckPill key={v} c={xs[0]} n={xs.length} />)}
      {unchecked > 0 && <StatusPill tone="grey">{count(unchecked, "not checked yet", "not checked yet")}</StatusPill>}
      {nextText}
    </div>
  );
}

const WEIGHT: Record<VerdictKey, number> = { confirms: 6, contradicts: 5, error: 4, no_effect: 3, insufficient_data: 2, masked: 2, not_yet: 0 };
/** An event's checks in one pill for a list row: the result that matters most, or when the checks start. */
export function CheckBrief({ e }: { e: EventDetail | undefined }) {
  if (!e) return null;
  if (!e.run.validation) return <StatusPill tone="grey">Not checked</StatusPill>;
  const cs = e.tasks.map(t => t.check).filter(c => !!c).map(c => ({ verdict: c!.verdict as VerdictKey, alert: c!.alert }));
  const next = earliest(e.tasks.filter(t => !t.check?.final).map(t => t.next_check_after ?? t.check?.next_check_after));
  const top = [...cs].sort((a, b) => WEIGHT[b.verdict] - WEIGHT[a.verdict])[0];
  if (!top || top.verdict === "not_yet") return next ? <StatusPill tone="grey" icon="hourglass">First check {onDay(next)}</StatusPill> : <StatusPill tone="grey" icon="hourglass">Not checked yet</StatusPill>;
  return <CheckPill c={top} n={cs.filter(c => c.verdict === top.verdict).length} />;
}
