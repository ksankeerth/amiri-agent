"""get_field_rules hands the model schemas with no "$ref" left (Gemini refuses a tool result that has one)."""

import json

from app.tools import inline_refs

FLOWS = {  # the shape Pydantic gives the server's flows schema
    "$defs": {
        "Money": {"properties": {"amount": {"type": "number"}, "currency": {"type": "string"}}, "type": "object"},
        "FlowValue": {"properties": {"amount": {"type": "number"}, "money": {"$ref": "#/$defs/Money"}}, "type": "object"},
        "FlowSource": {"properties": {"kind": {"enum": ["dataset", "user"]}}, "type": "object"},
    },
    "properties": {
        "value": {"anyOf": [{"$ref": "#/$defs/FlowValue"}, {"type": "null"}], "default": None},
        "source": {"$ref": "#/$defs/FlowSource", "description": "Where the figure comes from."},
        "segments": {"items": {"type": "string"}, "type": "array"},
    },
    "type": "object",
}


def test_refs_are_inlined_and_defs_dropped():
    out = inline_refs(FLOWS)
    text = json.dumps(out)
    assert "$ref" not in text and "$defs" not in text
    assert out["properties"]["value"]["anyOf"][0]["properties"]["money"]["properties"]["currency"] == {"type": "string"}
    # what sat beside the $ref is kept
    assert out["properties"]["source"]["description"] == "Where the figure comes from."
    assert out["properties"]["source"]["properties"]["kind"]["enum"] == ["dataset", "user"]
    assert FLOWS["properties"]["source"]["$ref"] == "#/$defs/FlowSource"  # the cached schema is left as it was


def test_a_self_referencing_type_stops():
    tree = {"$defs": {"Node": {"properties": {"child": {"$ref": "#/$defs/Node"}}}}, "$ref": "#/$defs/Node"}
    assert "$ref" not in json.dumps(inline_refs(tree))
