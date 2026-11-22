# Spec: a real rich-text editor in the details panel

Status: **draft, waiting for approval.** No code until it is approved. (The details panel is already
resizable, so there is room to write in it.)

## Goal

Writing in Atelier looks like what it will be. Select words in the details panel and they turn bold,
red or larger right there, with no markup to read. The canvas shows the same result.

## What exists today

- An element's words are plain text with a little markup: `**bold**`, `*italic*`, `~~struck~~`,
  `{red:coloured}`, and lines starting `* ` or `- ` as bullets.
- On the canvas, double-click edits that text directly, with the markup visible. A small toolbar
  over selected words, plus ⌘B, ⌘I and ⌘⇧X, puts the markup in.
- In the details panel, "Words" and "Line under it" are plain text boxes that show the markup.
- One renderer (`RichText.tsx`) draws it on the canvas and in the PDF.

## Phase 1: the panel editor

### What you can do

| | How |
|---|---|
| **Bold**, *italic*, ~~strike~~ | toolbar, or ⌘B / ⌘I / ⌘⇧X |
| Colour | the 8 palette colours, on selected words |
| **Size** | four named sizes on selected words: small · normal · large · huge |
| Bullets | toolbar, or start a line with `* ` / `- ` (it becomes a bullet as you type) |
| Undo | ⌘Z inside the editor undoes typing. The canvas undo stays as it is |

Sizes are named, not points, for the same reason the palette is fixed: slides stay consistent. The
four sizes are relative to the element's own size (a card title's "large" is larger than a body
text's "large").

### Where it appears

It replaces the plain boxes in the details panel: a card's **Title** and **Line under it**, a text
element's **Words**, a box's **Label** and a pill's text. Lists, tables and bars keep their
line-per-item boxes for now.

### How it is built

- **TipTap** (on ProseMirror), the established library for this. Rich editing in a browser built by
  hand is a well-known trap. Pin the version checked at install. **To measure, not assume:** how
  much it adds to the bundle (expected around 100 KB).
- **The stored text does not change shape.** The editor reads the markup in and writes markup out.
  The AI, the text-drawing import, the PDF, the tests and every saved diagram keep working, and the
  canvas renderer stays the single place that draws text.
- **One addition to the markup, for size and for combining colour with size:**
  `{red,large:words}` means attributes separated by commas, then a colon, then the words. The
  existing `{red:words}` is the same form with one attribute, so old text needs no conversion.

### The tricky part

Converting between the editor and the markup has to be exact both ways, or text slowly corrupts as
it is edited:

- Marks that overlap (bold over half of a red phrase).
- Markup characters typed as plain text (a literal `*` or `{`). These need escaping, and the
  renderer must honour the escape.
- Bullets with several lines, and empty lines.
- **Tests:** a set of round-trip tests (markup → editor → markup gives back the same text) covering
  each of these, before the editor is wired in.

## Phase 2 (later): the same editor on the canvas

Double-click on the canvas opens the same editor instead of the markup box, so there is one way to
edit everywhere and the markup is never seen. It is a separate step because editing inside a zoomed
and panned canvas has its own problems: positioning, focus, and the element growing as you type.

## Out of scope

Fonts other than the one Atelier uses, underline, links, images inside text, alignment per
paragraph (alignment stays per element), tables inside text, and comments.

## How it will be checked

- The round-trip tests above pass.
- In the browser: select words in the panel and make them bold, red and large together. The canvas
  shows exactly that, the PDF export shows it with the text still selectable, and a reload keeps it.
- A diagram saved before this change opens and edits without its text changing.
- The existing e2e and API tests keep passing.
