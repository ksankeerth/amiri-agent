// The agents (board 13 section 6): Cloud Run sleeps idle agents, so say so in plain words, say what still works, and
// disable only the buttons that need the missing agent.
//   waking   the setup agent is starting (assistant/status.starting)
//   offline  the investigation or Radar isn't connected (investigation:status.connected / services.radar.connected = false)
import type { ReactNode } from "react";

export type AgentStateProps =
  | { kind: "waking"; title?: string; children?: ReactNode; className?: string }
  | {
      kind: "offline";
      /** warn (amber): something waits on it; idle (grey): nothing does. */
      tone?: "warn" | "idle";
      /** "The investigation is offline." */
      title: string;
      /** What still works, or what waits. */
      children?: ReactNode;
      /** A small mono note on the right: "checked 1 min ago". */
      meta?: ReactNode;
      /** A button that needs the agent: pass it disabled. */
      action?: ReactNode;
      className?: string;
    };

export function AgentState(props: AgentStateProps) {
  if (props.kind === "waking") {
    return (
      <div className={`v2-panel v2-agent v2-agent--waking${props.className ? ` ${props.className}` : ""}`} role="status">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" strokeWidth="2" aria-hidden="true" focusable="false" className="v2-agent__spark"><path d="M12 3l2 5 5 2-5 2-2 5-2-5-5-2 5-2z" /></svg>
        <div className="v2-agent__body">
          <b>{props.title ?? "Waking the setup agent…"}</b>
          <div className="v2-agent__sub">{props.children ?? "It sleeps when nobody's using it. Usually about 20 seconds."}</div>
        </div>
        <span className="v2-dots" aria-hidden="true"><span /><span /><span /></span>
      </div>
    );
  }
  const tone = props.tone ?? "warn";
  return (
    <div className={`v2-agent v2-agent--off v2-agent--${tone}${props.className ? ` ${props.className}` : ""}`} role="status">
      <span className="v2-agent__dot" aria-hidden="true" />
      <span className="v2-agent__text"><b>{props.title}</b>{props.children != null && <> {props.children}</>}</span>
      {props.meta != null && <span className="v2-mono v2-agent__meta">{props.meta}</span>}
      {props.action}
    </div>
  );
}
