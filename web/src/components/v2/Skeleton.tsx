// The loading state (board 13 section 2): rows that keep the shape of the real ones, so nothing jumps when the data arrives.
export interface SkeletonProps {
  rows?: number;
  /** Read out while loading ("Loading the alerts"). */
  label?: string;
  className?: string;
}
export function Skeleton({ rows = 4, label = "Loading", className }: SkeletonProps) {
  return (
    <div className={`v2-skel${className ? ` ${className}` : ""}`} role="status" aria-busy="true">
      <span className="v2-sr">{label}</span>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="v2-skel__row" aria-hidden="true"><span className="v2-skel__dot" /><span className="v2-skel__bar" /><span className="v2-skel__end" /></div>
      ))}
    </div>
  );
}
