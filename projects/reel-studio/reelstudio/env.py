"""Tiny .env loader (no extra dependency)."""
from __future__ import annotations

import os
from pathlib import Path


def load_env() -> None:
    for base in (Path.cwd(), Path(__file__).resolve().parents[1]):
        f = base / ".env"
        if not f.is_file():
            continue
        for line in f.read_text(encoding="utf-8").splitlines():
            line = line.split("#", 1)[0].strip()
            if "=" not in line:
                continue
            k, v = line.split("=", 1)
            k, v = k.strip(), v.strip().strip('"').strip("'")
            if v and k not in os.environ:
                os.environ[k] = v
