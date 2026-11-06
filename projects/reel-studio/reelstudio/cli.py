from __future__ import annotations

import argparse
import os
import shutil
import sys

from . import __version__
from .config import LANGUAGES, PLATFORMS
from .env import load_env
from .pipeline import Options, run


def _stage_main(argv: list[str]) -> int:
    """Sub-commands used by the four Claude agents (each agent runs only its own)."""
    from . import stages
    ap = argparse.ArgumentParser(prog="reel.py")
    sub = ap.add_subparsers(dest="cmd", required=True)
    v = sub.add_parser("validate-script", help="Script Writer: check + normalise script.json")
    v.add_argument("file"); v.add_argument("--platform"); v.add_argument("--lang"); v.add_argument("--duration", type=int)
    f = sub.add_parser("fetch-broll", help="Visual Director: download B-roll for shots.json")
    f.add_argument("shots"); f.add_argument("--broll-dir"); f.add_argument("--orientation", default="portrait",
                                                                          choices=["portrait", "square", "landscape"])
    r = sub.add_parser("render", help="Video Editor: script.json + shots.json -> mp4")
    r.add_argument("--script", required=True); r.add_argument("--shots", required=True); r.add_argument("--out", required=True)
    r.add_argument("--platform", choices=list(PLATFORMS))
    r.add_argument("--avatar", choices=["none", "ai", "face"], default="ai")
    r.add_argument("--avatar-image"); r.add_argument("--face-video"); r.add_argument("--music"); r.add_argument("--voice")
    r.add_argument("--gender", choices=["female", "male"], default="female")
    r.add_argument("--params", help='editor tweaks as JSON, e.g. \'{"shot_scale":0.7}\'')
    n = sub.add_parser("analyze", help="Analyzer: score the mp4")
    n.add_argument("--video", required=True); n.add_argument("--script", required=True)
    n.add_argument("--narration", required=True); n.add_argument("--platform", choices=list(PLATFORMS))
    a = ap.parse_args(argv)
    load_env()
    if not shutil.which("ffmpeg"):
        print("ERROR: ffmpeg not found on PATH", file=sys.stderr)
        return 2
    return {"validate-script": stages.validate_script, "fetch-broll": stages.fetch_broll,
            "render": stages.render, "analyze": stages.analyze}[a.cmd](a)


def main(argv: list[str] | None = None) -> int:
    argv = sys.argv[1:] if argv is None else argv
    if argv and argv[0] in ("validate-script", "fetch-broll", "render", "analyze"):
        return _stage_main(argv)
    ap = argparse.ArgumentParser(
        prog="reelstudio",
        description="Topic do, Reel/LinkedIn video lo: Script -> Visuals -> Edit -> Analyze -> Download.")
    ap.add_argument("topic", nargs="?", help="video ka topic (agar na do to puchhega)")
    ap.add_argument("-p", "--platforms", nargs="+", choices=list(PLATFORMS), default=["instagram", "linkedin"])
    ap.add_argument("-l", "--lang", nargs="+", choices=list(LANGUAGES), default=["hinglish"], help="ek ya zyada bhasha")
    ap.add_argument("-d", "--duration", type=int, default=30, help="target seconds (default 30)")
    ap.add_argument("--avatar", choices=["none", "ai", "face"], default="ai",
                    help="ai = cartoon AI presenter (ya --avatar-image), face = aapki apni recorded video (--face-video)")
    ap.add_argument("--avatar-image", help="apna AI-generated avatar / photo (jpg/png)")
    ap.add_argument("--face-video", help="aapki apni recording (script padhte hue); awaaz bhi isi se li jaati hai")
    ap.add_argument("--gender", choices=["female", "male"], default="female", help="AI voice")
    ap.add_argument("--voice", help="edge-tts voice name, e.g. hi-IN-MadhurNeural (edge-tts --list-voices)")
    ap.add_argument("--broll-dir", help="apne B-roll clips/images ka folder (stock se pehle ye use honge)")
    ap.add_argument("--music", help="apna background music (mp3/wav); warna tool khud bana deta hai")
    ap.add_argument("-o", "--out", default="output")
    ap.add_argument("--max-fixes", type=int, default=2, help="analyzer ke baad kitni baar wapas sudhare (default 2)")
    ap.add_argument("--offline", action="store_true", help="LLM use mat karo (template script)")
    ap.add_argument("--keep-work", action="store_true", help="intermediate files na hatao")
    ap.add_argument("--version", action="version", version=__version__)
    a = ap.parse_args(argv)

    load_env()
    if a.offline:
        os.environ["LLM_PROVIDER"] = "offline"
    for tool in ("ffmpeg", "ffprobe"):
        if not shutil.which(tool):
            print(f"{tool} nahi mila. Install karo: https://ffmpeg.org/download.html", file=sys.stderr)
            return 2
    topic = a.topic or input("Video ka topic kya hai? ").strip()
    if not topic:
        return 1
    if a.avatar == "ai" and a.face_video:
        a.avatar = "face"
    run(Options(topic=topic, platforms=a.platforms, languages=a.lang, seconds=a.duration, avatar=a.avatar,
                avatar_image=a.avatar_image, face_video=a.face_video, gender=a.gender, voice=a.voice,
                broll_dir=a.broll_dir, music=a.music, out=a.out, max_fixes=a.max_fixes, keep_work=a.keep_work))
    return 0
