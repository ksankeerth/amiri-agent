"""The tracks as the agent sees them (the server's
`app/assistant/tracks.py` is the source of what each may write, sent in the context pack).
Here: what the router reads about each track, and the first-setup order."""

from dataclasses import dataclass


@dataclass(frozen=True)
class Track:
    id: str
    label: str
    about: str  # for the router: what belongs here
    order: int | None = None
    read_only: bool = False


TRACKS: dict[str, Track] = {t.id: t for t in [
    Track("institution", "Institution", "who the institution is: name, bank or insurer, subtype, home country, "
          "currency, time zone, summary, governance", 1),
    Track("footprint_flows", "Footprint and flows", "where it operates (countries, states, branches), places to "
          "watch, and money or goods flowing with places abroad (remittances, exports, imports, tourism)", 2),
    Track("customers_products", "Customers and products", "customer groups (segments) and the products it "
          "offers, and who uses which product", 3),
    Track("rules", "Rules", "regulators and rules that reach it, sanctions regimes, the currencies it settles "
          "in abroad", 4),
    Track("rivals_partners", "Rivals and partners", "competitors, and firms it depends on (correspondent banks, "
          "reinsurers, payment networks)", 5),
    Track("risks", "Risks", "known risks: hazards and events that meet its places, customers, flows and routes", 6),
    Track("monitors", "Monitors", "news monitors: what to watch the news for (a corridor's jobs, a regulator's "
          "rules, a rival's prices), changing a monitor's lines", 7),
    Track("verification", "Verification", "checking the profile is complete and consistent before going live, "
          "fixing what's wrong, and undoing a change", 8),
    Track("history", "History", "what changed in the profile and who changed it (to undo a change: verification)",
          read_only=True),
    Track("agent_view", "What the agent can see", "what the agents read from the profile (the context, "
          "Radar's scope)", read_only=True),
    Track("question", "Question", "a question about Amiri Agent or the setup that changes nothing", read_only=True),
    Track("offtopic", "Off-topic", "anything unrelated to setting up Amiri Agent for this institution", read_only=True),
]}
FIRST_SETUP = [t.id for t in sorted((t for t in TRACKS.values() if t.order), key=lambda t: t.order)]


def next_in_setup(track: str) -> str | None:
    """The track after this one in the first-setup order."""
    if track not in FIRST_SETUP:
        return None
    i = FIRST_SETUP.index(track)
    return FIRST_SETUP[i + 1] if i + 1 < len(FIRST_SETUP) else None
