"""A fake Radar agent that implements the contract (app/radar/contract.py). No model, no BigQuery.

    uv run amiri radar-fake            # http://localhost:8005; then RADAR_URL=http://localhost:8005

It makes a few plausible stories from the request's own scope (a corridor's jobs, a rival's
fees, the home central bank), so the server and the web app work before the real agent exists.
Tests script exact stories (`FakeRadar.script`), or read `provided_news`.
"""

import hashlib
import json

import httpx
from fastapi import FastAPI, Request, Response
from pydantic import ValidationError

from app import reference
from app.radar.contract import CONTRACT_VERSION, RadarRunRequest, RadarRunStatus

CREATED = "2026-10-07T00:00:00Z"


def _fp(*parts: str) -> str:
    return "fake-" + hashlib.sha1("|".join(parts).encode()).hexdigest()[:12]


class FakeRadar:
    def __init__(self, canned: bool = True) -> None:
        self.canned = canned  # make up stories from the scope (the standalone fake); tests script theirs
        self.requests: list[dict] = []
        self.runs: dict[str, dict] = {}
        self.script: list[list[dict]] = []  # the next runs' stories, in order
        self.fail_next: list[int] = []  # HTTP statuses to answer POSTs with
        self.pending = False  # GET answers "running"
        self.fail_run = False  # GET answers "failed"
        self.forget: set[str] = set()  # run_ids GET answers 404 for, once
        self.bytes_per_run = 1_200_000_000

    def stories(self, req: dict) -> list[dict]:
        if self.script:
            return self.script.pop(0)
        until = req["window"]["until"]
        if not self.canned and not req.get("provided_news"):
            return []
        if req.get("provided_news"):
            return [{"fingerprint": _fp(n["id"]), "title": n["title"], "summary": n.get("body") or n["title"],
                     "places": n.get("places") or [], "relevance": "high", "score": 70, "publishers": 1,
                     "headlines": [{"title": n["title"], "outlet": n.get("outlet"), "published_at": n["published_at"]}],
                     "send": True, "why": "A simulation's headline."} for n in req["provided_news"]]
        inst, scope = req["institution"], req["scope"]
        home = inst["country"]
        country = inst.get("country_name") or reference.place_name(home) or home
        day = until[:10]
        out = []
        corridor = next((c for c in inst.get("corridors") or [] if c != home), None)
        if corridor:
            cname = reference.place_name(corridor) or corridor
            out.append(("jobs", f"{cname} tightens visa renewals for foreign workers",
                        f"{cname} will require new sponsorship for visa renewals; workers from {country} are among the largest groups.",
                        [corridor, home], [{"theme": "remittance", "direction": "down"}], "high", 72, 6,
                        f"Remittances from {cname} fund your customers' deposits."))
        rival = next(iter(inst.get("rivals") or []), None)
        if rival:
            out.append(("rival", f"{rival['name']} cuts transfer fees to zero until year-end",
                        f"{rival['name']} removed fees on transfers to {country}.", [home],
                        [{"theme": "competitor", "direction": "cheaper"}], "medium", 61, 3,
                        f"{rival['name']} is one of your rivals."))
        regs = list(inst.get("regulators") or [])
        bank = regs[0]["name"] if regs else f"The central bank of {country}"
        out.append(("cb", f"{bank} keeps its policy rate unchanged",
                    f"{bank} held rates and said it would watch inflation.", [home],
                    [{"theme": "rates", "direction": "up"}], "low", 38, 2, "Routine: no change for your products."))
        if "sea:red-sea" in scope["places"] or "chk:bab-el-mandeb" in scope["places"]:
            out.append(("ship", "Container lines divert ships around the Cape after a Red Sea attack",
                        "Two lines re-routed services after an attack near Bab-el-Mandeb.", ["sea:red-sea"],
                        [{"theme": "sector", "direction": "shock"}], "medium", 46, 9,
                        "Your exporters' goods take this route; below the line for now."))
        return [{"fingerprint": _fp(k, inst["name"], day), "title": t, "summary": s, "places": [p for p in pl if p],
                 "themes": th, "relevance": rel, "score": sc, "publishers": pub,
                 "headlines": [{"title": t, "outlet": "example-news.com", "url": f"https://example-news.com/{k}/{day}",
                                "published_at": until}], "send": sc >= 60, "why": why}
                for k, t, s, pl, th, rel, sc, pub, why in out][: req["limits"]["max_stories"]]

    def status(self, run_id: str) -> dict:
        req = self.runs[run_id]
        if self.pending:
            return {"run_id": run_id, "status": "running", "created_at": CREATED, "started_at": CREATED}
        if self.fail_run:
            return {"run_id": run_id, "status": "failed", "created_at": CREATED, "finished_at": CREATED,
                    "error": "BigQuery: the query would scan more than maximum_bytes_billed."}
        scripted = bool(self.script)
        stories = self.stories(req)
        sim = bool(req.get("provided_news"))  # a simulation reads its headlines: no BigQuery
        result = {"stories": stories, "considered": 40 * max(1, len(stories)), "shortlisted": len(stories),
                  "queries": [] if sim else [{"name": "gdelt-gkg-places", "purpose": "articles naming the scope's places",
                                              "bytes_processed": self.bytes_per_run, "rows": 380, "cached": False}],
                  "bytes_processed": 0 if sim else self.bytes_per_run, "stop_reason": "finished",
                  "usage": {"model": "fake", "model_calls": len(stories), "duration_ms": 5}}
        body = {"run_id": run_id, "status": "completed", "created_at": CREATED, "started_at": CREATED,
                "finished_at": CREATED, "result": result}
        if not scripted:  # what it makes up keeps to the contract; a test may script a broken answer on purpose
            RadarRunStatus.model_validate(body)
        return body

    def handler(self, request: httpx.Request) -> httpx.Response:
        if request.method == "POST":
            if self.fail_next:
                return httpx.Response(self.fail_next.pop(0), json={"error": "scripted failure"})
            body = json.loads(request.content)
            try:
                RadarRunRequest.model_validate(body)
            except ValidationError as e:
                return httpx.Response(422, json={"detail": e.errors(include_url=False, include_context=False)})
            self.requests.append(body)
            self.runs[body["run_id"]] = body
            return httpx.Response(202, json={"run_id": body["run_id"], "status": "queued", "created_at": CREATED})
        run_id = request.url.path.rsplit("/", 1)[-1]
        if run_id in self.forget:
            self.forget.discard(run_id)
            self.runs.pop(run_id, None)
        if run_id not in self.runs:
            return httpx.Response(404, json={"error": f"no run {run_id}"})
        return httpx.Response(200, json=self.status(run_id))


def create_fake_agent() -> FastAPI:
    fake = FakeRadar()
    app = FastAPI(title="amiri-radar (fake)", description=f"Implements the Radar agent contract {CONTRACT_VERSION} without a model.")

    @app.get("/health")
    async def health():
        return {"status": "ok"}

    @app.api_route("/radar-runs", methods=["POST"])
    @app.api_route("/radar-runs/{run_id}", methods=["GET"])
    async def runs(request: Request, run_id: str | None = None):
        r = fake.handler(httpx.Request(request.method, str(request.url), content=await request.body()))
        return Response(r.content, status_code=r.status_code, media_type="application/json")

    app.state.fake = fake
    return app


def contract_openapi() -> dict:
    """The contract as OpenAPI 3.1, for whoever builds the agent."""
    from fastapi.openapi.utils import get_openapi

    from app.radar import contract as c

    api = FastAPI()

    @api.post("/radar-runs", status_code=202, response_model=c.RadarRunStatus, summary="Start a run")
    async def start(body: c.RadarRunRequest):
        ...

    @api.get("/radar-runs/{run_id}", response_model=c.RadarRunStatus, summary="A run's status; its result when finished")
    async def get(run_id: str):
        ...

    @api.get("/health", summary="Liveness")
    async def health():
        ...

    spec = get_openapi(title="Amiri Agent Radar agent contract", version=c.CONTRACT_VERSION, routes=api.routes,
                       description=(c.__doc__ or "").strip())
    return spec

