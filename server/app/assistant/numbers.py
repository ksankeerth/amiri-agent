"""The number check on proposals.

Models never produce a number. Every number in a proposal's operations must be
either a reference value it points at (a flow's figure_id, a risk's hazard_id) or a
number the user typed in this thread ("1.2bn", "45%", "May to September").
"""

import re
from typing import Any

from app import reference

# Where numbers live, per section (dotted paths; "*" = every key of a dict).
NUMERIC_FIELDS: dict[str, list[str]] = {
    "institution": ["fiscal_year_start_month"],
    "footprint": ["branch_count"],
    "watch-places": ["lat", "lon"],
    "segments": ["share_of_customers_pct"],
    "products": ["book_size.amount", "attributes.*"],
    "flows": ["value.amount", "value.year", "source.original_amount", "source.dataset_year"],
    "risk-exposures": ["months"],
}
DEFAULTS: dict[str, set[float]] = {"fiscal_year_start_month": {1.0}}

SCALE = {"k": 1e3, "thousand": 1e3, "m": 1e6, "mn": 1e6, "mio": 1e6, "million": 1e6, "millions": 1e6,
         "b": 1e9, "bn": 1e9, "billion": 1e9, "billions": 1e9, "lakh": 1e5, "lakhs": 1e5, "crore": 1e7, "crores": 1e7}
MONTH_NAMES = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october",
               "november", "december"]
MONTHS = {**{m: i for i, m in enumerate(MONTH_NAMES, 1)}, **{m[:3]: i for i, m in enumerate(MONTH_NAMES, 1)},
          "sept": 9}
MONTH_WORD = r"(?:" + "|".join(sorted(MONTHS, key=len, reverse=True)) + r")\b"
MONTH_RANGE = re.compile(rf"\b({MONTH_WORD})\s*(?:to|-|\u2013|until|till|through|thru)\s*({MONTH_WORD})", re.I)
NUM = re.compile(r"(?<![\w.])(\d{1,3}(?:,\d{3})+|\d+)(\.\d+)?\s*(%|[a-zA-Z]+)?")


def user_numbers(texts: list[str]) -> set[float]:
    """Every number the user typed, as written and with its scale word applied; months by name too."""
    out: set[float] = set()
    for t in texts:
        for whole, frac, unit in NUM.findall(t or ""):
            x = float(whole.replace(",", "") + (frac or ""))
            out.add(x)
            u = (unit or "").lower()
            if u in SCALE:
                out.add(x * SCALE[u])
        for word in re.findall(r"[A-Za-z]+", t or ""):
            m = MONTHS.get(word.lower())
            if m:
                out.add(float(m))
        for a, b in MONTH_RANGE.findall(t or ""):  # "May to September": every month between
            m, end = MONTHS[a.lower()], MONTHS[b.lower()]
            while True:
                out.add(float(m))
                if m == end:
                    break
                m = m % 12 + 1
    return out


def _values(data: Any, path: str) -> list[tuple[str, float]]:
    parts = path.split(".")
    nodes: list[tuple[str, Any]] = [("", data)]
    for p in parts:
        nxt = []
        for name, n in nodes:
            if not isinstance(n, dict):
                continue
            if p == "*":
                nxt += [(f"{name}.{k}".lstrip("."), v) for k, v in n.items()]
            elif p in n:
                nxt.append((f"{name}.{p}".lstrip("."), n[p]))
        nodes = nxt
    out = []
    for name, v in nodes:
        for x in (v if isinstance(v, list) else [v]):
            if isinstance(x, bool) or x is None:
                continue
            if isinstance(x, (int, float)):
                out.append((name, float(x)))
    return out


def _close(x: float, allowed: set[float]) -> bool:
    return any(abs(x - a) <= max(1e-9, abs(a) * 1e-9) for a in allowed)


def check(section: str, data: dict | None, typed: set[float], index: int | None = None) -> list[dict]:
    """Numbers in one operation's data that the user didn't give and no reference backs."""
    if not data:
        return []
    allowed = set(typed)
    if section == "flows" and data.get("figure_id"):
        f = reference.flow_figure(data["figure_id"])
        if f:
            allowed |= {float(f["amount"]), float(f["year"])}
    if section == "risk-exposures" and data.get("hazard_id"):
        h = reference.hazard(data["hazard_id"])
        if h:
            allowed |= {float(m) for m in h["months"]}
    errors = []
    for path in NUMERIC_FIELDS.get(section, []):
        for name, x in _values(data, path):
            if not _close(x, allowed | DEFAULTS.get(name, set())):
                errors.append({"operation": index, "section": section, "field": name, "code": "unsupported_number",
                               "message": f"{x:g} isn't a reference figure or a number the user gave; ask the user, "
                                          "or use the suggestion that carries it"})
    return errors


def unbacked(text: str, allowed: set[float]) -> set[str]:
    """Numbers in an agent's reply that no data backs (shown to the user as unverified)."""
    out: set[str] = set()
    for m in NUM.finditer(text or ""):
        whole, frac, unit = m.groups()
        x = float(whole.replace(",", "") + (frac or ""))
        vals = {x}
        u = (unit or "").lower()
        if u in SCALE:
            vals.add(x * SCALE[u])
        if not any(_close(v, allowed) for v in vals):
            out.add(m.group(0).strip())
    return out


# ---------------------------------------------------------------- monitors

MONITOR_DEFAULTS = {"alert_level": 6.0, "lead_days": 3.0}


def monitor_texts(spec: dict) -> list[str]:
    """Every free-text field of a monitor spec."""
    a, p, v = spec.get("about") or {}, spec.get("public") or {}, spec.get("private") or {}
    ex = p.get("example_headlines") or {}
    return [a.get("name") or "", a.get("owner") or "", *(a.get("also_notify") or []),
            *(k.get("label") or "" for k in a.get("key_dates") or []),
            p.get("in_one_sentence") or "", *(p.get("tell_me_if") or []), *(p.get("ignore") or []),
            *(m.get("headline") or "" for m in ex.get("match") or []), *(ex.get("not_match") or []),
            *(w for c in p.get("watch") or [] for w in [c.get("name") or "", *(c.get("other_forms") or []),
                                                          *(c.get("not_confused_with") or [])]),
            *(e.get("how_it_reaches_us") or "" for e in v.get("exposure") or []), *(v.get("serious") or []),
            v.get("notes") or ""]


def text_numbers(texts: list[str]) -> list[tuple[str, float]]:
    out = []
    for t in texts:
        for m in NUM.finditer(t or ""):
            whole, frac, _ = m.groups()
            out.append((m.group(0).strip(), float(whole.replace(",", "") + (frac or ""))))
    return out


def check_monitor(spec: dict, typed: set[float], backed_texts: list[str], backed_specs: list[dict],
                  index: int, today_year: int) -> list[dict]:
    """Numbers in a proposed monitor that neither the user typed nor code wrote.

    Backed: what the user typed in the thread; numbers in code's draft or the monitor's current
    version (`backed_specs`) and in the profile's names (`backed_texts`). The check frequency is a
    choice from the allowed list (the schema checks it), and example headlines' line numbers are
    references, so neither is checked here.
    """
    allowed = set(typed) | {x for _, x in text_numbers(backed_texts)}
    for b in backed_specs:
        allowed |= {x for _, x in text_numbers(monitor_texts(b))}
    errors = []

    def bad(field: str, what: str):
        errors.append({"operation": index, "section": "monitors", "field": field, "code": "unsupported_number",
                       "message": f"{what} isn't a number the user gave or code drafted; ask the user, or leave it out"})

    for raw, x in text_numbers(monitor_texts(spec)):
        if not _close(x, allowed):
            bad("text", f"“{raw}”")
    level = float(spec.get("alert_level", MONITOR_DEFAULTS["alert_level"]))
    if not _close(level, allowed | {MONITOR_DEFAULTS["alert_level"]} | {float(b.get("alert_level", 6)) for b in backed_specs}):
        bad("alert_level", f"alert level {level:g}")
    backed_dates = {k.get("date") for b in backed_specs for k in (b.get("about") or {}).get("key_dates") or []}
    backed_leads = {float(k.get("lead_days", 3)) for b in backed_specs for k in (b.get("about") or {}).get("key_dates") or []}
    for k in (spec.get("about") or {}).get("key_dates") or []:
        d = str(k.get("date") or "")
        if d not in backed_dates:
            try:
                y, mo, day = (int(x) for x in d.split("-"))
            except ValueError:
                continue  # the schema reports it
            if not (_close(day, typed) and _close(mo, typed) and (_close(y, typed) or y in (today_year, today_year + 1))):
                bad("about.key_dates", f"the date {d}")
        lead = float(k.get("lead_days", MONITOR_DEFAULTS["lead_days"]))
        if not _close(lead, typed | backed_leads | {MONITOR_DEFAULTS["lead_days"]}):
            bad("about.key_dates", f"lead days {lead:g}")
    return errors
