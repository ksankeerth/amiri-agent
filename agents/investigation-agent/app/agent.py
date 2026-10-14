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

"""The investigation agent: a custom ADK agent that runs fixed steps in code.

Unlike a tool-calling LlmAgent, it follows the investigation tracks: code lists
every candidate and builds every task, and the model only makes small choices,
each one structured call constrained to the valid options (app/investigate.py,
app/steps.py). It reads the request from session state ("request") and writes
the result to session state ("result").
"""

from collections.abc import AsyncGenerator
from typing import Any

from google.adk.agents import BaseAgent
from google.adk.agents.invocation_context import InvocationContext
from google.adk.apps import App
from google.adk.events import Event, EventActions
from google.genai import types

from app.contract import InvestigationRequest
from app.investigate import Investigation
from app.data_client import HttpData
from app.steps import GeminiSteps

STATE_REQUEST = "request"
STATE_RESULT = "result"


class InvestigationAgent(BaseAgent):
    llm: Any = None  # app.steps.Llm; GeminiSteps on AGENT_MODELS by default
    data: Any = None  # app.data_client.Data; HttpData by default

    async def _run_async_impl(
        self, ctx: InvocationContext
    ) -> AsyncGenerator[Event, None]:
        body = ctx.session.state.get(STATE_REQUEST)
        if not body:
            yield Event(
                author=self.name,
                invocation_id=ctx.invocation_id,
                content=types.Content(
                    role="model",
                    parts=[
                        types.Part(
                            text="Start an investigation with POST /investigations."
                        )
                    ],
                ),
            )
            return
        req = InvestigationRequest.model_validate(body)
        investigation = Investigation(
            req, self.llm or GeminiSteps(), self.data or HttpData()
        )
        result = await investigation.run()
        yield Event(
            author=self.name,
            invocation_id=ctx.invocation_id,
            actions=EventActions(
                state_delta={
                    STATE_RESULT: result.model_dump(mode="json", by_alias=True)
                }
            ),
        )


root_agent = InvestigationAgent(
    # Keep in sync with agents-cli-manifest.yaml: agents-cli derives this name
    # from the project `name:` recorded there, and telemetry reports it as
    # gen_ai.agent.name. Renaming the agent only here makes the two disagree,
    # and anything selecting traces by name stops finding this agent's.
    name="investigation_agent",
    description="Turns findings into hypotheses and validation tasks.",
)

app = App(
    root_agent=root_agent,
    name="app",
)
