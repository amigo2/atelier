"""Saving and opening properly: New gives unique names, ⌘S saves now, and the Open window lists each diagram with
its shape count and lets you open, rename, duplicate, download, delete (after a confirm) and import a file."""
import json

from playwright.sync_api import expect


def row_of(dlg, name):
    """The row whose name is exactly this (not one that only contains it)."""
    return dlg.locator(".dlg-row").filter(has=dlg.page.get_by_text(name, exact=True))


def place(page, label):
    """Pick a tool, then click in the middle of the canvas to put it there (as a person does); Esc closes the
    words, which open for typing on anything made of them."""
    page.locator(".tools button", has_text=label).first.click()
    box = page.locator("main.canvas").bounding_box()
    page.mouse.click(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
    if page.locator("textarea.edit").count():
        page.keyboard.press("Escape")


def test_save_and_open(page, base_url, data, tmp_path):
    page.set_viewport_size({"width": 1500, "height": 900})
    page.goto(base_url + "/")

    page.get_by_role("button", name="New").click()
    first = page.locator(".name").input_value()
    place(page, "Card")
    page.keyboard.press("Meta+s")
    expect(page.locator(".toast")).to_have_text(f"Saved “{first}”")
    page.get_by_role("button", name="New").click()
    expect(page.locator(".react-flow__node")).to_have_count(0)
    expect(page.locator(".name")).not_to_have_value(first)                         # never two with the same name
    assert page.locator(".name").input_value().startswith("Untitled")

    # the Open window (⌘O): the first one, with its shape count; rename it
    page.locator(".tools button", has_text="Title").first.click()
    expect(page.locator(".saved")).to_have_text("Saved", timeout=5000)
    page.keyboard.press("Meta+o")
    dlg = page.get_by_role("dialog", name="Your diagrams")
    row = row_of(dlg, first)
    expect(row).to_contain_text("1 shape")
    row.hover()
    row.get_by_role("button", name="Rename").click()
    dlg.get_by_label("New name").fill("Pipeline v1")
    page.keyboard.press("Enter")
    row = row_of(dlg, "Pipeline v1")
    expect(row).to_be_visible()

    # duplicate (save as), download, then open it
    row.hover()
    row.get_by_role("button", name="Duplicate").click()
    expect(row_of(dlg, "Pipeline v1 copy")).to_be_visible()
    row.hover()
    with page.expect_download() as dl:
        row.get_by_role("button", name="Download").click()
    assert dl.value.suggested_filename == "Pipeline-v1.atelier.json"
    saved = tmp_path / "pipeline.atelier.json"
    dl.value.save_as(saved)
    assert json.loads(saved.read_text())["name"] == "Pipeline v1"
    row.locator(".dlg-name").click()
    expect(page.locator(".name")).to_have_value("Pipeline v1")
    expect(page.locator(".react-flow__node-card")).to_have_count(1)

    # delete the copy, after a confirm
    page.get_by_role("button", name="Open…").click()
    copy = row_of(dlg, "Pipeline v1 copy")
    copy.hover()
    copy.get_by_role("button", name="Delete").click()
    expect(copy).to_contain_text("Delete “Pipeline v1 copy”?")
    copy.get_by_role("button", name="Delete").click()
    expect(row_of(dlg, "Pipeline v1 copy")).to_have_count(0)

    # import the downloaded file: a new diagram, a unique name, opened
    dlg.locator("input[type=file][accept^=\".json\"]").set_input_files(str(saved))
    expect(page.get_by_role("dialog")).to_have_count(0)
    expect(page.locator(".name")).to_have_value("Pipeline v1 2")
    expect(page.locator(".react-flow__node-card")).to_have_count(1)
