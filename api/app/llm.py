"""The model behind Atelier's AI chat: Claude through OpenRouter, with tools. Any failure (no key, a timeout,
a reply without a message) raises LLMError, and the chat falls back to its scripted reader.

The key stays outside the repo: OPENROUTER_API_KEY in the environment, or the file ~/.sentinel/openrouter.env
(shared with Sentinel; ATELIER_OPENROUTER_ENV for another file). ATELIER_MODEL picks the model.
"""
import json
import logging
import os
import re
import urllib.error
import urllib.request
from pathlib import Path

log = logging.getLogger("atelier.llm")
URL = "https://openrouter.ai/api/v1/chat/completions"
MODEL = os.environ.get("ATELIER_MODEL", "anthropic/claude-sonnet-5.5")
TIMEOUT = float(os.environ.get("ATELIER_MODEL_TIMEOUT", "40"))


class LLMError(Exception):
    pass


class LLMProse(LLMError):
    """It answered, but in plain words rather than the JSON asked for."""
    def __init__(self, text: str):
        super().__init__(f"not JSON: {text[:200]}")
        self.text = text.strip()


def _key() -> str | None:
    if os.environ.get("OPENROUTER_API_KEY"):
        return os.environ["OPENROUTER_API_KEY"].strip()
    path = Path(os.environ.get("ATELIER_OPENROUTER_ENV", Path.home() / ".sentinel" / "openrouter.env")).expanduser()
    try:
        for line in path.read_text().splitlines():
            if line.strip().startswith("OPENROUTER_API_KEY="):
                return line.split("=", 1)[1].strip() or None
    except OSError:
        return None
    return None


def live() -> bool:
    return bool(_key())


def status() -> dict:
    return {"live": live(), "model": MODEL if live() else None, "provider": "OpenRouter" if live() else None}


def complete(system: str, messages: list[dict], max_tokens: int = 2000) -> str:
    """One completion: the system prompt, then the conversation. Raises LLMError on anything but an answer."""
    return _call(system, messages, max_tokens)["content"]


def complete_tools(system: str, messages: list[dict], tools: list[dict], max_tokens: int = 2000) -> dict:
    """One turn with tools the model may call (OpenAI-style function tools, as OpenRouter takes them): the
    assistant message back, with its text in "content" and any calls in "tool_calls"."""
    return _call(system, messages, max_tokens, tools)


def _call(system: str, messages: list[dict], max_tokens: int, tools: list[dict] | None = None) -> dict:
    key = _key()
    if not key:
        raise LLMError("no OpenRouter key")
    body = json.dumps({"model": MODEL, "max_tokens": max_tokens, "temperature": 0.2,
                       "messages": [{"role": "system", "content": system}, *messages], **({"tools": tools} if tools else {})}).encode()
    req = urllib.request.Request(URL, data=body, method="POST", headers={
        "Authorization": f"Bearer {key}", "Content-Type": "application/json",
        "HTTP-Referer": "http://localhost:8100", "X-Title": "Atelier"})
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
            data = json.load(r)
    except urllib.error.HTTPError as e:
        raise LLMError(f"OpenRouter {e.code}: {e.read()[:300].decode(errors='replace')}") from None
    except (urllib.error.URLError, TimeoutError, OSError) as e:
        raise LLMError(f"OpenRouter unreachable: {e}") from None
    try:
        msg = data["choices"][0]["message"]
        return {"content": msg.get("content") or "", "tool_calls": msg.get("tool_calls") or []}
    except (KeyError, IndexError, TypeError, AttributeError):
        raise LLMError(f"OpenRouter answered without a message: {str(data)[:300]}") from None


def complete_json(system: str, messages: list[dict], max_tokens: int = 2000) -> dict:
    """A completion that must be one JSON object. Prose or fences around it are tolerated (the last object
    found wins); no object at all raises LLMProse with the words it said."""
    text = complete(system, messages, max_tokens)
    found, dec = [], json.JSONDecoder()
    for m in re.finditer(r"\{", text):
        try:
            obj, _ = dec.raw_decode(text, m.start())
        except json.JSONDecodeError:
            continue
        if isinstance(obj, dict):
            found.append(obj)
    if not found:
        raise LLMProse(text)
    return next((o for o in reversed(found) if "reply" in o or "shape" in o), found[-1])
