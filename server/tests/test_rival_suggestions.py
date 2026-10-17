"""Rival suggestions (app/institutions/rivals.py): same kind, a shared market, a size that competes; ranked by code."""

from app import reference
from app.institutions import rivals
from tests.test_institutions_api import BANK, B, add, new


def test_size_rule():
    fits = rivals.size_fits
    # small and mid compete with their own size and the next one up, not with smaller ones
    assert fits("small", "small") and fits("small", "mid") and not fits("small", "large")
    assert fits("mid", "large") and not fits("mid", "small") and not fits("mid", "systemic")
    # large and systemic with their own size and the next one down
    assert fits("large", "mid") and fits("large", "large") and not fits("large", "systemic") and not fits("large", "small")
    assert fits("systemic", "large") and not fits("systemic", "mid")
    # no size band: every size
    assert all(fits(None, b) for b in rivals.BANDS)


def _suggest(kind="bank", size=None, home="AU", countries=("AU",), kinds=(), have=()):
    return rivals.suggest(reference.institution_rows(), kind, size, home, set(countries), set(kinds), set(have), lambda c: c)


def test_a_small_australian_bank_gets_small_and_mid_banks_there():
    s = _suggest(size="small", countries=("AU", "NZ"), kinds={"individual"})
    names = [x["item"]["name"] for x in s]
    bands = {x["size_band"] for x in s}
    assert bands == {"small", "mid"} and "Commonwealth Bank of Australia" not in names
    assert "Bendigo and Adelaide Bank" in names and "Kiwibank" in names and "Bank of Ceylon" not in names
    assert all(x["item"]["type"] == "bank" for x in s)
    # same size, home market and customers first: a small retail bank in Australia
    top = s[0]
    assert top["size_band"] == "small" and "AU" in top["item"]["places"] and top["item"]["overlap"] == "high"
    assert s[-1]["item"]["overlap"] in ("medium", "low")


def test_a_systemic_bank_skips_small_ones_and_insurers_get_insurers():
    names = {x["item"]["name"] for x in _suggest(size="systemic")}
    assert "Macquarie Bank" in names and "Westpac Banking Corporation" in names and "Judo Bank" not in names
    ins = _suggest(kind="insurer", home="LK", countries=("LK",))
    assert ins and all(x["item"]["type"] == "insurer" for x in ins) and {x["item"]["places"][0] for x in ins} == {"LK"}


def test_already_added_and_no_data():
    s = _suggest(size="mid", have={"bendigo bank"})  # matched by an alias
    assert next(x for x in s if x["item"]["name"] == "Bendigo and Adelaide Bank")["added"] is True
    assert _suggest(home="KE", countries=("KE",)) == []  # no reference data for Kenya: nothing invented


async def test_rival_suggestions_through_the_api_can_be_proposed_as_they_are(client):
    iid = (await new(client, {**BANK, "size_band": "mid"}))["institution_id"]
    r = (await client.get(f"{B}/{iid}/suggestions/rivals")).json()
    assert r["section"] == "rivals" and "sample" in r["note"]
    items = r["items"]
    assert items and {x["size_band"] for x in items} <= {"mid", "large"}
    assert all("LK" in x["item"]["places"] for x in items)
    first = items[0]["item"]
    await add(client, iid, "rivals", first)  # the suggestion is valid as it is
    again = (await client.get(f"{B}/{iid}/suggestions/rivals")).json()["items"]
    assert next(x for x in again if x["item"]["name"] == first["name"])["added"] is True
