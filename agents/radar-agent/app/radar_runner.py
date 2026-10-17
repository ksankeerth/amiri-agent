"""One Radar run: a code pipeline with one model step.

query GDELT (or read the simulation's provided news) -> clean and dedupe -> group into stories ->
score and shortlist -> the judge, in batches, within the model-call limits -> check its picks and
score -> cut to max_stories -> remember. A cost guard that refuses the query fails the run with a
plain error; running out of model calls or time stops it early with what was judged.
"""

import asyncio
import logging
import time
from dataclasses import dataclass

from app import settings
from app.articles import dedupe, from_provided, from_row
from app.bq import BigQuery, BudgetSpent, cap
from app.contract import Query, RadarRunRequest, RadarRunResult, Usage
from app.geo import places
from app.judge import Ask, adk_ask, judge
from app.memory import Memory
from app.queries import plan
from app.stories import finish, group, shortlist, to_story, unjudged

log = logging.getLogger(__name__)
NOT_JUDGED = "Not judged: Radar's daily model allowance is spent, so it's held back for now."


class RunFailed(Exception):
    """Nothing useful can come back; the message is the run's error, for a person."""


@dataclass
class Deps:
    bq: BigQuery
    memory: Memory
    ask: Ask = adk_ask


async def run_radar(req: RadarRunRequest, deps: Deps) -> RadarRunResult:
    started = time.monotonic()
    queries: list[Query] = []
    if req.provided_news is not None:  # a simulation: these headlines only, no BigQuery
        p = places(req.institution.country, list(req.scope.places), dict(req.scope.places_why))
        articles = [from_provided(item, p) for item in req.provided_news]
    else:
        q, p = plan(req)
        try:
            ran = await asyncio.to_thread(deps.bq.run, q.sql, q.params, cap(req.limits.max_bytes_per_query))
        except BudgetSpent as e:
            raise RunFailed(f"Radar didn't read the news: {e}.") from e
        except Exception as e:
            log.exception("bigquery failed for run %s", req.run_id)
            raise RunFailed(f"Reading the news failed ({type(e).__name__}); Radar tries again at the next run.") from e
        queries.append(Query(name=q.name, purpose=q.purpose, bytes_processed=ran.bytes_processed, rows=len(ran.rows),
                             cached=ran.cached))
        articles = [a for a in (from_row(r, p) for r in ran.rows) if a is not None]
    considered = len(articles)
    cands = group(dedupe(articles))
    short = shortlist(cands, req, deps.memory.recall(req.institution.name))

    stop = "finished"
    left_today = settings.integer("MODEL_CALLS_PER_DAY") - deps.memory.calls_today()
    calls_left = min(req.limits.max_model_calls, left_today)
    model, calls, tokens_in, tokens_out = "", 0, 0, 0
    if calls_left <= 0:
        judgements = {c.key: unjudged(c, NOT_JUDGED) for c in short}
    else:
        remaining = req.limits.timeout_seconds - (time.monotonic() - started) - 5
        try:
            async with asyncio.timeout(max(1.0, remaining)):
                j = await judge(short, req, calls_left, deps.ask, deps.memory.add_call)
            judgements, model, calls = j.judgements, j.model, j.calls
            tokens_in, tokens_out = j.input_tokens, j.output_tokens
            if j.call_limit:
                stop = "call_limit"
        except TimeoutError:
            stop, judgements = "timeout", {}
    picked = [(c, to_story(c, judgements[c.key], req)) for c in short if c.key in judgements]
    stories = finish([s for _, s in picked], req.limits.max_stories)
    kept = {s.fingerprint for s in stories}
    for c, s in picked:
        if s.fingerprint in kept:
            deps.memory.remember(req.institution.name, s.fingerprint, s.title, set(s.places), c.terms)
    usage = Usage(model=model or (settings.names("AGENT_MODELS") or ["none"])[0], model_calls=calls,
                  input_tokens=tokens_in, output_tokens=tokens_out, duration_ms=int((time.monotonic() - started) * 1000))
    log.info("radar %s %s: %d articles, %d candidates, %d shortlisted, %d stories (%d sent), %d model calls",
             req.run_id, stop, considered, len(cands), len(short), len(stories), sum(s.send for s in stories), calls)
    return RadarRunResult(stories=stories, queries=queries, bytes_processed=sum(x.bytes_processed for x in queries),
                          considered=considered, shortlisted=len(short), stop_reason=stop, usage=usage)
