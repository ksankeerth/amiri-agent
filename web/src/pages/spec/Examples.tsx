// A product's typical products, with the region examples that name other markets folded away (C6): an institution sees the
// examples for its home country, and the rest sit behind "Examples from other markets", closed by default.
import { splitExamples, ucFirst } from "./words";

export function Examples({ text, home, cap }: { text: string; home: string | null; cap?: boolean }) {
  const { main, other } = splitExamples(text, home);
  return (
    <>
      {cap ? ucFirst(main) : main}
      {other && <details className="v2-sx-other">
        <summary>Examples from other markets</summary>
        <p>e.g. {other}</p>
      </details>}
    </>
  );
}
