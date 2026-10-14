"""Examples for openapi.yaml (scripts/write_openapi.py) and the tests: a Sri Lankan bank's
"Gulf jobs" monitor, checked by web search."""

REQUEST = {
    "run_id": "chk-mon-gulf-jobs-20261012-1000",
    "monitor": {
        "monitor_id": "mon-gulf-jobs",
        "version": 3,
        "spec": {
            "about": {
                "name": "Gulf jobs and security",
                "owner": "Retail banking",
                "also_notify": ["Treasury"],
                "check_frequency": 60,
                "kind": "events",
                "key_dates": [
                    {
                        "date": "2026-11-01",
                        "label": "Saudi labour quota rules take effect",
                        "lead_days": 7,
                    }
                ],
                "review_by": "2027-01-31",
            },
            "public": {
                "watch": [
                    {
                        "name": "Saudi Arabia",
                        "type": "place",
                        "other_forms": ["KSA", "Saudi"],
                        "not_confused_with": [],
                    },
                    {
                        "name": "United Arab Emirates",
                        "type": "place",
                        "other_forms": ["UAE", "Dubai"],
                        "not_confused_with": [],
                    },
                    {
                        "name": "migrant workers",
                        "type": "topic",
                        "other_forms": ["foreign workers", "expatriate workers"],
                        "not_confused_with": [],
                    },
                ],
                "in_one_sentence": "Events in the Gulf that could cut jobs or pay for Sri Lankan and Indian migrant workers.",
                "tell_me_if": [
                    "Conflict or attacks affect a Gulf state where many South Asian migrants work",
                    "A Gulf state announces job cuts, visa limits or wage controls for foreign workers",
                    "Flights or money-transfer channels from the Gulf are disrupted",
                ],
                "ignore": ["Routine labour statistics with no change"],
                "example_headlines": {
                    "match": [
                        {
                            "headline": "Saudi Arabia cuts foreign worker quotas in construction",
                            "line": 2,
                        }
                    ],
                    "not_match": ["Saudi Aramco reports quarterly profit"],
                },
                "places": ["SA", "AE", "QA", "KW", "LK", "IN-KL"],
                "languages": ["en", "ar"],
                "sources": {
                    "mode": "any_reputable",
                    "check_first": ["arabnews.com", "gulfnews.com"],
                },
            },
            "private": {
                "exposure": [
                    {
                        "id": "segment:migrant-families",
                        "how_it_reaches_us": "Their remittances fund our savings book.",
                    },
                    {
                        "id": "product:migrant-savings",
                        "how_it_reaches_us": "Inflows fall if Gulf jobs go.",
                    },
                ],
                "serious": ["Any cut affecting more than 10,000 workers"],
                "notes": "",
            },
            "alert_level": 6,
        },
    },
    "institution": {
        "name": "Serendib Commercial Bank",
        "institution_type": "bank",
        "country": "LK",
        "country_name": "Sri Lanka",
        "currency": "LKR",
        "time_zone": "Asia/Colombo",
        "summary": "Mid-size commercial bank: retail deposits, SME lending, pawning; branches in South India.",
        "segments": [
            {
                "id": "migrant-families",
                "label": "Migrant-worker families",
                "note": "Households with a member working abroad, mostly in the Gulf.",
            }
        ],
        "products": [
            {
                "id": "migrant-savings",
                "name": "Migrant Family Savings",
                "category": "savings",
                "product_type": "savings_account",
            }
        ],
        "flows": [
            {
                "id": "remit-sa",
                "kind": "remittances_in",
                "local": "LK",
                "counterpart": "SA",
            }
        ],
        "corridors": ["SA", "AE"],
        "rivals": [
            {
                "id": "coastal-remit",
                "name": "Coastal Remit",
                "aliases": ["CoastalRemit"],
            }
        ],
        "regulators": [
            {"id": "cbsl", "name": "Central Bank of Sri Lanka", "aliases": ["CBSL"]}
        ],
    },
    "window": {"since": "2026-10-12T09:00:00Z", "until": "2026-10-12T10:00:00Z"},
    "web_search": {"max_queries": 3},
    "recent_urls": ["https://www.arabnews.com/node/2590001"],
}

FINDING = {
    "kind": "news_match",
    "title": "Saudi Arabia cuts quotas for foreign construction workers",
    "explanation": 'Arab News reported "Saudi Arabia cuts quotas for foreign construction workers" at 08:40 UTC on 12 Oct.',
    "tell_me_if_lines": [2],
    "evidence": {
        "web": [{"url": "https://www.arabnews.com/node/2591234", "title": None}],
        "news": [],
    },
    "places": ["SA"],
    "key_date": "2026-11-01",
}

COMPLETED = {
    "run_id": REQUEST["run_id"],
    "monitor_id": "mon-gulf-jobs",
    "monitor_version": 3,
    "status": "completed",
    "created_at": "2026-10-12T10:00:02Z",
    "started_at": "2026-10-12T10:00:03Z",
    "finished_at": "2026-10-12T10:00:41Z",
    "result": {
        "stop_reason": "finished",
        "summary": "Saudi Arabia cut quotas for foreign construction workers.",
        "findings": [FINDING],
        "sources": [
            {
                "ref": "https://www.arabnews.com/node/2591234",
                "url": "https://www.arabnews.com/node/2591234",
                "title": "Saudi Arabia cuts quotas for foreign construction workers",
                "outlet": "arabnews.com",
                "published_at": "2026-10-12T08:40:00Z",
            }
        ],
        "coverage": {
            "web_queries": 2,
            "pages_seen": 7,
            "pages_dated": 6,
            "pages_in_window": 2,
            "already_reported": 1,
            "provided_news": 0,
        },
        "tool_trace": [],
        "usage": {
            "model": "gemini-3.5-flash-lite",
            "model_calls": 4,
            "tool_calls": 3,
            "duration_ms": 38000,
        },
    },
}
RUNNING = {
    "run_id": REQUEST["run_id"],
    "monitor_id": "mon-gulf-jobs",
    "monitor_version": 3,
    "status": "running",
    "created_at": "2026-10-12T10:00:02Z",
    "started_at": "2026-10-12T10:00:03Z",
}
FAILED = {
    **RUNNING,
    "status": "failed",
    "finished_at": "2026-10-12T10:00:09Z",
    "error": "Every model was unavailable (quota exceeded). Start a new check.",
}
