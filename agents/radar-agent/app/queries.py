"""The BigQuery query a run sends to GDELT: built by code from the request, one per run.

It reads the GKG table's day partitions for the window (today, plus yesterday when the window
starts before midnight UTC; never more than two days), English articles only, eight columns: about
0.6 GB for a whole day, measured on 16 Oct 2026. It is wide on purpose (recall); the story code and
the judge decide what matters. An article is kept when any of these holds:

- home: the home country's names in the title, the home country HOME_MENTIONS times or more, or an
  outlet on the home country's domain (ft.lk for Sri Lanka);
- footprint: a footprint place in the title, or closely watched footprint countries (geo.SHARE_REASONS:
  branches, a place to watch, a remittance corridor) making up FOOTPRINT_SHARE of the article's place
  mentions (2 or more), and one of the institution type's theme codes. A country watched only for a
  trade flow or a background risk must be named in the title;
- place: a gazetteer place (a strait, a sea) or its alias in the title;
- actor: a rival, regulator or counterparty named in the organisations or the title, with a home or
  footprint country in the article.

Every value goes in as a query parameter, never into the SQL text (names come from people's
profiles). The only table it may read is the partitioned GKG (bq.py refuses anything else).
"""

from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta

from app import settings
from app.contract import RadarRunRequest
from app.geo import Places, home_domain, places, title_pattern

TABLE = "gdelt-bq.gdeltv2.gkg_partitioned"
MAX_DAYS = 2  # a cost guard: a run never reads more than two day partitions

# GKG theme codes (found in GDELT on 16 Oct 2026) that make a footprint article worth reading.
THEMES = {
    "bank": ["ECON_CENTRALBANK", "WB_1235_CENTRAL_BANKS", "EPU_POLICY_CENTRAL_BANK", "ECON_CURRENCY_EXCHANGE_RATE",
             "EPU_CATS_SOVEREIGN_DEBT_CURRENCY_CRISES", "ECON_INTEREST_RATES", "ECON_INFLATION", "WB_442_INFLATION",
             "ECON_OILPRICE", "FUELPRICES", "SANCTIONS", "MARITIME_INCIDENT", "WB_350_FINANCIAL_INFRASTRUCTURE_AND_REMITTANCES",
             "WB_2836_MIGRATION_POLICIES_AND_JOBS", "WB_1234_BANKING_INSTITUTIONS"],
    "insurer": ["WB_337_INSURANCE", "MARITIME_INCIDENT", "MARITIME_PIRACY", "SANCTIONS", "ECON_CURRENCY_EXCHANGE_RATE",
                "WB_1287_HEALTH_INSURANCE", "ECON_STOCKMARKET"],
}
# Economic policy codes specific enough to mean money; EPU_POLICY_POLITICAL, _GOVERNMENT, _AUTHORITIES
# and EPU_ECONOMY tag almost any government story.
EPU = ("EPU_POLICY_CENTRAL_BANK", "EPU_POLICY_MONETARY", "EPU_POLICY_FISCAL", "EPU_POLICY_TAX", "EPU_POLICY_REGULATORY",
       "EPU_POLICY_BUDGET", "EPU_CATS_")
# Wider than THEMES, for scoring only (stories.score): GKG codes, or code prefixes, that mark an article as
# about money, trade or the institution type's business. Recall stays narrow; ranking reads these.
SCORE_THEMES = {
    "bank": ("ECON_", *EPU, "WB_318_", "WB_1920_", "WB_1234_", "WB_1235_", "WB_1236_", "WB_368_",
             "WB_350_", "WB_2836_", "WB_442_", "WB_471_", "WB_507_", "WB_698_TRADE", "TOURISM", "FUELPRICES", "SANCTIONS"),
    "insurer": ("WB_337_", "WB_1287_", "NATURAL_DISASTER", "ECON_", *EPU, "MARITIME_INCIDENT",
                "MARITIME_PIRACY", "WB_507_", "WB_698_TRADE", "SANCTIONS"),
}
DISASTERS = ["NATURAL_DISASTER_EARTHQUAKE", "NATURAL_DISASTER_FLOOD", "NATURAL_DISASTER_FLOODS",
             "NATURAL_DISASTER_HURRICANE", "NATURAL_DISASTER_TSUNAMI", "NATURAL_DISASTER_DROUGHT"]

SQL = f"""
WITH a AS (
  SELECT DATE, SourceCommonName AS outlet, DocumentIdentifier AS url,
         REGEXP_EXTRACT(Extras, r'<PAGE_TITLE>(.*?)</PAGE_TITLE>') AS title,
         IFNULL(V2Locations, '') AS locations, IFNULL(V2Themes, '') AS themes, IFNULL(V2Organizations, '') AS orgs
  FROM `{TABLE}`
  WHERE _PARTITIONTIME BETWEEN TIMESTAMP(@day_from) AND TIMESTAMP(@day_to)
    AND DATE >= @since AND DATE < @until
    AND IFNULL(TranslationInfo, '') = ''),
b AS (
  SELECT *, LOWER(IFNULL(title, '')) AS t,
    (SELECT COUNTIF(SPLIT(x, '#')[SAFE_OFFSET(2)] IN UNNEST(@home_fips)) FROM UNNEST(SPLIT(locations, ';')) AS x) AS home_n,
    (SELECT COUNTIF(SPLIT(x, '#')[SAFE_OFFSET(2)] IN UNNEST(@foot_fips)) FROM UNNEST(SPLIT(locations, ';')) AS x) AS foot_n,
    (SELECT COUNTIF(SPLIT(x, '#')[SAFE_OFFSET(2)] IN UNNEST(@share_fips)) FROM UNNEST(SPLIT(locations, ';')) AS x) AS share_n,
    (SELECT COUNTIF(x != '') FROM UNNEST(SPLIT(locations, ';')) AS x) AS all_n
  FROM a),
c AS (
  SELECT *,
    (@home_names != '' AND REGEXP_CONTAINS(t, @home_names)) OR home_n >= @home_mentions
      OR ENDS_WITH(LOWER(IFNULL(outlet, '')), @home_domain) AS r_home,
    ((@foot_names != '' AND REGEXP_CONTAINS(t, @foot_names)) OR (share_n >= 2 AND share_n >= @share * all_n))
      AND REGEXP_CONTAINS(themes, @themes) AS r_footprint,
    @place_names != '' AND REGEXP_CONTAINS(t, @place_names) AS r_place,
    @actor_names != '' AND (home_n > 0 OR foot_n > 0) AND REGEXP_CONTAINS(CONCAT(LOWER(orgs), ' ', t), @actor_names) AS r_actor
  FROM b)
SELECT DATE, outlet, url, title, locations, themes, orgs, home_n, foot_n, all_n, r_home, r_footprint, r_place, r_actor
FROM c WHERE r_home OR r_footprint OR r_place OR r_actor
ORDER BY DATE DESC
LIMIT @row_limit
"""


@dataclass
class Plan:
    name: str
    purpose: str
    sql: str
    params: dict  # name -> (BigQuery type, value)
    days: list[date]
    clamped: bool  # the window was longer than MAX_DAYS: its start was moved


def stamp(t: datetime) -> int:
    """GDELT's DATE column: INT64 YYYYMMDDHHMMSS, UTC."""
    return int(t.astimezone(UTC).strftime("%Y%m%d%H%M%S"))


def actor_names(req: RadarRunRequest) -> list[str]:
    i = req.institution
    named = [*i.rivals, *i.regulators, *i.counterparties]
    names = [n for x in named for n in [x.name, *x.aliases]] + list(req.scope.actors)
    # short aliases ("BOC", "NDB") only as whole words; drop ones too short to mean anything
    return list(dict.fromkeys(n for n in names if len(n.strip()) >= 3))


def theme_codes(institution_type: str) -> list[str]:
    return [*THEMES.get(institution_type, THEMES["bank"]), *DISASTERS]


def score_themes(institution_type: str) -> tuple[str, ...]:
    return (*SCORE_THEMES.get(institution_type, SCORE_THEMES["bank"]), *theme_codes(institution_type))


def plan(req: RadarRunRequest) -> tuple[Plan, Places]:
    p = places(req.institution.country, list(req.scope.places), dict(req.scope.places_why))
    since, until = req.window.since.astimezone(UTC), req.window.until.astimezone(UTC)
    first = max(since.date(), until.date() - timedelta(days=MAX_DAYS - 1))
    clamped = first > since.date()
    if clamped:
        since = datetime.combine(first, datetime.min.time(), UTC)
    codes = theme_codes(req.institution.institution_type)
    params = {
        "day_from": ("STRING", first.isoformat()), "day_to": ("STRING", until.date().isoformat()),
        "since": ("INT64", stamp(since)), "until": ("INT64", stamp(until)),
        "home_fips": ("ARRAY<STRING>", list(p.home_fips)), "foot_fips": ("ARRAY<STRING>", p.footprint_fips),
        "share_fips": ("ARRAY<STRING>", p.share_fips),
        "home_names": ("STRING", title_pattern(p.home_names)), "home_domain": ("STRING", home_domain(p.home)), "foot_names": ("STRING", title_pattern(p.footprint_names)),
        "place_names": ("STRING", title_pattern([n for ns in p.named.values() for n in ns])),
        "actor_names": ("STRING", title_pattern(actor_names(req))),
        "themes": ("STRING", r"(^|;)(" + "|".join(codes) + r"),"),
        "home_mentions": ("INT64", settings.integer("HOME_MENTIONS")), "share": ("FLOAT64", settings.number("FOOTPRINT_SHARE")),
        "row_limit": ("INT64", settings.integer("BQ_ROW_LIMIT")),
    }
    days = [first + timedelta(days=d) for d in range((until.date() - first).days + 1)]
    return Plan("gkg-recall", "English articles about the home country, the footprint (with a "
                f"{req.institution.institution_type}'s themes), named places and actors", SQL, params, days, clamped), p
