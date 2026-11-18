"""A markdown deck, as pages you can move things around on.

The point of this file: the Manahata deck is written in markdown, and markdown is the right thing to import
from. A PDF is not — it has no paragraphs, no tables, no structure, only fragments of text at coordinates.
Importing one gives you a heap you cannot edit; importing the markdown gives you a deck you can.

**It is a one-way door, and that is deliberate.** Once a deck is imported, Atelier owns it: anything moved
or resized here is lost if the markdown is imported again. Round-tripping layout back into markdown would
mean inventing a way to write "this box is 40px lower" in a text file, and that file would stop being
readable, which was the reason for keeping it in markdown at all.

A page is a block between `---` lines. Inside one, blocks become elements stacked down the page:

    ## 11 · Where the money goes   a small label, in capitals
    # Big headline                 the title
    ### A lede                     a heading
    > A pulled-out line            a heading, in the accent colour
    - one                          a list
    | a | b |                      a table
    ```                            a block of fixed-width text
    <sub>the small print</sub>     a label, grey
    anything else                  a paragraph
"""
import re

PRESETS = {
    "16:9": (1600, 900),
    "4:3": (1200, 900),
    "square": (1080, 1080),
    "a4-land": (1600, 1131),
    "a4-port": (1131, 1600),
}

MARGIN = 88
GAP = 30
GAP_MIN = 12     # how tight the air between blocks may get before a page is simply too full
# The deck's six hues, so a row of figures is coloured rather than six grey boxes in a line.
HUES = ["blue", "red", "green", "amber", "violet", "teal"]
TYPE_FLOOR = 0.62  # the smallest the type may be scaled to: below this a slide stops being readable

# Type sized for a 1600-wide page, not for a diagram card. Atelier's own defaults are a diagram's — a
# title at 26px — and importing a deck at that scale is what turns a slide into a text dump. These are
# scaled to the page width, so a 4:3 or an A4 page gets type in proportion rather than the same numbers.
#
# (font size, line height as a multiple, how wide a character is as a multiple — for guessing the wrap)
TYPE = {
    "title":   (0.040, 1.14, 0.50),
    "heading": (0.022, 1.30, 0.50),
    "quote":   (0.021, 1.38, 0.50),
    "body":    (0.0145, 1.50, 0.50),
    "label":   (0.0115, 1.45, 0.62),   # uppercase and letter-spaced: wider per character
    "table":   (0.0130, 1.70, 0.52),
}

# ---------------------------------------------------------------- reading a table for what it is
#
# A deck writes three different things as a markdown table, because markdown has no other way to say
# them. Importing all three as tables is not wrong, exactly — every word survives — but it throws away
# what the slide meant. These two patterns are worth recognising; anything else stays a table.
#
#   | 58.800 | Empresas registradas |     a figure and what it counts      -> a row of cards
#   | 2027   | 458k€ |                    a label and a number             -> a bar chart

FIGURE = re.compile(r"\d")
UNITS = {"k": 1_000, "m": 1_000_000, "bn": 1_000_000_000, "b": 1_000_000_000}


def _figure_like(cell: str) -> bool:
    """Short, and with a number in it: `58.800`, `8.700 M€`, `65-150€`, `0€`."""
    bare = cell.replace("**", "").replace("*", "").strip()
    return 0 < len(bare) <= 16 and bool(FIGURE.search(bare))


def _as_number(cell: str) -> float | None:
    """`1,26 M€` as 1260000. Spanish decimals, and the k/M that make the bars comparable — without the
    unit, 458k and 1,26M come out as 458 and 1.26 and the chart is upside down."""
    bare = cell.replace("**", "").replace("*", "").strip().lower()
    m = re.search(r"(-?[\d.]+(?:,\d+)?)\s*(bn|[kmb])?", bare)
    if not m:
        return None
    try:
        n = float(m.group(1).replace(".", "").replace(",", "."))
    except ValueError:
        return None
    return n * UNITS.get(m.group(2) or "", 1)


def _short_notes(cells: list[str], avg: int = 70, most: int = 120) -> bool:
    """Whether a column reads as a caption rather than a paragraph.

    This is what tells a row of figures from a CV. `| 2026 → hoy | Lead Forward Deployed Engineer. AI for
    Pfizer and other… |` has a date in the first cell and so looks like a figure, but the second cell is a
    sentence, and six sentences do not become six cards without becoming unreadable.
    """
    lens = [len(c.replace("**", "").strip()) for c in cells]
    return bool(lens) and sum(lens) / len(lens) <= avg and max(lens) <= most


def _read_table(rows: list[list[str]]) -> dict:
    """What this table actually is."""
    n = len(rows)
    widths = {len(r) for r in rows}
    if 2 <= n <= 6 and widths == {2}:
        first = [_figure_like(r[0]) for r in rows]
        second = [_figure_like(r[1]) for r in rows]
        if all(first) and not all(second) and _short_notes([r[1] for r in rows]):
            return {"t": "figs", "cells": [(None, r[0], r[1]) for r in rows]}
        if all(second) and not all(first):
            vals = [_as_number(r[1]) for r in rows]
            if all(v is not None for v in vals):
                return {"t": "bars", "bars": [{"label": re.sub(r"\*+", "", r[0]).strip(), "value": v, "note": r[1]}
                                              for r, v in zip(rows, vals)]}
    if 2 <= n <= 6 and widths == {3} and all(_figure_like(r[1]) for r in rows) and _short_notes([r[2] for r in rows]):
        return {"t": "figs", "cells": [(r[0], r[1], r[2]) for r in rows]}
    return {"t": "table", "rows": rows}


def _id(prefix: str, n: int) -> str:
    return f"{prefix}-md{n}"


def _strip_inline(s: str) -> str:
    """Markdown that has no meaning on a canvas, removed. `**bold**` stays: the canvas renders it."""
    s = re.sub(r"`([^`]*)`", r"\1", s)
    s = re.sub(r"\[([^\]]*)\]\([^)]*\)", r"\1", s)  # a link's words, not its href
    s = re.sub(r"<[^>]+>", "", s)                    # <sub>, <br>, any stray html
    return s.strip()


def _metrics(style: str, pw: int) -> tuple[int, int]:
    """The font size and the line height in px, for this page width."""
    fs, lh, _ = TYPE[style]
    return max(11, round(fs * pw)), max(14, round(fs * pw * lh))


def _wrapped(text: str, style: str, pw: int, usable: int) -> tuple[int, int]:
    """How tall a run of text will be, and the font size it is set in.

    An estimate: the real height is whatever the browser does with the font. Guessing low would overlap
    elements, which is worse than a gap, so the character width errs wide.
    """
    size, line_h = _metrics(style, pw)
    _, _, cw = TYPE[style]
    per_line = max(8, int(usable / (size * cw)))
    lines = sum(max(1, (len(l) // per_line) + 1) for l in text.split("\n"))
    return lines * line_h, size


def _split_pages(md: str) -> list[list[str]]:
    """`---` on its own line starts a new page. A `---` inside a fence is a table rule, not a page break."""
    pages: list[list[str]] = [[]]
    fenced = False
    for line in md.splitlines():
        if line.strip().startswith("```"):
            fenced = not fenced
        if not fenced and re.fullmatch(r"-{3,}\s*", line):
            pages.append([])
            continue
        pages[-1].append(line)
    return [p for p in pages if any(l.strip() for l in p)]


def _blocks(lines: list[str]) -> list[dict]:
    """One page's lines, grouped into the things that become elements."""
    out: list[dict] = []
    i, n = 0, len(lines)
    while i < n:
        raw = lines[i]
        line = raw.strip()

        if not line:
            i += 1
            continue

        if line.startswith("```"):
            body: list[str] = []
            i += 1
            while i < n and not lines[i].strip().startswith("```"):
                body.append(lines[i])
                i += 1
            i += 1
            out.append({"t": "code", "text": "\n".join(body).rstrip()})
            continue

        if line.startswith("|"):
            rows: list[list[str]] = []
            while i < n and lines[i].strip().startswith("|"):
                cells = [c.strip() for c in lines[i].strip().strip("|").split("|")]
                # the |---|---| rule under a header is markdown's, not a row
                if not all(re.fullmatch(r":?-{2,}:?", c or "-") for c in cells):
                    rows.append([_strip_inline(c) for c in cells])
                i += 1
            if rows:
                out.append(_read_table(rows))
            continue

        if re.match(r"[-*]\s+", line):
            items: list[str] = []
            while i < n and re.match(r"[-*]\s+", lines[i].strip()):
                items.append(_strip_inline(re.sub(r"^[-*]\s+", "", lines[i].strip())))
                i += 1
                # a wrapped bullet: an indented continuation line belongs to the item above
                while i < n and lines[i].startswith("  ") and lines[i].strip() and not re.match(r"[-*]\s+", lines[i].strip()):
                    items[-1] += " " + _strip_inline(lines[i].strip())
                    i += 1
            out.append({"t": "list", "items": items})
            continue

        if line.startswith(">"):
            quote = []
            while i < n and lines[i].strip().startswith(">"):
                quote.append(_strip_inline(lines[i].strip().lstrip("> ").rstrip()))
                i += 1
            out.append({"t": "quote", "text": " ".join(q for q in quote if q)})
            continue

        m = re.match(r"(#{1,6})\s+(.*)", line)
        if m:
            level, words = len(m.group(1)), _strip_inline(m.group(2))
            out.append({"t": "head", "level": level, "text": words})
            i += 1
            continue

        # a paragraph: everything up to a blank line or the start of another block
        para = []
        while i < n and lines[i].strip() and not re.match(r"^\s*([-*]\s|\||>|#{1,6}\s|```)", lines[i]):
            para.append(lines[i].strip())
            i += 1
        joined = " ".join(para)
        small = "<sub>" in " ".join(para) or "</sub>" in " ".join(para)
        text = _strip_inline(joined)
        if text:
            out.append({"t": "sub" if small else "para", "text": text})
    return out


def _place(blocks: list[dict], px: int, usable: int, pw: int, ph: int, seq_start: int) -> tuple[list[dict], int, int]:
    """One page's blocks, stacked. Returns the elements, the bottom reached, and the next sequence number.

    Two things give way when a page is too full, in this order: the air between blocks, then the type
    itself. That is the order the deck this imports from uses, and the reason is that a page set two
    points smaller still reads, while a page whose blocks overlap does not.

    The type floor is deliberate. Below it a slide stops being a slide, and the honest answer is that the
    page has too much on it — so it is placed, named in `overflow`, and left for a person to split.
    """
    def lay(gap: int, scale: float) -> tuple[list[dict], int, int]:
        els, y, seq = [], MARGIN, seq_start
        for b in blocks:
            seq += 1
            kind, data, h = _element(b, pw, usable)
            if not kind:
                continue
            if scale != 1.0:
                h = max(18, round(h * scale))
                for k in ("fs", "sub_fs"):
                    if data.get(k):
                        data = {**data, k: max(10, round(data[k] * scale))}

            if kind == "__row__":
                cells = data["cells"]
                gapx = 16
                w = (usable - gapx * (len(cells) - 1)) // max(1, len(cells))
                for j, (label, figure, note) in enumerate(cells):
                    seq += 1
                    els.append({
                        "id": _id("card", seq), "kind": "card",
                        "x": px + MARGIN + j * (w + gapx), "y": y, "w": w, "h": max(h, 24),
                        "color": HUES[j % len(HUES)], "fs": data["fs"],
                        "title": re.sub(r"\*+", "", figure).strip(),
                        "sub": " · ".join(x for x in ((label or "").strip(), (note or "").strip()) if x),
                    })
                y += max(h, 24) + gap
                continue

            els.append({"id": _id(kind, seq), "kind": kind, "x": px + MARGIN, "y": y, "w": usable, "h": max(h, 24), **data})
            y += max(h, 24) + gap
        return els, y - gap + MARGIN, seq

    els, bottom, seq = lay(GAP, 1.0)
    if bottom <= ph:
        return els, bottom, seq

    # first the air
    if len(blocks) > 1:
        spare = (bottom - ph) / max(1, len(blocks) - 1)
        gap = max(GAP_MIN, int(GAP - spare))
        els, bottom, seq = lay(gap, 1.0)
        if bottom <= ph:
            return els, bottom, seq
    else:
        gap = GAP

    # then the type, a step at a time, never past the floor
    scale = 1.0
    for _ in range(12):
        scale *= 0.93
        if scale < TYPE_FLOOR:
            break
        els, bottom, seq = lay(gap, scale)
        if bottom <= ph:
            return els, bottom, seq
    return lay(gap, max(TYPE_FLOOR, scale))


def ph_hint(pw: int) -> int:
    """A bar chart wants height, not a line of it. Judged from the page, which is all this knows."""
    return round(pw * 0.5625)


def _element(b: dict, pw: int, usable: int) -> tuple[str | None, dict, int]:
    """One block as an element: its kind, its data (including the type size), and how tall it will be."""
    def text(style: str, words: str, color: str, size_token: str):
        h, fs = _wrapped(words, style, pw, usable)
        return "text", {"color": color, "text": words, "size": size_token, "fs": fs}, h

    if b["t"] == "head":
        style = {1: "title", 2: "label", 3: "heading"}.get(b["level"], "heading")
        return text(style, b["text"], "grey" if style == "label" else "ink", style)
    if b["t"] == "quote":
        return text("quote", b["text"], "blue", "heading")
    if b["t"] == "sub":
        return text("label", b["text"], "grey", "label")
    if b["t"] in ("para", "code"):
        return text("body", b["text"], "grey" if b["t"] == "code" else "ink", "body")
    if b["t"] == "list":
        size, line_h = _metrics("body", pw)
        _, _, cw = TYPE["body"]
        per_line = max(8, int((usable - size) / (size * cw)))
        lines = sum(max(1, (len(i) // per_line) + 1) for i in b["items"])
        return "list", {"color": "ink", "size": "body", "fs": size, "items": b["items"]}, max(lines, 1) * line_h
    if b["t"] == "figs":
        # A row of cards across the page, each one a hue from the deck's six, the way the slide it came
        # from colours them.
        size, line_h = _metrics("heading", pw)
        small, small_h = _metrics("label", pw)
        cells = b["cells"]
        h = line_h + small_h * 3
        return "__row__", {"cells": cells, "fs": size, "sub_fs": small}, h
    if b["t"] == "bars":
        size, _ = _metrics("label", pw)
        return "bars", {"color": "blue", "fs": size, "bars": b["bars"]}, round(ph_hint(pw) * 0.30)
    if b["t"] == "table":
        size, line_h = _metrics("table", pw)
        cols = max(1, max(len(r) for r in b["rows"]))
        per_cell = max(6, int((usable / cols) / (size * 0.52)))
        rows_h = sum(max(1, (max((len(c) for c in r), default=1) // per_cell) + 1) * line_h for r in b["rows"])
        return "table", {"color": "ink", "head": True, "fs": size, "rows": b["rows"]}, rows_h + 10
    return None, {}, 0


def to_doc(md: str, name: str, doc_id: str, preset: str = "16:9") -> dict:
    """The markdown as a document: one page per `---`-separated block, elements stacked down each page.

    `overflow` names the pages whose content still runs past the bottom after the air has been squeezed.
    They are not cut and nothing is dropped — the editor says which ones to go and tidy, because finding
    them by scrolling through fourteen pages is exactly the slow thing this import exists to avoid.
    """
    pw, ph = PRESETS.get(preset, PRESETS["16:9"])
    usable = pw - MARGIN * 2

    elements: list[dict] = []
    pages: list[dict] = []
    overflow: list[str] = []
    seq = 0

    for pi, lines in enumerate(_split_pages(md)):
        px = pi * (pw + 120)
        page = {"id": _id("p", pi), "name": f"Page {pi + 1}", "x": px, "y": 0, "w": pw, "h": ph, "preset": preset}
        pages.append(page)
        els, bottom, seq = _place(_blocks(lines), px, usable, pw, ph, seq)
        elements.extend(els)
        if bottom > ph:
            overflow.append(page["name"])

    return {"id": doc_id, "name": name, "elements": elements, "arrows": [], "pages": pages,
            "frame": {k: pages[0][k] for k in ("x", "y", "w", "h", "preset")} if pages else None,
            "overflow": overflow}
