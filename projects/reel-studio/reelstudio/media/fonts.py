"""Fonts for captions. Hindi needs a Devanagari font; we fetch Noto once (free) and cache it."""
from __future__ import annotations

import subprocess
import urllib.request
from pathlib import Path

from ..config import CACHE_DIR

_BASE = "https://github.com/notofonts/notofonts.github.io/raw/main/fonts"
FONTS = {
    "NotoSansDevanagari-Bold.ttf": f"{_BASE}/NotoSansDevanagari/hinted/ttf/NotoSansDevanagari-Bold.ttf",
    "NotoSans-Bold.ttf": f"{_BASE}/NotoSans/hinted/ttf/NotoSans-Bold.ttf",
}


def fonts_dir() -> Path:
    d = CACHE_DIR / "fonts"
    d.mkdir(parents=True, exist_ok=True)
    for name, url in FONTS.items():
        f = d / name
        if f.exists() and f.stat().st_size > 10_000:
            continue
        try:
            urllib.request.urlretrieve(url, f)
            if f.stat().st_size < 10_000:
                f.unlink()
        except Exception:
            f.unlink(missing_ok=True)
    return d


def caption_font(language: str) -> tuple[str, str | None]:
    """-> (font family name for ASS, fonts dir or None)."""
    d = fonts_dir()
    if language == "hindi":
        if (d / "NotoSansDevanagari-Bold.ttf").exists():
            return "Noto Sans Devanagari", str(d)
        return _system_font("Devanagari") or "Noto Sans Devanagari", None
    if (d / "NotoSans-Bold.ttf").exists():
        return "Noto Sans", str(d)
    return "DejaVu Sans", None


def _system_font(query: str) -> str | None:
    try:
        out = subprocess.run(["fc-match", f":lang=hi", "family"], capture_output=True, text=True).stdout.strip()
        return out or None
    except Exception:
        return None
