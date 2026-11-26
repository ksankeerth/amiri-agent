// Not found, inside the shell (decision D5): a page that doesn't exist (the `*` route), or a menu page that isn't built.
// The look of an empty page: the title, one line, the way back, and the menu's pages as links (the menu itself is on the left,
// or behind the Menu button on a phone).
import { Link, useLocation } from "react-router-dom";
import { Button } from "../components/v2/Button";
import { navFor } from "../components/v2/nav";
import { useCrumbs } from "../components/v2/Shell";
import { useRole } from "../components/ui";
import "../styles/v2/system.css";

const CRUMBS = [{ label: "Not found" }];

/** `title` is the name of a menu page that isn't part of this version; without it the address itself is unknown. */
export function NotFoundPage({ title }: { title?: string }) {
  const { pathname } = useLocation();
  const { role } = useRole();
  useCrumbs(title ? null : CRUMBS);  // a known page keeps its menu name in the bar
  const links = navFor(role).filter(([, , to]) => to !== "/home");
  return (
    <div className="v2-nf">
      <h1 className="v2-nf__h1">{title ?? "Page not found"}</h1>
      <p className="v2-nf__lede">{title ? "This page isn't available in this version of AMIRI Agent." : "There's nothing at this address. The page may have moved, or the link may be mistyped."}</p>
      <code className="v2-mono v2-nf__path">{pathname}</code>
      <div className="v2-nf__act"><Button as="link" to="/home" variant="primary">Go to the Overview</Button></div>
      {links.length > 0 && (
        <nav className="v2-nf__more" aria-labelledby="nf-pages">
          <h2 id="nf-pages">Or open a page from the menu</h2>
          <ul className="v2-nf__links">{links.map(([, label, to]) => <li key={to}><Link to={to}>{label}</Link></li>)}</ul>
        </nav>
      )}
    </div>
  );
}
