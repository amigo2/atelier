"""The AI's tools on a diagram, and the scripted chat (no model is called: ATELIER_NO_MODEL forces it off)."""
import pytest

from app import assist, llm
from app.assist import Canvas


@pytest.fixture(autouse=True)
def no_model(monkeypatch):
    # An explicit switch rather than hiding a credential: on Bedrock the SDK reads the whole AWS chain
    # (~/.aws, AWS_* vars, instance roles), and a test that passes only on a laptop without a profile is
    # a test that fails on anyone else's.
    monkeypatch.setenv("ATELIER_NO_MODEL", "1")
    assert not llm.live()


def test_tools_place_connect_arrange_group():
    cv = Canvas({"id": "d", "name": "x", "elements": [], "arrows": []})
    q = cv.add_element(kind="card", title="Question", color="ink")["id"]
    e = cv.add_element(kind="card", title="Embed", color="violet", after=q)["id"]
    r = cv.add_element(kind="card", title="Retrieve", after=e, side="below")["id"]
    E = {x["id"]: x for x in cv.els}
    assert E[e]["x"] == E[q]["x"] + 180 + 36 and E[e]["y"] == E[q]["y"]              # to its right, one gap away
    assert E[r]["y"] == E[e]["y"] + 110 + 36                                           # below
    cv.connect(**{"from": q, "to": e}), cv.connect(**{"from": e, "to": r})
    assert [(a["fromSide"], a["toSide"]) for a in cv.doc["arrows"]] == [("r", "l"), ("b", "t")]
    cv.arrange([q, e, r], "row")                                                       # now all in one row
    assert len({x["y"] for x in cv.els}) == 1 and cv.doc["arrows"][1]["fromSide"] == "r"
    g = cv.group([q, e, r], "AWS · eu-west-1")["id"]
    assert cv.els[0]["id"] == g and cv.els[0]["kind"] == "box"                         # behind the cards
    assert cv.els[0]["x"] < E[q]["x"] and cv.els[0]["w"] > 3 * 180
    cv.delete_elements([e])
    assert len(cv.doc["arrows"]) == 0 and len(cv.els) == 3


def test_bad_calls_are_errors_not_crashes():
    cv = Canvas({"elements": [], "arrows": []})
    for name, args in [("update_element", {"id": "nope"}), ("add_element", {"kind": "circle"}), ("connect", {"from": "a", "to": "b"}), ("nope", {})]:
        with pytest.raises(ValueError):
            cv.call(name, args)


def test_scripted_chat():
    doc = {"id": "d", "name": "x", "elements": [], "arrows": []}
    r = assist.assist({"doc": doc, "text": "draw a pipeline: Question -> Embed -> Retrieve"})
    assert r["live"] is False and [e["title"] for e in r["doc"]["elements"]] == ["Question", "Embed", "Retrieve"]
    assert len(r["doc"]["arrows"]) == 2 and doc["elements"] == []                        # the original is untouched
    r = assist.assist({"doc": r["doc"], "text": "make embed violet"})
    assert next(e for e in r["doc"]["elements"] if e["title"] == "Embed")["color"] == "violet"
    sel = [r["doc"]["elements"][2]["id"]]
    r = assist.assist({"doc": r["doc"], "selected": sel, "text": "make this amber"})
    assert r["doc"]["elements"][2]["color"] == "amber"
    r = assist.assist({"doc": r["doc"], "text": "add a title RAG pipeline"})
    assert r["doc"]["elements"][-1]["size"] == "title"
    r = assist.assist({"doc": r["doc"], "text": "delete Retrieve"})
    assert [e.get("title") for e in r["doc"]["elements"] if e["kind"] == "card"] == ["Question", "Embed"] and len(r["doc"]["arrows"]) == 1


def test_frame_is_shown_and_new_things_start_inside_it():
    cv = Canvas({"elements": [], "arrows": [], "frame": {"x": 400, "y": 200, "w": 1600, "h": 900, "preset": "16:9"}})
    assert cv.summary()["frame"] == {"x": 400, "y": 200, "w": 1600, "h": 900}
    r = cv.add_element(kind="text", size="title", text="Hello")
    assert (r["x"], r["y"]) == (460, 250)
