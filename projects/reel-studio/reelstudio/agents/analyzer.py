"""Agent 4 - Analyzer: watches/listens to the finished video like a platform would, scores it /100 against
what works on today's Reels and LinkedIn video, and says WHICH agent must fix WHAT.

It measures the real file (ffprobe / ebur128 / silencedetect / scene detection) and checks the copy.
It cannot predict virality; it enforces the repeatable best practices that decide whether a video
even gets a chance (hook, pacing, captions, loudness, length, CTA)."""
from __future__ import annotations

import re
import subprocess

from ..config import PLATFORMS
from ..media import ffutil, fonts

PASS_SCORE = 78

HOOK_WORDS = re.compile(
    r"\?|\d|nobody|never|stop|mistake|secret|why|how|truth|wrong|before|without|worst|best|nahi|nahin|koi|galti|"
    r"kyun|kaise|sach|raaz|ruko|रुक|नहीं|कोई|गलती|क्यों|कैसे|सच|राज़|राज", re.I)
CTA_WORDS = re.compile(r"save|follow|comment|share|subscribe|like|tell me|let me know|dm|link|"
                       r"karo|kijiye|kijie|batao|bataiye|सेव|फॉलो|कमेंट|शेयर|बताइ|कीजिए|करो", re.I)


def _stderr(args: list[str]) -> str:
    return subprocess.run(["ffmpeg", "-hide_banner", "-nostats", *args], capture_output=True, text=True).stderr


def measure(video: str) -> dict:
    info = ffutil.probe(video)
    v = next(s for s in info["streams"] if s["codec_type"] == "video")
    a = next((s for s in info["streams"] if s["codec_type"] == "audio"), None)
    dur = float(info["format"]["duration"])
    m = {"width": v["width"], "height": v["height"], "vcodec": v["codec_name"], "acodec": a and a["codec_name"],
         "fps": eval(v["r_frame_rate"]), "duration": dur, "size_mb": int(info["format"]["size"]) / 1e6}
    log = _stderr(["-i", video, "-af", "ebur128=peak=true", "-vn", "-f", "null", "-"])
    summ = log.split("Summary:")[-1]
    li = re.search(r"I:\s+(-?[\d.]+)\s+LUFS", summ)
    pk = re.search(r"Peak:\s+(-?[\d.]+)\s+dBFS", summ)
    m["lufs"] = float(li.group(1)) if li else None
    m["peak"] = float(pk.group(1)) if pk else None
    sil = _stderr(["-i", video, "-af", "silencedetect=noise=-38dB:d=0.9", "-vn", "-f", "null", "-"])
    m["silences"] = [float(x) for x in re.findall(r"silence_duration:\s*([\d.]+)", sil)]
    sc = _stderr(["-i", video, "-vf", "fps=5,crop=iw:ih*0.38:0:ih*0.17,scale=240:-2,select='gt(scene,0.05)',showinfo", "-an", "-f", "null", "-"])
    raw = [float(x) for x in re.findall(r"pts_time:([\d.]+)", sc)]
    cuts = []                                    # sampled at 5fps so gradual xfade transitions register; merge <0.5s apart
    for t in raw:
        if not cuts or t - cuts[-1] > 0.5:
            cuts.append(t)
    m["cuts"] = cuts
    edges = [0.0, *cuts, dur]
    m["max_static"] = max(b - a for a, b in zip(edges, edges[1:]))
    return m


def _chk(name, got, mx, msg, fix=None):
    return {"name": name, "score": round(got, 1), "max": mx, "message": msg, "fix": fix}


def analyze(video: str, script: dict, narr, platform: str) -> dict:
    pf = PLATFORMS[platform]
    m = measure(video)
    scenes = script["scenes"]
    checks = []

    # --- Hook (25) ---------------------------------------------------------------------
    hook = scenes[0]["voiceover"]
    nwords = len(hook.split())
    lim = 12 if platform == "instagram" else 18
    s_len = 8 if nwords <= lim else max(0, 8 - (nwords - lim))
    s_pat = 9 if HOOK_WORDS.search(hook) else 3
    first_word = narr.words[0][1] if narr.words else 0
    s_voice = 4 if first_word <= 0.6 else 1
    s_vis = 4 if scenes[0].get("on_screen_text") else 0
    issues = []
    if s_len < 8:
        issues.append(f"hook is {nwords} words; cut it to {lim} or fewer")
    if s_pat < 9:
        issues.append("hook has no pattern-interrupt; open with a bold claim, a number or a question")
    checks.append(_chk("Hook (first 3 seconds)", s_len + s_pat + s_voice + s_vis, 25,
                       f"{nwords} words, voice starts at {first_word:.1f}s, "
                       f"{'pattern-interrupt present' if s_pat == 9 else 'no pattern-interrupt'}",
                       {"target": "script", "issues": issues} if issues else None))

    # --- Pacing (20) -------------------------------------------------------------------
    n_shots = len(m["cuts"]) + 1
    avg = m["duration"] / n_shots
    lo, hi = pf["shot_sec"]
    if avg <= hi * 1.25:
        s_avg = 12
    else:
        s_avg = max(0, 12 - (avg - hi * 1.25) * 5)
    s_static = 8 if m["max_static"] <= hi * 2.0 else max(0, 8 - (m["max_static"] - hi * 2.0) * 3)
    fix = {"target": "editor", "params": {"shot_scale": 0.7}, "issues": ["too slow: cut more often"]} \
        if s_avg + s_static < 17 else None
    checks.append(_chk("Pacing & visual change", s_avg + s_static, 20,
                       f"{n_shots} shots, avg {avg:.1f}s (target {lo}-{hi}s), longest static stretch {m['max_static']:.1f}s", fix))

    # --- Audio (15) --------------------------------------------------------------------
    if m["acodec"] is None or m["lufs"] is None:
        checks.append(_chk("Audio", 0, 15, "no audio track", None))
    else:
        d = abs(m["lufs"] - pf["target_lufs"])
        s_l = 8 if d <= 2 else max(0, 8 - (d - 2) * 2)
        s_p = 3 if (m["peak"] is None or m["peak"] <= -0.9) else 0
        long_sil = [x for x in m["silences"] if x > 1.2]
        s_s = 4 if not long_sil else 1
        fix = {"target": "editor", "params": {"music_mult": 0.7}, "issues": ["loudness off target"]} if s_l < 5 else None
        checks.append(_chk("Audio (loudness, peaks, dead air)", s_l + s_p + s_s, 15,
                           f"{m['lufs']:.1f} LUFS (target {pf['target_lufs']}), peak {m['peak']} dBFS, "
                           f"{len(long_sil)} dead-air gap(s) >1.2s", fix))

    # --- Captions & readability (15) --------------------------------------------------
    total_words = len(narr.words)
    wps = total_words / max(1.0, m["duration"])
    s_rate = 6 if wps <= 3.2 else max(0, 6 - (wps - 3.2) * 5)
    s_cov = 5 if total_words >= 0.9 * sum(len(s["voiceover"].split()) for s in scenes) else 2
    font_ok = script["language"] != "hindi" or (fonts.fonts_dir() / "NotoSansDevanagari-Bold.ttf").exists()
    s_font = 4 if font_ok else 1
    fix = None
    if s_rate < 4:
        fix = {"target": "script", "issues": [f"speech is too fast ({wps:.1f} words/s); shorten the script ~20%"]}
    msg = f"{wps:.1f} words/s, captions cover {total_words} words, word-by-word highlight on"
    if not font_ok:
        msg += "; Hindi font not found offline (it auto-downloads once you have internet)"
    checks.append(_chk("Captions & readability", s_rate + s_cov + s_font, 15, msg, fix))

    # --- Format & length (15) ----------------------------------------------------------
    ok_dim = (m["width"], m["height"]) == pf["size"]
    ilo, ihi = pf["ideal_sec"]
    d = m["duration"]
    s_dur = 7 if ilo <= d <= ihi else max(0, 7 - min(abs(d - ilo), abs(d - ihi)) / 5)
    s_max = 2 if d <= pf["max_sec"] else 0
    s_codec = 2 if (m["vcodec"] == "h264" and m["acodec"] == "aac" and abs(m["fps"] - 30) < 1) else 0
    s_dim = 4 if ok_dim else 0
    fix = None
    if s_dur < 5:
        direction = "shorter" if d > ihi else "longer"
        fix = {"target": "script", "issues": [f"video is {d:.0f}s, should be {ilo}-{ihi}s: make the script {direction}"]}
    checks.append(_chk("Format & length", s_dim + s_dur + s_max + s_codec, 15,
                       f"{m['width']}x{m['height']} {m['vcodec']}/{m['acodec']} {m['fps']:.0f}fps, {d:.0f}s "
                       f"(ideal {ilo}-{ihi}s), {m['size_mb']:.1f} MB", fix))

    # --- Copy: CTA, caption, hashtags (10) ---------------------------------------------
    cta_ok = bool(CTA_WORDS.search(scenes[-1]["voiceover"]))
    hmin, hmax = pf["hashtags"]
    h_ok = hmin <= len(script["hashtags"]) <= hmax
    cap = script["caption"]
    cap_ok = 0 < len(cap) <= pf["caption_limit"]
    title_ok = 0 < len(script["title"]) <= 70
    s_copy = (4 if cta_ok else 0) + (3 if h_ok else 1) + (2 if cap_ok else 0) + (1 if title_ok else 0)
    issues = [] if cta_ok else ["final scene needs a clear CTA (save / follow / comment with a question)"]
    checks.append(_chk("Copy: CTA, caption, hashtags", s_copy, 10,
                       f"CTA {'yes' if cta_ok else 'MISSING'}, {len(script['hashtags'])} hashtags (want {hmin}-{hmax}), "
                       f"caption {len(cap)} chars",
                       {"target": "script", "issues": issues} if issues else None))

    total = round(sum(c["score"] for c in checks))
    mx = sum(c["max"] for c in checks)
    return {"platform": platform, "score": total, "max": mx, "passed": total >= PASS_SCORE,
            "grade": "Ready to post" if total >= 88 else "Good - post it" if total >= PASS_SCORE else "Needs work",
            "checks": checks, "metrics": {k: v for k, v in m.items() if k != "cuts"}, "cut_times": m["cuts"]}


def contact_sheet(video: str, out: str, duration: float) -> None:
    step = max(1.0, duration / 12)
    ffutil.run(["-i", video, "-vf", f"fps=1/{step:.2f},scale=216:-2,tile=6x2", "-frames:v", "1", "-q:v", "3", out])
