// The first-run page's steps and words (board 14), as plain logic so `npm test` covers them.
import type { Overview } from "../../api/overview";  // a type only: erased, so `node --test` runs this file as it is

const plural = (n: number, one: string, many?: string) => `${n} ${n === 1 ? one : many ?? one + "s"}`;

export type StepState = "done" | "open" | "locked";
export interface FirstStep { n: number; state: StepState; title: string; body: string; to: string; label: string; next: boolean }

type Inst = Overview["institution"];

/** The three steps. With no institution the first is the one to take (Start setup); once there is one, the first
 *  undone step is (Continue setup, Review, Monitors), and a step opens only when the one before it is done. */
export function firstSteps(i: Inst, monitorsLive: number): FirstStep[] {
  const done = [!!i, !!i && i.readiness.ready && i.status === "active", monitorsLive > 0];
  const base = [
    { title: "Tell Amiri Agent about your institution", body: "Where you operate, your customers, products, flows, regulators, rivals and risks. Talk to the setup agent, or use the forms.",
      to: i ? "/institution/setup" : "/institution/new", label: i ? "Continue setup" : "Start setup" },
    { title: "Check it and go live",
      body: i ? (i.readiness.ready ? "Everything required is there. Activate the profile so Amiri Agent starts using it." : `${plural(i.readiness.missing_required, "required item")} still missing.`)
        : "Once the profile has what's required, activate it so the agents use it.",
      to: "/institution/setup/review", label: "Review" },
    { title: "Choose what to watch", body: "Draft monitors from your profile; a Risk Manager approves each one.", to: "/monitors", label: "Monitors" },
  ];
  const next = done.findIndex(d => !d);
  return base.map((b, k) => ({ n: k + 1, ...b, next: k === next,
    state: done[k] ? "done" : k > 0 && !done[k - 1] ? "locked" : "open" }));
}

/** What the right-hand side of a step says when it has no button: "Done" or "After step 1". */
export const stepNote = (s: FirstStep): string | null => (s.state === "done" ? "Done" : s.state === "locked" ? `After step ${s.n - 1}` : null);

/** "Serendib Commercial Bank · a bank in Sri Lanka" (the server's wording starts with a capital). */
export const demoLine = (d: { name: string; what: string }) => `${d.name} · ${d.what.charAt(0).toLowerCase()}${d.what.slice(1)}`;

/** The note under the demo buttons. The reset is a Platform Admin's, in Settings, and only where the server allows it. */
export const resetNote = (resetAllowed: boolean) => resetAllowed
  ? { before: "Only on an empty platform. A Platform Admin can reset the prototype in ", link: "Settings", after: "." }
  : { before: "Only on an empty platform.", link: null, after: "" };
