"""Drawing with the AI chat (scripted, no model): a pipeline from one sentence, a colour change on what's
selected, Undo taking the AI's step back whole, and the result saved like anything drawn by hand."""
import json

from playwright.sync_api import expect


def say(page, text):
    page.locator(".chat-in textarea").fill(text)
    page.keyboard.press("Enter")
    expect(page.locator(".chat .spin")).to_have_count(0, timeout=30_000)


def test_draw_with_the_ai(page, base_url, data, errors):
    page.set_viewport_size({"width": 1500, "height": 900})
    page.goto(base_url + "/")
    page.get_by_role("button", name="New").click()
    expect(page.locator(".chat-f")).to_contain_text("scripted")

    say(page, "draw a pipeline: Question -> Embed -> Retrieve -> Answer")
    cards = page.locator(".react-flow__node-card")
    expect(cards).to_have_count(4)
    expect(page.locator(".react-flow__edge")).to_have_count(3)
    expect(page.locator(".msg.note").last).to_contain_text("added card Question")
    expect(page.locator(".msg.ai").last).to_contain_text("Drew 4 steps")
    ys = {round(cards.nth(i).bounding_box()["y"]) for i in range(4)}
    assert len(ys) == 1                                                          # one row

    # select one, "make this amber": only it changes
    cards.nth(2).click()
    say(page, "make this amber")
    assert "249, 239, 216" in cards.nth(2).locator(".card").evaluate("e => getComputedStyle(e).backgroundColor")
    assert "233, 240, 255" in cards.nth(0).locator(".card").evaluate("e => getComputedStyle(e).backgroundColor")

    # Undo in the chat takes the whole AI step back; the pipeline before it stays
    say(page, "delete Embed")
    expect(cards).to_have_count(3)
    page.locator(".msg.note .undo").last.click()
    expect(cards).to_have_count(4)
    expect(page.locator(".react-flow__edge")).to_have_count(3)

    # saved like anything else
    page.locator(".name").fill("AI pipeline")
    expect(page.locator(".saved")).to_have_text("Saved", timeout=5000)
    doc = next(json.loads(f.read_text()) for f in data.glob("*.json") if json.loads(f.read_text())["name"] == "AI pipeline")
    assert [e["title"] for e in doc["elements"]] == ["Question", "Embed", "Retrieve", "Answer"]
    assert errors == []
