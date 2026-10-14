"""Errors as RFC 9457 problem details."""

from typing import Any

from fastapi import Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

TITLES = {
    400: "Bad request",
    403: "Forbidden",
    404: "Not found",
    409: "Conflict",
    422: "Unprocessable",
    429: "Too many requests",
    500: "Internal error",
    502: "Provider error",
    503: "Unavailable",
}


class Problem(Exception):
    def __init__(
        self,
        status: int,
        code: str,
        detail: str,
        retry_after: int | None = None,
        **extra: Any,
    ):
        super().__init__(detail)
        self.status, self.code, self.detail = status, code, detail
        self.retry_after, self.extra = retry_after, extra


def problem_response(p: Problem) -> JSONResponse:
    body = {
        "type": f"https://amiri.dev/errors/{p.code}",
        "title": TITLES.get(p.status, "Error"),
        "status": p.status,
        "code": p.code,
        "detail": p.detail,
        **p.extra,
    }
    headers = {"Retry-After": str(p.retry_after)} if p.retry_after is not None else None
    if p.retry_after is not None:
        body["retry_after_seconds"] = p.retry_after
    return JSONResponse(
        body, status_code=p.status, headers=headers, media_type="application/problem+json"
    )


async def on_problem(_: Request, exc: Exception) -> JSONResponse:
    assert isinstance(exc, Problem)
    return problem_response(exc)


async def on_validation(_: Request, exc: Exception) -> JSONResponse:
    assert isinstance(exc, RequestValidationError)
    errors = [
        {"field": ".".join(str(x) for x in e["loc"] if x != "body"), "code": "invalid", "message": e["msg"]}
        for e in exc.errors()
    ]
    return problem_response(
        Problem(422, "validation_error", "The request has invalid fields.", errors=errors)
    )
