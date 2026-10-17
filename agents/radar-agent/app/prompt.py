"""The judge's instruction: who the institution is, the batch of stories, and what to decide.

Built from the session state the runner sets for each batch (app/judge.py): "institution" (a
short profile), "batch" (the stories: key, watched places with why, headlines, remembered look-alikes) and
"vocabulary" (theme ids, their directions and what each means). The judge never sees a score or writes a number.
"""

import json

RULES = """You judge news stories for {name}, a {kind} in {country}, for its Risk Managers.

About {name}: {summary}
Customer groups: {segments}
Products: {products}
Money and goods flows: {flows}

For each story below decide:
- relevance: "high" if it could move {name}'s products or customers within weeks; "medium" if it
  could later or a little; "low" if routine, far away or not about {name}'s products or customers.
  A story's watched_places say why {name} watches each place (its branches, a flow, an import route).
  A change there (prices, routes, rules, a disruption) reaches {name} through that reason, so it is
  never "far away" or routine: judge it by what the change does to that flow or customer group.
- send: true only if an analyst should trace it to the products now. Never for routine news.
- why: ONE line in your own words naming the link to {name} (the place, flow, customer group, product,
  rival or regulator it touches, and how), or why it doesn't matter.
- title: one neutral line in English. summary: 1-3 sentences, from the headlines only.
- themes: only from the vocabulary below, and only for a change the headlines report: something
  held, kept or unchanged has no direction, so leave it out. When unsure, an empty list.
- same_as: the fingerprint of a remembered story only if this IS that story. continues: the fingerprint
  of a remembered story only if this is a new development of it. Otherwise leave both empty.

Never write numbers or facts that aren't in the headlines. Answer for every story, using its key.

Theme vocabulary (theme: direction = meaning):
{vocabulary}

Stories:
{batch}
"""


def build_instruction(state: dict) -> str:
    i = state.get("institution", {})
    batch = state.get("batch", [])
    return RULES.format(
        name=i.get("name", "the institution"), kind=i.get("institution_type", "bank"),
        country=i.get("country_name") or i.get("country", ""), summary=i.get("summary") or "-",
        segments="; ".join(i.get("segments", [])) or "-", products="; ".join(i.get("products", [])) or "-",
        flows="; ".join(i.get("flows", [])) or "-",
        vocabulary="\n".join(f"- {k}: " + "; ".join(f"{d} = {m}" for d, m in v.items())
                             for k, v in state.get("vocabulary", {}).items()),
        batch=json.dumps(batch, ensure_ascii=False, indent=1),
    )
