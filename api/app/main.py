"""Atelier's API: diagrams saved as JSON files on this machine, one file per diagram, and the editor itself.

ATELIER_DATA is where the files go (default: data/ at the repo root, git-ignored). The built editor (web/dist)
is served at /, so one process runs the whole thing: `uvicorn app.main:app --port 8100`.
"""
import json
import os
import re
import time
from pathlib import Path

from fastapi import Body, FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles

ROOT = Path(__file__).resolve().parents[2]
DATA = Path(os.environ.get("ATELIER_DATA", ROOT / "data")).expanduser()
WEB = ROOT / "web" / "dist"
ID = re.compile(r"^[A-Za-z0-9_-]{1,80}$")   # ids become file names: nothing that could leave the folder

app = FastAPI(title="Atelier")


def _path(doc_id: str) -> Path:
    if not ID.match(doc_id):
        raise HTTPException(400, "bad diagram id")
    return DATA / f"{doc_id}.json"


@app.get("/api/health")
def health():
    return {"ok": True}


@app.get("/api/diagrams")
def list_diagrams():
    """Every saved diagram, the most recently changed first."""
    out = []
    for f in DATA.glob("*.json") if DATA.exists() else []:
        try:
            out.append({"id": f.stem, "name": json.loads(f.read_text()).get("name") or f.stem, "updated": int(f.stat().st_mtime)})
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


if WEB.exists():
    app.mount("/", StaticFiles(directory=WEB, html=True), name="web")
