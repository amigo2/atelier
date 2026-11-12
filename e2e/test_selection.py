"""Selecting and moving around like Figma or Miro: drag on the canvas draws a selection box, Shift-click adds,
Delete removes all of them (one undo brings them back), ⌘A selects everything, and Space + drag pans the view
without moving anything. The chat shows how many are selected."""
from playwright.sync_api import expect


def say(page, text):
    page.locator(".chat-in textarea").fill(text)
    page.keyboard.press("Enter")
    expect(page.locator(".chat .spin")).to_have_count(0, timeout=30_000)


def test_select_delete_pan(page, base_url, errors):
    page.set_viewport_size({"width": 1500, "height": 900})
    page.goto(base_url + "/")
    page.get_by_role("button", name="New").click()
    say(page, "draw a pipeline: One -> Two -> Three -> Four")
    cards = page.locator(".react-flow__node-card")
    expect(cards).to_have_count(4)
    page.wait_for_timeout(500)                                                   # the zoom to fit

    # a selection box from empty canvas over the first two
    a, b = cards.nth(0).bounding_box(), cards.nth(1).bounding_box()
    page.mouse.move(a["x"] - 30, a["y"] - 30)
    page.mouse.down()
    page.mouse.move(b["x"] + b["width"] / 2, b["y"] + b["height"] + 30, steps=8)
    page.mouse.up()
    expect(page.locator(".react-flow__node-card.selected")).to_have_count(2)
    expect(page.locator(".insp h3")).to_have_text("2 selected")
    expect(page.locator(".sel-chip")).to_contain_text("2 selected")

    # Shift-click adds a third; Delete removes all three and their arrows; one undo brings them all back
    cards.nth(2).click(modifiers=["Shift"])
    expect(page.locator(".react-flow__node-card.selected")).to_have_count(3)
    page.keyboard.press("Delete")
    expect(cards).to_have_count(1)
    expect(page.locator(".react-flow__edge")).to_have_count(0)
    page.keyboard.press("Meta+z")
    expect(cards).to_have_count(4)
    expect(page.locator(".react-flow__edge")).to_have_count(3)

    # ⌘A selects everything; Escape lets go
    page.locator(".react-flow__pane").click(position={"x": 20, "y": 20})
    page.keyboard.press("Meta+a")
    expect(page.locator(".react-flow__node-card.selected")).to_have_count(4)
    page.keyboard.press("Escape")
    expect(page.locator(".react-flow__node-card.selected")).to_have_count(0)

    # Space + drag pans: everything moves on screen together, nothing moves in the diagram, nothing selected
    before = page.locator(".react-flow__viewport").get_attribute("style")
    x0 = cards.nth(0).bounding_box()["x"]
    page.mouse.move(700, 700)
    page.keyboard.down("Space")
    page.mouse.down()
    page.mouse.move(850, 650, steps=8)
    page.mouse.up()
    page.keyboard.up("Space")
    assert page.locator(".react-flow__viewport").get_attribute("style") != before
    assert abs(cards.nth(0).bounding_box()["x"] - (x0 + 150)) < 3
    expect(page.locator(".react-flow__node-card.selected")).to_have_count(0)
    assert errors == []
