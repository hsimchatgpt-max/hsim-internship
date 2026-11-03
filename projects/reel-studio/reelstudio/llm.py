"""Free LLM providers behind one call. No SDKs, only urllib.

Order for provider "auto": Gemini -> Groq -> Ollama -> None (agents then use offline templates).
"""
from __future__ import annotations

import json
import os
import re
import urllib.error
import urllib.request


class LLMError(RuntimeError):
    pass


def _post(url: str, payload: dict, headers: dict | None = None, timeout: int = 90) -> dict:
    req = urllib.request.Request(
        url, data=json.dumps(payload).encode(), method="POST",
        headers={"Content-Type": "application/json", **(headers or {})},
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        raise LLMError(f"HTTP {e.code}: {e.read()[:300]!r}") from e
    except Exception as e:  # network down, DNS, timeout ...
        raise LLMError(str(e)) from e


def provider_name() -> str | None:
    want = os.environ.get("LLM_PROVIDER", "auto").lower()
    if want == "offline":
        return None
    if want != "auto":
        return want
    if os.environ.get("GEMINI_API_KEY"):
        return "gemini"
    if os.environ.get("GROQ_API_KEY"):
        return "groq"
    if os.environ.get("OLLAMA_MODEL"):
        return "ollama"
    return None


def available() -> bool:
    return provider_name() is not None


def chat(system: str, user: str, temperature: float = 0.8) -> str:
    p = provider_name()
    if p == "gemini":
        model = os.environ.get("GEMINI_MODEL", "gemini-2.0-flash")
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
        d = _post(url, {
            "systemInstruction": {"parts": [{"text": system}]},
            "contents": [{"role": "user", "parts": [{"text": user}]}],
            "generationConfig": {"temperature": temperature, "responseMimeType": "application/json"},
        }, {"x-goog-api-key": os.environ["GEMINI_API_KEY"]})
        try:
            return d["candidates"][0]["content"]["parts"][0]["text"]
        except (KeyError, IndexError) as e:
            raise LLMError(f"unexpected Gemini reply: {str(d)[:200]}") from e
    if p == "groq":
        d = _post("https://api.groq.com/openai/v1/chat/completions", {
            "model": os.environ.get("GROQ_MODEL", "llama-3.3-70b-versatile"),
            "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
            "temperature": temperature, "response_format": {"type": "json_object"},
        }, {"Authorization": f"Bearer {os.environ['GROQ_API_KEY']}"})
        return d["choices"][0]["message"]["content"]
    if p == "ollama":
        host = os.environ.get("OLLAMA_HOST", "http://localhost:11434")
        d = _post(f"{host}/api/chat", {
            "model": os.environ.get("OLLAMA_MODEL", "llama3.1"), "stream": False, "format": "json",
            "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
            "options": {"temperature": temperature},
        }, timeout=300)
        return d["message"]["content"]
    raise LLMError("no LLM configured")


def chat_json(system: str, user: str, temperature: float = 0.8) -> dict:
    """Ask for JSON and parse it robustly (strips code fences / stray text)."""
    raw = chat(system + "\nReply with ONE valid JSON object only. No markdown.", user, temperature)
    raw = re.sub(r"^```(?:json)?|```$", "", raw.strip(), flags=re.M).strip()
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        m = re.search(r"\{.*\}", raw, re.S)
        if m:
            try:
                return json.loads(m.group(0))
            except json.JSONDecodeError:
                pass
    raise LLMError(f"model did not return JSON: {raw[:200]!r}")
