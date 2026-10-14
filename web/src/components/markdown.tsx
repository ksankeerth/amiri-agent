// A small renderer for the investigation's report (headings, paragraphs, bullets, bold).
// The report is built by code on the server side; nothing here runs HTML from it.
import { Fragment, type ReactNode } from "react";

function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith("**") && part.endsWith("**") ? <b key={i}>{part.slice(2, -2)}</b> : <Fragment key={i}>{part}</Fragment>);
}

export function Markdown({ text }: { text: string }) {
  const out: ReactNode[] = [];
  let bullets: string[] = [];
  const flush = () => {
    if (bullets.length) out.push(<ul key={`u${out.length}`} className="md-list">{bullets.map((b, i) => <li key={i}>{inline(b)}</li>)}</ul>);
    bullets = [];
  };
  for (const line of text.split("\n")) {
    if (line.startsWith("- ")) { bullets.push(line.slice(2)); continue; }
    flush();
    if (!line.trim()) continue;
    if (line.startsWith("## ")) out.push(<h3 key={out.length} className="md-h">{inline(line.slice(3))}</h3>);
    else if (line.startsWith("# ")) out.push(<h2 key={out.length} className="md-h">{inline(line.slice(2))}</h2>);
    else out.push(<p key={out.length}>{inline(line)}</p>);
  }
  flush();
  return <div className="md">{out}</div>;
}
