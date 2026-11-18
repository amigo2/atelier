"""Atelier's API: diagrams saved as JSON files on this machine, one file per diagram, and the editor itself.

ATELIER_DATA is where the files go (default: data/ at the repo root, git-ignored). The built editor (web/dist)
is served at /, so one process runs the whole thing: `uvicorn app.main:app --port 8100`.
"""
import hashlib
import json
import os
import re
import time
from pathlib import Path

from fastapi import Body, FastAPI, HTTPException, UploadFile
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles

from . import assist, llm, markdown_import

ROOT = Path(__file__).resolve().parents[2]
DATA = Path(os.environ.get("ATELIER_DATA", ROOT / "data")).expanduser()
WEB = ROOT / "web" / "dist"
ID = re.compile(r"^[A-Za-z0-9_-]{1,80}$")   # ids become file names: nothing that could leave the folder

IMAGES = DATA / "images"
# What a browser can show and html-to-image can inline on export. SVG is left out on purpose: it is a
# document, it can carry script, and it would be served from the same origin as the editor.
IMAGE_TYPES = {"image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp", "image/gif": ".gif"}
MAX_IMAGE = 12 * 1024 * 1024

app = FastAPI(title="Atelier")


def _path(doc_id: str) -> Path:
    if not ID.match(doc_id):
        raise HTTPException(400, "bad diagram id")
    return DATA / f"{doc_id}.json"


@app.get("/api/health")
def health():
    return {"ok": True}


# One HTML document, one SVG per printed page. `size` in @page and a body with no margin are what make
# Chromium print the page at exactly the artboard's size instead of fitting it to A4.
_PDF_HTML = """<!doctype html><meta charset="utf-8"><style>
@page {{ size: {w}px {h}px; margin: 0 }}
html, body {{ margin: 0; padding: 0; background: #fff }}
.page {{ width: {w}px; height: {h}px; overflow: hidden; break-after: page }}
.page:last-child {{ break-after: auto }}
.page > svg {{ display: block; width: {w}px; height: {h}px }}
</style>{body}"""


@app.post("/api/images")
async def upload_image(file: UploadFile):
    """A picture, kept beside the diagrams. Returns the URL an image element points at.

    Named by the hash of its contents, so dropping the same screenshot into four slides stores it once and
    re-importing a deck does not pile up copies.
    """
    kind = IMAGE_TYPES.get((file.content_type or "").split(";")[0].strip().lower())
    if not kind:
        raise HTTPException(400, f"not an image we can show: {file.content_type}")
    blob = await file.read(MAX_IMAGE + 1)
    if len(blob) > MAX_IMAGE:
        raise HTTPException(400, f"too big: the limit is {MAX_IMAGE // (1024 * 1024)} MB")
    if not blob:
        raise HTTPException(400, "empty file")

    name = hashlib.sha256(blob).hexdigest()[:24] + kind
    IMAGES.mkdir(parents=True, exist_ok=True)
    path = IMAGES / name
    if not path.exists():
        path.write_bytes(blob)
    return {"id": name, "url": f"/api/images/{name}"}


@app.get("/api/images/{name}")
def get_image(name: str):
    """One picture. The name is checked rather than trusted: it ends up as a path."""
    if not re.fullmatch(r"[0-9a-f]{24}\.(png|jpg|webp|gif)", name):
        raise HTTPException(400, "bad image name")
    path = IMAGES / name
    if not path.is_file():
        raise HTTPException(404, "no such image")
    # A year: the name is the hash of the contents, so the file at a name never changes.
    return FileResponse(path, headers={"Cache-Control": "public, max-age=31536000, immutable"})


@app.post("/api/import/markdown")
def import_markdown(body: dict = Body(...)):
    """A markdown deck as a document: one page per `---`, text and tables as elements you can move.

    Returns the document without saving it — the editor opens it and the usual save-as-you-go writes it, so
    an import that looks wrong is discarded by not keeping it, and never overwrites something already there.
    """
    md = body.get("markdown")
    if not isinstance(md, str) or not md.strip():
        raise HTTPException(400, "no markdown")
    name = str(body.get("name") or "Imported").strip() or "Imported"
    doc_id = str(body.get("id") or f"d-md{int(time.time() * 1000):x}")
    if not ID.match(doc_id):
        raise HTTPException(400, "bad diagram id")
    preset = str(body.get("preset") or "16:9")
    return markdown_import.to_doc(md, name, doc_id, preset)


@app.post("/api/export/pdf")
def export_pdf(body: dict = Body(...)):
    """The deck as a PDF: the editor sends one SVG per page, Chromium prints them.

    Printed rather than drawn with a PDF library, and the SVG keeps its text as text, so a figure in the
    finished file can still be selected and searched. A PNG per page would have been three lines and a
    document nobody can copy a number out of.
    """
    pages = [p for p in (body.get("pages") or []) if isinstance(p, str) and p.strip()]
    if not pages:
        raise HTTPException(400, "no pages to export")
    try:
        w, h = int(body.get("width") or 0), int(body.get("height") or 0)
    except (TypeError, ValueError):
        raise HTTPException(400, "bad page size") from None
    if not (0 < w <= 20000 and 0 < h <= 20000):
        raise HTTPException(400, "bad page size")

    html = _PDF_HTML.format(w=w, h=h, body="".join(f'<div class="page">{svg}</div>' for svg in pages))

    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        raise HTTPException(500, "playwright is not installed: pip install -r requirements.txt") from None

    try:
        with sync_playwright() as pw:
            browser = pw.chromium.launch()
            try:
                page = browser.new_page(viewport={"width": w, "height": h})
                page.set_content(html, wait_until="load")
                # The fonts are inside the SVG, but the layout still settles a frame later; without this the
                # first page occasionally prints before its text has its final metrics.
                page.wait_for_timeout(120)
                pdf = page.pdf(width=f"{w}px", height=f"{h}px", print_background=True,
                               margin={"top": "0", "right": "0", "bottom": "0", "left": "0"})
            finally:
                browser.close()
    except HTTPException:
        raise
    except Exception as exc:
        # Most likely cause by far: the browser was never downloaded.
        raise HTTPException(500, f"could not print: {type(exc).__name__}: {exc}"
                                 " — if the browser is missing: python -m playwright install chromium") from None

    name = re.sub(r"[^\w.-]+", "-", str(body.get("name") or "deck")).strip("-") or "deck"
    return Response(pdf, media_type="application/pdf",
                    headers={"Content-Disposition": f'attachment; filename="{name}.pdf"'})


@app.get("/api/diagrams")
def list_diagrams():
    """Every saved diagram, the most recently changed first."""
    out = []
    for f in DATA.glob("*.json") if DATA.exists() else []:
        try:
            d = json.loads(f.read_text())
            out.append({"id": f.stem, "name": d.get("name") or f.stem, "updated": int(f.stat().st_mtime),
                        "elements": len(d.get("elements") or []),
                        "pages": len(d.get("pages") or ([d["frame"]] if d.get("frame") else []))})
        except (OSError, json.JSONDecodeError):
            continue
    return sorted(out, key=lambda d: -d["updated"])


@app.get("/api/diagrams/{doc_id}")
def get_diagram(doc_id: str):
    p = _path(doc_id)
    if not p.exists():
        raise HTTPException(404, f"no diagram {doc_id}")
    return json.loads(p.read_text())


@app.put("/api/diagrams/{doc_id}")
def save_diagram(doc_id: str, doc: dict = Body(...)):
    """Save the whole diagram (written to a temp file, then moved, so a crash never leaves half a file)."""
    if doc.get("id") != doc_id or not isinstance(doc.get("elements"), list) or not isinstance(doc.get("arrows"), list):
        raise HTTPException(400, "a diagram needs its id, elements and arrows")
    p = _path(doc_id)
    DATA.mkdir(parents=True, exist_ok=True)
    tmp = p.with_suffix(f".{time.time_ns()}.tmp")
    tmp.write_text(json.dumps(doc, indent=1, ensure_ascii=False))
    tmp.replace(p)
    return {"saved": doc_id}


@app.delete("/api/diagrams/{doc_id}")
def delete_diagram(doc_id: str):
    p = _path(doc_id)
    if not p.exists():
        raise HTTPException(404, f"no diagram {doc_id}")
    p.unlink()
    return {"deleted": doc_id}


@app.get("/api/ai")
def ai_status():
    """Whether the chat has the live model, and which."""
    return llm.status()


@app.post("/api/assist")
def assist_message(body: dict = Body(..., examples=[{"doc": {"id": "d-1", "name": "x", "elements": [], "arrows": []}, "selected": [], "text": "draw a pipeline: Question -> Embed -> Retrieve"}])):
    """One chat message: the diagram changed by the AI's tools (not saved here: the editor saves it), its reply,
    and the steps it took."""
    return assist.assist(body)


if WEB.exists():
    app.mount("/", StaticFiles(directory=WEB, html=True), name="web")
