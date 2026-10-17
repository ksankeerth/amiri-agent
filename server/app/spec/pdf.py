"""Writes metrics-spec-<version>.pdf, the guide, from its print page (/spec/print) with headless Chrome, so the PDF and
the pages never say different things. Development only: it needs the dev dependencies (playwright, with its browser,
and pypdf) and a built web app (web/dist). No server is started: the page's few calls are answered here, from the
bundled spec, and every other request is refused, so the PDF uses local fonts only.

Chrome prints the page with an outline (the PDF's bookmarks) built from its headings, and the outline gives each
heading's page: the contents' page numbers are filled in from it, and the page printed again until they hold. Each
page then gets its running header (the spec and the section) and footer (page X of Y), printed by Chrome on blank
pages of the same size and merged in, the cover excepted.
SPEC_PDF_CHROME names a Chrome to use instead of Playwright's own (`uv run playwright install chromium-headless-shell`)."""

import html
import io
import json
import os
from pathlib import Path
from urllib.parse import urlparse

from app import settings
from app.spec import api

ORIGIN = "http://spec.local"
PUBLISHER = "Amiri Agent"
MARGIN = {"top": "22mm", "bottom": "20mm", "left": "20mm", "right": "20mm"}  # the print layout's page (extra.css)
FILL = """pages => [...document.querySelectorAll('[data-toc]')].flatMap(e => {
  const page = pages[e.dataset.toc.split(/\\s+/).join(' ')];
  e.textContent = page ?? '';
  return page ? [] : [e.dataset.toc];
})"""
OVERLAY = """<!doctype html><html lang="en"><meta charset="utf-8"><style>
@page {{ size: A4; margin: 0; }}
body {{ margin: 0; font: 7.5pt/1.2 "Helvetica Neue", Helvetica, Arial, sans-serif; color: #4d4d4d; }}
.p {{ position: relative; width: 210mm; height: 297mm; overflow: hidden; break-after: page; }}
.p:last-child {{ break-after: auto; }}
.h, .f {{ position: absolute; left: 20mm; right: 20mm; display: flex; justify-content: space-between; gap: 8mm; }}
.h {{ top: 11mm; padding-bottom: 1.6mm; border-bottom: .5pt solid #b8b8b8; }}
.f {{ bottom: 10mm; padding-top: 1.6mm; border-top: .5pt solid #b8b8b8; }}
b {{ font-weight: 600; color: #1a1a1a; }}
</style>{pages}</html>"""


def _outline(pdf: bytes) -> tuple[list[tuple[int, str, int]], int]:
    """Every heading in the PDF's outline as (level, title, page from 1), and the number of pages."""
    from pypdf import PdfReader

    reader, out = PdfReader(io.BytesIO(pdf)), []

    def walk(items, level):
        for x in items:
            if isinstance(x, list):
                walk(x, level + 1)
            else:
                out.append((level, " ".join(x.title.split()), reader.get_destination_page_number(x) + 1))

    walk(reader.outline, 1)
    return out, len(reader.pages)


def _overlay(heads: list[tuple[int, str, int]], pages: int, name: str, status: str) -> str:
    """The running header and footer of every page but the cover: the section is the last one begun by that page."""
    sections = [(p, t) for level, t, p in heads if level == 1]
    out = []
    for n in range(1, pages + 1):
        section = next((t for p, t in reversed(sections) if p <= n), None)
        out.append('<div class="p"></div>' if n == 1 or section is None else
                   f'<div class="p"><div class="h"><b>{html.escape(name)}</b><span>{html.escape(section)}</span></div>'
                   f'<div class="f"><span>{PUBLISHER} · {html.escape(status[:1].upper() + status[1:])}</span><span>Page {n} of {pages}</span>'
                   '</div></div>')
    return OVERLAY.format(pages="".join(out))


def _merge(pdf: bytes, overlay: bytes, meta: dict[str, str]) -> bytes:
    from pypdf import PdfReader, PdfWriter

    writer, top = PdfWriter(clone_from=PdfReader(io.BytesIO(pdf))), PdfReader(io.BytesIO(overlay))
    for page, over in zip(writer.pages, top.pages, strict=True):
        page.merge_page(over)
        page.compress_content_streams()
    writer.add_metadata(meta)
    writer.page_mode = "/UseOutlines"  # open with the bookmarks shown
    buf = io.BytesIO()
    writer.write(buf)
    return buf.getvalue()


async def make(out: Path | None = None) -> Path:
    from playwright.async_api import async_playwright

    dist = Path(settings.raw("WEB_DIST"))
    dist = dist if dist.is_absolute() else settings.PROJECT / dist
    if not (dist / "index.html").exists():
        raise SystemExit(f"No built web app at {dist}: run `npm run build` in web/ first.")
    out = out or api.pdf_path()
    doc = await api.spec_pages()
    name = f"{doc['title']} {doc['spec_version']}"
    answers = {"/api/v1/spec": doc, "/api/v1/auth/config": {"mode": "off", "recaptcha_site_key": None},
               "/api/v1/auth/me": {"mode": "off", "signed_in": True, "kind": None}}

    async def serve(route):
        url = urlparse(route.request.url)
        if f"{url.scheme}://{url.netloc}" != ORIGIN:
            return await route.abort()  # nothing from the network (the app's web fonts): the print layout's are local
        path = url.path
        if path in answers:
            return await route.fulfill(status=200, content_type="application/json", body=json.dumps(answers[path], default=str))
        if path.startswith("/api/"):
            return await route.fulfill(status=404, content_type="application/json", body="{}")
        f = (dist / path.lstrip("/")).resolve()
        return await route.fulfill(path=f if path != "/" and f.is_file() and dist.resolve() in f.parents else dist / "index.html")

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(executable_path=os.environ.get("SPEC_PDF_CHROME") or None)
        page = await browser.new_page()
        await page.route("**/*", serve)
        await page.goto(f"{ORIGIN}/spec/print")
        await page.wait_for_selector("[data-spec-ready]", timeout=30_000)
        await page.wait_for_function("v => document.title.endsWith(v)", arg=api.version())  # the PDF's title
        await page.emulate_media(media="print")
        filled: dict[str, str] | None = None
        for _ in range(4):  # the numbers can move a heading only if they change the contents' length; they settle fast
            pdf = await page.pdf(format="A4", print_background=True, margin=MARGIN, outline=True, tagged=True)
            heads, pages = _outline(pdf)
            numbers = {t: str(p) for _, t, p in heads}
            if numbers == filled:
                break
            if missing := await page.evaluate(FILL, numbers):
                raise SystemExit(f"Contents entries with no heading in the PDF: {missing}")
            filled = numbers
        else:
            raise SystemExit("The contents' page numbers did not settle.")
        frame = await browser.new_page()
        await frame.set_content(_overlay(heads, pages, name, doc["status"]))
        overlay = await frame.pdf(prefer_css_page_size=True, print_background=True)
        await browser.close()
    out.write_bytes(_merge(pdf, overlay, {
        "/Title": name, "/Author": PUBLISHER, "/Creator": PUBLISHER,
        "/Subject": "The guide to the Metrics Spec: aggregated metrics for banks and insurers",
        "/Keywords": "Metrics Spec, banks, insurers, aggregated metrics, reference API, conformance"}))
    return out
