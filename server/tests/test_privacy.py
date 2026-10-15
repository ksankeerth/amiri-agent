"""The personal-data check: dates and amounts pass; account numbers, emails and names don't."""

from app.institutions import privacy


def test_dates_and_amounts_are_not_personal_data():
    assert privacy.find({"book_size": {"amount": 64000000000, "currency": "LKR", "as_of": "2026-06-30"}}) == []
    assert privacy.find({"launched_on": "2019-01-15", "note": "open since 2026-06-30, reviewed 2026-09-01"}) == []


def test_numbers_and_names_in_free_text_are_refused():
    assert privacy.find({"note": "account 1234567890"})[0][0] == "note"
    assert privacy.find({"note": "call +94 77 123 4567"})
    assert privacy.find({"note": "ask Mr Perera"})
    assert privacy.find({"note": "write to a.b@bank.lk"})
