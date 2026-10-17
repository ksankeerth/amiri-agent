"""What the agent knows of earlier runs: only what the request brings.

To say "this is the same story as yesterday" (keep its fingerprint) or "this develops last week's
story" (development_of), the agent needs the stories it already reported. The server keeps them
and sends the institution's recent ones with every run (`seen_stories`: fingerprint, title,
places, a few headlines), so the agent has no memory of its own: a restart, a redeploy or a new
instance loses nothing, and the prototype reset clears it with the rest. The daily model-call
allowance comes the same way (`model_calls_left_today`).
"""

from dataclasses import dataclass
from datetime import datetime

from app.articles import tokens
from app.contract import RadarRunRequest


@dataclass
class Remembered:
    fingerprint: str
    title: str
    places: set[str]
    terms: set[str]     # words of its title and headlines, as grouping compares them
    last_seen: datetime


def recall(req: RadarRunRequest) -> list[Remembered]:
    """The stories the server says this institution has seen, ready to compare with new candidates."""
    return [Remembered(s.fingerprint, s.title, set(s.places), tokens(" ".join([s.title, *s.headlines])), s.last_seen_at)
            for s in req.seen_stories]


def seen_fingerprints(req: RadarRunRequest) -> set[str]:
    """Every fingerprint the server knows for this institution (2.0 servers send `seen` only)."""
    return set(req.seen) | {s.fingerprint for s in req.seen_stories}
