"""Saving and opening diagrams: a round trip, the listing, ids that can't escape the folder, delete."""
import importlib

import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("ATELIER_DATA", str(tmp_path))
    from app import main
    importlib.reload(main)
    return TestClient(main.app)


DOC = {"id": "d-1", "name": "RAG pipeline", "elements": [{"id": "c1", "kind": "card", "x": 0, "y": 0, "w": 180, "h": 110, "color": "blue", "title": "Embed"}], "arrows": []}


def test_round_trip(client):
    assert client.put("/api/diagrams/d-1", json=DOC).json() == {"saved": "d-1"}
    assert client.get("/api/diagrams/d-1").json() == DOC
    assert [d["name"] for d in client.get("/api/diagrams").json()] == ["RAG pipeline"]


def test_bad_ids_and_shapes(client):
    assert 400 <= client.put("/api/diagrams/..%2Fescape", json={**DOC, "id": "../escape"}).status_code < 500   # never written
    assert client.put("/api/diagrams/bad.id", json={**DOC, "id": "bad.id"}).status_code == 400                 # ids are plain names
    assert client.put("/api/diagrams/d-2", json=DOC).status_code == 400            # the id in the body must match
    assert client.put("/api/diagrams/d-1", json={"id": "d-1"}).status_code == 400  # no elements, no arrows
    assert client.get("/api/diagrams/nope").status_code == 404


def test_delete(client):
    client.put("/api/diagrams/d-1", json=DOC)
    assert client.delete("/api/diagrams/d-1").json() == {"deleted": "d-1"}
    assert client.get("/api/diagrams").json() == []
