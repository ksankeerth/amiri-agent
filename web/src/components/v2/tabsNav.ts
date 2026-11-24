// Keyboard moves along a tab row (WAI-ARIA tabs, automatic activation): the arrows wrap, Home and End jump.
// Returns the index to move to, or null when the key isn't one the tab row handles.
export function nextTabIndex(key: string, current: number, count: number): number | null {
  if (count <= 0) return null;
  switch (key) {
    case "ArrowRight": return (current + 1) % count;
    case "ArrowLeft": return (current - 1 + count) % count;
    case "Home": return 0;
    case "End": return count - 1;
    default: return null;
  }
}
