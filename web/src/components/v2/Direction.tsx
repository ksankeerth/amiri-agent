// Direction: ▲ bad for you, ◆ mixed, ▼ good for you, ■ neutral, always shape plus words (never colour alone).
// The mark is decoration (aria-hidden); the word carries the meaning, visible or visually hidden.
import { DIRECTIONS, directionOf } from "./directionWords";
import { Pill } from "./Pill";

const SHAPE: Record<string, string> = {
  bad: "M7 1.5 13 12.5H1z", mixed: "M7 1 13 7 7 13 1 7z", good: "M7 12.5 13 1.5H1z", neutral: "M2.5 2.5h9v9h-9z",
};

/** Just the shape, for a row's lead (the word is read from `word`, or from the pill beside it). */
export function DirectionMark({ tone, size = 13 }: { tone: string | null | undefined; size?: number }) {
  const t = directionOf(tone);
  return (
    <svg className={`v2-dir v2-dir--${t}`} width={size} height={size} viewBox="0 0 14 14" aria-hidden="true" focusable="false"><path d={SHAPE[t]} /></svg>
  );
}

export interface DirectionProps {
  tone: string | null | undefined;
  /** Say the words on screen ("Bad for you") beside the mark; otherwise they are read, not shown. */
  showWord?: boolean;
  /** Replace the default words. */
  word?: string;
  size?: number;
}
export function Direction({ tone, showWord = false, word, size }: DirectionProps) {
  const d = DIRECTIONS[directionOf(tone)];
  const text = word ?? d.word;
  return (
    <span className={`v2-direction v2-direction--${directionOf(tone)}`}>
      <DirectionMark tone={tone} size={size} />
      <span className={showWord ? "v2-direction__w" : "v2-sr"}>{text}</span>
    </span>
  );
}

/** The tinted pill with the words: "Bad for you", "Mixed", "Good for you". */
export function DirectionPill({ tone, word }: { tone: string | null | undefined; word?: string }) {
  const d = DIRECTIONS[directionOf(tone)];
  return <Pill tone={d.pill}>{word ?? d.word}</Pill>;
}
