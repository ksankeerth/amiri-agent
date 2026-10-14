# ruff: noqa
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

from google.adk.agents import Agent
from google.adk.agents.readonly_context import ReadonlyContext
from google.adk.apps import App
from google.genai import types

from app import settings, verifier, web_search
from app.models import fallback_gemini, model_chain, reviewer_chain, search_chain
from app.prompt import build_instruction
from app.tools import TOOLS

# Each role tries its models in order; if one is busy, slow or out of quota,
# the next takes the call (app/models.py). Change them in .env (app/settings.py).
MODELS = model_chain()
REVIEWER_MODELS = reviewer_chain()  # a stronger model first: it judges every finding
SEARCH_MODELS = search_chain()  # models the key allows Google Search grounding for

web_search.set_searcher(web_search.GoogleSearcher(models=SEARCH_MODELS))
verifier.set_verifier(verifier.GeminiVerifier(models=REVIEWER_MODELS))


def instruction(ctx: ReadonlyContext) -> str:
    return build_instruction(dict(ctx.state))


root_agent = Agent(
    # Keep in sync with agents-cli-manifest.yaml: agents-cli derives this name
    # from the project `name:` recorded there, and telemetry reports it as
    # gen_ai.agent.name. Renaming the agent only here makes the two disagree,
    # and anything selecting traces by name stops finding this agent's.
    name="event_monitor_agent",
    model=fallback_gemini(MODELS),
    instruction=instruction,
    tools=TOOLS,
    generate_content_config=types.GenerateContentConfig(
        temperature=settings.number("AGENT_TEMPERATURE")
    ),
)

app = App(
    root_agent=root_agent,
    name="app",
)
