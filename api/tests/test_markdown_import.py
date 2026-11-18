"""Importing a markdown deck: one page per `---`, and the blocks inside it as elements."""
from app import markdown_import as mi

DECK = """\
# Manahata

A line under the title.

---

## 02 · A bit of background

# Why all this.

- **The family business.** My father, a career in Seville.
- 2017. I opened my own agency.

| Year | What |
|---|---|
| 2017 | An agency |
| 2026 | This |

> The market has not changed since.

<sub>Measured November 2026.</sub>
"""


def doc():
    return mi.to_doc(DECK, "Deck", "d-t")


def test_one_page_per_separator():
    d = doc()
    assert [p["name"] for p in d["pages"]] == ["Page 1", "Page 2"]
    # side by side, left to right, so reading order is page order
    assert d["pages"][1]["x"] > d["pages"][0]["x"]
    # the first page is also written as the old single frame, for whatever still reads one
    assert d["frame"]["w"] == d["pages"][0]["w"]


def test_each_block_becomes_its_kind():
    els = doc()["elements"]
    kinds = [e["kind"] for e in els]
    assert "list" in kinds and "table" in kinds

    lst = next(e for e in els if e["kind"] == "list")
    assert lst["items"][1] == "2017. I opened my own agency."
    # bold survives: the canvas renders **like this**, so stripping it here would lose the emphasis
    assert lst["items"][0].startswith("**The family business.**")

    tbl = next(e for e in els if e["kind"] == "table")
    assert tbl["rows"][0] == ["Year", "What"]      # the header
    assert ["2017", "An agency"] in tbl["rows"]
    assert all("---" not in c for r in tbl["rows"] for c in r)   # the |---| rule is not a row


def test_headings_and_small_print():
    els = [e for e in doc()["elements"] if e["kind"] == "text"]
    by_text = {e["text"]: e for e in els}
    assert by_text["Manahata"]["size"] == "title"           # #
    assert by_text["02 · A bit of background"]["size"] == "label"   # ##
    assert by_text["Why all this."]["size"] == "title"
    assert by_text["Measured November 2026."]["size"] == "label"    # <sub>
    assert by_text["The market has not changed since."]["color"] == "blue"  # a quote


def test_elements_are_stacked_and_inside_their_page():
    d = doc()
    page = d["pages"][1]
    els = sorted((e for e in d["elements"] if e["x"] >= page["x"]), key=lambda e: e["y"])
    assert els, "the second page got no elements"
    for a, b in zip(els, els[1:]):
        assert b["y"] >= a["y"] + a["h"], "elements overlap"
    for e in els:
        assert page["x"] <= e["x"] and e["x"] + e["w"] <= page["x"] + page["w"]


def test_a_page_too_full_is_named_not_cut():
    # blank lines between them: consecutive lines are one paragraph in markdown, which is correct and not
    # what this test is about
    full = "\n\n".join(f"Paragraph number {i}, long enough to take a line of its own on the page." for i in range(60))
    d = mi.to_doc(full, "Full", "d-f")
    assert d["overflow"] == ["Page 1"]
    # nothing is dropped: being told which page to tidy is the point, losing content is not
    assert len(d["elements"]) == 60


def test_a_fence_is_not_a_page_break():
    d = mi.to_doc("Before\n\n```\n---\n```\n\nAfter", "Fence", "d-c")
    assert len(d["pages"]) == 1
