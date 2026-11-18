"""The model behind Atelier's AI chat: Claude through Anthropic's own API, with tools.

Any failure (no key, a timeout, a reply without a message) raises LLMError, and the chat falls back to its
scripted reader. That fallback is why nothing here retries forever: in an editor you are drawing in, a slow
answer is worse than a scripted one.

**Anthropic directly, not a reseller.** This used to go through OpenRouter. One account, one bill, one set
of terms, and the model ids are the real ones rather than a reseller's aliases. Atelier is a local tool, so
it does not go anywhere near Manahata's Bedrock route — that exists for a data-processing agreement over
property and owner data, which nothing here touches.

**The interface did not change.** `assist.py` speaks OpenAI-shaped tools and messages, and still does: the
translation to Anthropic's shape happens here, at the boundary. Rewriting the caller to match the SDK would
have touched 412 lines of working tool code to no benefit.

The key stays outside the repo: ANTHROPIC_API_KEY in the environment, or a file holding it (default
`~/.sentinel/anthropic.env`, `ATELIER_ANTHROPIC_ENV` for another), or a profile from `ant auth login`.
`ATELIER_NO_MODEL=1` forces the scripted reader, which is how the tests run without a key.
"""
import json
import logging
import os
from pathlib import Path
from typing import Any

log = logging.getLogger("atelier.llm")

# Sonnet 5.5: everything this assistant does lands on a canvas the person is looking at, and is undone with
# one keystroke, so the model does not have to be the biggest one.
MODEL = os.environ.get("ATELIER_MODEL", "claude-sonnet-5-5")
TIMEOUT = float(os.environ.get("ATELIER_MODEL_TIMEOUT", "40"))

# Unset by default, and sent only when set. `effort` trades thoroughness for tokens and latency; `low` is
# what an interactive editor wants, but it is a measured decision, not a default to guess at.
EFFORT = os.environ.get("ATELIER_MODEL_EFFORT", "").strip()

KEY_FILE = Path(os.environ.get("ATELIER_ANTHROPIC_ENV", Path.home() / ".sentinel" / "anthropic.env")).expanduser()

_client = None


class LLMError(Exception):
    pass


class LLMProse(LLMError):
    """It answered, but in plain words rather than the JSON asked for."""

    def __init__(self, text: str):
        super().__init__(f"not JSON: {text[:200]}")
        self.text = text.strip()


def _key() -> str | None:
    """The key from the environment, or from a file outside the repo. None means neither."""
    env = os.environ.get("ANTHROPIC_API_KEY", "").strip()
    if env:
        return env
    try:
        for line in KEY_FILE.read_text().splitlines():
            line = line.strip()
            if line.startswith("ANTHROPIC_API_KEY="):
                return line.split("=", 1)[1].strip().strip("\"'") or None
    except OSError:
        return None
    return None


def _profile() -> bool:
    """Whether `ant auth login` has left a profile the SDK can read on its own."""
    return (Path.home() / ".config" / "anthropic").is_dir()


def _build_client():
    """One shared client, created on first use.

    Lazily, because importing this module must never need a key: the tests import the package and none of
    them should have to hold one to do it.
    """
    global _client
    if _client is None:
        try:
            from anthropic import Anthropic
        except ImportError as exc:  # pragma: no cover - a broken install
            raise LLMError(f"the anthropic SDK is not installed: {exc}") from exc
        key = _key()
        # With no key, the zero-arg client picks up an `ant auth login` profile by itself. Passing
        # api_key=None explicitly would stop it doing that.
        _client = Anthropic(timeout=TIMEOUT, max_retries=1, **({"api_key": key} if key else {}))
    return _client


def reset_client() -> None:
    """Drop the cached client, so a test that changes the key gets a new one."""
    global _client
    _client = None


def live() -> bool:
    if os.environ.get("ATELIER_NO_MODEL", "").strip() not in ("", "0", "false"):
        return False
    return bool(_key()) or _profile()


def status() -> dict:
    on = live()
    return {"live": on, "model": MODEL if on else None, "provider": "Anthropic" if on else None}


# ------------------------------------------------------------------ shape translation
#
# assist.py speaks the OpenAI shape. Claude speaks blocks. Everything between these two functions exists to
# keep that difference out of the 412 lines of tool code that work.


def _tools_for_claude(tools: list[dict]) -> list[dict]:
    out = []
    for t in tools:
        f = t.get("function") or t
        out.append({
            "name": f["name"],
            "description": f.get("description", ""),
            "input_schema": f.get("parameters") or {"type": "object", "properties": {}},
        })
    return out


def _messages_for_claude(messages: list[dict]) -> list[dict]:
    """OpenAI-shaped history to Claude's.

    The one thing that has to be right: **every tool result from one assistant turn goes in a single user
    message.** assist.py appends them one at a time, which is correct OpenAI and invalid here — split across
    messages, the model quietly stops calling tools in parallel and nobody can see why it got slow.
    """
    out: list[dict] = []
    pending: list[dict] = []

    def flush() -> None:
        nonlocal pending
        if pending:
            out.append({"role": "user", "content": pending})
            pending = []

    for m in messages:
        role = m.get("role")

        if role == "tool":
            pending.append({
                "type": "tool_result",
                "tool_use_id": m.get("tool_call_id") or "",
                "content": m.get("content") or "",
            })
            continue

        flush()

        if role == "assistant":
            blocks: list[dict] = []
            if (m.get("content") or "").strip():
                blocks.append({"type": "text", "text": m["content"]})
            for c in m.get("tool_calls") or []:
                fn = c.get("function") or {}
                try:
                    args = json.loads(fn.get("arguments") or "{}")
                except json.JSONDecodeError:
                    args = {}
                blocks.append({"type": "tool_use", "id": c.get("id") or "", "name": fn.get("name") or "", "input": args})
            # An assistant turn with neither words nor calls carries nothing, and an empty content list is
            # rejected. Drop it rather than send a placeholder the model has to interpret.
            if blocks:
                out.append({"role": "assistant", "content": blocks})
            continue

        if (m.get("content") or "").strip():
            out.append({"role": "user", "content": m["content"]})

    flush()
    return out


def _reply_for_assist(response: Any) -> dict:
    text = "".join(b.text for b in response.content if getattr(b, "type", "") == "text")
    calls = [
        {"id": b.id, "type": "function", "function": {"name": b.name, "arguments": json.dumps(b.input, ensure_ascii=False)}}
        for b in response.content
        if getattr(b, "type", "") == "tool_use"
    ]
    return {"content": text, "tool_calls": calls}


# ------------------------------------------------------------------ the calls


def complete(system: str, messages: list[dict], max_tokens: int = 2000) -> str:
    """One completion: the system prompt, then the conversation. Raises LLMError on anything but an answer."""
    return _call(system, messages, max_tokens)["content"]


def complete_tools(system: str, messages: list[dict], tools: list[dict], max_tokens: int = 2000) -> dict:
    """One turn with tools the model may call: the assistant message back, with its text in "content" and
    any calls in "tool_calls", in the OpenAI shape assist.py already handles."""
    return _call(system, messages, max_tokens, tools)


def _call(system: str, messages: list[dict], max_tokens: int, tools: list[dict] | None = None) -> dict:
    client = _build_client()

    kwargs: dict[str, Any] = {
        "model": MODEL,
        "max_tokens": max_tokens,
        "system": system,
        "messages": _messages_for_claude(messages),
    }
    if tools:
        # tool_choice stays at its default (auto). Forcing a call returns a 400 on this model, and the
        # assistant has to be able to answer "there is nothing to change" without inventing a tool call.
        kwargs["tools"] = _tools_for_claude(tools)
    if EFFORT:
        kwargs["output_config"] = {"effort": EFFORT}

    # No temperature, top_p or top_k: removed from the API, and a 400 now. The old OpenRouter call sent
    # temperature 0.2; what made that output steady was the tool schemas, not the sampler.
    try:
        response = client.messages.create(**kwargs)
    except Exception as exc:
        # Deliberately broad. A missing key, a rate limit, a read timeout — they all mean the same thing to
        # the person drawing: this message did not get an answer, use the scripted reader. The specific
        # cause goes to the log.
        raise LLMError(f"{type(exc).__name__}: {exc}") from None

    if response.stop_reason == "refusal":
        raise LLMError(f"refused: {getattr(response, 'stop_details', None)}")

    return _reply_for_assist(response)


def complete_json(system: str, messages: list[dict], max_tokens: int = 2000) -> dict:
    """A completion that must be one JSON object. Prose or fences around it are tolerated (the last object
    found wins); no object at all raises LLMProse with the words it said."""
    import re

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
