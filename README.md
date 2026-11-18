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
Diagrams save as you draw to `data/` (git-ignored), one JSON file each; `ATELIER_DATA=/somewhere` for another
folder. **Open…** (⌘O) lists them: open, rename, duplicate (save as), download as a `.atelier.json` file to keep
anywhere, delete, or import a file. ⌘S saves now. PNG exports go to your browser's Downloads folder.

## Use it
- **Add** from the left: Card, Title, Heading, Label, Text, **List**, **Table**, **Icon**, **Bars**, Box,
  Pill, **Image** (placed in the middle of the view). Lists, tables and bars are edited as plain lines: one
  item or row per line, cells separated by `|`, a bar as `label | value | note`. `**bold**` works anywhere
  words are shown.
- **Icons:** ~1,500 from [Lucide](https://lucide.dev), bundled — no network, one stroke weight, one licence.
  Search them by name in the panel on the right; a card can carry one instead of an emoji.
- **Bars:** a chart from numbers, not rectangles sized by hand. Change a value and the bar moves.
- **Images:** a screenshot, a photo or a logo, stored beside the diagrams in `data/images` and named by the
  hash of its contents, so the same picture on four slides is kept once. PNG, JPEG, WebP or GIF, up to 12 MB.
- **Edit words** with a double-click (or Enter on the selected one); colour, emoji and size on the right.
- **Arrows:** drag from a dot on a shape's side and drop on another shape. Select an arrow to label it.
- **Resize** from the corners; **move** by dragging. **Select several** by dragging on the canvas, Shift-click, or ⌘A; Delete removes them all.
- **Move around** with Space + drag (or the middle mouse button, or the trackpad); pinch or ⌘-scroll to zoom.
- ⌘Z undo · ⇧⌘Z redo · ⌘D duplicate · Delete removes (a shape's arrows go with it).
- **Grid:** soft lines every 16 (stronger every 80); shapes snap to 8.
- **▭ Frame / Pages:** the frame is page 1. **+ Page** adds another to its right; a strip of numbers along
  the bottom jumps to each. Reading order — left to right, then top to bottom — **is** the page order, so
  reordering a deck is dragging a page. An element belongs to the page its centre is inside; anything
  outside every page is scratch and is not exported. Deleting a page leaves its shapes on the canvas.
- **Export PDF**: every page, in order, as one PDF — drawn as SVG and printed by Chromium, so **the text
  stays text**: selectable, searchable, sharp at any zoom. Needs the browser once:
  `api/.venv/bin/python -m playwright install chromium`.
- **Export PNG**: page 1 (or the whole drawing with no pages), at 2x, on white.

## The AI chat
On the left. Describe a diagram or a change ("draw a RAG pipeline…", "make these teal", "group these as AWS"); select
shapes first to mean "this". Each AI message is one undo step (Undo in the chat, or ⌘Z).
It has 8 tools: read_diagram, add_element, update_element, delete_elements, connect, arrange, group, clear
(`api/app/assist.py`). Model: **Claude Sonnet 5.5 through Anthropic's own API** — not a reseller, so one
account and the real model ids. The key lives outside the repo: `ANTHROPIC_API_KEY` in the environment, or
`~/.atelier/anthropic.env` (`ATELIER_ANTHROPIC_ENV` for another file), or a profile from `ant auth login`.
`ATELIER_MODEL` picks another model and `ATELIER_MODEL_EFFORT` sets the effort level (unset by default).
Without a key a scripted reader handles plain requests ("draw a pipeline: A -> B -> C", "add a card X",
"connect A to B", "make X amber", "delete X"). Tests never call the model: `ATELIER_NO_MODEL=1` forces the
scripted reader, and `ATELIER_LIVE_MODEL=1` lets e2e use the real one.

## Importing a markdown deck
**Open… → Import markdown…** turns a markdown file into pages: one page per `---`, with its headings, lists
and tables as elements you can move. It is a one-way door — once imported, Atelier owns the document, and
importing again would throw away anything you have moved. Pages whose content still runs past the bottom
after the import squeezes the spacing are named, not cut, so you know which ones to tidy.

## Tests
```bash
cd api && .venv/bin/pytest -q            # the API
cd .. && api/.venv/bin/pytest e2e        # the editor in Chrome (build web first)
```

## Next
1. Tidy (automatic layout, elkjs) and templates.
2. More exports (SVG, copy to clipboard).
3. Reordering pages from the strip, rather than by dragging them on the canvas.
