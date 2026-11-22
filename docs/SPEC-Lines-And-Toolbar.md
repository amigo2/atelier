# Spec: lines you draw, line shapes, and a tidier toolbar

Status: **approved 2026-11-22 (toolbar option A) and built.** Decisions made while building:

- The three line tools: **Line** is curved with no arrowheads, **Arrow** is straight with one
  head, **Elbow** is all right angles with one head.
- Lines are drawn **above** elements (`zIndex: 1`), so a card placed over a line no longer hides
  it.
- Dropping an arrow dragged from a dot uses the same 12 px snapping.
- A box only wins the snap when nothing else is within reach.
- The header fits on one line at 1512 px and wider. Below that, the toolbar scrolls sideways.
- Still to do: e2e tests for the line tool. It was checked with a scripted browser run, but those
  checks are not yet in `e2e/`.

## What exists today

- An arrow can only be made by dragging from a dot on a shape's side to another shape. Dropping
  anywhere on the target shape attaches to its nearest side.
- Every arrow has two ends attached to elements. React Flow draws it, and it follows when either
  shape moves.
- Every arrow looks the same: elbowed (`smoothstep`), grey, 1.5 px, with an arrowhead at the end.
  When selected, the right panel offers a label and Delete, nothing else.
- The toolbar is one flat row of 12 buttons: Card, Title, Heading, Label, Text, List, Table,
  Icon, Bars, Box, Pill, Image.

## 1. Draw a line from the toolbar

A **Line** tool, in addition to dragging from a dot (which stays as it is).

- Pick **Line**, press on the canvas, drag, release. That draws a line from where you pressed to
  where you let go. The tool switches back to normal selection afterwards. Esc cancels.
- **Gentle snapping.** If an end is released within **12 px of any element's edge** (card, text,
  box, pill, list, table, image, icon, chart), it attaches to that edge, on the nearest side. From
  then on it follows the element when it moves. Further away than that, the end stays where you
  dropped it, free on the canvas.
- While dragging, the side that would be snapped to is highlighted, so you see it before you let
  go.
- A free end can be dragged later. Drag it near an edge and it snaps the same way. Drag an
  attached end away and it comes loose.

**How it's stored.** An arrow already joins two elements. A free end becomes a tiny invisible
`point` element where the end sits. That way every line is still an ordinary React Flow edge that
follows what it's attached to, and old diagrams don't change. Points are hidden in the editor
except as a small handle on a selected line. They never appear in PNG or PDF exports, and the AI's
view of the diagram doesn't list them as elements.

## 2. Line shape controls

When a line or arrow is selected, the right panel shows three small controls, plus the label and
Delete:

| Control | Options | Default |
|---|---|---|
| **Shape** | Straight · Curved · Elbow | Elbow for arrows dragged from a dot (as today), Curved for lines drawn with the tool |
| **Ends** | None · Arrow at end · Arrows at both ends | Arrow at end |
| **Style** | Solid · Dashed | Solid |

The colour swatches work the same way as for shapes.

Curved is a smooth bezier: it leaves each element straight out of its side and bends between the
two. These go into the file as three optional fields on an arrow (`shape`, `ends`, `dash`). An
arrow without them looks exactly as it does today.

The AI's `connect` tool gets the same three options, so "connect these with a dashed curve" works.

## 3. A grouped toolbar

The same tools, grouped so you can find them:

| Group | Contains |
|---|---|
| **Shapes** | Card, Box, Pill |
| **Text** | Title, Heading, Label, Text |
| **Lines** | Line (curved), Arrow (straight), Elbow arrow |
| **Extras** | List, Table, Bars, Icon, Image |

Decision needed: how the groups appear.
- **(A) Buttons with dividers.** Everything visible, one click, just grouped and labelled. 15
  buttons wide.
- **(B) One menu per group.** Four buttons: click "Text ▾" and pick from it. Narrower, but two
  clicks for everything.
- **Recommendation: (A)**, with a tiny group label above each cluster. One click matters in a tool
  you use for hours, and the header has room once the groups are tidy.

## Out of scope for now

- Bending a line by dragging its middle. Curved/Elbow are automatic.
- Lines through several points (polylines).
- Free-hand ink. That is the pen in the roadmap, a separate piece of work.

## How it will be checked

- In the browser, against a throwaway server:
  - Draw a line between two cards: both ends snap, and the line follows when a card moves.
  - Draw one ending 30 px from a card: that end stays free. Then drag that end close: it snaps.
  - Each shape, ends and style option shows on screen and survives a reload.
  - PNG and PDF exports show the line but no point handles.
- The existing e2e and API tests keep passing. New e2e tests cover drawing a line, snapping, and
  the shape controls.
