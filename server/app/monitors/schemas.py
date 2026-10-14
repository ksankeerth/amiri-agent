"""The monitor spec as the web app and the setup agent write it. It is the monitor agent's
MonitorSpec (agents/event-monitor-agent/app/contract.py, contract 2.0); the server checks it
against the profile (places, exposures) and the prototype's limits."""

from datetime import date
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app import reference, settings

FREQUENCIES = (15, 60, 360, 1440)
Line = Annotated[str, Field(min_length=3, max_length=300)]
Short = Annotated[str, Field(min_length=1, max_length=120)]


class Model(BaseModel):
    model_config = ConfigDict(extra="forbid")


class KeyDate(Model):
    date: date
    label: Short
    lead_days: Literal[1, 3, 7] = 3


class About(Model):
    name: Annotated[str, Field(min_length=3, max_length=80)]
    owner: Short
    also_notify: list[Short] = Field(default_factory=list, max_length=10)
    check_frequency: Literal[15, 60, 360, 1440] = 60
    kind: Literal["events", "trend"] = "events"
    key_dates: list[KeyDate] = Field(default_factory=list, max_length=10)
    review_by: date | None = None

    @model_validator(mode="after")
    def _frequency(self):
        least = settings.integer("MONITOR_MIN_FREQUENCY_MINUTES")
        if self.check_frequency < least:
            raise ValueError(f"check_frequency {self.check_frequency} is more often than this installation allows "
                             f"(every {least} minutes at most)")
        return self


class WatchChip(Model):
    name: Short
    type: Literal["organisation", "place", "region", "person", "sector", "regulation", "topic"]
    other_forms: list[Short] = Field(default_factory=list, max_length=10)
    not_confused_with: list[Short] = Field(default_factory=list, max_length=10)


class ExampleMatch(Model):
    headline: Annotated[str, Field(min_length=3, max_length=300)]
    line: int = Field(ge=1)


class ExampleHeadlines(Model):
    match: list[ExampleMatch] = Field(default_factory=list, max_length=10)
    not_match: list[Annotated[str, Field(min_length=3, max_length=300)]] = Field(default_factory=list, max_length=10)


class Sources(Model):
    mode: Literal["any_reputable", "trusted_only"] = "any_reputable"
    check_first: list[Short] = Field(default_factory=list, max_length=10)


class Public(Model):
    watch: list[WatchChip] = Field(min_length=1, max_length=12)
    in_one_sentence: Annotated[str, Field(min_length=10, max_length=300)]
    tell_me_if: list[Line] = Field(min_length=1, max_length=8)
    ignore: list[Line] = Field(default_factory=list, max_length=8)
    example_headlines: ExampleHeadlines = Field(default_factory=ExampleHeadlines)
    places: list[str] = Field(default_factory=list, max_length=20)
    languages: list[Literal["en"]] = Field(default_factory=lambda: ["en"], min_length=1, max_length=1,
                                           description="English only in the prototype.")
    sources: Sources = Field(default_factory=Sources)

    @model_validator(mode="after")
    def _places_and_examples(self):
        bad = [p for p in self.places if not reference.is_place(p)]
        if bad:
            raise ValueError(f"unknown places: {', '.join(bad)} (GET /reference/places)")
        n = len(self.tell_me_if)
        if any(m.line > n for m in self.example_headlines.match):
            raise ValueError(f"an example headline refers to a line beyond the {n} tell_me_if lines")
        return self


class Exposure(Model):
    id: Annotated[str, Field(pattern=r"^(product|segment|flow|rival|regulator|counterparty|risk):.+$")]
    how_it_reaches_us: Annotated[str, Field(max_length=300)] = ""


class Private(Model):
    exposure: list[Exposure] = Field(default_factory=list, max_length=20)
    serious: list[Line] = Field(default_factory=list, max_length=8)
    notes: Annotated[str, Field(max_length=1000)] = ""


class MonitorSpec(Model):
    about: About
    public: Public
    private: Private = Field(default_factory=Private)
    alert_level: int = Field(6, ge=0, le=10)


class MonitorCreate(Model):
    spec: MonitorSpec
    note: Annotated[str, Field(max_length=500)] | None = None


class MonitorPatch(Model):
    spec: MonitorSpec
    note: Annotated[str, Field(max_length=500)] | None = None


class Draft(Model):
    """Start a monitor by code: from a template, or from a profile item."""

    template_id: str | None = None
    institution_id: str | None = Field(None, description="Default: INSTITUTION_ID (the guided setup passes its own).")
    section: Literal["risk-exposures", "regulators", "rivals", "flows", "counterparties"] | None = None
    item_id: str | None = None

    @model_validator(mode="after")
    def _one(self):
        if bool(self.template_id) == bool(self.section and self.item_id):
            raise ValueError("give template_id, or section and item_id")
        return self


class ChangesRequested(Model):
    note: Annotated[str, Field(min_length=3, max_length=500)]
