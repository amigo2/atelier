# ✦ Atelier

A diagram editor for clean architecture and pipeline visuals (cards, titles, labels, boxes, pills, arrows),
drawn by hand now and with an AI assistant next. Local: diagrams are JSON files on this machine.

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

## Tests
```bash
cd api && .venv/bin/pytest -q            # the API
cd .. && api/.venv/bin/pytest e2e        # the editor in Chrome (build web first)
```

## Next
1. AI assistant beside the canvas, with tools (add, update, delete, connect, group, tidy, read).
2. Tidy (automatic layout) and templates.
3. Acceptance: "draw the RAG pipeline" gets close to `rag-pipeline.png`.
