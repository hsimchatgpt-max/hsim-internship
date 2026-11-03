"""Generated graphics (no stock needed): gradient backgrounds and the cartoon AI avatar."""
from __future__ import annotations

import numpy as np
from PIL import Image, ImageDraw

from ..config import THEMES


def gradient_bg(path, size: tuple[int, int], theme_idx: int) -> None:
    w, h = size
    c0, c1 = (np.array(c, float) for c in THEMES[theme_idx % len(THEMES)])
    y = np.linspace(0, 1, h)[:, None, None]
    img = c0 * (1 - y) + c1 * y
    yy, xx = np.mgrid[0:h, 0:w]
    r = np.sqrt(((xx - w / 2) / (w * 0.75)) ** 2 + ((yy - h * 0.45) / (h * 0.75)) ** 2)
    img = img * (1.12 - 0.5 * np.clip(r, 0, 1))[..., None]
    Image.fromarray(np.clip(img, 0, 255).astype("uint8")).save(path)


def _sprite(mouth: int, blink: bool, seed: int, S: int = 1400) -> Image.Image:
    """Friendly flat-style presenter. mouth 0..3 = closed..wide open."""
    rng = np.random.default_rng(seed)
    skin = [(246, 205, 170), (224, 172, 130), (180, 126, 92)][seed % 3]
    hair = [(30, 24, 28), (70, 40, 25), (20, 20, 40)][(seed // 3) % 3]
    shirt = [(40, 90, 200), (210, 70, 90), (30, 150, 120), (240, 170, 40)][(seed // 5) % 4]
    im = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    cx = S // 2
    # shoulders / shirt
    d.rounded_rectangle([cx - 520, 1000, cx + 520, S + 200], radius=330, fill=shirt)
    d.polygon([(cx - 120, 1000), (cx + 120, 1000), (cx, 1130)], fill=(255, 255, 255, 230))
    # neck
    d.rounded_rectangle([cx - 105, 860, cx + 105, 1060], radius=60, fill=tuple(int(c * 0.9) for c in skin))
    # hair back + head
    d.ellipse([cx - 360, 190, cx + 360, 930], fill=hair)
    d.ellipse([cx - 320, 260, cx + 320, 940], fill=skin)
    # hair fringe
    d.pieslice([cx - 345, 170, cx + 345, 800], 180, 360, fill=hair)
    d.ellipse([cx - 335, 330, cx - 250, 640], fill=skin)   # ears region cleanup left
    d.ellipse([cx + 250, 330, cx + 335, 640], fill=skin)
    d.ellipse([cx - 322, 400, cx - 258, 560], fill=skin)
    # eyes
    for sx in (-1, 1):
        ex, ey = cx + sx * 135, 560
        if blink:
            d.arc([ex - 55, ey - 20, ex + 55, ey + 40], 20, 160, fill=(30, 20, 25), width=14)
        else:
            d.ellipse([ex - 48, ey - 52, ex + 48, ey + 52], fill=(255, 255, 255))
            d.ellipse([ex - 25, ey - 28, ex + 25, ey + 28], fill=(35, 25, 30))
            d.ellipse([ex - 8, ey - 22, ex + 8, ey - 6], fill=(255, 255, 255))
        d.arc([ex - 70, ey - 120, ex + 70, ey - 40], 200, 340, fill=hair, width=16)    # brows
    # blush + nose
    for sx in (-1, 1):
        d.ellipse([cx + sx * 215 - 55, 650, cx + sx * 215 + 55, 710], fill=(255, 140, 140, 90))
    d.arc([cx - 30, 620, cx + 30, 700], 20, 160, fill=tuple(int(c * 0.7) for c in skin), width=10)
    # mouth
    my = 770
    if mouth == 0:
        d.arc([cx - 90, my - 50, cx + 90, my + 40], 20, 160, fill=(150, 50, 60), width=14)
    else:
        mw = {1: 70, 2: 82, 3: 92}[mouth]
        mh = {1: 22, 2: 50, 3: 82}[mouth]
        d.ellipse([cx - mw, my - mh // 2, cx + mw, my + mh], fill=(110, 25, 40))
        if mouth >= 2:
            d.ellipse([cx - mw + 22, my + mh * 0.45, cx + mw - 22, my + mh - 4], fill=(230, 100, 110))
        d.rounded_rectangle([cx - mw + 12, my - mh // 2 + 2, cx + mw - 12, my - mh // 2 + 22], radius=8,
                            fill=(255, 255, 255))
    return im.resize((S // 2, S // 2), Image.LANCZOS)


def avatar_sprites(outdir, seed: int) -> dict[tuple[int, bool], str]:
    out = {}
    for m in range(4):
        for b in (False, True):
            p = outdir / f"avatar_{m}{'b' if b else ''}.png"
            _sprite(m, b, seed).save(p)
            out[(m, b)] = str(p)
    return out


def mouth_states(env: np.ndarray, fps: int, f0: int, f1: int) -> list[tuple[int, bool]]:
    """Per-frame (mouth, blink) for frames f0..f1 from the loudness envelope."""
    seg = env[f0:f1]
    if len(seg) < f1 - f0:
        seg = np.concatenate([seg, np.zeros(f1 - f0 - len(seg))])
    m = np.digitize(seg, [0.10, 0.32, 0.58])
    if len(m) > 2:                                   # 3-frame median: no flicker
        m = np.array([int(np.median(m[max(0, i - 1): i + 2])) for i in range(len(m))])
    out = []
    for i, mm in enumerate(m):
        phase = (f0 + i) % int(fps * 3.4)
        out.append((int(mm), phase < 4))
    return out
