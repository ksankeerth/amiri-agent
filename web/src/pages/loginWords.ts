// The words of the entry screens (Judge login, the reCAPTCHA check, the paused page), as plain logic so `npm test` covers them.

export const TAGLINE = "Early warning for banks and insurers";
export const FOOT = "Prototype · a demo bank with sample data, no real customers";
export const JUDGE_LEDE = "One click, no password. Editing is switched off for this demo.";
export const BOX_LEDE = "No password needed. Tick the box below and the app opens on a demo bank.";

type Problemish = { problem?: { code?: unknown; detail?: unknown } } | null | undefined;

/** What a refused or failed entry says. A rate limit is said as what to do next; anything else is the server's own sentence. */
export function entryProblem(e: unknown, how: "judge" | "box"): string {
  const p = (e as Problemish)?.problem;
  if (p?.code === "too_many") return `Too many tries from this network. Wait a minute, then ${how === "judge" ? "press the button" : "tick the box"} again.`;
  if (typeof p?.detail === "string" && p.detail) return p.detail;
  return "Something went wrong on our side. Try again in a moment.";
}

/** Why the box isn't there. */
export type BoxProblem = "blocked" | "no_key";
export const boxProblem = (k: BoxProblem): { title: string; body: string } =>
  k === "blocked"
    ? { title: "The check couldn't load", body: "Turn off a blocker for google.com, or try another browser, then load this page again." }
    : { title: "The check isn't set up yet", body: "This server has no reCAPTCHA key, so nobody can get in. Ask whoever runs this prototype to set it up." };

/** The paused page: where the check for "is it awake yet" has got to. */
export type PausedStep = "idle" | "checking" | "still" | "unreachable";
export const pausedStatus = (s: PausedStep): string =>
  s === "checking" ? "Checking whether it's awake…"
    : s === "still" ? "Still paused. Try again in a minute."
      : s === "unreachable" ? "Couldn't reach AMIRI Agent. Try again in a minute."
        : "";

/** Only after a check that found it awake: the button's own words while it looks. */
export const pausedButton = (s: PausedStep): string => (s === "checking" ? "Checking…" : "Check again");
