// The direction marks: shape plus words, never colour alone (board 00, board 13 section 7).
// ▲ bad for you, ◆ mixed, ▼ good for you, ■ neutral. The server's event `tone` is good | bad | mixed | neutral.
import type { PillTone } from "./verdictWords.ts";

export type DirectionTone = "bad" | "mixed" | "good" | "neutral";
export const DIRECTIONS: Record<DirectionTone, { glyph: string; word: string; pill: PillTone }> = {
  bad: { glyph: "▲", word: "Bad for you", pill: "bad" },
  mixed: { glyph: "◆", word: "Mixed", pill: "unusual" },
  good: { glyph: "▼", word: "Good for you", pill: "good" },
  neutral: { glyph: "■", word: "Neutral", pill: "neutral" },
};
/** Anything the server sends that isn't one of the three is neutral (a shape and a word, still). */
export const directionOf = (tone: string | null | undefined): DirectionTone => (tone === "bad" || tone === "mixed" || tone === "good" ? tone : "neutral");
