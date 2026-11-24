// The count chip: a number in a small pill. Red for what needs a person (alerts to review), tinted for unusual, grey otherwise.
// `label` is read after the number ("3 alerts to review"): a bare number tells a screen reader nothing.
export interface CountProps {
  n: number | string;
  tone?: "neutral" | "hot" | "unusual";
  label?: string;
  className?: string;
}
export function Count({ n, tone = "neutral", label, className }: CountProps) {
  return (
    <span className={`v2-chip${tone !== "neutral" ? ` v2-chip--${tone}` : ""}${className ? ` ${className}` : ""}`}>
      {n}{label && <span className="v2-sr"> {label}</span>}
    </span>
  );
}
