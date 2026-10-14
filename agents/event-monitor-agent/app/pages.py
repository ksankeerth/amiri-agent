"""Reads a cited web page's own publication time and title (code, no model).

Search grounding returns links without dates. Before a page can support a finding, its
publication time is read from the page itself: Open Graph and article meta tags, JSON-LD
`datePublished`, or a `<time datetime>` element; the title from `og:title` or `<title>`.
A page published outside the check's window, or with no date, can't support a finding
(app/tools.py, finish).

One GET per page, with a short timeout and a size cap (PAGE_TIMEOUT_SECONDS, PAGE_MAX_BYTES).
"""

import json
import re
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from html.parser import HTMLParser

import httpx

from app import settings

DATE_META = (
    "article:published_time", "og:article:published_time", "datepublished", "publishdate", "pubdate",
    "publish-date", "date", "dc.date", "dc.date.issued", "dcterms.created", "sailthru.date",
    "parsely-pub-date", "article.published", "og:published_time", "og:updated_time", "article:modified_time",
)  # fmt: skip
USER_AGENT = "Mozilla/5.0 (compatible; AmiriAgentMonitor/1.0)"


@dataclass
class Page:
    url: str  # after redirects
    title: str | None
    published_at: datetime | None
    error: str | None = None


def parse_time(value: str) -> datetime | None:
    v = (value or "").strip()
    if not v:
        return None
    v = v.replace("Z", "+00:00")
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}", v):
        v += "T00:00:00+00:00"
    v = re.sub(r"([+-]\d{2})(\d{2})$", r"\1:\2", v)  # +0530 -> +05:30
    try:
        t = datetime.fromisoformat(v)
    except ValueError:
        return None
    return (t if t.tzinfo else t.replace(tzinfo=UTC)).astimezone(UTC)


class _Head(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.meta: dict[str, str] = {}
        self.title: str | None = None
        self.time: str | None = None
        self.json_ld: list[str] = []
        self._in_title = self._in_ld = False

    def handle_starttag(self, tag, attrs):
        a = {k.lower(): (v or "") for k, v in attrs}
        if tag == "meta":
            key = (
                a.get("property") or a.get("name") or a.get("itemprop") or ""
            ).lower()
            if key and a.get("content") and key not in self.meta:
                self.meta[key] = a["content"]
        elif tag == "title":
            self._in_title = True
        elif tag == "time" and a.get("datetime") and not self.time:
            self.time = a["datetime"]
        elif tag == "script" and a.get("type", "").lower() == "application/ld+json":
            self._in_ld = True
            self.json_ld.append("")

    def handle_endtag(self, tag):
        if tag == "title":
            self._in_title = False
        if tag == "script":
            self._in_ld = False

    def handle_data(self, data):
        if self._in_title and self.title is None and data.strip():
            self.title = data.strip()
        if self._in_ld:
            self.json_ld[-1] += data


def _ld_dates(blobs: list[str]) -> list[str]:
    out = []

    def walk(x):
        if isinstance(x, dict):
            if isinstance(x.get("datePublished"), str):
                out.append(x["datePublished"])
            for v in x.values():
                walk(v)
        elif isinstance(x, list):
            for v in x:
                walk(v)

    for b in blobs:
        try:
            walk(json.loads(b))
        except ValueError:
            continue
    return out


def read_html(url: str, html: str) -> Page:
    p = _Head()
    try:
        p.feed(html)
    except Exception:  # broken HTML: take what was parsed
        pass
    candidates = [*_ld_dates(p.json_ld), *(p.meta[k] for k in DATE_META if k in p.meta)]
    if p.time:
        candidates.append(p.time)
    published = next((t for t in (parse_time(c) for c in candidates) if t), None)
    title = p.meta.get("og:title") or p.meta.get("twitter:title") or p.title
    return Page(
        url=url,
        title=" ".join(title.split()) if title else None,
        published_at=published,
    )


class HttpPages:
    async def __call__(self, url: str) -> Page:
        try:
            async with httpx.AsyncClient(
                timeout=settings.number("PAGE_TIMEOUT_SECONDS"),
                follow_redirects=True,
                headers={"User-Agent": USER_AGENT},
            ) as client:
                async with client.stream("GET", url) as r:
                    if r.status_code >= 400:
                        return Page(
                            url=str(r.url),
                            title=None,
                            published_at=None,
                            error=f"HTTP {r.status_code}",
                        )
                    body = b""
                    async for chunk in r.aiter_bytes():
                        body += chunk
                        if len(body) >= settings.integer("PAGE_MAX_BYTES"):
                            break
                    return read_html(
                        str(r.url), body.decode(r.encoding or "utf-8", errors="replace")
                    )
        except httpx.HTTPError as e:
            return Page(
                url=url, title=None, published_at=None, error=f"{type(e).__name__}: {e}"
            )


PageReader = Callable[[str], Awaitable[Page]]
_reader: PageReader | None = None


def set_reader(reader: PageReader) -> None:
    global _reader
    _reader = reader


def get_reader() -> PageReader:
    global _reader
    if _reader is None:
        _reader = HttpPages()
    return _reader
