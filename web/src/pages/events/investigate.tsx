// What the Events page shares with Findings and a market series: the investigation's status, the "Investigate now" button
// (it waits for the answer, see poll.ts), and a theme tag in words.
import { useCallback, useEffect, useRef, useState } from "react";
import { peek } from "../../api/client";
import { investigationApi, type InvestigationStatus, type Theme } from "../../api/investigation";
import { Icon } from "../../components/Icon";
import { useRefusalToast, useToast } from "../../components/ui";
import { Button } from "../../components/v2/Button";
import { plural } from "../../format";
import { themeLabel } from "../../plain";
import { finishedText, pollRun } from "./poll";

/** A theme tag in words ("Oil prices up"): Radar uses it too. */
export const themeText = (t: Theme) => themeLabel(t);

export function useInvestigationStatus() {
  const [status, setStatus] = useState<InvestigationStatus | null>(() => peek(() => investigationApi.status()) ?? null);
  const reload = useCallback(() => { investigationApi.status().then(setStatus).catch(() => {}); }, []);
  useEffect(() => { reload(); }, [reload]);
  return { status, reload };
}

/** Sends the waiting findings (or just `ids`) to the investigation agent now, then waits for the answer: asks every 3 s,
 *  for up to 2 minutes. `onDone` runs when the runs finish (events now exist) and after the send itself. */
export function InvestigateNowButton({ ids, onDone, small }: { ids?: string[]; onDone: () => void; small?: boolean }) {
  const toast = useToast(), refuse = useRefusalToast();
  const [busy, setBusy] = useState(false);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const go = async () => {
    setBusy(true);
    try {
      const out = await investigationApi.investigateNow(ids);
      const sent = out.items.reduce((n, r) => n + r.finding_ids.length, 0);
      toast([sent ? `Sent ${plural(sent, "finding")} to the investigation agent.` : "Nothing new to investigate.",
             out.developments.length ? `${out.developments.length} joined an open event as the same move continuing (${out.developments[0].event_title}).` : ""]
        .filter(Boolean).join(" "));
      onDone();
      const running = out.items.filter(r => r.status === "running");
      if (!running.length) return;
      const runs = new Map(running.map(r => [r.run_id, r]));
      const end = await pollRun({
        wait: ms => new Promise(r => setTimeout(r, ms)),
        cancelled: () => !alive.current,
        stillRunning: async () => {
          const now = await Promise.all([...runs.keys()].map(id => investigationApi.run(id)));
          for (const r of now) if (r.status !== "running") runs.set(r.run_id, r);
          return now.some(r => r.status === "running");
        },
      });
      if (!alive.current) return;
      const found = [...runs.values()].reduce((n, r) => n + (r.status === "running" ? 0 : r.events ?? 0), 0);
      const words = finishedText(end, found);
      if (words) toast(words);
      onDone();
    } catch (e) { refuse(e); }
    finally { if (alive.current) setBusy(false); }
  };
  return (
    <Button size={small ? "sm" : "md"} onClick={go} disabled={busy} busy={busy} busyLabel="Working on it…" title="Skips the wait for the next batch">
      <Icon name="play" />Investigate now
    </Button>
  );
}
