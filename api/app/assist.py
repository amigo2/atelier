"""The AI chat beside the canvas. It works on the diagram through tools, on a copy: the editor sends the diagram,
what's selected and the message; the model reads, adds, changes, connects, groups and arranges; the new diagram
goes back to the editor as one change (one undo step). Positions and sizes are worked out here, so the model
says "a card after Embed", not coordinates, unless it wants to.

Without a model (no key, or any failure) a scripted reader handles the plain requests ("draw a pipeline:
A -> B -> C", "add a card X", "connect A to B", "make X amber", "delete X"), so tests never call the model.
"""
import copy
import json
import logging
import re

from . import llm

log = logging.getLogger("atelier.assist")
ROUNDS = 12   # model turns per message: tool calls, then the answer

COLORS = ["ink", "grey", "blue", "violet", "teal", "green", "amber", "red"]
KINDS = ["card", "text", "box", "pill"]
SIZES = ["title", "heading", "label", "body"]
GAP = 36
DEFAULT = {"card": (180, 110), "box": (420, 260), "pill": (110, 28)}
TEXT_H = {"title": 44, "heading": 32, "label": 24, "body": 60}
CHAR_W = {"title": 15.5, "heading": 10.5, "label": 8.6, "body": 7.6}
ALIGNS = ["left", "center", "right"]
SHAPES = ["straight", "curved", "elbow"]
ENDS = ["none", "end", "both"]
FIELDS = ("title", "sub", "emoji", "text", "size", "align", "color", "x", "y", "w", "h")

_place = {"type": "object", "properties": {
    "after": {"type": "string", "description": "An element id: put the new one next to it"},
    "side": {"type": "string", "enum": ["right", "below", "left", "above"], "description": "Which side of `after` (default right)"},
    "x": {"type": "number"}, "y": {"type": "number"}, "w": {"type": "number"}, "h": {"type": "number"}}}

TOOLS = [
    {"type": "function", "function": {
        "name": "read_diagram",
        "description": "Everything on the canvas: each element's id, kind, position, size, colour and words, and the arrows. "
                       "The diagram is also given with the message; read it again after many changes if unsure.",
        "parameters": {"type": "object", "properties": {}}}},
    {"type": "function", "function": {
        "name": "add_element",
        "description": "Add one element. card: a step or a part (emoji, title, a short line under it). text: a title, heading, "
                       "small section label (capitals) or a paragraph. box: a frame around a group, with a small label. pill: a "
                       "small tag, e.g. a legend entry. Place it next to another with after+side, or give x/y; with neither it "
                       "goes below everything. Returns its id.",
        "parameters": {"type": "object", "properties": {
            "kind": {"type": "string", "enum": KINDS},
            "title": {"type": "string", "description": "card or box"},
            "sub": {"type": "string", "description": "card: one short line under the title"},
            "emoji": {"type": "string", "description": "card: one emoji before the title"},
            "text": {"type": "string", "description": "text or pill"},
            "size": {"type": "string", "enum": SIZES, "description": "text only"},
            "align": {"type": "string", "enum": ALIGNS, "description": "card or text: where the words sit (default left)"},
            "color": {"type": "string", "enum": COLORS},
            **_place["properties"]}, "required": ["kind"]}}},
    {"type": "function", "function": {
        "name": "update_element",
        "description": "Change an element: its words, emoji, colour, text size, alignment, position (x, y) or size (w, h). Only what is given changes.",
        "parameters": {"type": "object", "properties": {
            "id": {"type": "string"}, "title": {"type": "string"}, "sub": {"type": "string"}, "emoji": {"type": "string"},
            "text": {"type": "string"}, "size": {"type": "string", "enum": SIZES}, "align": {"type": "string", "enum": ALIGNS},
            "color": {"type": "string", "enum": COLORS}, "x": {"type": "number"}, "y": {"type": "number"}, "w": {"type": "number"}, "h": {"type": "number"}}, "required": ["id"]}}},
    {"type": "function", "function": {
        "name": "delete_elements",
        "description": "Delete elements (their arrows go too) or arrows, by id.",
        "parameters": {"type": "object", "properties": {"ids": {"type": "array", "items": {"type": "string"}}}, "required": ["ids"]}}},
    {"type": "function", "function": {
        "name": "connect",
        "description": "Draw an arrow from one element to another, optionally labelled. The sides are chosen from where they are.",
        "parameters": {"type": "object", "properties": {
            "from": {"type": "string"}, "to": {"type": "string"}, "label": {"type": "string", "description": "A few words, e.g. HTTPS 443"},
            "shape": {"type": "string", "enum": SHAPES, "description": "default elbow"},
            "ends": {"type": "string", "enum": ENDS, "description": "arrowheads: none (a plain line), end (default) or both"},
            "dash": {"type": "boolean", "description": "a dashed line, e.g. for something optional or async"},
            "color": {"type": "string", "enum": COLORS}},
            "required": ["from", "to"]}}},
    {"type": "function", "function": {
        "name": "arrange",
        "description": "Line elements up in a row (left to right) or a column (top to bottom), evenly spaced, starting where the first one is. "
                       "Use it for a pipeline of steps or a set of decision boxes.",
        "parameters": {"type": "object", "properties": {
            "ids": {"type": "array", "items": {"type": "string"}, "description": "In order"},
            "direction": {"type": "string", "enum": ["row", "column"]},
            "gap": {"type": "number", "description": "Space between them (default 36)"}}, "required": ["ids", "direction"]}}},
    {"type": "function", "function": {
        "name": "group",
        "description": "Draw a box around some elements, with a small label at its top (e.g. AWS · eu-west-1, or a section name).",
        "parameters": {"type": "object", "properties": {
            "ids": {"type": "array", "items": {"type": "string"}}, "title": {"type": "string"},
            "color": {"type": "string", "enum": COLORS}}, "required": ["ids", "title"]}}},
    {"type": "function", "function": {
        "name": "clear",
        "description": "Remove everything from the canvas. Only when they ask to start again.",
        "parameters": {"type": "object", "properties": {}}}},
]

SYSTEM = """You draw and edit diagrams on a canvas with the user, like a designer who is quick and tidy. The look is \
clean and modern, like an architecture or pipeline diagram in a good README:
- A title at the top (text, size title, colour ink), often starting with an emoji.
- Small section labels in capitals above each part (text, size label).
- Steps or components as cards: an emoji, a short title (1 to 3 words), one short line under it (under 8 words). \
A pipeline is cards in a row joined by arrows, left to right.
- Panels (decisions, notes) as boxes with a label and a body text inside; a legend as pills at the bottom.
- Colour carries meaning, used consistently: violet for models and AI, teal for data and retrieval, blue for services \
and APIs, amber for guardrails and checks, green for outputs and success, red for failures, grey for neutral frames, \
ink for the starting point or plain text.

How you work:
- Use the tools; call several in one turn when they don't depend on each other. Put new things next to related ones \
(after + side) rather than guessing coordinates; use arrange to line up a row of steps.
- When a request needs an element you just added, use the id add_element returned. Never invent ids.
- "This", "it", "these" mean the selected elements, listed with the message.
- If the diagram has a frame, it is the exported picture: keep everything inside it, with a margin of about 50, \
and use its width (a row of steps spread across it, panels sized to fill it).
- Change only what they asked for. Keep words short; no full sentences on cards.
- Line up anything meant as a row or column (steps, panels, a legend of pills) with arrange, so the spacing is even.
- Before you answer, after building or moving several things: call read_diagram and check every step of a flow is connected to the next and nothing overlaps; fix what isn't right.
- When done, reply in one or two plain sentences saying what you did. No markdown."""


# ------------------------------------------------------------------ the diagram, changed by the tools

class Canvas:
    def __init__(self, doc: dict):
        self.doc = copy.deepcopy(doc)
        self.doc.setdefault("elements", [])
        self.doc.setdefault("arrows", [])
        self.steps: list[str] = []
        self._n = 0

    @property
    def els(self) -> list[dict]:
        return self.doc["elements"]

    def get(self, i: str) -> dict:
        e = next((e for e in self.els if e["id"] == i), None)
        if not e:
            raise ValueError(f"no element {i}")
        return e

    def _id(self, kind: str) -> str:
        self._n += 1
        base = re.sub(r"[^a-z0-9]+", "-", kind)
        i = f"{base}-ai{self._n}"
        while any(e["id"] == i for e in self.els) or any(a["id"] == i for a in self.doc["arrows"]):
            self._n += 1
            i = f"{base}-ai{self._n}"
        return i

    def summary(self, selected: list[str] | None = None) -> dict:
        words = lambda e: {k: e[k] for k in ("title", "sub", "emoji", "text", "size", "align") if e.get(k)}
        # A free line end is stored as a `point` element. It is a detail of the line, not something on the page.
        pts = {e["id"] for e in self.els if e["kind"] == "point"}
        end = lambda i: "(free end)" if i in pts else i
        style = lambda a: {k: a[k] for k in ("label", "shape", "ends", "dash", "color") if a.get(k)}
        return {"elements": [{"id": e["id"], "kind": e["kind"], "x": e["x"], "y": e["y"], "w": e["w"], "h": e["h"], "color": e.get("color"), **words(e),
                              **({"locked": True} if e.get("locked") else {})} for e in self.els if e["kind"] != "point"],
                "arrows": [{"id": a["id"], "from": end(a["from"]), "to": end(a["to"]), **style(a)} for a in self.doc["arrows"]],
                **({"frame": {k: self.doc["frame"][k] for k in ("x", "y", "w", "h")}} if self.doc.get("frame") else {}),
                **({"selected": selected} if selected is not None else {})}

    # --- sizes and places

    @staticmethod
    def _size(a: dict) -> tuple[int, int]:
        k = a["kind"]
        if k == "text":
            z = a.get("size") or "body"
            txt = a.get("text") or ""
            if z == "body":
                return int(a.get("w") or 320), int(a.get("h") or max(TEXT_H["body"], 22 * (1 + len(txt) // 42)))
            return int(a.get("w") or min(900, max(80, len(txt) * CHAR_W[z] + 24))), int(a.get("h") or TEXT_H[z])
        if k == "pill":
            return int(a.get("w") or max(80, len(a.get("text") or "") * 7.4 + 32)), int(a.get("h") or 28)
        w, h = DEFAULT[k]
        return int(a.get("w") or w), int(a.get("h") or h)

    def _spot(self, a: dict, w: int, h: int) -> tuple[int, int]:
        if a.get("x") is not None and a.get("y") is not None:
            return int(a["x"]), int(a["y"])
        if a.get("after"):
            o = self.get(a["after"])
            side = a.get("side") or "right"
            if side == "right":
                return o["x"] + o["w"] + GAP, o["y"]
            if side == "left":
                return o["x"] - w - GAP, o["y"]
            if side == "below":
                return o["x"], o["y"] + o["h"] + GAP
            return o["x"], o["y"] - h - GAP
        f = self.doc.get("frame")
        if not self.els:
            return (f["x"] + 60, f["y"] + 50) if f else (0, 0)
        return min(e["x"] for e in self.els), max(e["y"] + e["h"] for e in self.els) + 40

    # --- the tools

    def read_diagram(self) -> dict:
        return self.summary()

    def add_element(self, **a) -> dict:
        k = a.get("kind")
        if k not in KINDS:
            raise ValueError(f"kind must be one of {KINDS}")
        w, h = self._size(a)
        x, y = self._spot(a, w, h)
        color = a.get("color") if a.get("color") in COLORS else {"card": "blue", "box": "grey", "pill": "blue", "text": "ink"}[k]
        e = {"id": self._id(k), "kind": k, "x": int(x), "y": int(y), "w": w, "h": h, "color": color}
        for f in ("title", "sub", "emoji", "text"):
            if a.get(f):
                e[f] = str(a[f])
        if a.get("align") in ALIGNS and a["align"] != "left" and k in ("card", "text"):
            e["align"] = a["align"]
        if k == "text":
            e["size"] = a.get("size") if a.get("size") in SIZES else "body"
            e.setdefault("text", "Text")
            if e["size"] == "label":
                e["color"] = "grey"
        if k == "card":
            e.setdefault("title", "Title")
        if k == "box":
            self.els.insert(0, e)    # frames sit behind
        else:
            self.els.append(e)
        self.steps.append(f"added {k} {e.get('title') or e.get('text') or ''}".strip())
        return {"id": e["id"], "x": e["x"], "y": e["y"], "w": w, "h": h}

    def _unlocked(self, e: dict) -> dict:
        if e.get("locked"):
            raise ValueError(f"{e.get('title') or e.get('text') or e['id']} is locked: leave it as it is, or ask the person to unlock it")
        return e

    def update_element(self, id: str, **a) -> dict:
        e = self._unlocked(self.get(id))
        changed = []
        for f in FIELDS:
            if f not in a or a[f] is None:
                continue
            v = a[f]
            if f == "color" and v not in COLORS:
                raise ValueError(f"colour must be one of {COLORS}")
            if f == "size" and v not in SIZES:
                raise ValueError(f"size must be one of {SIZES}")
            if f == "align" and v not in ALIGNS:
                raise ValueError(f"align must be one of {ALIGNS}")
            e[f] = int(v) if f in ("x", "y", "w", "h") else str(v)
            changed.append(f)
        self.steps.append(f"changed {e.get('title') or e.get('text') or id}: {', '.join(changed)}")
        return {"id": id, "changed": changed}

    def delete_elements(self, ids: list[str]) -> dict:
        kept = [e.get("title") or e.get("text") or e["id"] for e in self.els if e["id"] in ids and e.get("locked")]
        gone = {i for i in ids if not any(e["id"] == i and e.get("locked") for e in self.els)}
        names = [e.get("title") or e.get("text") or e["id"] for e in self.els if e["id"] in gone]
        self.doc["elements"] = [e for e in self.els if e["id"] not in gone]
        self.doc["arrows"] = [a for a in self.doc["arrows"] if a["id"] not in gone and a["from"] not in gone and a["to"] not in gone]
        # a free line end whose line is gone has nothing left to do
        used = {x for ar in self.doc["arrows"] for x in (ar["from"], ar["to"])}
        self.doc["elements"] = [e for e in self.els if e["kind"] != "point" or e["id"] in used]
        if gone:
            self.steps.append(f"deleted {', '.join(names) or 'arrows'}")
        return {"deleted": sorted(gone), **({"kept_locked": kept} if kept else {})}

    def connect(self, **a) -> dict:
        f, t = self.get(a["from"]), self.get(a["to"])
        if f["id"] == t["id"]:
            raise ValueError("an arrow needs two different elements")
        dx = (t["x"] + t["w"] / 2) - (f["x"] + f["w"] / 2)
        dy = (t["y"] + t["h"] / 2) - (f["y"] + f["h"] / 2)
        sides = (("r", "l") if dx > 0 else ("l", "r")) if abs(dx) >= abs(dy) else (("b", "t") if dy > 0 else ("t", "b"))
        arrow = {"id": self._id("a"), "from": f["id"], "to": t["id"], "fromSide": sides[0], "toSide": sides[1]}
        if a.get("label"):
            arrow["label"] = str(a["label"])
        if a.get("shape") in SHAPES and a["shape"] != "elbow":
            arrow["shape"] = a["shape"]
        if a.get("ends") in ENDS and a["ends"] != "end":
            arrow["ends"] = a["ends"]
        if a.get("dash"):
            arrow["dash"] = True
        if a.get("color") in COLORS:
            arrow["color"] = a["color"]
        self.doc["arrows"].append(arrow)
        self.steps.append(f"connected {f.get('title') or f.get('text') or f['id']} → {t.get('title') or t.get('text') or t['id']}")
        return {"id": arrow["id"]}

    def arrange(self, ids: list[str], direction: str, gap: float | None = None) -> dict:
        es = [self._unlocked(self.get(i)) for i in ids]
        if not es:
            return {"arranged": []}
        g = int(gap if gap is not None else GAP)
        x, y = es[0]["x"], es[0]["y"]
        for e in es:
            e["x"], e["y"] = x, y
            if direction == "row":
                x += e["w"] + g
            else:
                y += e["h"] + g
        if direction == "row":                    # one height, so a row of cards reads as one
            hmax = max(e["h"] for e in es if e["kind"] == "card") if any(e["kind"] == "card" for e in es) else None
            for e in es:
                if hmax and e["kind"] == "card":
                    e["h"] = hmax
        self._reside(set(ids))
        self.steps.append(f"lined up {len(es)} in a {direction}")
        return {"arranged": ids}

    def _reside(self, moved: set[str]):
        """Arrows touching moved elements pick their sides again."""
        for a in self.doc["arrows"]:
            if a["from"] in moved or a["to"] in moved:
                f, t = self.get(a["from"]), self.get(a["to"])
                dx = (t["x"] + t["w"] / 2) - (f["x"] + f["w"] / 2)
                dy = (t["y"] + t["h"] / 2) - (f["y"] + f["h"] / 2)
                a["fromSide"], a["toSide"] = (("r", "l") if dx > 0 else ("l", "r")) if abs(dx) >= abs(dy) else (("b", "t") if dy > 0 else ("t", "b"))

    def group(self, ids: list[str], title: str, color: str | None = None) -> dict:
        es = [self.get(i) for i in ids]
        if not es:
            raise ValueError("nothing to group")
        pad, top = 20, 44
        x0, y0 = min(e["x"] for e in es) - pad, min(e["y"] for e in es) - top
        x1, y1 = max(e["x"] + e["w"] for e in es) + pad, max(e["y"] + e["h"] for e in es) + pad
        r = self.add_element(kind="box", title=title, color=color if color in COLORS else "grey", x=x0, y=y0, w=x1 - x0, h=y1 - y0)
        self.steps[-1] = f"grouped {len(es)} as {title}"
        return r

    def clear(self) -> dict:
        # what is locked stays, with any arrow whose both ends stay
        keep = [e for e in self.els if e.get("locked")]
        ids = {e["id"] for e in keep}
        self.doc["elements"] = keep
        self.doc["arrows"] = [a for a in self.doc["arrows"] if a["from"] in ids and a["to"] in ids]
        self.steps.append("cleared the canvas" + (f", kept {len(keep)} locked" if keep else ""))
        return {"cleared": True, **({"kept_locked": len(keep)} if keep else {})}

    def call(self, name: str, args: dict):
        fn = {"read_diagram": self.read_diagram, "add_element": self.add_element, "update_element": self.update_element,
              "delete_elements": self.delete_elements, "connect": self.connect, "arrange": self.arrange,
              "group": self.group, "clear": self.clear}.get(name)
        if not fn:
            raise ValueError(f"no tool {name}")
        return fn(**args)


# ------------------------------------------------------------------ one message

def assist(body: dict) -> dict:
    doc, text = body.get("doc") or {}, (body.get("text") or "").strip()
    selected = [i for i in body.get("selected") or [] if isinstance(i, str)]
    chat = [m for m in body.get("chat") or [] if m.get("role") in ("user", "assistant") and isinstance(m.get("content"), str)][-12:]
    if not text:
        return {"reply": "Say what to draw or change.", "doc": doc, "steps": [], "live": llm.live()}
    if llm.live():
        try:
            return {**_live(doc, selected, chat, text), "live": True}
        except llm.LLMError as e:
            log.warning("model failed, scripted reply instead: %s", e)
            return {**_scripted(doc, selected, text), "live": True, "fallback": True}
    return {**_scripted(doc, selected, text), "live": False}


def _live(doc: dict, selected: list[str], chat: list[dict], text: str) -> dict:
    cv = Canvas(doc)
    msgs = [*chat, {"role": "user", "content": f"{text}\n\nThe diagram now: {json.dumps(cv.summary(selected), ensure_ascii=False)}"}]
    for _ in range(ROUNDS):
        m = llm.complete_tools(SYSTEM, msgs, TOOLS)
        calls = m["tool_calls"]
        if not calls:
            return {"reply": m["content"].strip() or "Done.", "doc": cv.doc, "steps": cv.steps}
        msgs.append({"role": "assistant", "content": m["content"] or None, "tool_calls": calls})
        for c in calls:
            try:
                args = json.loads(c["function"].get("arguments") or "{}")
                out = cv.call(c["function"]["name"], args)
            except (ValueError, TypeError, KeyError, json.JSONDecodeError) as e:
                out = {"error": str(e)}
            msgs.append({"role": "tool", "tool_call_id": c["id"], "content": json.dumps(out, ensure_ascii=False)})
    return {"reply": "That took more steps than I allow for one message; here is how far I got.", "doc": cv.doc, "steps": cv.steps}


# ------------------------------------------------------------------ without a model

COLOR_WORDS = {"black": "ink", "ink": "ink", "grey": "grey", "gray": "grey", "blue": "blue", "purple": "violet", "violet": "violet",
               "teal": "teal", "green": "green", "amber": "amber", "orange": "amber", "yellow": "amber", "red": "red"}


def _find(cv: Canvas, words: str, selected: list[str]) -> list[dict]:
    w = words.strip().strip(".!?\"' ").lower()
    if w in ("this", "it", "these", "them", "the selected", "selected", "that"):
        return [e for e in cv.els if e["id"] in selected]
    name = lambda e: (e.get("title") or e.get("text") or "").lower()
    exact = [e for e in cv.els if name(e) == w]
    return exact or [e for e in cv.els if w and w in name(e)][:1]


def _scripted(doc: dict, selected: list[str], text: str) -> dict:
    cv, low = Canvas(doc), text.strip()
    done = lambda reply: {"reply": reply, "doc": cv.doc, "steps": cv.steps}
    try:
        # "draw a pipeline: Question -> Embed -> Retrieve"  (or →, >, "then")
        parts = [p.strip(" .") for p in re.split(r"\s*(?:->|→|=>|>)\s*", re.sub(r"^.*?:\s*", "", low, count=1) if ":" in low else low)]
        if len(parts) >= 2 and all(parts) and re.search(r"->|→|=>|>", low):
            prev = None
            for p in parts:
                r = cv.add_element(kind="card", title=p, **({"after": prev, "side": "right"} if prev else {}))
                if prev:
                    cv.connect(**{"from": prev, "to": r["id"]})
                prev = r["id"]
            return done(f"Drew {len(parts)} steps in a row, joined by arrows.")
        m = re.match(r"(?i)^(?:add|draw|create)\s+(?:a|an)\s+(card|title|heading|label|text|box|pill)\b(?:\s+(?:called|named|saying|for))?\s*[:\"']?(.*?)[\"']?$", low)
        if m:
            kind, words = m.group(1).lower(), m.group(2).strip()
            if kind in ("title", "heading", "label"):
                r = cv.add_element(kind="text", size=kind, text=words or kind.capitalize())
            elif kind == "text":
                r = cv.add_element(kind="text", size="body", text=words or "Text")
            elif kind == "pill":
                r = cv.add_element(kind="pill", text=words or "label")
            else:
                r = cv.add_element(kind=kind, title=words or ("GROUP" if kind == "box" else "Title"),
                                   **({"after": selected[-1], "side": "right"} if selected and kind == "card" else {}))
            return done(f"Added a {kind}.")
        m = re.match(r"(?i)^connect\s+(.+?)\s+(?:to|with|and)\s+(.+?)$", low)
        if m:
            a, b = _find(cv, m.group(1), selected), _find(cv, m.group(2), selected)
            if a and b:
                cv.connect(**{"from": a[0]["id"], "to": b[0]["id"]})
                return done("Connected them.")
            return done("I couldn't find both of those on the canvas.")
        m = re.match(r"(?i)^(?:make|colou?r|paint|turn)\s+(.+?)\s+(?:to\s+|in\s+)?(\w+)$", low)
        if m and m.group(2).lower() in COLOR_WORDS:
            es = _find(cv, m.group(1), selected)
            for e in es:
                cv.update_element(e["id"], color=COLOR_WORDS[m.group(2).lower()])
            return done(f"Made {len(es)} {m.group(2).lower()}." if es else "I couldn't find that on the canvas.")
        m = re.match(r"(?i)^(?:delete|remove)\s+(.+?)$", low)
        if m:
            es = _find(cv, m.group(1), selected)
            if es:
                cv.delete_elements([e["id"] for e in es])
                return done(f"Deleted {len(es)}.")
            return done("I couldn't find that on the canvas.")
        if re.match(r"(?i)^(?:clear|start again|start over)\b", low):
            cv.clear()
            return done("Cleared the canvas.")
    except ValueError as e:
        return done(f"That didn't work: {e}")
    return done("Without the live model I understand: \"draw a pipeline: A -> B -> C\", \"add a card X\", "
                "\"connect A to B\", \"make X amber\", \"delete X\", \"clear\".")
