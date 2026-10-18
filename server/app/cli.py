"""amiri: the server's command line.

    uv run amiri serve            # the API on SERVER_PORT (default 8000)
    uv run amiri migrate          # apply database migrations
    uv run amiri tick             # run one tick (what Cloud Scheduler does every 15 min)
    uv run amiri seed-series      # watch a demo's series (--institution bank: USD/LKR, AED/LKR, gold, Brent;
                                  #   insurer: USD/IDR, MSCI Indonesia, Brent, EUR/USD)
    uv run amiri seed-institution # a demo's profile (--institution bank: Serendib Commercial Bank, Sri Lanka;
                                  #   insurer: Samudra Raya General Insurance, Indonesia), both invented
    uv run amiri demo-export      # write the repository's demo/ folder from the demo profiles
    uv run amiri spec-sync        # refresh the Metrics Spec snapshot from its source file (metrics-spec-v1.0.yaml)
    uv run amiri spec-pdf         # write the spec's PDF from its print page (needs web/dist and the dev dependencies)
    uv run amiri ref-load         # load reference data into the ref tables now (also done at start-up)
    uv run amiri fake-agent       # a fake setup agent on :8003 (contract 1.0); then ASSISTANT_BACKEND=http
    uv run amiri agent-contract   # write contracts/setup-agent-openapi.yaml
    uv run amiri agent-check --url http://localhost:8003     # conformance check of a setup agent
    uv run amiri scenarios --server http://localhost:8000    # play the scenario catalogue through the server
    uv run amiri env-example      # rewrite .env.example from app/settings.py
    uv run amiri openapi          # write openapi.yaml from the code
    uv run amiri radar-fake       # a fake Radar agent on :8005 (contract 2.0); then RADAR_URL=http://localhost:8005
    uv run amiri radar-contract   # write contracts/radar-agent-openapi.yaml
    uv run amiri radar-check --url http://localhost:8006   # conformance check of a Radar agent
"""

import argparse
import asyncio
import json
import sys
from pathlib import Path

from app import db, settings


async def _migrate() -> None:
    pool = db.make_pool()
    await pool.open(wait=True)
    async with pool.connection() as conn:
        print("applied:", await db.migrate(conn) or "nothing (up to date)")
    await pool.close()


async def _ref_load() -> None:
    from app.reference import load

    pool = db.make_pool()
    await pool.open(wait=True)
    async with pool.connection() as conn:
        await db.migrate(conn)
        out = await load.load(conn, force=True)
    await pool.close()
    print(json.dumps(out, indent=1))


async def _with_app(fn):
    from app.main import create_app

    app = create_app()
    async with app.router.lifespan_context(app):
        return await fn(app)


async def _tick() -> None:
    from app.tick import run_tick

    print(json.dumps(await _with_app(run_tick), indent=2, default=str))


async def _seed(kind: str) -> None:
    from app import demo
    from app.problems import Problem

    async def go(app):
        for s in demo.SERIES[kind]:
            try:
                out = await app.state.series.create(s)
                print(f"added {out['series_id']}: {out['state']} ({out['state_reason']})")
            except Problem as e:
                print(f"{s['symbol']}: {e.code}: {e.detail} {e.extra.get('provider_message') or ''}")

    await _with_app(go)


async def _seed_institution(kind: str) -> None:
    from app import demo
    from app.institutions.schemas import InstitutionCreate
    from app.problems import Problem

    doc = demo.profile(kind)
    body = {k: v for k, v in doc["institution"].items() if k != "institution_id"}

    async def go(app):
        try:
            out = await app.state.institutions.create(InstitutionCreate(**body, institution_id=settings.raw("INSTITUTION_ID")),
                                                      "seed", "import", doc["sections"])
            print(f"added {out['institution_id']}: {out['counts']}")
        except Problem as e:
            print(f"{e.code}: {e.detail}", json.dumps(e.extra.get("errors", []), indent=1)[:2000])

    await _with_app(go)


def _openapi() -> None:
    import yaml  # type: ignore[import-not-found]

    from app.main import create_app

    (settings.PROJECT / "openapi.yaml").write_text(
        yaml.safe_dump(create_app().openapi(), sort_keys=False, allow_unicode=True)
    )
    print("wrote openapi.yaml")


def main() -> None:
    p = argparse.ArgumentParser(prog="amiri", description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("command", choices=["serve", "migrate", "tick", "seed-series", "seed-institution", "demo-export", "spec-sync", "spec-pdf", "ref-load",
                                       "coverage",
                                       "fake-agent", "agent-contract", "agent-check", "scenarios", "env-example", "openapi",
                                       "radar-fake", "radar-contract", "radar-check"])
    p.add_argument("--url", default="http://localhost:8003", help="agent-check: the setup agent's base URL")
    p.add_argument("--server", default="http://localhost:8000", help="scenarios: the server's base URL")
    p.add_argument("--only", default="", help="scenarios: comma-separated ids (S01,S07)")
    p.add_argument("--out", default="", help="agent-check, scenarios: also write the results as JSON here")
    p.add_argument("--port", type=int, default=8003, help="fake-agent: port")
    p.add_argument("--institution", choices=["bank", "insurer"], default="bank",
                   help="seed-series, seed-institution: which demo")
    p.add_argument("--profile", default="", help="coverage: a profile file ({institution, sections}, as for import)")
    a = p.parse_args()
    if a.command == "serve":
        import uvicorn

        uvicorn.run("app.main:app", host="0.0.0.0", port=settings.integer("SERVER_PORT"))
    elif a.command == "migrate":
        asyncio.run(_migrate())
    elif a.command == "tick":
        asyncio.run(_tick())
    elif a.command == "seed-series":
        asyncio.run(_seed(a.institution))
    elif a.command == "seed-institution":
        asyncio.run(_seed_institution(a.institution))
    elif a.command == "demo-export":
        from app import demo_export

        print(demo_export.write(demo_export.REPO / "demo"))
    elif a.command == "fake-agent":
        import uvicorn

        from app.assistant.fake_agent import create_fake_agent

        uvicorn.run(create_fake_agent(), host="0.0.0.0", port=a.port)
    elif a.command == "coverage":
        # What /internal/coverage answers for a profile, without a database (fixtures for the agent's tests).
        from app.institutions.rules import Item, State
        from app.investigation.coverage import coverage

        doc = json.loads(Path(a.profile).read_text())
        state = State(inst={"fields": doc["institution"]},
                      items={k: {str(i): Item(data=v) for i, v in enumerate(vals)} for k, vals in doc["sections"].items()})
        for k, items in list(state.items.items()):  # ids as the profile gives them
            state.items[k] = {(it.data.get("id") or i): it for i, it in items.items()}
        text = json.dumps(coverage(state), indent=1, ensure_ascii=False, default=str) + "\n"
        if a.out:
            Path(a.out).write_text(text)
        else:
            print(text)
    elif a.command == "radar-fake":
        import uvicorn

        from app.radar.fake_agent import create_fake_agent as fake_radar

        uvicorn.run(fake_radar(), host="0.0.0.0", port=a.port if a.port != 8003 else 8005)
    elif a.command == "radar-check":
        from app.radar import check as rcheck

        async def go():
            res = await rcheck.Checker(a.url if a.url != "http://localhost:8003" else "http://localhost:8006").run()
            print(rcheck.report(res))
            return sum(1 for r in res if not r.ok)

        sys.exit(asyncio.run(go()))
    elif a.command == "radar-contract":
        import yaml  # type: ignore[import-not-found]

        from app.radar.fake_agent import contract_openapi as radar_openapi

        out = settings.PROJECT / "contracts" / "radar-agent-openapi.yaml"
        out.parent.mkdir(exist_ok=True)
        out.write_text(yaml.safe_dump(radar_openapi(), sort_keys=False, allow_unicode=True))
        print("wrote", out)
    elif a.command == "agent-contract":
        import yaml  # type: ignore[import-not-found]

        from app.assistant.fake_agent import contract_openapi

        out = settings.PROJECT / "contracts" / "setup-agent-openapi.yaml"
        out.parent.mkdir(exist_ok=True)
        out.write_text(yaml.safe_dump(contract_openapi(), sort_keys=False, allow_unicode=True))
        print("wrote", out)
    elif a.command == "agent-check":
        from app.assistant import agent_check

        async def go():
            return await agent_check.Checker(a.url).run()

        results = asyncio.run(go())
        print(agent_check.report(results))
        if a.out:
            Path(a.out).write_text(agent_check.to_json(results))
        sys.exit(sum(1 for r in results if not r.ok))
    elif a.command == "scenarios":
        from app.assistant import scenarios

        results = asyncio.run(scenarios.run(a.server, [x for x in a.only.split(",") if x] or None))
        print(scenarios.summary(results))
        if a.out:
            Path(a.out).write_text(json.dumps(results, indent=1, default=str))
    elif a.command == "ref-load":
        asyncio.run(_ref_load())
    elif a.command == "spec-sync":
        from app import spec

        if not spec.SOURCE.exists():
            sys.exit(f"The Metrics Spec source isn't in this checkout ({spec.SOURCE.name}); the snapshot in app/spec is used.")
        print("spec", spec.sync()["spec_version"], "->", spec.SNAPSHOT)
    elif a.command == "spec-pdf":
        from app.spec import pdf

        print("wrote", asyncio.run(pdf.make()))
    elif a.command == "env-example":
        (settings.PROJECT / ".env.example").write_text(settings.env_example() + "\n")
        print("wrote .env.example")
    elif a.command == "openapi":
        _openapi()
    else:
        sys.exit(2)


if __name__ == "__main__":
    main()
