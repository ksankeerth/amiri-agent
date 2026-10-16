"""Web search backend: Gemini with Google Search grounding.

The agent's web_search tool (app/tools.py) does the gating; this module only
runs a search and returns the answer text plus the grounding sources.
"""

import asyncio
from collections.abc import Awaitable, Callable

import httpx
from google import genai
from google.genai import types

from app import models, settings

Searcher = Callable[[str, str, str], Awaitable[dict]]

_PROMPT = """Search the web for news about:
{query}

Look for news published between {since} and {until} (UTC). List each relevant result with its
publication date and a one-sentence summary, including results whose date you are unsure of: the dates
are checked afterwards. Say "No results" only if you find nothing relevant at all."""


class SearchUnavailable(RuntimeError):
    """Every search of a check failed (quota, outage): the check read nothing, so it fails
    rather than report "nothing new", and the next check reads the same window again."""


class GoogleSearcher:
    """Searches with the first of `models` that answers (app/models.py)."""

    def __init__(self, models: list[str], timeout: float | None = None):
        self.models = models
        self.timeout = timeout  # per model; SEARCH_TIMEOUT_SECONDS if None
        self._client: genai.Client | None = None

    async def __call__(self, query: str, since: str, until: str) -> dict:
        if self._client is None:
            self._client = genai.Client(
                http_options=types.HttpOptions(retry_options=models.RETRY)
            )
        response, _ = await models.generate_content(
            self._client,
            self.models,
            contents=_PROMPT.format(query=query, since=since, until=until),
            config=types.GenerateContentConfig(
                tools=[types.Tool(google_search=types.GoogleSearch())], temperature=0
            ),
            timeout=self.timeout or settings.number("SEARCH_TIMEOUT_SECONDS"),
        )
        candidate = response.candidates[0] if response.candidates else None
        metadata = candidate.grounding_metadata if candidate else None
        chunks = (metadata.grounding_chunks if metadata else None) or []
        sources = [
            {"url": c.web.uri, "title": c.web.title}
            for c in chunks
            if c.web and c.web.uri
        ]
        sources = await _resolve_redirects(sources)
        return {"answer": response.text or "", "sources": sources}


async def _resolve_redirects(sources: list[dict]) -> list[dict]:
    """Grounding links are redirects; resolve them to the article's own URL where possible."""

    async def resolve(client: httpx.AsyncClient, url: str) -> str:
        try:
            r = await client.head(url, follow_redirects=True)
            return str(r.url)
        except httpx.HTTPError:
            return url

    async with httpx.AsyncClient(timeout=5.0) as client:
        urls = await asyncio.gather(*(resolve(client, s["url"]) for s in sources))
    return [{**s, "url": u} for s, u in zip(sources, urls, strict=True)]


_searcher: Searcher | None = None


def set_searcher(searcher: Searcher) -> None:
    global _searcher
    _searcher = searcher


def get_searcher() -> Searcher:
    if _searcher is None:
        raise RuntimeError("no web searcher configured")
    return _searcher
