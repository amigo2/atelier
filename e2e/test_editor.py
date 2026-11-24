"""Drawing by hand: add cards, edit their words in place, colour them, connect them with an arrow, resize,
undo and redo, delete; it saves as you go and opens again after a reload; and it exports a PNG."""
import json

from playwright.sync_api import expect

NODE = ".react-flow__node"


def add(page, label):
    """Pick a tool, then click in the middle of the canvas to put it there (as a person does); Esc closes the
    words, which open for typing on anything made of them."""
    page.locator(".tools button", has_text=label).first.click()
    box = page.locator("main.canvas").bounding_box()
    page.mouse.click(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
    if page.locator("textarea.edit").count():
        page.keyboard.press("Escape")


def test_draw_by_hand(page, base_url, data, errors):
    page.set_viewport_size({"width": 1400, "height": 860})
    page.goto(base_url + "/")
    expect(page.locator(".empty")).to_be_visible()

    # a card, its title edited in place
    add(page, "Card")
    card = page.locator(f"{NODE}-card").first
    expect(card).to_contain_text("Title")
    card.dblclick()
    page.keyboard.type("Embed")
    page.keyboard.press("Enter")
    expect(card).to_contain_text("Embed")

    # its colour from the inspector
    page.locator(".insp .sw[aria-label=violet]").click()
    assert "239, 234, 255" in card.locator(".card").evaluate("e => getComputedStyle(e).backgroundColor")

    # a second card, moved to the right, then an arrow between them (drag from a dot to the other card)
    add(page, "Card")
    second = page.locator(f"{NODE}-card").nth(1)
    box = second.bounding_box()
    page.mouse.move(box["x"] + 30, box["y"] + 30)
    page.mouse.down()
    page.mouse.move(box["x"] + 330, box["y"] + 30, steps=8)
    page.mouse.up()
    first_r = card.locator(".react-flow__handle-right")
    card.hover()
    a = first_r.bounding_box()
    b = second.bounding_box()
    page.mouse.move(a["x"] + 4, a["y"] + 4)
    page.mouse.down()
    page.mouse.move(b["x"] + b["width"] / 2, b["y"] + b["height"] / 2, steps=10)
    page.mouse.up()
    expect(page.locator(".react-flow__edge")).to_have_count(1)

    # resize the first one from its corner
    card.click()
    w0 = card.bounding_box()["width"]
    h = card.locator(".react-flow__resize-control.bottom.right").bounding_box()
    page.mouse.move(h["x"] + 4, h["y"] + 4)
    page.mouse.down()
    page.mouse.move(h["x"] + 84, h["y"] + 44, steps=6)
    page.mouse.up()
    assert card.bounding_box()["width"] > w0 + 40

    # delete the second card: its arrow goes with it; undo brings both back, redo takes them away again
    second.click()
    page.keyboard.press("Delete")
    expect(page.locator(f"{NODE}-card")).to_have_count(1)
    expect(page.locator(".react-flow__edge")).to_have_count(0)
    page.keyboard.press("Meta+z")
    expect(page.locator(f"{NODE}-card")).to_have_count(2)
    expect(page.locator(".react-flow__edge")).to_have_count(1)
    page.keyboard.press("Meta+Shift+z")
    expect(page.locator(f"{NODE}-card")).to_have_count(1)
    page.keyboard.press("Meta+z")

    # a title and a box; a name; saved as you go, and back after a reload
    add(page, "Title")
    add(page, "Box")
    page.locator(".name").fill("RAG pipeline")
    expect(page.locator(".saved")).to_have_text("Saved", timeout=5000)
    page.reload()
    expect(page.locator(".name")).to_have_value("RAG pipeline")
    expect(page.locator(f"{NODE}-card")).to_have_count(2)
    expect(page.locator(f"{NODE}-text")).to_have_count(1)
    expect(page.locator(f"{NODE}-box")).to_have_count(1)
    expect(page.locator(".react-flow__edge")).to_have_count(1)
    doc = next(d for d in (json.loads(f.read_text()) for f in data.glob("*.json")) if d["name"] == "RAG pipeline")
    assert doc["name"] == "RAG pipeline" and any(e.get("title") == "Embed" and e["color"] == "violet" for e in doc["elements"])

    # export: a PNG download
    with page.expect_download() as dl:
        page.get_by_role("button", name="PNG", exact=True).click()
    assert dl.value.suggested_filename == "RAG-pipeline.png"
    head = open(dl.value.path(), "rb").read(8)
    assert head == b"\x89PNG\r\n\x1a\n"
    assert errors == []
