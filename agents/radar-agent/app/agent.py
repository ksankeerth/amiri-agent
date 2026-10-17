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

"""The judge: one LlmAgent with a structured output and no tools.

The runner (app/judge.py) calls it once per batch of shortlisted stories, each in a fresh session
whose state holds the institution, the batch and the theme vocabulary (app/prompt.py). The model
only categorises and words; every number is code's (app/stories.py).
"""

from typing import Literal

from google.adk.agents import Agent
from google.adk.agents.readonly_context import ReadonlyContext
from google.adk.apps import App
from google.genai import types
from pydantic import BaseModel, Field

from app import settings
from app.models import fallback_gemini, model_chain
from app.prompt import build_instruction


class JudgedTheme(BaseModel):
    theme: str
    direction: str
    item: str | None = None


class Judged(BaseModel):
    key: str = Field(description="The story's key, as given.")
    relevance: Literal["high", "medium", "low"]
    send: bool
    why: str = Field(description="One line: the link to this institution, or why it doesn't matter.")
    title: str = Field(description="One neutral line, English.")
    summary: str = Field(description="1-3 sentences, from the headlines only.")
    themes: list[JudgedTheme] = Field(default_factory=list)
    same_as: str | None = Field(None, description="A remembered fingerprint: this IS that story.")
    continues: str | None = Field(None, description="A remembered fingerprint: a new development of it.")


class Judgements(BaseModel):
    stories: list[Judged]


def instruction(ctx: ReadonlyContext) -> str:
    return build_instruction(dict(ctx.state))


root_agent = Agent(
    # Keep in sync with agents-cli-manifest.yaml: agents-cli derives this name
    # from the project `name:` recorded there, and telemetry reports it as
    # gen_ai.agent.name.
    name="radar_agent",
    model=fallback_gemini(model_chain()),
    instruction=instruction,
    output_schema=Judgements,
    output_key="judgements",
    generate_content_config=types.GenerateContentConfig(temperature=settings.number("AGENT_TEMPERATURE")),
)

app = App(root_agent=root_agent, name="app")
