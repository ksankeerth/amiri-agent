"""This agent's contract models match the server's (server/contracts/setup-agent-openapi.yaml)."""

from pathlib import Path

import yaml

from app import contract

YAML = Path(__file__).resolve().parents[4] / "server" / "contracts" / "setup-agent-openapi.yaml"


def test_tracks_and_events_match_the_server():
    spec = yaml.safe_load(YAML.read_text())
    schemas = spec["components"]["schemas"]
    tracks = set(schemas["TrackEv"]["properties"]["track"]["enum"])
    assert tracks == set(contract.TRACK_IDS)
    for name in ("MessageEv", "TextDeltaEv", "QuestionEv", "TrackEv", "TrackNotesEv", "TrackConcludedEv", "ProposalEv",
                 "UsageEv", "ErrorEv", "TurnIn", "AgentSessionIn", "AgentSessionOut", "Answer", "Note"):
        mine = getattr(contract, name).model_json_schema()
        assert set(mine["properties"]) == set(schemas[name]["properties"]), name
        assert set(mine.get("required", [])) == set(schemas[name].get("required", [])), name
