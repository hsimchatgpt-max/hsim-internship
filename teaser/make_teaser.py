import math, os, subprocess, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter, ImageChops

S = 2
W, H, FPS = 1080 * S, 1920 * S, 24
BW0, BH0 = 1080, 1920
DUR = 20.0
N = int(DUR * FPS)
HERE = os.path.dirname(os.path.abspath(__file__))
FRAMES = os.path.join(HERE, "frames")
os.makedirs(FRAMES, exist_ok=True)
FONT = "/usr/share/fonts/opentype/inter/Inter-Black.otf"
if not os.path.exists(FONT):
    FONT = "/usr/share/fonts/opentype/inter/Inter-ExtraBold.otf"
BLUE = (10, 70, 175)
rng = np.random.default_rng(7)

def font(sz): return ImageFont.truetype(FONT, int(sz * S))
def ease(t): t = max(0, min(1, t)); return t * t * (3 - 2 * t)
def easeout(t): t = max(0, min(1, t)); return 1 - (1 - t) ** 3
def seg(t, a, b): return (t - a) / (b - a)

def text_img(txt, sz, fill, squeeze=0.82, spacing=0):
    f = font(sz)
    bb = f.getbbox(txt)
    spacing = spacing * S
    w, h = bb[2] + 20 + int(spacing * len(txt)), bb[3] + 20
    im = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    if spacing:
        x = 10
        for ch in txt:
            d.text((x, 0), ch, font=f, fill=fill); x += f.getlength(ch) + spacing
    else:
        d.text((10, 0), txt, font=f, fill=fill)
    im = im.crop(im.getbbox())
    return im.resize((int(im.width * squeeze), im.height), Image.LANCZOS)

def paste_c(base, im, cx, cy, alpha=1.0):
    cx, cy = cx * S, cy * S
    if alpha < 1:
        a = im.split()[3].point(lambda v: int(v * alpha)); im = im.copy(); im.putalpha(a)
    base.alpha_composite(im, (int(cx - im.width / 2), int(cy - im.height / 2)))

def vgrad(top, bot, h=None):
    h = h or H
    t = np.linspace(0, 1, h)[:, None, None]
    a = np.array(top)[None, None, :] * (1 - t) + np.array(bot)[None, None, :] * t
    return np.repeat(a, W, axis=1)

def noise_tex(w, h, scale, seed):
    r = np.random.default_rng(seed)
    small = r.random((h // scale + 2, w // scale + 2)).astype(np.float32)
    im = Image.fromarray((small * 255).astype(np.uint8)).resize((w, h), Image.BICUBIC).filter(ImageFilter.GaussianBlur(scale / 3))
    return np.asarray(im).astype(np.float32) / 255

# ---------- assets ----------
logo = Image.open(os.path.join(HERE, "hsim_logo.jpg")).convert("RGB")
# crop white margins around the logo, keep RGB (white bg stays white on white screen)
arr = np.asarray(logo); mask = (arr < 245).any(axis=2); ys, xs = np.where(mask)
logo = logo.crop((xs.min() - 10, ys.min() - 10, xs.max() + 10, ys.max() + 10))

# ocean base
ocean_base = vgrad((14, 120, 135), (4, 40, 70)).astype(np.float32)
wave1 = noise_tex(W + 400*S, H + 400*S, 40*S, 1); wave2 = noise_tex(W + 400*S, H + 400*S, 90*S, 2)
# sky
sky_base = vgrad((70, 150, 185), (240, 170, 110), 1100*S).astype(np.float32)
cl1 = noise_tex(W + 600*S, 900*S, 160*S, 3); cl2 = noise_tex(W + 600*S, 900*S, 70*S, 4)
# hills (static)
def make_ground():
    g = Image.new("RGBA", (BW0, BH0), (0, 0, 0, 0)); d = ImageDraw.Draw(g)
    pts = [(0, 1250)]
    for x in range(0, BW0 + 40, 40):
        pts.append((x, 1180 + 50 * math.sin(x / 170) + 30 * math.sin(x / 61)))
    pts += [(BW0, BH0), (0, H)]
    d.polygon(pts, fill=(34, 92, 60, 255))
    # city blocks
    r = np.random.default_rng(11)
    for _ in range(140):
        x = r.integers(0, BW0); y = r.integers(1300, BH0 - 40)
        w = r.integers(40, 120); h = r.integers(25, 60)
        c = [(215, 205, 195), (200, 120, 80), (230, 225, 215), (160, 170, 160)][r.integers(0, 4)]
        d.rectangle([x, y, x + w, y + h], fill=c + (255,))
        d.rectangle([x, y + h, x + w, y + h + 8], fill=(80, 80, 70, 255))
    # trees
    for _ in range(260):
        x = r.integers(0, BW0); y = r.integers(1260, BH0)
        rad = r.integers(10, 22)
        d.ellipse([x - rad, y - rad, x + rad, y + rad], fill=(20, 90 + r.integers(0, 40), 40, 255))
    return g
ground = make_ground().resize((W, H), Image.LANCZOS).filter(ImageFilter.GaussianBlur(1.2 * S))

def billboard_base():
    bw, bh = 900 * S, 520 * S
    im = Image.new("RGBA", (bw + 80 * S, bh + 420 * S), (0, 0, 0, 0)); d = ImageDraw.Draw(im)
    ox, oy = 40 * S, 20 * S
    for lx in (ox + 140 * S, ox + bw - 180 * S):
        d.rectangle([lx, oy + bh, lx + 40 * S, oy + bh + 380 * S], fill=(55, 60, 70, 255))
    d.rounded_rectangle([ox - 12 * S, oy - 12 * S, ox + bw + 12 * S, oy + bh + 12 * S], 18 * S, fill=(40, 45, 55, 255))
    d.rounded_rectangle([ox, oy, ox + bw, oy + bh], 12 * S, fill=(18, 78, 160, 255))
    for i in range(14):
        lx = ox + 30 * S + i * (bw - 60 * S) / 13
        d.ellipse([lx - 9 * S, oy - 30 * S, lx + 9 * S, oy - 12 * S], fill=(255, 245, 190, 255))
    return im, (ox, oy, bw, bh)
bb_im, (box, boy, BW, BH) = billboard_base()

def billboard_with_text(t):
    im = bb_im.copy()
    # gradient glow on panel
    sm = text_img("SOMETHING", 150, (255, 255, 255, 255), 0.8)
    big = text_img("BIG", 190, (110, 220, 60, 255), 0.8)
    isc = text_img("IS COMING", 150, (255, 255, 255, 255), 0.8)
    for img_ in (sm, big, isc):
        pass
    cx = (box + BW / 2) / S
    def shadowed(base, t_im, cx_, cy_):
        sh = Image.new("RGBA", t_im.size, (0, 0, 0, 0))
        sh.paste((0, 20, 60, 200), mask=t_im.split()[3])
        base.alpha_composite(sh, (int(cx_ * S - t_im.width / 2 + 6 * S), int(cy_ * S - t_im.height / 2 + 8 * S)))
        paste_c(base, t_im, cx_, cy_)
    shadowed(im, sm, cx, boy / S + 120)
    shadowed(im, big, cx - 270, boy / S + 270)
    shadowed(im, isc, cx + 120, boy / S + 270 + 10) if False else None
    isc_small = text_img("IS COMING", 120, (255, 255, 255, 255), 0.8)
    shadowed(im, isc_small, cx + 130, boy / S + 285)
    shadowed(im, text_img("HSIM  •  OPENING 16 NOV", 60, (255, 255, 255, 255), 0.85, spacing=4), cx, boy / S + 440)
    return im
bb_final = billboard_with_text(None)

# ---------- scene A: HELLO CHANDIGARH ----------
def scene_A(t, dur):
    off = int(t * 90) * S
    tex = wave1[off % (400*S): off % (400*S) + H, 0:W] * 0.6 + wave2[(off // 2) % (400*S): (off // 2) % (400*S) + H, 100*S:100*S + W] * 0.4
    hi = np.clip((tex - 0.5) * 1.6, 0, 1)[:, :, None] * 0.55
    base = ocean_base + hi * np.array([110, 150, 150])
    bg = Image.fromarray(np.clip(base, 0, 255).astype(np.uint8)).convert("RGBA")
    # sunset glow top
    glow = Image.new("RGBA", (W, H), (0, 0, 0, 0)); gd = ImageDraw.Draw(glow)
    gd.ellipse([W * 0.2, -500 * S, W * 1.2, 500 * S], fill=(255, 190, 110, 150))
    bg.alpha_composite(glow.filter(ImageFilter.GaussianBlur(120 * S)))
    # 3D text layer
    layer = Image.new("RGBA", (2000 * S, 1100 * S), (0, 0, 0, 0))
    h1 = text_img("HELLO", 330, (255, 255, 255, 255), 0.85)
    h2 = text_img("CHANDIGARH", 190, (255, 255, 255, 255), 0.82)
    lines = [(h1, 330 * S), (h2, 600 * S)]
    for depth in range(36, 0, -1):
        for im, cy in lines:
            ex = Image.new("RGBA", im.size, (0, 0, 0, 0))
            shade = int(150 + (36 - depth) * 2)
            ex.paste((shade - 40, shade, shade + 20, 255), mask=im.split()[3])
            layer.alpha_composite(ex, (int(1000 * S - im.width / 2 + depth * 0.6 * S), int(cy - im.height / 2 + depth * 0.9 * S)))
    for im, cy in lines:
        layer.alpha_composite(im, (int(1000 * S - im.width / 2), int(cy - im.height / 2)))
    layer = layer.crop(layer.getbbox())
    p = easeout(seg(t, 0.0, 1.2)); out = ease(seg(t, dur - 0.6, dur))
    sc = (0.55 + 0.45 * p) * (1 + 0.4 * out) * (0.88 * W / layer.width) / 0.9
    ang = -14 + 6 * (1 - p)
    L = layer.resize((int(layer.width * sc * 0.9), int(layer.height * sc * 0.9)), Image.LANCZOS)
    L = L.rotate(ang, expand=True, resample=Image.BICUBIC)
    paste_c(bg, L, BW0 / 2, 900 + 40 * math.sin(t * 2), alpha=p * (1 - out))
    # foam streaks
    return bg

# ---------- scene B: billboard reveal ----------
def scene_B(t, dur):
    z = 1 + 0.06 * (t / dur)  # slow push-in
    off = int(t * 18) * S
    sky = sky_base.copy()
    c = (cl1[:900 if False else 1100 if False else 0:0] if False else None)
    cl = np.zeros((1100 * S, W), np.float32); o1 = off % (600 * S); o2 = (off * 2) % (600 * S)
    cl[:900 * S] = cl1[:, o1: o1 + W] * 0.6 + cl2[:, o2: o2 + W] * 0.4
    cl = np.clip((cl - 0.45) * 2.6, 0, 1)[:, :, None]
    sky = sky + cl * (np.array([255, 245, 235]) - sky) * 0.85
    bg = Image.new("RGBA", (W, H), (240, 170, 110, 255))
    bg.paste(Image.fromarray(np.clip(sky, 0, 255).astype(np.uint8)), (0, 0))
    bg.alpha_composite(ground)
    # billboard
    cx, top = W // 2 - 10 * S, 560 * S
    sheet = Image.new("RGBA", bb_im.size, (0, 0, 0, 0))
    show = bb_final if t > 0 else bb_im
    sheet.alpha_composite(show)
    # cloth covering
    prog = ease(seg(t, 1.2, 4.6))  # pull
    if prog < 1:
        cloth = Image.new("RGBA", bb_im.size, (0, 0, 0, 0)); cd = ImageDraw.Draw(cloth)
        pad = 24 * S
        poly = [(box - pad, boy - pad - 10 * S), (box + BW + pad, boy - pad - 10 * S),
                (box + BW + pad, boy + BH + pad + 380 * S), (box - pad, boy + BH + pad + 380 * S)]
        cd.polygon(poly, fill=(205, 22, 28, 255))
        # folds
        fo = np.zeros((bb_im.height, bb_im.width), np.float32)
        xs = np.arange(bb_im.width)[None, :]; ys_ = np.arange(bb_im.height)[:, None]
        fo = 0.5 + 0.5 * np.sin(xs / (70.0 * S) + np.sin(ys_ / (160.0 * S) + t * 1.5) * 0.9)
        ca = np.asarray(cloth).astype(np.float32)
        shade = (0.78 + 0.3 * fo)[:, :, None]
        ca[:, :, :3] = np.clip(ca[:, :, :3] * shade, 0, 255)
        cloth = Image.fromarray(ca.astype(np.uint8))
        # reveal mask: diagonal sweep toward top-right; cloth is clipped by line
        xs2 = np.arange(bb_im.width)[None, :].astype(np.float32); ys2 = np.arange(bb_im.height)[:, None].astype(np.float32)
        d = (xs2 - bb_im.width) * 0.8 - (ys2 - 0) * 0.6   # increases toward bottom-left
        d = (d - d.min()) / (d.max() - d.min())
        d = 1 - d  # 0 bottom-left ... 1 top-right? invert so sweep goes up-right
        wobble = 0.03 * np.sin(ys2 / (30.0 * S) + t * 6)
        m = ((d + wobble) > prog * 1.35).astype(np.uint8) * 255
        # keep cloth where line hasn't passed
        mk = Image.fromarray(m).filter(ImageFilter.GaussianBlur(3 * S))
        cloth.putalpha(ImageChops.multiply(cloth.split()[3], mk))
        sheet.alpha_composite(cloth)
    s = z
    sheet2 = sheet.resize((int(sheet.width * s), int(sheet.height * s)), Image.LANCZOS)
    bg.alpha_composite(sheet2, (int(W / 2 - sheet2.width / 2), int(top - 40 * S * z)))
    # hand pulling cloth
    if False:
        hp = Image.new("RGBA", (260, 340), (0, 0, 0, 0)); hd = ImageDraw.Draw(hp)
        hd.rounded_rectangle([60, 120, 200, 340], 60, fill=(224, 172, 140, 255))
        hd.ellipse([40, 40, 220, 200], fill=(232, 180, 148, 255))
        hx = W - 150 - 330 * prog; hy = 380 - 520 * prog + 520 * 0
        hy = 620 - 700 * prog
        bg.alpha_composite(hp, (int(hx), int(hy)))
    # title overlays
    if t > 5.0:
        pass
    # fade out & push-in at end to white
    f = ease(seg(t, dur - 0.7, dur))
    if f > 0:
        white = Image.new("RGBA", (W, H), (255, 255, 255, int(255 * f)))
        bg.alpha_composite(white)
    # birds
    d2 = ImageDraw.Draw(bg)
    for i in range(7):
        bx = ((150 + i * 90 + t * 30) * S) % W; by = (220 + 40 * math.sin(i + t * 3) + i * 18) * S
        d2.arc([bx, by, bx + 20 * S, by + 14 * S], 200, 340, fill=(30, 30, 30, 255), width=3 * S)
        d2.arc([bx + 18 * S, by, bx + 38 * S, by + 14 * S], 200, 340, fill=(30, 30, 30, 255), width=3 * S)
    return bg

# ---------- scene C: COMING SOON + logo ----------
def insta_icon(sz, col):
    im = Image.new("RGBA", (sz, sz), (0, 0, 0, 0)); d = ImageDraw.Draw(im)
    w = max(4, sz // 12)
    d.rounded_rectangle([w, w, sz - w, sz - w], sz // 4, outline=col, width=w)
    d.ellipse([sz * .3, sz * .3, sz * .7, sz * .7], outline=col, width=w)
    d.ellipse([sz * .7, sz * .2, sz * .79, sz * .29], fill=col)
    return im

coming = text_img("COMING", 300, BLUE + (255,), 0.78)
soon = text_img("SOON", 380, BLUE + (255,), 0.78)
opening = text_img("OPENING 16 NOVEMBER 2026", 66, (255, 255, 255, 255), 0.9, spacing=3)
stay = text_img("STAY TUNED", 52, (60, 60, 70, 255), 0.9, spacing=18)
handle = text_img("@hsim.chandigarh", 64, (30, 30, 40, 255), 0.9)
ig = insta_icon(90 * S, (20, 20, 30, 255))
pill_w, pill_h = opening.width + 90 * S, 130 * S
pill = Image.new("RGBA", (pill_w, pill_h), (0, 0, 0, 0)); pd = ImageDraw.Draw(pill)
pd.rounded_rectangle([0, 0, pill_w - 1, pill_h - 1], 65 * S, fill=(215, 30, 90, 255))
pill.alpha_composite(opening, ((pill_w - opening.width) // 2, (pill_h - opening.height) // 2))
logo_big = logo.resize((860 * S, int(860 * S * logo.height / logo.width)), Image.LANCZOS)

def scene_C(t, dur):
    bg = Image.new("RGBA", (W, H), (255, 255, 255, 255))
    # logo
    a = easeout(seg(t, 0.2, 1.1))
    L = logo_big.convert("RGBA")
    paste_c(bg, L, BW0 / 2, 400 - 40 * (1 - a), alpha=a)
    # COMING / SOON slide
    p1 = easeout(seg(t, 1.0, 1.7)); p2 = easeout(seg(t, 1.5, 2.2))
    paste_c(bg, coming, BW0 / 2 - 700 * (1 - p1), 900, alpha=p1)
    paste_c(bg, soon, BW0 / 2 + 700 * (1 - p2), 1160, alpha=p2)
    # pill
    p3 = easeout(seg(t, 2.4, 3.1))
    sc = 0.7 + 0.3 * p3
    pl = pill.resize((int(pill.width * sc), int(pill.height * sc)), Image.LANCZOS)
    paste_c(bg, pl, BW0 / 2, 1410, alpha=p3)
    # stay tuned + handle
    p4 = ease(seg(t, 3.4, 4.1))
    paste_c(bg, stay, BW0 / 2, 1530, alpha=p4)
    p5 = ease(seg(t, 4.0, 4.8))
    iw, hw = ig.width / S, handle.width / S
    tot = iw + 24 + hw
    x0 = BW0 / 2 - tot / 2
    paste_c(bg, ig, x0 + iw / 2, 1700, alpha=p5)
    paste_c(bg, handle, x0 + iw + 24 + hw / 2, 1700, alpha=p5)
    # fade in from white scene B handled by B's fade
    return bg

A_END, B_END = 4.6, 12.0
for i in range(int(sys.argv[1]) if len(sys.argv) > 1 else 0, N):
    t = i / FPS
    if t < A_END:
        fr = scene_A(t, A_END)
        if t > A_END - 0.3:
            pass
    elif t < B_END:
        fr = scene_B(t - A_END, B_END - A_END)
        # crossfade-in from A
        k = seg(t, A_END, A_END + 0.4)
        if k < 1:
            prev = scene_A(A_END - 1 / FPS, A_END)
            fr = Image.blend(prev, fr, ease(k))
    else:
        fr = scene_C(t - B_END, DUR - B_END)
    fr.convert("RGB").save(os.path.join(FRAMES, f"f{i:04d}.jpg"), quality=95)
    if i % 48 == 0: print("frame", i, "/", N, flush=True)
print("done")
