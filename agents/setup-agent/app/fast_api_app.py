# Copyright 2026 Google LLC
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     https://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

import contextlib
import logging
import os
from collections.abc import AsyncIterator

from a2a.server.tasks import InMemoryTaskStore
from dotenv import load_dotenv
from fastapi import FastAPI
from google.adk.cli.fast_api import get_fast_api_app
from google.adk.runners import Runner

from app import settings, turn_api
from app.app_utils import services
from app.app_utils.a2a import attach_a2a_routes
from app.contract import CONTRACT_VERSION, HEADER
from app.sessions import SessionStore

load_dotenv()
logger = logging.getLogger(__name__)

if settings.raw("MODEL_MIN_INTERVAL_SECONDS"):
    # Development only: devtools/ is not in the Docker image.
    try:
        from devtools import pacing

        pacing.install()
        logger.warning("development pacing on: %ss between model requests", pacing.spacer.interval)
    except ImportError:
        logger.warning("MODEL_MIN_INTERVAL_SECONDS is set but devtools/ is absent; ignored")
allow_origins = settings.names("ALLOW_ORIGINS") or None
# Cloud Trace export needs Google Cloud credentials: on by default on Cloud Run
# (K_SERVICE is set there), off locally where an API key may be all there is.
otel_to_cloud = settings.flag("OTEL_TO_CLOUD")
if otel_to_cloud is None:
    otel_to_cloud = bool(os.getenv("K_SERVICE"))

AGENT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


@contextlib.asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    from app.agent import app as adk_app
    from app.agent import root_agent

    runner = Runner(
        app=adk_app,
        session_service=services.get_session_service(),
        artifact_service=services.get_artifact_service(),
        auto_create_session=True,
    )
    app.state.runner = runner
    logger.info("settings: %s", settings.current())
    app.state.sessions = SessionStore()
    from app import engine, track_loop

    engine.set_responder(track_loop.respond)
    app.state.agent_app_name = adk_app.name
    await attach_a2a_routes(
        app,
        agent=root_agent,
        runner=runner,
        task_store=InMemoryTaskStore(),
        rpc_path=f"/a2a/{adk_app.name}",
    )
    yield


app: FastAPI = get_fast_api_app(
    agents_dir=AGENT_DIR,
    web=True,
    artifact_service_uri=services.ARTIFACT_SERVICE_URI,
    allow_origins=allow_origins,
    session_service_uri=services.SESSION_SERVICE_URI,
    otel_to_cloud=otel_to_cloud,
    lifespan=lifespan,
)
app.title = "setup-agent"
app.description = "amiri-setup-agent: the setup chat's agent (contract 1.0, app/contract.py)"
app.include_router(turn_api.router)  # POST /sessions, POST /sessions/{id}/turns, GET /health/details


@app.middleware("http")
async def contract_header(request, call_next):
    """Every answer carries the contract version (X-Amiri-Contract: 1.0)."""
    response = await call_next(request)
    response.headers[HEADER] = CONTRACT_VERSION
    return response


# Main execution
if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000)
