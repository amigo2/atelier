"""A box drawing pasted as text, turned into a diagram.

    ┌──── Worker container (1 process, cap: 256 MB) ────┐
    │                    [ P1 ~40MB ]                   │ → flat green Stats ✅
    └───────────────────────────────────────────────────┘

The lines are only read to find where the boxes are; they are never drawn. What is drawn is what they hold:

- each rectangle becomes an element, the words in its top border its title;
- inside, plain lines are the card's words; `[ bracketed ]` items become pills, and the box a frame around them;
  a rectangle inside another becomes a box inside it;
- `→ words` beside a box becomes a card and an arrow to it; `──▶` (with or without a label) between two boxes is
  an arrow between them; `▼` between a box and one below it is an arrow down;
- any other words outside the boxes become text, where they are.

No model, so no key, no cost, and the same drawing always gives the same diagram. `+--+` boxes work too.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field

TL, TR, BL, BR = "┌╭╔+", "┐╮╗+", "└╰╚+", "┘╯╝+"
H, V = "─━═-", "│┃║|"
HEADS_RIGHT, HEADS_LEFT, HEADS_DOWN, HEADS_UP = "▶►>→", "◀◄<←", "▼v↓", "▲^↑"
LINE_CHARS = set(H + V + "├┤┬┴┼" + HEADS_RIGHT + HEADS_LEFT + "▼↓▲↑")

CW, RH = 9, 30          # one character column, one text row, in canvas pixels
TOKEN = re.compile(r"\[[^\]]+\]")


@dataclass
class Box:
    r0: int
    c0: int
    r1: int
    c1: int
    title: str = ""
    lines: list[str] = field(default_factory=list)
    tokens: list[list[str]] = field(default_factory=list)   # rows of [bracketed] items
    children: list["Box"] = field(default_factory=list)
    parent: "Box | None" = None
    id: str = ""

    def contains(self, o: "Box") -> bool:
        return self is not o and self.r0 <= o.r0 and self.c0 <= o.c0 and self.r1 >= o.r1 and self.c1 >= o.c1

    def holds(self, r: int, c: int) -> bool:
        return self.r0 <= r <= self.r1 and self.c0 <= c <= self.c1


def _grid(text: str) -> list[str]:
    lines = text.replace("\t", "    ").split("\n")
    while lines and not lines[0].strip():
        lines.pop(0)
    while lines and not lines[-1].strip():
        lines.pop()
    # the common indent goes, so a drawing pasted from an indented block starts at column 0
    pad = min((len(l) - len(l.lstrip()) for l in lines if l.strip()), default=0)
    width = max((len(l) for l in lines), default=0)
    return [l[pad:].ljust(width - pad) for l in lines]


def _at(g: list[str], r: int, c: int) -> str:
    return g[r][c] if 0 <= r < len(g) and 0 <= c < len(g[r]) else " "


def find_boxes(g: list[str]) -> list[Box]:
    found: list[Box] = []
    for r, line in enumerate(g):
        for c, ch in enumerate(line):
            if ch not in TL or (ch == "+" and _at(g, r, c + 1) not in H):
                continue
            # along the top: to the corner on the right (words in the border are its title)
            c1 = c + 1
            while c1 < len(line) and line[c1] not in TR:
                c1 += 1
            if c1 >= len(line) or c1 - c < 2:
                continue
            # down the left side, to the bottom-left corner
            # (a side may wobble a column either way: hand-drawn boxes often do)
            side = lambda k, col, ok: any(_at(g, k, col + d) in ok for d in (0, -1, 1))
            r1 = r + 1
            while r1 < len(g) and side(r1, c, V + "├╟╠") and _at(g, r1, c) not in BL:
                r1 += 1
            if not side(r1, c, BL) or r1 - r < 1:
                continue
            if not side(r1, c1, BR) or any(not side(k, c1, V + "┤╢╣") for k in range(r + 1, r1)):
                continue
            title = line[c + 1:c1].strip("".join(H) + " ").strip()
            found.append(Box(r, c, r1, c1, title=re.sub(r"\s*[─━═-]{2,}\s*", " ", title).strip()))
    # the smallest box around each is its parent
    for b in found:
        around = [o for o in found if o.contains(b)]
        if around:
            b.parent = min(around, key=lambda o: (o.r1 - o.r0) * (o.c1 - o.c0))
            b.parent.children.append(b)
    return found


def _masked(g: list[str], boxes: list[Box]) -> list[list[str]]:
    """The grid with what the boxes have read blanked out: every border, and the inside of every box with no box
    in it. What is left is outside them all, or loose inside a container (an arrow between two boxes in a frame)."""
    m = [list(l) for l in g]
    sides = set(V + "├╟╠┤╢╣")

    def blank(r: int, c: int, only: set[str] | None = None) -> None:
        if 0 <= r < len(m) and 0 <= c < len(m[r]) and (only is None or m[r][c] in only):
            m[r][c] = " "

    for b in boxes:
        for c in range(b.c0, b.c1 + 1):                         # top and bottom borders, with any title in them
            blank(b.r0, c)
            blank(b.r1, c)
        for r in range(b.r0 + 1, b.r1):                         # the sides, allowing a column of wobble
            for c in (b.c0 - 1, b.c0, b.c0 + 1, b.c1 - 1, b.c1, b.c1 + 1):
                blank(r, c, sides)
            if not b.children:                                   # a box with nothing in it has read its own inside
                for c in range(b.c0 + 1, b.c1):
                    blank(r, c)
    return m


def _read_inside(g: list[str], b: Box) -> None:
    # a container's own words and arrows are read where they sit, with everything else loose (see parse)
    if b.children:
        return
    for r in range(b.r0 + 1, b.r1):
        row = list(g[r][b.c0 + 1:b.c1])
        for ch in b.children:                                  # a box inside is its own; blank it here
            if ch.r0 <= r <= ch.r1:
                for c in range(ch.c0, ch.c1 + 1):
                    if b.c0 < c < b.c1:
                        row[c - b.c0 - 1] = " "
        text = "".join(row).strip(" " + V)                       # a wobbled border is not part of the words
        if not text:
            continue
        toks = TOKEN.findall(text)
        if toks and not TOKEN.sub("", text).strip():
            b.tokens.append([t.strip("[] ").strip() for t in toks])
        else:
            b.lines.append(re.sub(r"\s{2,}", "  ", text))


def _segments(row: list[str]) -> list[tuple[int, str]]:
    """Runs of words on a row, split where three or more spaces part them: (column, text)."""
    out, start, buf, gap = [], None, [], 0
    for c, ch in enumerate(row + [" "] * 3):
        if ch == " ":
            gap += 1
            if buf and gap >= 3:
                out.append((start, "".join(buf).rstrip()))
                buf, start = [], None
            elif buf:
                buf.append(ch)
        else:
            if start is None:
                start = c
            buf.append(ch)
            gap = 0
    return out


# an arrow drawn in text: ──▶, -->, ->, =>, ◀──, <--, or a single → / ←
ARROW = re.compile(r"[<◀◄←]?[─━═\-=]{2,}[>▶►→]?|[<◀◄←][─━═\-=]+|[─━═\-=]+[>▶►→]|[→←▶◀►◄]")


def _label(seg: str) -> str:
    """The words on or beside an arrow, with the arrow taken off: `──HTTP──▶` -> HTTP, `→ 120+ MB > 96 MB` keeps its `>`."""
    return re.sub(r"\s{2,}", " ", ARROW.sub(" ", seg)).strip()


def parse(text: str) -> dict:
    """Boxes, arrows and loose words, read from the drawing. Coordinates are in grid cells."""
    g = _grid(text)
    boxes = find_boxes(g)
    for b in boxes:
        _read_inside(g, b)
    m = _masked(g, boxes)
    arrows, loose = [], []          # arrows: (from box, to box | None, label, (row, col) of a new end)

    def box_left_of(r: int, c: int) -> Box | None:
        near = [b for b in boxes if b.r0 <= r <= b.r1 and 0 < c - b.c1 <= 3]
        return min(near, key=lambda b: (b.r1 - b.r0) * (b.c1 - b.c0)) if near else None

    def box_right_of(r: int, c: int) -> Box | None:
        near = [b for b in boxes if b.r0 <= r <= b.r1 and 0 < b.c0 - c <= 3]
        return min(near, key=lambda b: (b.r1 - b.r0) * (b.c1 - b.c0)) if near else None

    for r, row in enumerate(m):
        for c, seg in _segments(row):
            end = c + len(seg) - 1
            words = _label(seg)
            left, right = box_left_of(r, c), box_right_of(r, end)
            heads_r = any(h in seg for h in HEADS_RIGHT) or "->" in seg
            heads_l = any(h in seg for h in HEADS_LEFT) or "<-" in seg
            if left and right and (heads_r or heads_l or set(seg) <= LINE_CHARS | {" "}):
                a, z = (right, left) if heads_l and not heads_r else (left, right)
                arrows.append((a, z, words, None))
            elif left and seg.lstrip()[:1] in "─━═-=>→▶►" and heads_r and words:
                arrows.append((left, None, words, (r, c + len(seg) - len(seg.lstrip("─━═-=>→▶► ")))))
            elif set(seg.strip()) <= set(V + HEADS_DOWN + HEADS_UP) and any(h in seg for h in HEADS_DOWN + HEADS_UP):
                col = c + next(i for i, ch in enumerate(seg) if ch in HEADS_DOWN + HEADS_UP)
                up = [b for b in boxes if b.r1 < r and b.c0 < col < b.c1]
                down = [b for b in boxes if b.r0 > r and b.c0 < col < b.c1]
                if up and down:
                    a, z = max(up, key=lambda b: b.r1), min(down, key=lambda b: b.r0)
                    arrows.append((z, a, "", None) if any(h in seg for h in HEADS_UP) else (a, z, "", None))
            elif words and not set(seg) <= LINE_CHARS | {" "}:
                loose.append((r, c, seg.strip()))
    return {"grid": g, "boxes": boxes, "arrows": arrows, "loose": loose}


def looks_like(text: str) -> bool:
    """Is this a box drawing? At least one whole rectangle in it."""
    return "\n" in text.strip() and bool(find_boxes(_grid(text)))


def draw(cv, text: str) -> str:
    """Add the drawing to the canvas `cv` (an assist.Canvas). Returns what was drawn, in words."""
    p = parse(text)
    boxes: list[Box] = p["boxes"]
    # below what is there already, lined up with it
    els = cv.els
    oy = (max(e["y"] + e["h"] for e in els) + 80) if els else 0
    ox = min(e["x"] for e in els) if els else 0
    X = lambda c: ox + c * CW
    Y = lambda r: oy + r * RH
    n = {"boxes": 0, "cards": 0, "pills": 0, "arrows": 0, "text": 0}

    # outer boxes first, so frames sit behind what is in them
    for b in sorted(boxes, key=lambda b: -(b.r1 - b.r0) * (b.c1 - b.c0)):
        x, y, w, h = X(b.c0), Y(b.r0), (b.c1 - b.c0) * CW, (b.r1 - b.r0) * RH
        frame = bool(b.children or b.tokens)
        if frame:
            title = b.title or (b.lines[0] if b.lines else "")
            b.id = cv.add_element(kind="box", title=title, color="blue", x=x, y=y, w=w, h=max(h, 60 + 44 * len(b.tokens)))["id"]
            n["boxes"] += 1
            extra = b.lines[1:] if not b.title else b.lines
            ty = y + 44
            for line in extra:                                   # words in a frame, above its pills
                cv.add_element(kind="text", text=line, size="body", x=x + 20, y=ty, w=w - 40, h=24)
                ty += 28
                n["text"] += 1
            for row in b.tokens:                                  # [P1 ~40MB] [P2 ~40MB]: a row of pills
                total = sum(len(t) * 8 + 28 for t in row) + 10 * (len(row) - 1)
                px = x + max(20, (w - total) // 2)
                for t in row:
                    pw = len(t) * 8 + 28
                    cv.add_element(kind="pill", text=t, color="violet", x=px, y=ty, w=pw, h=30)
                    px += pw + 10
                    n["pills"] += 1
                ty += 44
        else:
            title = b.title or (b.lines[0] if b.lines else "")
            sub = "\n".join(b.lines if b.title else b.lines[1:])
            need = 50 + 20 * (sub.count("\n") + 1 if sub else 0)
            b.id = cv.add_element(kind="card", title=title or " ", sub=sub, color="blue", x=x, y=y, w=max(w, 120), h=max(h, need))["id"]
            n["cards"] += 1

    for a, z, label, at in p["arrows"]:
        if not a.id:
            continue
        if z is None:                                             # "→ words" beside a box: a card at the end of an arrow
            r, c = at
            src = cv.get(a.id)                                    # level with the box, so the arrow runs straight
            tid = cv.add_element(kind="card", title=label, color="green", x=max(X(c) + 40, src["x"] + src["w"] + 60),
                                 y=src["y"] + src["h"] // 2 - 28, w=max(140, len(label) * 9 + 40), h=56)["id"]
            n["cards"] += 1
            cv.connect(**{"from": a.id, "to": tid})
        elif z.id and z.id != a.id:
            cv.connect(**{"from": a.id, "to": z.id, **({"label": label} if label else {})})
        else:
            continue
        n["arrows"] += 1

    for r, c, words in p["loose"]:
        # where it was written; moved down until it sits on nothing (cards moved to make room for arrows)
        x, y, w, h = X(c), Y(r), max(60, len(words) * 8 + 10), 24
        hits = lambda y: [e for e in cv.els if e["kind"] != "box" and x < e["x"] + e["w"] and e["x"] < x + w and y < e["y"] + e["h"] and e["y"] < y + h]
        while hits(y):
            y = max(e["y"] + e["h"] for e in hits(y)) + 8
        cv.add_element(kind="text", text=words, size="body", x=x, y=y, w=w, h=h)
        n["text"] += 1

    one = {"boxes": "box", "cards": "card", "pills": "pill", "arrows": "arrow", "text": "text"}
    said = [f"{v} {k if v != 1 else one[k]}" for k, v in n.items() if v]
    return "Drew it from the text drawing: " + ", ".join(said) + ". The lines only showed where things go; edit anything."
