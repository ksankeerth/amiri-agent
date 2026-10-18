"""Each track as configuration (one shared loop, app/track_loop.py): what it
covers, how it gathers and concludes, and its tools. Written for a bank or an insurer;
the data that differs (taxonomy, templates, the rule table) comes from the server."""

from dataclasses import dataclass, field
from typing import Any

from app import tools as T


@dataclass(frozen=True)
class Guide:
    writes: str  # what its proposals may change, in words (the server enforces it)
    steps: str
    tools: list[Any] = field(default_factory=list)


ASK = [T.ask_user]
PROPOSE = [T.propose, T.conclude]

GUIDES: dict[str, Guide] = {
    "institution": Guide(
        "the institution's own fields: name, type (bank or insurer), subtype, islamic, home country, base "
        "currency, time zone, summary, governance body, size band",
        """- Before the institution exists: gather name, type, subtype, home country, base currency and time zone.
  Ask only for what's missing (ask_user with options for the type and subtype; get_reference
  institution-types). Use search_places (countries_only) for the country code, and get_reference
  currencies / time-zones for the codes; never guess a code. Then propose with `institution`.
- Once it exists: propose `operations` [{op: update, section: institution, data: {…}}] for fields
  that change. Read the current fields with get_section("institution").""",
        [T.get_section, T.search_places, T.get_reference, T.get_field_rules, *ASK, *PROPOSE]),
    "footprint_flows": Guide(
        "footprint (where it operates), watch-places (places to watch), flows (money and goods with places abroad)",
        """- Footprint: each place it operates in, with its role (branches, subsidiary, agents, …). Codes from
  search_places (regions are ISO 3166-2, e.g. IN-KL).
- Flows: start from get_suggestions("flows"): published figures for the footprint, each with a
  figure_id. Propose those items as they are. A flow the user describes without a figure has no value:
  leave value out unless the user typed the amount and year.
- Watch-places: places that matter without being in the footprint (a port, a strait), from search_places.""",
        [*T.READS, *ASK, *PROPOSE]),
    "customers_products": Guide(
        "segments (customer groups) and products (and which groups use which product)",
        """- Customer groups: keep the user's own names for them. Look at get_suggestions("segments") (templates for
  this institution type), but use a template only when its description means what the user said; never one
  that reverses a direction (people who send remittances abroad are not a group that receives them; expats
  working here earn salaries). Set income_sources and the Metrics Spec mapping (spec_mapping,
  get_reference segment-dimensions) only from what the user said or from a template that truly matches.
- Products: get_suggestions("products") or get_reference product-taxonomy; the category and product type
  must come from the taxonomy for this institution's type (a bank has no insurance categories, an insurer
  no savings accounts: if the user asks for one, explain and ask whether it's a separate institution).
- Link every product to the groups that use it (a product's `segments`: segment ids) in the same proposal;
  if you can't tell which groups use a product, ask. If the proposal comes back with warnings (a product
  with no customer group), say so.""",
        [*T.READS, *ASK, *PROPOSE]),
    "rules": Guide(
        "regulators, and the institution's clearing_currencies (the currencies it settles in abroad)",
        """- Regulators come from the rule table: get_suggestions("regulators") (home, host countries, the
  sanctions that follow its clearing currencies, global standards). Propose those items as they are.
- The sanctions regimes (OFAC for USD, …) follow the SAVED clearing currencies. If the user names clearing
  currencies that aren't saved yet, propose the currencies on their own first ({op: update, section:
  institution, data: {clearing_currencies: [...]}}; the only institution field this track may change), and end
  that reply with a question naming what comes next, e.g. "Once these are applied, shall I add APRA and ASIC,
  with the sanctions regimes for USD?". When they are applied, get_suggestions("regulators") again and propose
  the regulators, sanctions included. Never say the next step is another track while regulators the user
  asked for are still to come.
- A regulator that isn't in the table: only with the user's own words for its name, and then basis: user.
  Never mark one you thought of yourself as basis: user; ask the user to confirm it first.
- If the table has no regulator for the home country or a host country, say so plainly and ask the user to
  name theirs.""",
        [*T.READS, *ASK, *PROPOSE]),
    "rivals_partners": Guide(
        "rivals (competitors) and counterparties (firms it depends on: correspondent banks, reinsurers, payment networks)",
        """- Rivals: start from get_suggestions("rivals"): licensed banks or insurers in the institution's markets,
  of a similar size, each with "why". Offer the ones not yet added with ask_user (multi: true, their names
  as options), then propose the ones picked as they are. If there are none (no data for these markets yet),
  say so in one sentence and ask the user to name their competitors; never suggest names of your own.
- Rivals the user names, and all counterparties: record names, type, aliases, the places they compete in
  (search_places), and how much they overlap.
- An insurer's counterparties are reinsurers and brokers; a bank's, correspondent banks and networks.""",
        [*T.READS, *ASK, *PROPOSE]),
    "risks": Guide(
        "risk-exposures (known risks that meet the institution's places, customers, flows and routes)",
        """- Start from get_suggestions("risk-exposures"): the risk finder's hazards that meet the profile, each
  with a hazard_id and its months. Propose those items as they are, and link what they touch
  (products, segments) when the user says so.
- A risk the user describes that isn't in the library: title, kind and places from search_places; no
  months unless the user gave them.""",
        [*T.READS, *ASK, *PROPOSE]),
    "monitors": Guide(
        "monitors (news to watch for); the proposal's kind is monitors. Confirming submits them for approval; "
        "a Risk Manager makes them live on the Monitors page",
        """- get_monitor_candidates: profile items a monitor can watch; one with monitor_id is watched already:
  change that monitor (get_monitor, then propose an update with its whole spec), never a second one.
- For a new one: get_monitor_template(section, item_id), then edit the text to what the user asked
  (name, sentence, "tell me if" lines, ignore, watch chips). Keep places, exposure and the rest unless the
  user changes them. propose(monitors=[{op: create, origin_ref, spec}]).
- Numbers: the alert level stays 6, key dates and thresholds only as the user typed them; check frequency
  is one of 60, 360, 1440 minutes (hourly at most in the prototype). English only.
- Keep the private fields private: what "how it reaches us" and "serious" say must not be repeated in the
  sentence, the lines or the watch chips (those become web searches).
- You can't approve, pause, resume or retire a monitor: that's done on the Monitors page.""",
        [T.get_section, T.search_places, *T.MONITOR_TOOLS, *ASK, *PROPOSE]),
    "verification": Guide(
        "any section (fixes it finds), and undoing a change",
        """- get_readiness: what's missing (required) and recommended; walk the user through the gaps, the
  section most needed first, and propose fixes in one proposal.
- Contradictions (a product category the type can't have, a flow outside the footprint): explain, ask,
  then fix.
- Undo: get_history to find the batch, get_undo(batch_id) for its inverse operations, then propose them as
  they are and say what will be undone.""",
        [*T.READS, *T.HISTORY_TOOLS, *ASK, *PROPOSE]),
    "history": Guide(
        "nothing (read only)",
        """- Answer from get_history: what changed, when, who, and from where (form, assistant, setup, import).
  To undo a change, the user asks for it and the verification track proposes it.""",
        [T.get_section, *T.HISTORY_TOOLS, T.conclude]),
    "agent_view": Guide(
        "nothing (read only)",
        """- Answer from get_agent_context: what the agents read, and Radar's scope with why each place is in
  it (a footprint place, a flow's end, a risk, a place to watch).""",
        [T.get_agent_context, T.get_section, T.conclude]),
    "question": Guide(
        "nothing (read only)",
        """- Answer questions about Amiri Agent and the setup from what you know and the profile. Amiri Agent: Radar and
  monitors watch the news, market series watch prices; their findings go to the investigation agent,
  which traces events to the institution's products and customers. The profile is what they all read.""",
        [T.get_section, T.get_readiness, T.conclude]),
}
