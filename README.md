# ✦ Atelier

A diagram editor for clean architecture and pipeline visuals (cards, titles, labels, boxes, pills, arrows),
drawn by hand or by an AI assistant with tools. Local: diagrams are JSON files on this machine.

## Run it
```bash
cd web && npm install && npm run build && cd ..
cd api && python3.12 -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/uvicorn app.main:app --port 8100          # http://localhost:8100
```
While working on the editor: `cd web && npm run dev` (http://localhost:5174, proxies /api to :8100).
Diagrams go to `data/` (git-ignored); `ATELIER_DATA=/somewhere` for another folder.

## Use it
- **Add** from the left: Card, Title, Heading, Label, Text, Box, Pill (placed in the middle of the view).
- **Edit words** with a double-click (or Enter on the selected one); colour, emoji and size on the right.
- **Arrows:** drag from a dot on a shape's side and drop on another shape. Select an arrow to label it.
- **Resize** from the corners; **move** by dragging; **select several** with Shift-click or by dragging a box.
- ⌘Z undo · ⇧⌘Z redo · ⌘D duplicate · Delete removes (a shape's arrows go with it).
- **Export PNG**: cropped to the drawing, 2x, on white. Saved as you go.

## The AI chat
On the left. Describe a diagram or a change ("draw a RAG pipeline…", "make these teal", "group these as AWS"); select
shapes first to mean "this". Each AI message is one undo step (Undo in the chat, or ⌘Z).
It has 8 tools: read_diagram, add_element, update_element, delete_elements, connect, arrange, group, clear
(`api/app/assist.py`). Model: Claude Sonnet 5.5 via OpenRouter, key in `~/.sentinel/openrouter.env` (shared with
Sentinel) or `OPENROUTER_API_KEY`; `ATELIER_MODEL` picks another. Without a key a scripted reader handles plain
requests ("draw a pipeline: A -> B -> C", "add a card X", "connect A to B", "make X amber", "delete X").
Tests never call the model (`ATELIER_LIVE_MODEL=1` lets e2e use it).

## Tests
```bash
cd api && .venv/bin/pytest -q            # the API
cd .. && api/.venv/bin/pytest e2e        # the editor in Chrome (build web first)
```

## Next
1. Tidy (automatic layout, elkjs) and templates.
2. More exports (SVG, copy to clipboard).
