"""B-roll sourcing: your own folder first, then free stock APIs (Pexels / Pixabay)."""
from __future__ import annotations

import hashlib
import json
import os
import urllib.parse
import urllib.request
from pathlib import Path

from ..config import CACHE_DIR

VIDEO_EXT = {".mp4", ".mov", ".m4v", ".webm", ".mkv"}
IMAGE_EXT = {".jpg", ".jpeg", ".png", ".webp"}
UA = {"User-Agent": "reel-studio/0.1 (+personal video tool)"}


def local_files(folder: str | Path | None) -> list[Path]:
    if not folder:
        return []
    return sorted(p for p in Path(folder).expanduser().glob("*") if p.suffix.lower() in VIDEO_EXT | IMAGE_EXT)


def _get_json(url: str, headers: dict | None = None):
    req = urllib.request.Request(url, headers={**UA, **(headers or {})})
    with urllib.request.urlopen(req, timeout=25) as r:
        return json.loads(r.read())


def _download(url: str) -> Path:
    d = CACHE_DIR / "broll"
    d.mkdir(parents=True, exist_ok=True)
    f = d / (hashlib.sha1(url.encode()).hexdigest()[:16] + ".mp4")
    if not f.exists() or f.stat().st_size < 10_000:
        req = urllib.request.Request(url, headers=UA)
        with urllib.request.urlopen(req, timeout=60) as r, open(f, "wb") as out:
            while chunk := r.read(1 << 16):
                out.write(chunk)
    return f


def _pexels(query: str, orientation: str, skip: set[str]) -> Path | None:
    key = os.environ.get("PEXELS_API_KEY")
    if not key:
        return None
    q = urllib.parse.urlencode({"query": query, "orientation": orientation, "per_page": 8, "size": "medium"})
    data = _get_json(f"https://api.pexels.com/videos/search?{q}", {"Authorization": key})
    for v in data.get("videos", []):
        files = [f for f in v.get("video_files", []) if f.get("file_type") == "video/mp4" and f.get("width")]
        files.sort(key=lambda f: abs(f["height"] - 1280))
        if files and files[0]["link"] not in skip:
            skip.add(files[0]["link"])
            return _download(files[0]["link"])
    return None


def _pixabay(query: str, skip: set[str]) -> Path | None:
    key = os.environ.get("PIXABAY_API_KEY")
    if not key:
        return None
    q = urllib.parse.urlencode({"key": key, "q": query, "per_page": 8, "safesearch": "true"})
    for h in _get_json(f"https://pixabay.com/api/videos/?{q}").get("hits", []):
        url = (h["videos"].get("medium") or h["videos"].get("small") or {}).get("url")
        if url and url not in skip:
            skip.add(url)
            return _download(url)
    return None


class BrollSource:
    """Hands out one clip per request, never repeating a clip within a video."""

    def __init__(self, folder: str | None, orientation: str, log=print):
        self.local = local_files(folder)
        self.orientation, self.log = orientation, log
        self.used: set[str] = set()
        self.i = 0

    def get(self, query: str) -> Path | None:
        if self.local:
            p = self.local[self.i % len(self.local)]
            self.i += 1
            return p
        for fn in (lambda: _pexels(query, self.orientation, self.used), lambda: _pixabay(query, self.used)):
            try:
                p = fn()
                if p:
                    return p
            except Exception as e:
                self.log(f"  [broll] '{query}': {type(e).__name__}: {str(e)[:80]}")
                break      # network/key problem: stop trying for this query
        return None
