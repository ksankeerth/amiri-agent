"""The ADK app (agents-cli playground, A2A). The setup chat itself runs through the
contract's endpoints (app/turn_api.py): the router, then one agent per track
(app/track_loop.py). This root agent is the general one the playground talks to."""

from google.adk.agents import Agent
from google.adk.apps import App

from app.models import fallback_gemini

root_agent = Agent(
    # Keep in sync with agents-cli-manifest.yaml (root_agent_name); telemetry reports it.
    name="setup_agent",
    model=fallback_gemini(),
    instruction=(
        "You are Amiri Agent's setup agent. You help a bank or insurer describe itself so Amiri Agent can watch the "
        "world for it. In this playground you only explain what the setup covers: the institution, "
        "where it operates and its flows, customers and products, rules, rivals and partners, risks and "
        "monitors. You change nothing here; the setup chat in the web app makes proposals the user confirms."
    ),
)

app = App(root_agent=root_agent, name="app")
