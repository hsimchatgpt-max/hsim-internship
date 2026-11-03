"""Voiceover + word timings.

Three sources, all free:
  1. edge-tts      -> natural Microsoft neural voice (needs internet)           [default]
  2. face video    -> YOUR recorded voice (audio is taken from --face-video)
  3. placeholder   -> rhythmic beeps so the pipeline still runs offline (clearly NOT a real voice)
"""
from __future__ import annotations

import asyncio
import re
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np

from ..config import LANGUAGES
from . import ffutil
from .ffutil import SR

GAP = 0.18      # silence between scenes (s)
TAIL = 0.45     # silence at the very end


@dataclass
class Narration:
    wav: Path
    duration: float
    windows: list[tuple[float, float]]                   # per scene [t0, t1)
    words: list[tuple[str, float, float, int]]           # (word, start, end, scene_idx)
    source: str                                          # edge-tts | face-video | placeholder
    envelope: np.ndarray = field(default=None, repr=False)   # loudness per 1/FPS, 0..1


def _tokens(text: str) -> list[str]:
    return [w for w in re.split(r"\s+", text.strip()) if w]


def _proportional(text: str, t0: float, t1: float, scene_idx: int):
    toks = _tokens(text)
    weights = np.array([len(re.sub(r"\W", "", w)) + 2 for w in toks], dtype=float)
    edges = t0 + (t1 - t0) * np.concatenate([[0], np.cumsum(weights)]) / weights.sum()
    return [(w, float(edges[i]), float(edges[i + 1]), scene_idx) for i, w in enumerate(toks)]


async def _edge(text: str, voice: str, out: Path):
    import edge_tts
    try:
        com = edge_tts.Communicate(text, voice, boundary="WordBoundary")
    except TypeError:                       # older edge-tts
        com = edge_tts.Communicate(text, voice)
    words, audio = [], bytearray()
    async for ch in com.stream():
        if ch["type"] == "audio":
            audio += ch["data"]
        elif ch["type"] == "WordBoundary":
            s = ch["offset"] / 1e7
            words.append((ch["text"], s, s + ch["duration"] / 1e7))
    if not audio:
        raise RuntimeError("edge-tts returned no audio")
    out.write_bytes(bytes(audio))
    return words


def _placeholder(text: str) -> np.ndarray:
    """Pseudo-speech: voiced buzz shaped by a syllable rhythm."""
    rng = np.random.default_rng(len(text))
    parts = []
    for w in _tokens(text):
        n = int(SR * (0.10 + 0.055 * len(w)))
        t = np.arange(n) / SR
        f0 = 120 + 25 * rng.random() + 12 * np.sin(2 * np.pi * 5 * t)
        ph = 2 * np.pi * np.cumsum(f0) / SR
        sig = sum(np.sin(k * ph) / k for k in (1, 2, 3, 4))
        env = np.clip(np.sin(np.pi * t / t[-1]), 0, 1) ** 0.6 * (0.55 + 0.45 * np.abs(np.sin(2 * np.pi * 4.5 * t)))
        parts.append((0.32 * sig * env).astype(np.float32))
        parts.append(np.zeros(int(SR * 0.06), np.float32))
    return np.concatenate(parts) if parts else np.zeros(SR // 4, np.float32)


def _envelope(audio: np.ndarray, fps: int) -> np.ndarray:
    hop = SR // fps
    n = len(audio) // hop
    rms = np.sqrt((audio[: n * hop].reshape(n, hop) ** 2).mean(axis=1) + 1e-12)
    ref = np.percentile(rms, 95) or 1.0
    return np.clip(rms / ref, 0, 1)


def _finish(chunks, scenes, words, source, workdir: Path, fps: int, windows=None) -> Narration:
    audio = np.concatenate(chunks) if chunks else np.zeros(SR, np.float32)
    wav = workdir / "narration.wav"
    ffutil.write_wav(wav, audio)
    return Narration(wav, len(audio) / SR, windows, words, source, _envelope(audio, fps))


def narrate(scenes: list[dict], language: str, gender: str, workdir: Path, fps: int,
            voice: str | None = None, log=print) -> Narration:
    voice = voice or LANGUAGES[language]["voice_f" if gender == "female" else "voice_m"]
    workdir.mkdir(parents=True, exist_ok=True)
    chunks, windows, words, t = [], [], [], 0.0
    source = "edge-tts"
    for i, sc in enumerate(scenes):
        text = sc["voiceover"]
        seg_wav = workdir / f"scene{i + 1}.mp3"
        w = None
        if source == "edge-tts":
            try:
                w = asyncio.run(_edge(text, voice, seg_wav))
                audio = ffutil.decode_audio(seg_wav)
            except Exception as e:
                log(f"  [voice] edge-tts unavailable ({type(e).__name__}); using PLACEHOLDER beeps. "
                    f"Run on a machine with internet for the real voice.")
                source = "placeholder"
        if source == "placeholder":
            audio = _placeholder(text)
        dur = len(audio) / SR
        if source == "edge-tts" and w and len(w) >= max(1, len(_tokens(text)) // 2):
            words += [(wt, t + s, t + min(e, dur), i) for wt, s, e in w]
        else:
            words += _proportional(text, t, t + dur, i)
        gap = TAIL if i == len(scenes) - 1 else GAP
        chunks += [audio, np.zeros(int(SR * gap), np.float32)]
        windows.append((t, t + dur + gap))
        t += dur + gap
    return _finish(chunks, scenes, words, source, workdir, fps, windows)


def from_face_video(video: Path, scenes: list[dict], language: str, workdir: Path, fps: int, log=print) -> Narration:
    """Use the user's own recording: audio comes from the video, scene windows are split by word count."""
    workdir.mkdir(parents=True, exist_ok=True)
    audio = ffutil.decode_audio(video)
    # trim leading/trailing silence so windows match the actual speech
    env = _envelope(audio, 100)
    voiced = np.where(env > 0.08)[0]
    a0 = voiced[0] / 100 if len(voiced) else 0.0
    a1 = (voiced[-1] + 1) / 100 if len(voiced) else len(audio) / SR
    total = len(audio) / SR
    counts = np.array([max(1, len(_tokens(s["voiceover"]))) for s in scenes], dtype=float)
    edges = a0 + (a1 - a0) * np.concatenate([[0], np.cumsum(counts)]) / counts.sum()
    windows = [(float(edges[i]) if i else 0.0, float(edges[i + 1]) if i < len(scenes) - 1 else total)
               for i in range(len(scenes))]
    words = []
    wh = _whisper_words(video, language, log)
    if wh:
        for w, s, e in wh:
            idx = next((i for i, (x0, x1) in enumerate(windows) if s < x1), len(scenes) - 1)
            words.append((w, s, e, idx))
    else:
        for i, sc in enumerate(scenes):
            words += _proportional(sc["voiceover"], max(windows[i][0], a0 if i == 0 else windows[i][0]),
                                   windows[i][1] - (0.1 if i < len(scenes) - 1 else 0), i)
    wav = workdir / "narration.wav"
    ffutil.write_wav(wav, audio)
    return Narration(wav, total, windows, words, "face-video", _envelope(audio, fps))


def _whisper_words(video: Path, language: str, log):
    try:
        from faster_whisper import WhisperModel
    except ImportError:
        log("  [voice] faster-whisper not installed -> captions use estimated word timing "
            "(pip install faster-whisper for exact sync)")
        return None
    try:
        model = WhisperModel("small", compute_type="int8")
        lang = {"hindi": "hi", "hinglish": "hi", "english": "en"}[language]
        segs, _ = model.transcribe(str(video), language=lang, word_timestamps=True)
        return [(w.word.strip(), w.start, w.end) for s in segs for w in s.words if w.word.strip()]
    except Exception as e:
        log(f"  [voice] whisper failed ({e}); using estimated word timing")
        return None
