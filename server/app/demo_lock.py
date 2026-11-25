"""Demo lock: for a live demo where many people click around. With DEMO_LOCK=true every endpoint that edits,
deletes or resets something someone set up answers 403 `demo_locked` (the web app greys those controls out).
Alerts (acknowledge, resolve, reopen) are locked too, so the alerts stay as they were set up for everyone watching, and so
are a monitor's Check now and Radar's Run now, which spend the day's budget. Scenario Studio runs and new scenarios, the
data connection's Check, Investigate now, asking the setup assistant and signing in stay open.

Each locked endpoint calls `guard()` first.
"""

from app import settings
from app.problems import Problem


def guard() -> None:
    if settings.flag("DEMO_LOCK"):
        raise Problem(403, "demo_locked", "Editing is switched off for this demo.")
