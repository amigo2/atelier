"""The export frame: off by default (export crops to the drawing); on, a dashed frame of the chosen size is drawn
on the canvas, the PNG is exactly that size (2x), and the frame is saved with the diagram."""
import json
import struct

from playwright.sync_api import expect


def png_size(path):
    with open(path, "rb") as f:
        head = f.read(24)
    return struct.unpack(">II", head[16:24])


def test_export_frame(page, base_url, data):
    page.set_viewport_size({"width": 1500, "height": 900})
    page.goto(base_url + "/")
    page.get_by_role("button", name="New").click()
    page.locator(".tools button", has_text="Card").first.click()
    expect(page.locator(".xframe")).to_have_count(0)
    expect(page.locator(".react-flow__background")).to_have_count(2)            # the soft grid: minor and major lines

    frame_btn = page.get_by_role("button", name="▭ Frame")
    frame_btn.click()
    expect(page.locator(".xframe")).to_be_visible()
    expect(page.locator(".xframe-l")).to_have_text("Export · 1600 × 900")
    with page.expect_download() as dl:
        page.get_by_role("button", name="PNG", exact=True).click()
    assert png_size(dl.value.path()) == (3200, 1800)                             # exactly the frame, at 2x

    page.locator("select.preset").select_option("square")
    expect(page.locator(".xframe-l")).to_have_text("Export · 1080 × 1080")
    with page.expect_download() as dl:
        page.get_by_role("button", name="PNG", exact=True).click()
    assert png_size(dl.value.path()) == (2160, 2160)

    page.locator(".name").fill("Framed")
    expect(page.locator(".saved")).to_have_text("Saved", timeout=5000)
    doc = next(d for d in (json.loads(f.read_text()) for f in data.glob("*.json")) if d["name"] == "Framed")
    assert doc["frame"]["w"] == 1080 and doc["frame"]["preset"] == "square"
    page.reload()
    expect(page.locator(".xframe-l")).to_have_text("Export · 1080 × 1080")

    frame_btn.click()                                                            # off: back to cropping to the drawing
    expect(page.locator(".xframe")).to_have_count(0)
    with page.expect_download() as dl:
        page.get_by_role("button", name="PNG", exact=True).click()
    # a new card is the size of its words, so read its size rather than assume one
    card = page.locator(".react-flow__node-card").first
    w, h = card.evaluate("n => [n.offsetWidth, n.offsetHeight]")
    assert png_size(dl.value.path()) == ((w + 80) * 2, (h + 80) * 2)
