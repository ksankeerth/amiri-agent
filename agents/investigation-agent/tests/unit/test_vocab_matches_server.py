"""The agent's theme vocabulary is the server's (server/app/reference/themes.json), item for item.

If the two ever differ, every finding with the extra theme, direction or item is refused, or cleaned away, at the
boundary. This test makes that change visible in both places at once."""

import json
from pathlib import Path

from app.vocab import ITEMS, THEME_DIRECTIONS

SERVER = json.loads((Path(__file__).parents[4] / "server" / "app" / "reference" / "themes.json").read_text())
SERVER = SERVER.get("themes", SERVER)


def test_the_same_themes_directions_and_items_as_the_server():
    assert set(THEME_DIRECTIONS) == set(SERVER)
    for theme, spec in SERVER.items():
        assert set(THEME_DIRECTIONS[theme]) == set(spec["directions"]), theme
        assert set(ITEMS.get(theme, ())) == set(spec.get("items", [])), theme
