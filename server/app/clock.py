"""The server's clock. Code takes time from here, never from the database's now(),
so tests (and later the Scenario Studio's sandboxes) can set it."""

from datetime import UTC, datetime, timedelta


class Clock:
    def now(self) -> datetime:
        return datetime.now(UTC)


class FixedClock(Clock):
    """A clock that only moves when told (tests)."""

    def __init__(self, at: datetime):
        self.at = at

    def now(self) -> datetime:
        return self.at

    def advance(self, **kwargs) -> datetime:
        self.at += timedelta(**kwargs)
        return self.at
