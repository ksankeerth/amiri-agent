"""Words for people: counts that read right ("1 alert", "2 alerts"), never "alert(s)"."""


def plural(n: int, one: str, many: str | None = None) -> str:
    return f"{n} {one if n == 1 else many or one + 's'}"


def plain_error(error: str | None) -> str:
    """What a failed check or run means for a person, in a sentence. The raw message stays in the detail views."""
    e = (error or "").lower()
    if not e:
        return "It didn't finish."
    if "quota" in e or "429" in e or "rate limit" in e or "resource_exhausted" in e:
        return "The news search is over its limit, so nothing was read this time."
    if "couldn't take" in e or "refused" in e or "unreachable" in e or "connect" in e or "404" in e or "lost the" in e:
        return "The service that does this didn't answer, so nothing was read this time."
    if "timeout" in e or "timed out" in e or "deadline" in e:
        return "It took too long and was stopped."
    return "Something went wrong and nothing was read this time."
