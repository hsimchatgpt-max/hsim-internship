"""Thin ffmpeg / ffprobe helpers."""
from __future__ import annotations

import json
import subprocess
from pathlib import Path

import numpy as np

SR = 44100


class FFmpegError(RuntimeError):
    pass


def run(args: list[str], cwd: str | Path | None = None) -> subprocess.CompletedProcess:
    cmd = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", *args]
    p = subprocess.run(cmd, capture_output=True, text=True, cwd=cwd)
    if p.returncode != 0:
        raise FFmpegError(f"ffmpeg failed: {' '.join(cmd)[:400]}\n{p.stderr[-800:]}")
    return p


def probe(path: str | Path) -> dict:
    p = subprocess.run(
        ["ffprobe", "-v", "error", "-print_format", "json", "-show_format", "-show_streams", str(path)],
        capture_output=True, text=True)
    if p.returncode != 0:
        raise FFmpegError(p.stderr)
    return json.loads(p.stdout)


def duration(path: str | Path) -> float:
    return float(probe(path)["format"]["duration"])


def has_video(path: str | Path) -> bool:
    return any(s["codec_type"] == "video" for s in probe(path)["streams"])


def decode_audio(path: str | Path, sr: int = SR) -> np.ndarray:
    """Any media file -> mono float32 array."""
    p = subprocess.run(
        ["ffmpeg", "-v", "error", "-i", str(path), "-vn", "-ac", "1", "-ar", str(sr), "-f", "f32le", "-"],
        capture_output=True)
    if p.returncode != 0:
        raise FFmpegError(p.stderr.decode()[-500:])
    return np.frombuffer(p.stdout, dtype=np.float32).copy()


def write_wav(path: str | Path, data: np.ndarray, sr: int = SR) -> None:
    import wave
    pcm = (np.clip(data, -1, 1) * 32767).astype("<i2")
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes(pcm.tobytes())
