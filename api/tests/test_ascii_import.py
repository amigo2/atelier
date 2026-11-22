"""Box drawings pasted as text: the lines say where things are, and are never drawn themselves."""
from app import ascii_import
from app.assist import Canvas

WORKER = """\
┌──── Worker container (1 process, cap: 256 MB) ────┐
│                    [ P1 ~40MB ]                   │ → flat green Stats ✅
└───────────────────────────────────────────────────┘"""

OOM = """\
┌──────── Worker container (cap: 96 MB) ────────┐
│  [P1 ~30MB] [P2 ~30MB] [P3 ~30MB] [P4 ~30MB]  │ → 120+ MB > 96 MB
└───────────────────────────────────────────────┘   💥 Linux OOMKill (Exit 137)"""

NESTED = """\
+------------------ Docker ------------------+
|  +--- Web ---+           +--- api ---+     |
|  | Nginx :80 |  --HTTP-> | FastAPI   |     |
|  +-----------+           +-----------+     |
|                               v           |
|                          +--- Redis ---+   |
|                          | cache       |   |
|                          +-------------+   |
+--------------------------------------------+"""


def kinds(cv):
    return sorted(e["kind"] for e in cv.els)


def test_a_box_with_a_title_a_pill_and_an_arrow_out():
    assert ascii_import.looks_like(WORKER)
    cv = Canvas({"id": "d", "name": "x", "elements": [], "arrows": []})
    ascii_import.draw(cv, WORKER)
    box = next(e for e in cv.els if e["kind"] == "box")
    assert box["title"] == "Worker container (1 process, cap: 256 MB)"
    assert [e["text"] for e in cv.els if e["kind"] == "pill"] == ["P1 ~40MB"]
    stats = next(e for e in cv.els if e["kind"] == "card")
    assert stats["title"] == "flat green Stats ✅"
    assert [(a["from"], a["to"]) for a in cv.doc["arrows"]] == [(box["id"], stats["id"])]
    # nothing drawn from the lines themselves
    assert not any("─" in (e.get("title") or e.get("text") or "") for e in cv.els)


def test_four_pills_an_arrow_and_loose_words():
    cv = Canvas({"id": "d", "name": "x", "elements": [], "arrows": []})
    ascii_import.draw(cv, OOM)
    assert [e["text"] for e in cv.els if e["kind"] == "pill"] == ["P1 ~30MB", "P2 ~30MB", "P3 ~30MB", "P4 ~30MB"]
    assert next(e for e in cv.els if e["kind"] == "card")["title"] == "120+ MB > 96 MB"
    assert [e["text"] for e in cv.els if e["kind"] == "text"] == ["💥 Linux OOMKill (Exit 137)"]
    pills = [e for e in cv.els if e["kind"] == "pill"]
    box = next(e for e in cv.els if e["kind"] == "box")
    assert all(box["x"] <= p["x"] and p["x"] + p["w"] <= box["x"] + box["w"] for p in pills)    # inside the frame


def test_ascii_boxes_nesting_and_arrows_between_boxes():
    cv = Canvas({"id": "d", "name": "x", "elements": [], "arrows": []})
    ascii_import.draw(cv, NESTED)
    by = {(e.get("title") or e.get("text")): e for e in cv.els}
    assert by["Docker"]["kind"] == "box" and {by[t]["kind"] for t in ("Web", "api", "Redis")} == {"card"}
    assert by["Web"]["sub"] == "Nginx :80" and by["Redis"]["sub"] == "cache"
    arrows = {(a["from"], a["to"]): a.get("label") for a in cv.doc["arrows"]}
    assert arrows[(by["Web"]["id"], by["api"]["id"])] == "HTTP"
    assert (by["api"]["id"], by["Redis"]["id"]) in arrows
    assert cv.els[0]["id"] == by["Docker"]["id"]                                       # the frame sits behind


def test_plain_requests_are_not_mistaken_for_drawings():
    assert not ascii_import.looks_like("draw a pipeline: Question -> Embed -> Answer")
    assert not ascii_import.looks_like("make these teal")
