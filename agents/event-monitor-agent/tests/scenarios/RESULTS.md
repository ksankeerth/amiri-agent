# Monitor check scenarios, live

Run 2026-10-12 18:42 UTC · agent gemini-3.5-flash-lite, gemini-3.1-flash-lite · reviewer gemini-3.8-flash, gemini-3.7-flash, gemini-3.5-flash, gemini-3.1-flash-lite · 1 round(s) · web search and pages stubbed with each scenario's sources · `uv run python -m tests.scenarios.run`

**6/6 passed.**

| Scenario | About | Passed | Failed checks |
|---|---|---|---|
| `quota_cut` | Saudi Arabia cuts foreign-worker quotas: line 2, one dated page; an old and an off-topic page. | 1/1 |  |
| `quiet` | Gulf business news, nothing that meets a line. | 1/1 |  |
| `undated_only` | The only matching page has no date: nothing can be reported. | 1/1 |  |
| `confused_name` | A rival monitor: news about a different company with a similar name is not a match. | 1/1 |  |
| `ph_tagalog` | A Philippine bank's Gulf-jobs monitor: a Tagalog headline about Saudi job cuts. | 1/1 |  |
| `id_flood` | An Indonesian insurer's flood monitor: Bahasa and English pages; the old flood is not reported. | 1/1 |  |

Earlier results (contract 1.x, feed store, 9 Oct 2026) are in git history: this contract replaced
feeds and signals with web search only.
