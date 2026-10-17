// A small renderer for text built by code or bundled with the app (the investigation's report, the Metrics Spec's
// guide): headings, paragraphs, bullets and numbered lists, tables, quotes, bold and `code`. Nothing here runs HTML.
import { Fragment, type ReactNode } from "react";

function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((part, i) =>
    part.startsWith("**") && part.endsWith("**") && part.length > 4 ? <b key={i}>{inline(part.slice(2, -2))}</b>
      : part.startsWith("`") && part.endsWith("`") && part.length > 2 ? <code key={i}>{part.slice(1, -1)}</code>
      : <Fragment key={i}>{part}</Fragment>);
}

/** A table that may scroll sideways: focusable and named, so a keyboard can scroll it. */
export function ScrollTable({ label, children }: { label: string; children: ReactNode }) {
  return <div className="md-table" tabIndex={0} role="region" aria-label={`${label} (scrolls sideways)`}>{children}</div>;
}

const cells = (row: string) => row.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map(c => c.trim());

export function Markdown({ text }: { text: string }) {
  const out: ReactNode[] = [];
  let bullets: string[] = [], numbered: string[] = [], rows: string[] = [], quote: string[] = [];
  const flush = () => {
    const k = out.length;
    if (bullets.length) out.push(<ul key={`u${k}`} className="md-list">{bullets.map((b, i) => <li key={i}>{inline(b)}</li>)}</ul>);
    if (numbered.length) out.push(<ol key={`o${k}`} className="md-list">{numbered.map((b, i) => <li key={i}>{inline(b)}</li>)}</ol>);
    if (quote.length) out.push(<blockquote key={`q${k}`} className="md-quote">{quote.map((q, i) => <p key={i}>{inline(q)}</p>)}</blockquote>);
    if (rows.length) {
      const [head, ...body] = rows.filter(r => !/^\|?\s*:?-{3,}/.test(r.trim()));
      out.push(<ScrollTable key={`t${k}`} label={cells(head).join(", ")}><table>
        <thead><tr>{cells(head).map((c, i) => <th key={i} scope="col">{inline(c)}</th>)}</tr></thead>
        <tbody>{body.map((r, i) => <tr key={i}>{cells(r).map((c, j) => <td key={j}>{inline(c)}</td>)}</tr>)}</tbody>
      </table></ScrollTable>);
    }
    bullets = []; numbered = []; rows = []; quote = [];
  };
  for (const line of text.split("\n")) {
    if (line.startsWith("- ")) { if (numbered.length || rows.length || quote.length) flush(); bullets.push(line.slice(2)); continue; }
    const n = /^\d+\. (.*)$/.exec(line);
    if (n) { if (bullets.length || rows.length || quote.length) flush(); numbered.push(n[1]); continue; }
    if (line.trim().startsWith("|")) { if (bullets.length || numbered.length || quote.length) flush(); rows.push(line); continue; }
    if (line.startsWith("> ")) { if (bullets.length || numbered.length || rows.length) flush(); quote.push(line.slice(2)); continue; }
    flush();
    if (!line.trim() || line.trim() === "---") continue;
    if (line.startsWith("### ")) out.push(<h4 key={out.length} className="md-h">{inline(line.slice(4))}</h4>);
    else if (line.startsWith("## ")) out.push(<h3 key={out.length} className="md-h">{inline(line.slice(3))}</h3>);
    else if (line.startsWith("# ")) out.push(<h2 key={out.length} className="md-h">{inline(line.slice(2))}</h2>);
    else out.push(<p key={out.length}>{inline(line)}</p>);
  }
  flush();
  return <div className="md">{out}</div>;
}
