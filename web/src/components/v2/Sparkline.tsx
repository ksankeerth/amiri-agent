// A small price line (board 00 Prices, board 07 Market series). A picture only: aria-hidden, since the value and the
// change beside it are already words (A7). Sized 80 × 24 as on the Overview; the series list draws it at 70 × 22.
import { sparkPoints } from "./sparkMath";

export type SparkTone = "bad" | "unusual" | "good" | "neutral";
export interface SparklineProps {
  values: number[];
  tone?: SparkTone;
  width?: number;
  height?: number;
  className?: string;
}
export function Sparkline({ values, tone = "neutral", width = 80, height = 24, className }: SparklineProps) {
  const points = sparkPoints(values, 80, 24);
  if (!points) return <span className="v2-spark v2-spark--none" style={{ width, height }} aria-hidden="true" />;
  return (
    <svg className={`v2-spark v2-spark--${tone}${className ? ` ${className}` : ""}`} width={width} height={height} viewBox="0 0 80 24" aria-hidden="true" focusable="false">
      <polyline points={points} fill="none" />
    </svg>
  );
}
