"""Writes metrics-spec-<version>.pdf from the print page (/spec/print) with headless Chrome, so the PDF and the pages
never say different things. Development only: it needs the dev dependencies (playwright, with its browser) and a
built web app (web/dist). No server is started: the page's few calls are answered here, from the bundled spec.
SPEC_PDF_CHROME names a Chrome to use instead of Playwright's own (`uv run playwright install chromium-headless-shell`)."""

import json
import os
from pathlib import Path
from urllib.parse import urlparse

from app import settings
from app.spec import api

ORIGIN = "http://spec.local"
FOOTER = ('<div style="font: 8px sans-serif; width: 100%; padding: 0 12mm; color: #666; display: flex;">'
          '<span>Metrics Spec {v}</span><span style="margin-left: auto;">'
          '<span class="pageNumber"></span> / <span class="totalPages"></span></span></div>')


async def make(out: Path | None = None) -> Path:
    from playwright.async_api import async_playwright

    dist = Path(settings.raw("WEB_DIST"))
    dist = dist if dist.is_absolute() else settings.PROJECT / dist
    if not (dist / "index.html").exists():
        raise SystemExit(f"No built web app at {dist}: run `npm run build` in web/ first.")
    out = out or api.pdf_path()
    answers = {"/api/v1/spec": await api.spec_pages(), "/api/v1/auth/config": {"mode": "off", "recaptcha_site_key": None},
               "/api/v1/auth/me": {"mode": "off", "signed_in": True, "kind": None}}

    async def serve(route):
        path = urlparse(route.request.url).path
        if path in answers:
            return await route.fulfill(status=200, content_type="application/json", body=json.dumps(answers[path], default=str))
        if path.startswith("/api/"):
            return await route.fulfill(status=404, content_type="application/json", body="{}")
        f = (dist / path.lstrip("/")).resolve()
        return await route.fulfill(path=f if path != "/" and f.is_file() and dist.resolve() in f.parents else dist / "index.html")

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(executable_path=os.environ.get("SPEC_PDF_CHROME") or None)
        page = await browser.new_page()
        await page.route(f"{ORIGIN}/**", serve)
        await page.goto(f"{ORIGIN}/spec/print")
        await page.wait_for_selector("[data-spec-ready]", timeout=30_000)
        await page.wait_for_function("v => document.title.endsWith(v)", arg=api.version())  # the PDF's title
        await page.emulate_media(media="print")
        await page.pdf(path=str(out), format="A4", print_background=True, display_header_footer=True,
                       header_template="<span></span>", footer_template=FOOTER.format(v=api.version()),
                       margin={"top": "14mm", "bottom": "16mm", "left": "12mm", "right": "12mm"})
        await browser.close()
    return out
