"""The setup agent's tracks.

Each track writes only its own sections; the server enforces it on proposals.
"""

from dataclasses import dataclass


@dataclass(frozen=True)
class Track:
    id: str
    label: str
    tab: str | None           # the Institution page tab it switches to (None: stays)
    setup_step: str | None    # the guided-setup step it matches
    writes: tuple[str, ...]   # sections it may change ("institution" = the institution's fields)
    shown: bool = True        # the chat shows which track you're in (not for off-topic)
    order: int | None = None  # first-setup order

    @property
    def read_only(self) -> bool:
        return not self.writes


ALL_SECTIONS = ("institution", "footprint", "watch-places", "segments", "products", "flows", "regulators",
                "rivals", "counterparties", "risk-exposures")

TRACKS: dict[str, Track] = {t.id: t for t in [
    Track("institution", "Institution", "overview", "institution", ("institution",), order=1),
    Track("footprint_flows", "Footprint and flows", "footprint", "where", ("footprint", "flows", "watch-places"), order=2),
    Track("customers_products", "Customers and products", "customers", "customers", ("segments", "products"), order=3),
    Track("rules", "Rules", "rules", "rules", ("regulators", "institution"), order=4),
    Track("rivals_partners", "Rivals and partners", "rivals", "rivals", ("rivals", "counterparties"), order=5),
    Track("risks", "Risks", "risks", "risks", ("risk-exposures",), order=6),
    # monitors aren't a profile section: its proposals are kind "monitors"
    Track("monitors", "Monitors", None, "monitors", ("monitors",), order=7),
    Track("verification", "Verification", "overview", "review", ALL_SECTIONS, order=8),
    Track("history", "History", "history", None, ()),
    Track("agent_view", "What the agent can see", "agents", None, ()),
    Track("question", "Question", None, None, ()),
    Track("offtopic", "Off-topic", None, None, (), shown=False),
]}

# The rules track may change only these fields of the institution itself.
RULES_INSTITUTION_FIELDS = {"clearing_currencies"}


def view() -> list[dict]:
    return [{"track": t.id, "label": t.label, "tab": t.tab, "setup_step": t.setup_step, "writes": list(t.writes),
             "read_only": t.read_only, "shown": t.shown, "order": t.order} for t in TRACKS.values()]
