// Which world an item is from (board 13 section 4): live is unmarked, sandbox is "Test" (dashed outline), studio is
// "Simulated" (its own tint). Both stay out of live counts and the Overview.
import { Pill } from "./Pill";

export type World = "live" | "sandbox" | "studio" | string | null | undefined;
export function WorldMark({ world }: { world: World }) {
  if (world === "sandbox") return <Pill dashed>Test</Pill>;
  if (world === "studio") return <Pill tone="sim">Simulated</Pill>;
  return null;
}
