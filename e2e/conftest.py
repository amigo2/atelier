"""The editor in a real browser, against its own API on a free port with a throwaway data folder.

    cd atelier && (cd web && npm run build) && api/.venv/bin/pytest e2e          # headless
    api/.venv/bin/pytest e2e --headed --slowmo 300                              # watch it
"""
import socket
import subprocess
import tempfile
import time
import urllib.request
from pathlib import Path

import pytest

API = Path(__file__).resolve().parents[1] / "api"


def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@pytest.fixture(scope="session")
def server():
    port, data = _free_port(), tempfile.mkdtemp(prefix="atelier-e2e-")
    proc = subprocess.Popen([str(API / ".venv/bin/uvicorn"), "app.main:app", "--port", str(port)], cwd=API,
                            env={"ATELIER_DATA": data, "PATH": "/usr/bin:/bin"}, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    base = f"http://127.0.0.1:{port}"
    for _ in range(100):
        try:
            urllib.request.urlopen(base + "/api/health", timeout=1)
            break
        except OSError:
            time.sleep(0.1)
    yield {"base": base, "data": Path(data)}
    proc.terminate()


@pytest.fixture(scope="session")
def base_url(server):
    return server["base"]


@pytest.fixture
def data(server):
    return server["data"]


@pytest.fixture
def errors(page):
    found = []
    page.on("pageerror", lambda e: found.append(str(e)))
    return found
