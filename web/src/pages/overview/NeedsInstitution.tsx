// What a page that needs the institution shows before there is one (board 14's tone, board 15's layout): the page's own name,
// one reason, and the way forward. Not a spinner and not an error.
import { ArrowLink } from "../../components/v2/ArrowLink";
import { Button } from "../../components/v2/Button";
import "../../styles/v2/first-run.css";

export function NeedsInstitutionPage({ title, what }: { title: string; what: string }) {
  return (
    <div className="v2-fr v2-fr--need">
      <header className="v2-fr-head">
        <h1 className="v2-fr-h1 v2-fr-h1--page">{title}</h1>
      </header>
      <section className="v2-fr-need" aria-labelledby="needs-inst">
        <h2 id="needs-inst" className="v2-fr-h2">Set up your institution first</h2>
        <p>{what} come from your institution's profile: who you are, where you operate, your customers, products and risks. Set it up first; it takes a few minutes with the forms or the setup agent.</p>
        <div className="v2-fr-need__act">
          <Button as="link" to="/institution/setup" variant="primary">Set up the institution</Button>
          <ArrowLink to="/home">Or see a demo first</ArrowLink>
        </div>
      </section>
    </div>
  );
}
