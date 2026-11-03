"""ASS subtitles: word-by-word highlighted captions (reels style) + scene headline labels."""
from __future__ import annotations

import re

HIGHLIGHT = {"instagram": "&H0000D4FF", "linkedin": "&H00FFB64D"}      # ASS is BGR: yellow / sky-blue
_PUNCT_BREAK = re.compile(r"[,.;:!?।]$")


def _t(sec: float) -> str:
    sec = max(0.0, sec)
    h, rem = divmod(sec, 3600)
    m, s = divmod(rem, 60)
    return f"{int(h)}:{int(m):02d}:{s:05.2f}"


def _clean(w: str) -> str:
    return re.sub(r"[{}\\]", "", w).replace("\n", " ")


def chunk_words(words, max_words: int, max_chars: int):
    chunks, cur = [], []
    for w in words:
        cur.append(w)
        text_len = sum(len(x[0]) + 1 for x in cur)
        if len(cur) >= max_words or text_len >= max_chars or _PUNCT_BREAK.search(w[0]):
            chunks.append(cur)
            cur = []
    if cur:
        chunks.append(cur)
    return chunks


def build_ass(path, words, windows, scenes, size, platform, font: str, max_words: int = 3,
              cap_scale: float = 1.0, show_headlines: bool = True) -> list[float]:
    """Write the .ass file. Returns the times at which headline labels pop in (used for pop SFX)."""
    w, h = size
    ig = platform == "instagram"
    cap_size = int((h / 1920 * 86 if ig else h / 1350 * 62) * cap_scale)
    head_size = int(cap_size * 0.78)
    margin_v = {"instagram": 520, "linkedin": 150}[platform]
    head_margin = int(h * (0.13 if ig else 0.07))
    hl = HIGHLIGHT[platform]
    max_chars = 18 if ig else 30
    lines = [
        "[Script Info]", "ScriptType: v4.00+", f"PlayResX: {w}", f"PlayResY: {h}", "WrapStyle: 0", "ScaledBorderAndShadow: yes", "",
        "[V4+ Styles]",
        "Format: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,Bold,Italic,Underline,"
        "StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding",
        f"Style: Cap,{font},{cap_size},&H00FFFFFF,&H000000FF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,{max(4, cap_size // 12)},2,2,70,70,{margin_v},1",
        f"Style: Head,{font},{head_size},&H00FFFFFF,&H000000FF,&H00A03C14,&HB0000000,-1,0,0,0,100,100,0,0,3,{max(10, head_size // 4)},0,8,60,60,{head_margin},1",
        "", "[Events]", "Format: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text",
    ]
    chunks = chunk_words(words, max_words, max_chars)
    for ci, chunk in enumerate(chunks):
        nxt_start = chunks[ci + 1][0][1] if ci + 1 < len(chunks) else None
        for wi, (wt, s, e, _) in enumerate(chunk):
            end = chunk[wi + 1][1] if wi + 1 < len(chunk) else e + 0.12
            if nxt_start is not None:
                end = min(end, nxt_start)
            if end - s < 0.05:
                end = s + 0.05
            txt = " ".join(
                (f"{{\\c{hl}&\\fscx112\\fscy112}}{_clean(x[0])}{{\\c&HFFFFFF&\\fscx100\\fscy100}}" if j == wi else _clean(x[0]))
                for j, x in enumerate(chunk))
            lines.append(f"Dialogue: 0,{_t(s)},{_t(end)},Cap,,0,0,0,,{txt}")
    pops = []
    if show_headlines:
        for i, sc in enumerate(scenes):
            label = _clean(sc.get("on_screen_text", "")).strip()
            if not label:
                continue
            t0, t1 = windows[i]
            end = min(t1 - 0.1, t0 + 1.9)
            if end - t0 < 0.5:
                continue
            lines.append(f"Dialogue: 1,{_t(t0 + 0.05)},{_t(end)},Head,,0,0,0,,{{\\fad(120,160)\\fscx60\\fscy60\\t(0,160,\\fscx100\\fscy100)}}{label}")
            pops.append(t0 + 0.05)
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return pops
