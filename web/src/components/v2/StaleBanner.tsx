// "Couldn't refresh. Showing what was loaded 3 min ago." (board 13 section 2): the data on screen is kept, and the
// banner says how old it is, with one way to try again.
import { agoText } from "./states";

export interface StaleBannerProps {
  /** When the data on screen was loaded (ms since the epoch). */
  loadedAt: number;
  now?: number;
  onRetry: () => void;
  className?: string;
}
export function StaleBanner({ loadedAt, now, onRetry, className }: StaleBannerProps) {
  return (
    <div className={`v2-stale${className ? ` ${className}` : ""}`} role="status">
      <span aria-hidden="true">⚠</span>
      <span>Couldn't refresh. Showing what was loaded {agoText(loadedAt, now)}.</span>
      <button type="button" className="v2-stale__retry" onClick={onRetry}>Retry</button>
    </div>
  );
}
